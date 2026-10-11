"""Git fixtures (2026-10-02): the repositories cases clone over git://, rebuilt from the fast-export streams in their
definition and served read-only by `git daemon` at the address the cases' URLs name.

Definition fixtures/git/<name>/fixture.yaml:
  image         a public image, pinned by digest, that ships git daemon (the server container of the runner)
  address       host:port of the cases' URLs (172.17.0.1:9418 serves git://172.17.0.1/<repo>)
  repositories  [{name, stream, stream_sha256, head, refs}]: `stream` is a fast-export of every ref of the repository,
                next to the definition; fast-import turns it back into the same commits, which the build checks
  absent        repository names the cases rely on NOT existing (an error path)
Every run: the provisioner finds the case's git://<address>/<repo> URLs (its steps, its fixture and its profile's
state scripts) and makes sure the server at that address serves exactly the fixture's refs and none of its absent
repositories. On the recording side the lab's own Git server serves them and is only checked; the conformance runner starts
a container from the pinned image (`encode-git`) on a folder with the built repositories.
"""
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import time

import caselib
import fixture

URL = re.compile(r"git://([0-9.]+|[A-Za-z][\w.-]*)(?::(\d+))?/([\w.-]+)")
CONTAINER = "encode-git"
ADDRESS = "172.17.0.1:9418"   # the lab's own Git server, and the runner's fixture server
# a public image pinned by digest that ships git daemon (mcr.microsoft.com/devcontainers/base:ubuntu, 2026-10-02)
IMAGE = "mcr.microsoft.com/devcontainers/base@sha256:edfb983aab9c579a385dc23c57d7d3703f5ec920124d99c16204a2cac465aab4"
# git without the caller's own configuration (no default branch, no hooks, no credential helpers)
GIT_ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1",
           "LANG": "C", "HOME": "/nonexistent"}


def repo_name(r):
    r = r.rstrip("/")
    return r if r.endswith(".git") else r + ".git"


def git(*args, git_dir=None, input=None, check=True, timeout=120):
    cmd = ["git"] + (["--git-dir", git_dir] if git_dir else []) + list(args)
    p = subprocess.run(cmd, capture_output=True, input=input, timeout=timeout, env=GIT_ENV)
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:2])}: {p.stderr.decode(errors='replace').strip()[:300]}")
    return p


def refs_of(git_dir):
    out = git("for-each-ref", "--format=%(refname) %(objectname)", git_dir=git_dir).stdout.decode()
    return dict(line.split(" ", 1) for line in out.splitlines() if line)


# ---------------------------------------------------------------- which fixtures a case needs
def needs(case, profile):
    """{(address, repository)} of the git:// URLs in the case's steps and fixture and its profile's state scripts."""
    text = json.dumps([case.get("steps"), case.get("fixture")], ensure_ascii=False)
    for sc in (profile or {}).get("state_scripts") or []:
        p = f"{caselib.PROFILES}/{sc}"
        if os.path.exists(p):
            text += open(p, encoding="utf-8").read()
    return {(f"{h}:{port or '9418'}", repo_name(r)) for h, port, r in URL.findall(text) if r.strip(".")}


def entries(cat=None):
    """The newest version of every Git fixture in the catalogue."""
    best = {}
    for e in (cat or fixture.load_catalog())["fixtures"]:
        if e["kind"] == "git" and (e["name"] not in best or e["version"] > best[e["name"]]["version"]):
            best[e["name"]] = e
    return sorted(best.values(), key=lambda e: e["name"])


def for_case(case, profile, cat=None):
    """([the Git fixture entries the case needs], [(address, repository) that no Git fixture provides])."""
    used, missing = {}, []
    es = entries(cat)
    for addr, repo in sorted(needs(case, profile)):
        hit = next((e for e in es if e["address"] == addr
                    and (repo in e["repositories"] or repo in (e.get("absent") or []))), None)
        if hit:
            used[hit["name"]] = hit
        else:
            missing.append((addr, repo))
    return list(used.values()), missing


# ---------------------------------------------------------------- serving
def ls_remote(addr, repo, runner=None):
    """(ok, {ref: sha}) of git://addr/repo, with HEAD under the key HEAD. runner(args) runs git elsewhere (the machine
    whose view of the address counts) and returns a text-mode CompletedProcess."""
    p = runner(["ls-remote", f"git://{addr}/{repo}"]) if runner else git("ls-remote", f"git://{addr}/{repo}", check=False, timeout=30)
    if p.returncode != 0:
        return False, {}
    out = {}
    for line in (p.stdout if isinstance(p.stdout, str) else p.stdout.decode()).splitlines():
        sha, _, ref = line.partition("\t")
        out[ref] = sha
    return True, out


def check_served(e, addr=None, runner=None):
    """Problems with what the server at the fixture's address serves (empty when it serves exactly the fixture)."""
    addr = addr or e["address"]
    problems = []
    for repo, r in e["repositories"].items():
        ok, got = ls_remote(addr, repo, runner)
        want = dict(r["refs"], HEAD=r["refs"][r["head"]])
        if not ok:
            problems.append(f"git://{addr}/{repo} is not served")
        elif {k: v for k, v in got.items() if k in want or k.startswith("refs/heads/")} != want:
            problems.append(f"git://{addr}/{repo} serves other refs than {e['name']}@{e['sha256'][:12]}")
    for repo in e.get("absent") or []:
        if ls_remote(addr, repo, runner)[0]:
            problems.append(f"git://{addr}/{repo} exists, but the cases rely on its absence")
    return problems


def start_server(es, addr=None, container=None):
    """Serve the fixtures' repositories from a container of their pinned image (the runner; a test may give another
    address and container name). Idempotent: an existing container is kept and the repositories are refreshed."""
    images = {e["image"] for e in es}
    addrs = {addr or e["address"] for e in es}
    if len(images) != 1 or len(addrs) != 1:
        raise RuntimeError(f"Git fixtures with different images or addresses cannot share a server: {images} {addrs}")
    image, addr = images.pop(), addrs.pop()
    name = container or CONTAINER
    served = f"{fixture.FIXTURES}/git/.served-{name}"
    os.makedirs(served, exist_ok=True)
    for e in es:
        with tarfile.open(fixture.fixture_file(e)) as tf:
            for top in {m.name.split("/")[0] for m in tf.getmembers()}:
                shutil.rmtree(os.path.join(served, top), ignore_errors=True)
            tf.extractall(served, filter="data")
    import driver
    env = dict(driver.BASE_ENV)
    insp = subprocess.run(["docker", "inspect", "--format", "{{.Config.Image}} {{.State.Running}}", name],
                          capture_output=True, text=True, env=env)
    host, port = addr.rsplit(":", 1)
    if insp.returncode != 0:
        subprocess.run(["docker", "run", "-d", *fixture.labiso.labels(), "--name", name, "--label", "encode.fixture=git", "--restart",
                        "unless-stopped", "-p", f"{host}:{port}:9418", "-v", f"{served}:/srv/git:ro", image,
                        "git", "-c", "safe.directory=*", "daemon", "--reuseaddr", "--export-all", "--base-path=/srv/git",
                        "/srv/git"], check=True, capture_output=True, text=True, env=env)
    else:
        img, running = insp.stdout.split()
        if img != image:
            raise RuntimeError(f"{name} runs {img}, the Git fixtures pin {image}: remove it first")
        if running != "true":
            subprocess.run(["docker", "start", name], check=True, capture_output=True, env=env)
    first = next(iter(es[0]["repositories"]))
    for _ in range(30):
        if ls_remote(addr, first)[0]:
            return addr
        time.sleep(1)
    raise RuntimeError(f"the Git fixture server at {addr} does not answer")


def ensure_served(es, runner=None):
    """Before a run: the server at each fixture's address serves exactly the fixture. Returns the fixtures' pins.
    runner: run the check's git where the run's windows and daemons are (another recording host)."""
    start_server(es)
    problems = [p for e in es for p in check_served(e, runner=runner)]
    if problems:
        raise RuntimeError("; ".join(problems))
    return [f"{e['name']}@{e['sha256'][:12]}" for e in es]


# ---------------------------------------------------------------- build
def build(name):
    path, d = fixture.definition("git", name)
    ddir = os.path.dirname(path)
    repos = {}
    with tempfile.TemporaryDirectory() as tmp:
        for r in d["repositories"]:
            sp = os.path.join(ddir, r["stream"])
            if fixture.sha256_file(sp) != r["stream_sha256"]:
                raise RuntimeError(f"{r['stream']}: sha256 differs from the definition")
            bare = os.path.join(tmp, r["name"])
            git("init", "--bare", "--quiet", bare)
            shutil.rmtree(os.path.join(bare, "hooks"), ignore_errors=True)
            with open(sp, "rb") as f:
                git("fast-import", "--quiet", git_dir=bare, input=f.read())
            git("symbolic-ref", "HEAD", r["head"], git_dir=bare)
            got = refs_of(bare)
            if got != r["refs"]:
                raise RuntimeError(f"{r['name']}: fast-import gave {got}, the definition pins {r['refs']}")
            git("gc", "--quiet", "--prune=now", git_dir=bare)
            repos[r["name"]] = {"head": r["head"], "refs": got}
        os.makedirs(f"{fixture.FIXTURES}/git/{name}", exist_ok=True)
        tmp_tar = f"{fixture.FIXTURES}/git/{name}/.build.tar.gz"
        with tarfile.open(tmp_tar, "w:gz", format=tarfile.PAX_FORMAT) as tf:
            for repo in sorted(repos):
                tf.add(os.path.join(tmp, repo), arcname=repo,
                       filter=lambda ti: (setattr(ti, "uid", 0), setattr(ti, "gid", 0), setattr(ti, "uname", ""),
                                          setattr(ti, "gname", ""), ti)[-1])
    digest = fixture.sha256_file(tmp_tar)
    final = f"{fixture.FIXTURES}/git/{name}/{name}-v{d['version']}-{digest[:12]}.tar.gz"
    os.replace(tmp_tar, final)
    fixture.put_entry({"name": name, "kind": "git", "version": d["version"], "file": os.path.relpath(final, caselib.ROOT),
                       "sha256": digest, "size": os.path.getsize(final), "build": f"{fixture.BUILD_CMD} git/{name}",
                       "definition": os.path.relpath(path, caselib.ROOT), "definition_sha256": fixture.sha256_file(path),
                       "image": d["image"], "address": d["address"], "repositories": repos,
                       "absent": list(d.get("absent") or []), "date": fixture.now(), "built_on": fixture.LOCAL_HOST})
    print(f"git {name}: {final} ({len(repos)} repositories)")


