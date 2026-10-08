#!/usr/bin/env python3
"""Versioned fixtures for the encode tools (testing-kit.md section 2a): built by script from pinned inputs, stored as
tarballs with their sha256 in fixtures/CATALOG.json, restored by the provisioner for every run. Never made by hand.

usage: fixture.py build mirror [--pull]        the local registry mirror of THIS machine's platform (container
                                               encode-registry, host daemon; fixtures/mirror/*.yaml); --pull first pulls
                                               every pinned source by digest and tags it
       fixture.py build mirror/<name> [--pull] the mirror definition named <name>
       fixture.py build engine/<name>          a golden Docker data root (fixtures/engine/<name>/fixture.yaml) for THIS
                                               machine's platform (the definition is the same for every platform)
       fixture.py build editor/<name>          a VS Code profile snapshot (fixtures/editor/<name>/fixture.yaml)
       fixture.py build git/<name>             Git repositories from fast-export streams (fixtures/git/<name>/; gitfixture.py)
       fixture.py build workspace/<name>       files a case extracts into its folder (fixtures/workspace/<name>/fixture.yaml;
                                               deterministic: the same definition gives the same sha256 everywhere)
       fixture.py verify [<name>...]           tarball hashes, the mirror's contents, definitions unchanged
       fixture.py list                         the catalogue
       fixture.py pin [--platform P] <case.yaml>...   write the current catalogue hashes into the cases' `fixtures:`
                                               block, for recording platform P (linux/arm64 | linux/x86_64; default: the
                                               stream worker's platform, else this machine's)

Platforms (2026-10-02): engine and mirror entries serve one recording platform (`platform`: linux/arm64 or linux/x86_64;
the mirror's images carry the matching image platform, linux/arm64 or linux/amd64); editor, Git and workspace fixtures
are data and serve every platform (`platform: any`). An engine definition is built once per platform: same name, version and
definition_sha256, different tarballs; a case pins the tarball of the platform it is recorded on.

Builds use the builder daemon labdind-encode-fxbuild and, for editor snapshots, the caller's own lab slot
(LAB_SLOT); the private daemon of a build is removed afterwards. Only the mirror lives on the machine's own daemon.
"""
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

import caselib
import driver
import normalize

LOCAL_HOST = "local"
BUILD_CMD = "bin/conformance build"
import labiso  # noqa: E402

FIXTURES = os.environ.get("ENCODE_FIXTURES") or f"{caselib.ROOT}/fixtures"
CATALOG = f"{FIXTURES}/CATALOG.json"
FX_WS = f"{caselib.WS_BASE}/_fixtures"          # fixed folders of fixture workspaces: _fixtures/<engine fixture>/<name>
BUILD_FID = "encode-fxbuild"
CODE = os.environ.get("ENCODE_CODE_CLI") or "/usr/share/code/bin/code"
KINDS = ("mirror", "engine", "editor", "git", "workspace")

# Editor snapshots: ONLY these profile files (relative to the slot folder). Never the extensions folder, cached VSIX
# files, extension manifests caches, an extension's CLI or scripts (AGENTS.md; R-13). An extension's own global
# storage contributes its top-level *.json files only (the allowed global-state JSON).
EDITOR_ALLOW = [
    r"user-data/User/settings\.json", r"user-data/User/keybindings\.json",
    r"user-data/User/globalStorage/(state\.vscdb|state\.vscdb\.backup|storage\.json)",
    r"user-data/User/globalStorage/[^/]+/[^/]+\.json",
    r"user-data/User/workspaceStorage/[^/]+/(workspace\.json|state\.vscdb|state\.vscdb\.backup)",
    r"user-data/machineid", r"vscode-shared/sharedStorage/state\.vscdb", r"dot-vscode/argv\.json",
]
EDITOR_DENY = [r"(^|/)extensions(/|$)", r"CachedExtensionVSIXs", r"CachedProfilesData", r"cli-bin", r"(^|/)cli(/|$)",
               r"\.(js|mjs|cjs|sh|vsix|node|exe)$"]


def now():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_catalog():
    if not os.path.exists(CATALOG):
        return {"version": 1, "fixtures": []}
    with open(CATALOG) as f:
        return json.load(f)


def save_catalog(cat):
    cat["fixtures"].sort(key=lambda e: (e["kind"], e["name"], e["version"]))
    tmp = CATALOG + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cat, f, indent=1, sort_keys=False)
        f.write("\n")
    os.replace(tmp, CATALOG)


# Engine and mirror fixtures serve one recording platform; entries written before 2026-10-02 carry none and are arm64.
PLATFORM_SPECIFIC = ("engine", "mirror")
LEGACY_PLATFORM = "linux/arm64"


def entry_platform(e):
    """The recording platform a catalogue entry serves: linux/arm64, linux/x86_64, or `any` (editor and Git data)."""
    return e.get("platform") or (LEGACY_PLATFORM if e["kind"] in PLATFORM_SPECIFIC else "any")


def serves(e, platform):
    return platform is None or entry_platform(e) in ("any", platform)


def put_entry(entry):
    cat = load_catalog()
    cat["fixtures"] = [e for e in cat["fixtures"] if not (e["kind"] == entry["kind"] and e["name"] == entry["name"]
                                                          and e["version"] == entry["version"]
                                                          and entry_platform(e) == entry_platform(entry))]
    cat["fixtures"].append(entry)
    save_catalog(cat)


def find(kind, name, sha12=None, cat=None, platform=None):
    """The catalogue entry of a fixture: the one whose hash starts with sha12, else the newest version serving
    `platform` (a recording platform; None = any entry)."""
    cat = cat or load_catalog()
    hits = [e for e in cat["fixtures"] if e["kind"] == kind and e["name"] == name]
    if sha12:
        hits = [e for e in hits if e["sha256"].startswith(sha12)]
    else:
        hits = [e for e in hits if serves(e, platform)]
    return max(hits, key=lambda e: e["version"]) if hits else None


def mirror_for(platform, cat=None):
    """The newest mirror entry serving a recording platform."""
    cat = cat or load_catalog()
    hits = [e for e in cat["fixtures"] if e["kind"] == "mirror" and serves(e, platform)]
    return max(hits, key=lambda e: e["version"]) if hits else None


# The standalone runner (D-27): fixtures are rebuilt from their definitions on the implementer's machine, so their
# tarball hashes differ from the dirty room's. ENCODE_REFERENCE_CATALOG names the catalogue as published; a pinned
# `<name>@<sha12>` then resolves to the local build of the same definition (same kind, name, definition_sha256).
REFERENCE_CATALOG = os.environ.get("ENCODE_REFERENCE_CATALOG")


def resolve_pin(kind, name, sha12, cat=None):
    """The local catalogue entry a case's pin stands for (None if there is none)."""
    if not REFERENCE_CATALOG:
        return find(kind, name, sha12, cat)
    with open(REFERENCE_CATALOG) as f:
        ref = find(kind, name, sha12, json.load(f))
    if not ref:
        return None
    local = [e for e in (cat or load_catalog())["fixtures"] if e["kind"] == kind and e["name"] == name
             and e.get("definition_sha256") == ref.get("definition_sha256") and serves(e, caselib.local_platform())]
    return max(local, key=lambda e: e["version"]) if local else None


def is_public(entry):
    """Built from public inputs only (D-27): engines and the mirror (public images by digest), and editor snapshots
    captured with no extension installed. publish_tests.py also scans a snapshot's state for the reference's id."""
    if not entry:
        return False
    if entry["kind"] == "editor":
        return not entry.get("inputs", {}).get("captured_with_extensions")
    return True


def parse_ref(ref):
    m = re.fullmatch(r"([a-z0-9][a-z0-9-]*)@([0-9a-f]{12})", str(ref or ""))
    return (m.group(1), m.group(2)) if m else (None, None)


def fixture_file(entry):
    return os.path.join(caselib.ROOT, entry["file"])


def mirror_definitions():
    """{path: definition} of every mirror definition (fixtures/mirror/*.yaml; one per image platform)."""
    import glob
    return {p: caselib.load_yaml(p) for p in sorted(glob.glob(f"{FIXTURES}/mirror/*.yaml"))}


def definition(kind, name):
    if kind == "mirror":
        defs = mirror_definitions()
        if name:   # by name
            hit = [(p, d) for p, d in defs.items() if d.get("name") == name]
        else:      # the one whose image platform is this machine's
            want = caselib.OCI_PLATFORM.get(caselib.local_platform())
            hit = [(p, d) for p, d in defs.items() if d.get("platform") == want]
        if len(hit) != 1:
            raise RuntimeError(f"no single mirror definition for {name or caselib.local_platform()} in {FIXTURES}/mirror "
                               f"({len(hit)} match)")
        return hit[0]
    path = f"{FIXTURES}/{kind}/{name}/fixture.yaml"
    return path, caselib.load_yaml(path)


def recording_platform_of_image(oci):
    """linux/amd64 -> linux/x86_64, linux/arm64 -> linux/arm64."""
    return next((rp for rp, o in caselib.OCI_PLATFORM.items() if o == oci), oci)


def run(cmd, env=None, check=True, timeout=1800, input=None):
    p = subprocess.run(cmd, capture_output=True, text=True, env=env or driver.BASE_ENV, timeout=timeout, input=input)
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:4])}: {(p.stderr or p.stdout).strip()[-600:]}")
    return p


def build_slot():
    slot = int(os.environ.get("LAB_SLOT") or 0)
    if not slot:
        sys.exit("fixture.py: builds use your own lab slot; LAB_SLOT is not set")
    return slot


# ---------------------------------------------------------------- mirror
def registry_get(addr, path, accept=None, method="GET"):
    req = urllib.request.Request(f"http://{addr}{path}", method=method)
    if accept:
        req.add_header("Accept", accept)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, dict(r.headers), r.read()


MANIFEST_TYPES = ("application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, "
                  "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json")


def mirror_has(addr, repo, digest):
    try:
        st, hdr, _ = registry_get(addr, f"/v2/{repo}/manifests/{digest}", MANIFEST_TYPES, "HEAD")
        return st == 200 and hdr.get("Docker-Content-Digest") == digest
    except Exception:
        return False


def ensure_registry(d):
    name, vol, addr, image = d["container"], d["volume"], d["address"], d["registry_image"]
    insp = run(["docker", "inspect", name], check=False)
    if insp.returncode != 0:
        run(["docker", "volume", "create", *labiso.labels(), "--label", "encode.mirror=1", vol])   # R-51: the room's label too
        host, port = addr.split(":")
        run(["docker", "run", "-d", *labiso.labels(), "--name", name, "--label", "encode.mirror=1", "--restart", "unless-stopped",
             "-p", f"{host}:{port}:5000", "-v", f"{vol}:/var/lib/registry", image])
    else:
        c = json.loads(insp.stdout)[0]
        if c["Config"]["Image"] != image:
            raise RuntimeError(f"{name} runs {c['Config']['Image']}, the definition pins {image}: remove it by hand first")
        if not c["State"]["Running"]:
            run(["docker", "start", name])
    for _ in range(30):
        try:
            if registry_get(addr, "/v2/")[0] == 200:
                return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f"registry {addr} does not answer")


def source_digests(source):
    """RepoDigests of a local image (by tag)."""
    p = run(["docker", "image", "inspect", source, "--format", "{{json .RepoDigests}}"], check=False)
    return json.loads(p.stdout) if p.returncode == 0 else []


def index_lists(img, oci):
    """Check (by public registry metadata, no pull) that a pinned single-platform manifest digest is the `oci` entry
    of the multi-platform index the definition also pins (`index_digest`)."""
    repo = img["source"].rsplit(":", 1)[0]
    raw = run(["docker", "buildx", "imagetools", "inspect", "--raw", f"{repo}@{img['index_digest']}"], timeout=120).stdout
    idx = json.loads(raw)
    os_, arch = oci.split("/", 1)
    want = [m["digest"] for m in idx.get("manifests") or [] if (m.get("platform") or {}).get("os") == os_
            and (m.get("platform") or {}).get("architecture") == arch]
    if want != [img["digest"]]:
        raise RuntimeError(f"{img['source']}: the index {img['index_digest'][:19]}... lists {want} for {oci}, the "
                           f"definition pins {img['digest']}")


def pull_sources(d):
    """Pull every pinned source by digest and tag it with its usual name (a machine without the lab's pre-pulled
    images, e.g. a new recording host). Public images only."""
    for img in d["images"]:
        repo = img["source"].rsplit(":", 1)[0]
        if img.get("index_digest"):
            index_lists(img, d["platform"])
        run(["docker", "pull", "--platform", d["platform"], f"{repo}@{img['digest']}"], timeout=1800)
        run(["docker", "tag", f"{repo}@{img['digest']}", img["source"]])


def build_mirror(name=None, pull=False):
    path, d = definition("mirror", name)
    if d["platform"] != caselib.OCI_PLATFORM.get(caselib.local_platform()):
        raise RuntimeError(f"{d['name']} holds {d['platform']} images; build it on a {d['platform']} machine "
                           f"(this one is {caselib.local_platform()})")
    if pull:
        pull_sources(d)
    ensure_registry(d)
    addr = d["address"]
    # pinned sources must be on this machine exactly at the pinned digests (the lab's pre-pulled images, or --pull)
    for img in d["images"]:
        repo = img["source"].rsplit(":", 1)[0]
        digests = source_digests(img["source"])
        want = f"{'docker.io/library/' if '/' not in repo else ''}{repo}@{img['digest']}"
        if not any(x.endswith(f"{repo}@{img['digest']}") or x == want for x in digests):
            raise RuntimeError(f"{img['source']} on this machine is not at the pinned digest {img['digest']} (has {digests})")
        if img.get("index_digest") and not pull:
            index_lists(img, d["platform"])
    labiso.SEED = [img["source"] for img in d["images"]]
    env = labiso.docker_up(BUILD_FID, build_slot(), daemon_args=["--tls=false", "--insecure-registry", addr],
                           seed=[img["source"] for img in d["images"]])
    denv = dict(driver.BASE_ENV, DOCKER_HOST=env["DOCKER_HOST"])
    contents = []
    try:
        for img in d["images"]:
            target = f"{addr}/{img['path']}"
            run(["docker", "tag", img["source"], target], env=denv)
            out = run(["docker", "push", "--platform", d["platform"], target], env=denv).stdout
            m = re.search(r"digest: (sha256:[0-9a-f]{64})", out)
            if not m:
                raise RuntimeError(f"push {target}: no digest in output")
            repo, tag = img["path"].rsplit(":", 1)
            if not mirror_has(addr, repo, m.group(1)):
                raise RuntimeError(f"mirror does not serve {repo}@{m.group(1)}")
            arch = json.loads(run(["docker", "image", "inspect", target, "--format", "{{json .Architecture}}"], env=denv).stdout)
            if f"linux/{arch}" != d["platform"]:
                raise RuntimeError(f"{img['source']} is {arch}, the mirror holds {d['platform']}")
            c = {"image": img["source"], "source_digest": img["digest"], "platform": d["platform"],
                 "mirror": f"{addr}/{repo}:{tag}", "digest": m.group(1)}
            if img.get("index_digest"):
                c["index_digest"] = img["index_digest"]
            contents.append(c)
    finally:
        labiso.docker_down(BUILD_FID)
    canon = json.dumps({"registry_image": d["registry_image"], "address": addr, "contents": contents}, sort_keys=True)
    inputs = {"registry_image": d["registry_image"], "sources": [dict({"image": i["source"], "digest": i["digest"]},
                                                                      **({"index_digest": i["index_digest"]} if i.get("index_digest") else {}))
                                                                 for i in d["images"]]}
    put_entry({"name": d["name"], "kind": "mirror", "version": d["version"], "file": None,
               "platform": recording_platform_of_image(d["platform"]),
               "sha256": hashlib.sha256(canon.encode()).hexdigest(), "build": f"{BUILD_CMD} mirror",
               "definition": os.path.relpath(path, caselib.ROOT), "definition_sha256": sha256_file(path),
               "inputs": inputs, "container": d["container"], "volume": d["volume"], "address": addr, "contents": contents,
               "date": now(), "built_on": LOCAL_HOST})
    print(f"mirror {d['name']} ({d['platform']}): {len(contents)} image(s) at {addr}")


# ---------------------------------------------------------------- engine
def fx_ws(name):
    return f"{FX_WS}/{name}"


def materialize_workspaces(entry):
    """Write an engine fixture's workspace folders at their fixed paths (idempotent; never removed by runs)."""
    base = fx_ws(entry["name"])
    for ws, files in (entry.get("contents", {}).get("workspaces") or {}).items():
        for rel, content in files.items():
            p = os.path.join(base, ws, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            if not os.path.exists(p) or open(p, encoding="utf-8").read() != content:
                with open(p, "w", encoding="utf-8") as f:
                    f.write(content)
    return base


def build_engine(name):
    path, d = definition("engine", name)
    platform = caselib.local_platform()
    mirror = mirror_for(platform)
    if not mirror or mirror.get("built_on", LOCAL_HOST) != LOCAL_HOST:
        raise RuntimeError(f"build the {platform} mirror on this machine first (fixture.py build mirror)")
    addr = mirror["address"]
    ph = {"FIXTURE_WS": fx_ws(name)}
    d = dict(d, containers=caselib.subst(d.get("containers") or [], ph))
    materialize_workspaces({"name": name, "contents": {"workspaces": d.get("workspaces") or {}}})
    labiso.SEED = []
    env = labiso.docker_up(BUILD_FID, build_slot(), daemon_args=["--tls=false", "--insecure-registry", addr], seed=[])
    dk = driver.Docker(env["DOCKER_HOST"])
    images = []
    try:
        for img in d.get("images") or []:
            src = next((c for c in mirror["contents"] if c["mirror"].endswith("/" + img["mirror"])), None)
            if not src:
                raise RuntimeError(f"{img['mirror']} is not in the mirror")
            repo = src["mirror"].rsplit(":", 1)[0]
            ref = f"{repo}@{src['digest']}"
            dk.run(["pull", ref], check=True, timeout=1800)
            dk.run(["tag", ref, img["tag"]], check=True)
            dk.run(["rmi", ref], check=True)
            info = json.loads(dk.run(["image", "inspect", img["tag"]], check=True).stdout)[0]
            if platform_name(info) != src.get("platform", mirror_platform(mirror)):
                raise RuntimeError(f"{img['tag']} pulled as {platform_name(info)}, the mirror holds {src.get('platform')}")
            images.append({"tag": img["tag"], "mirror": ref, "digest": src["digest"], "id": info["Id"],
                           "platform": platform_name(info)})
        for n in d.get("networks") or []:
            dk.run(["network", "create", *sum([["--label", f"{k}={v}"] for k, v in (n.get("labels") or {}).items()], []),
                    n["name"]], check=True)
        helper = "alpine:latest"
        for v in d.get("volumes") or []:
            dk.run(["volume", "create", *sum([["--label", f"{k}={x}"] for k, x in (v.get("labels") or {}).items()], []),
                    v["name"]], check=True)
            for rel, content in (v.get("files") or {}).items():   # R-51: private daemon (the build's)
                p = subprocess.run(["docker", "run", "-i", "--rm", "-v", f"{v['name']}:/v", helper, "sh", "-c",
                                    f"mkdir -p \"$(dirname '/v/{rel}')\" && cat > '/v/{rel}'"], input=content, text=True,
                                   capture_output=True, env=dict(driver.BASE_ENV, DOCKER_HOST=env["DOCKER_HOST"]))
                if p.returncode != 0:
                    raise RuntimeError(f"volume {v['name']}: {p.stderr.strip()[-300:]}")
        for c in d.get("containers") or []:
            args = ["--name", c["name"]]
            for k, x in (c.get("labels") or {}).items():
                args += ["--label", f"{k}={x}"]
            for m in c.get("mounts") or []:
                args += ["-v", m]
            nets = c.get("networks") or []
            if nets:
                args += ["--network", nets[0]]
            cmd = [str(x) for x in c.get("command") or []]
            st = c.get("state", "running")
            if st == "created":
                dk.run(["create", *args, c["image"], *cmd], check=True)
            elif st == "exited":
                dk.run(["run", *args, c["image"], *cmd], check=True, timeout=300)
            else:
                dk.run(["run", "-d", *args, c["image"], *cmd], check=True)
                if st == "paused":
                    dk.run(["pause", c["name"]], check=True)
            for extra in nets[1:]:
                dk.run(["network", "connect", extra, c["name"]], check=True)
        engine_version = dk.run(["version", "--format", "{{.Server.Version}}"]).stdout.strip()
        driver_name = dk.run(["info", "--format", "{{.Driver}}"]).stdout.strip()
        # stop the daemon cleanly (it stops the running containers: restored by the provisioner per run)
        run(["docker", "stop", "-t", "60", f"labdind-{BUILD_FID}"])
        os.makedirs(f"{FIXTURES}/engine/{name}", exist_ok=True)
        tmp = f"{FIXTURES}/engine/{name}/.build.tar.gz"
        labiso.save_data_root(f"labdind-{BUILD_FID}", tmp)
    finally:
        labiso.docker_down(BUILD_FID)
    digest = sha256_file(tmp)
    final = f"{FIXTURES}/engine/{name}/{name}-v{d['version']}-{digest[:12]}.tar.gz"
    os.replace(tmp, final)
    dind = json.loads(run(["docker", "image", "inspect", "docker:dind", "--format", "{{json .RepoDigests}}"]).stdout)
    put_entry({"name": name, "kind": "engine", "version": d["version"], "file": os.path.relpath(final, caselib.ROOT),
               "platform": platform,
               "sha256": digest, "size": os.path.getsize(final), "build": f"{BUILD_CMD} engine/{name}",
               "definition": os.path.relpath(path, caselib.ROOT), "definition_sha256": sha256_file(path),
               "inputs": {"images": [{"tag": i["tag"], "mirror": i["mirror"]} for i in images],
                          "mirror_sha256": mirror["sha256"], "dind_image": dind[0] if dind else "docker:dind"},
               "engine": f"docker-ce {engine_version} ({driver_name})",
               "contents": {"images": images, "networks": [n["name"] for n in d.get("networks") or []],
                            "volumes": [{"name": v["name"], "labels": v.get("labels") or {}, "files": sorted(v.get("files") or {})}
                                        for v in d.get("volumes") or []],
                            "containers": [{"name": c["name"], "image": c["image"], "state": c.get("state", "running")}
                                           for c in d.get("containers") or []],
                            "workspaces": d.get("workspaces") or {}, "workspace_root": os.path.relpath(fx_ws(name), caselib.ROOT)},
               "date": now(), "built_on": LOCAL_HOST})
    print(f"engine {name}: {final} ({os.path.getsize(final) >> 20} MiB)")


def platform_name(image_info):
    """linux/<arch> of a `docker image inspect` record (the image platform)."""
    return f"{image_info.get('Os', 'linux')}/{image_info.get('Architecture')}"


def mirror_platform(mirror):
    return caselib.OCI_PLATFORM.get(entry_platform(mirror))


def restore_states(entry, docker):
    """Bring the fixture's containers to their recorded states after the private daemon started on the data root:
    `running` -> docker start, `paused` -> start + pause (no restart policy in the fixture: it would show in
    docker inspect and change what stopping a container does). exited and created stay as the data root has them."""
    done = []
    for c in entry["contents"]["containers"]:
        if c["state"] in ("running", "paused"):
            docker.run(["start", c["name"]], check=True)
            if c["state"] == "paused":
                docker.run(["pause", c["name"]], check=True)
            done.append(f"{c['name']}={c['state']}")
    return done


# ---------------------------------------------------------------- editor
def editor_member_ok(rel):
    return any(re.fullmatch(p, rel) for p in EDITOR_ALLOW) and not any(re.search(p, rel) for p in EDITOR_DENY)


def editor_members(slot_dir, d):
    """The profile files an editor snapshot takes (EDITOR_ALLOW, never EDITOR_DENY), sorted. A definition whose `scrub`
    lists `workspace-storage` leaves out user-data/User/workspaceStorage: an empty-window capture's window state there
    holds values of the capturing machine (for example the empty window's debug.selectedroot, a settings path)."""
    members = []
    for d_, _, fs in os.walk(slot_dir):
        rel_d = os.path.relpath(d_, slot_dir)
        if re.search(EDITOR_DENY[0], rel_d):   # never descend into an extensions folder
            continue
        for fn in fs:
            rel = os.path.normpath(os.path.join(rel_d, fn))
            if editor_member_ok(rel) and os.path.isfile(os.path.join(slot_dir, rel)):
                members.append(rel)
    if "workspace-storage" in (d.get("scrub") or []):
        members = [m for m in members if not m.startswith("user-data/User/workspaceStorage/")]
    return sorted(members)


def install_extensions(slot_dir, ids, remote=None):
    """Install extensions BY ID (id@version) into a slot profile; returns `code --list-extensions --show-versions`."""
    base = [CODE, "--user-data-dir", f"{slot_dir}/user-data", "--extensions-dir", f"{slot_dir}/extensions"]
    sh = lambda c: run(c, timeout=600)  # noqa: E731
    for ext in ids:
        sh(base + ["--install-extension", ext])
    return sh(base + ["--list-extensions", "--show-versions"]).stdout.split()


def under_test_ids():
    """The extension under test: ENCODE_EXTENSION, your build (a package path or publisher.name@version)."""
    if not os.environ.get("ENCODE_EXTENSION"):
        raise RuntimeError("set ENCODE_EXTENSION to the build under test (a package path or publisher.name@version)")
    return [os.environ["ENCODE_EXTENSION"]]


def build_editor(name):
    path, d = definition("editor", name)
    slot = build_slot()
    slot_dir = f"{caselib.SLOTS_DIR}/{slot}"
    home = f"{caselib.HOMES}/{BUILD_FID}"
    lenv = dict(driver.BASE_ENV, LAB_SLOT=str(slot), LAB_HOME=home)
    run([caselib.LAB_CODE, "stop"], env=lenv, check=False)
    shutil.rmtree(slot_dir, ignore_errors=True)
    shutil.rmtree(home, ignore_errors=True)
    os.makedirs(f"{home}/.ssh", mode=0o700)
    with open(f"{home}/.gitconfig", "w") as f:
        f.write(labiso.GITCONFIG)
    os.makedirs(f"{slot_dir}/user-data/User")
    with open(f"{slot_dir}/user-data/User/settings.json", "w") as f:
        json.dump(d["settings"], f, indent=2)
    # `extensions: []` captures with nothing installed (a public fixture, D-27); the default is the reference
    exts = install_extensions(slot_dir, under_test_ids()) if d.get("extensions", ["under-test"]) else []
    ver = run([CODE, "--version"]).stdout.split()[0]
    if d.get("vscode") and ver != str(d["vscode"]):
        raise RuntimeError(f"VS Code is {ver}, the definition pins {d['vscode']}")
    sc = d.get("scenario") or {}
    folder = []
    if sc.get("workspace", "empty-window") != "empty-window":
        folder = [f"{FX_WS}/editor-{name}"]
        os.makedirs(folder[0], exist_ok=True)
    # no Docker during the capture: the window's /run/docker.sock is a dead socket, so nothing about any engine
    # (the machine's shared one included) can end up in the snapshot
    iso = f"{caselib.ISO}/{BUILD_FID}"
    os.makedirs(iso, exist_ok=True)
    dead = f"{iso}/docker.sock"
    if os.path.exists(dead):
        os.remove(dead)
    import socket
    s_ = socket.socket(socket.AF_UNIX)
    s_.bind(dead)
    s_.close()
    lenv["LAB_DOCKER_SOCK"] = dead
    try:
        run([caselib.LAB_CODE, "start", *folder], env=lenv)
        sess = driver.Session(slot, LOCAL_HOST, {"WORKSPACE": folder[0] if folder else ""})
        for i, step in enumerate(sc.get("steps") or []):
            (verb, arg), = step.items()
            res = sess.wait(arg["until"], arg["timeout"]) if verb == "wait" else sess.lab(verb, *([arg] if isinstance(arg, str) else []))
            if not res.get("ok"):
                raise RuntimeError(f"scenario step {i} {verb}: {res.get('error')}")
    finally:
        run([caselib.LAB_CODE, "stop"], env=lenv, check=False)
        time.sleep(2)
    members = editor_members(slot_dir, d)
    if "machine-ids" in (d.get("scrub") or []):   # a fixture that crosses must not carry this machine's identifiers
        members = [m for m in members if m != "user-data/machineid"]
        for rel, keys in (("user-data/User/globalStorage/storage.json", lambda k: k.startswith("telemetry.")),
                          ("dot-vscode/argv.json", lambda k: k == "crash-reporter-id")):
            fp = os.path.join(slot_dir, rel)
            if rel in members and os.path.exists(fp):
                text = open(fp).read()
                try:
                    data = json.loads(text)
                except ValueError:   # argv.json is JSON with comments: drop the line instead
                    data = None
                if isinstance(data, dict):
                    data = {k: v for k, v in data.items() if not keys(k)}
                    open(fp, "w").write(json.dumps(data, indent=1))
                else:
                    open(fp, "w").write("\n".join(l for l in text.splitlines() if '"crash-reporter-id"' not in l) + "\n")
    os.makedirs(f"{FIXTURES}/editor/{name}", exist_ok=True)
    tmp = f"{FIXTURES}/editor/{name}/.build.tar.gz"
    with tarfile.open(tmp, "w:gz", format=tarfile.PAX_FORMAT) as tf:
        for rel in members:
            ti = tf.gettarinfo(os.path.join(slot_dir, rel), arcname=rel)
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = ""
            with open(os.path.join(slot_dir, rel), "rb") as f:
                tf.addfile(ti, f)
    digest = sha256_file(tmp)
    final = f"{FIXTURES}/editor/{name}/{name}-v{d['version']}-{digest[:12]}.tar.gz"
    os.replace(tmp, final)
    shutil.rmtree(home, ignore_errors=True)
    shutil.rmtree(iso, ignore_errors=True)
    put_entry({"name": name, "kind": "editor", "version": d["version"], "file": os.path.relpath(final, caselib.ROOT),
               "sha256": digest, "size": os.path.getsize(final), "build": f"{BUILD_CMD} editor/{name}",
               "definition": os.path.relpath(path, caselib.ROOT), "definition_sha256": sha256_file(path),
               "inputs": {"vscode": ver, "settings_sha256": hashlib.sha256(json.dumps(d["settings"], sort_keys=True).encode()).hexdigest(),
                          "captured_with_extensions": exts, "scenario": sc},
               "contents": {"files": members, "excludes": "every extensions folder, cached VSIX files, extension CLI and scripts"},
               "date": now(), "built_on": LOCAL_HOST})
    print(f"editor {name}: {final} ({len(members)} files)")


# ---------------------------------------------------------------- workspace
# A workspace fixture (2026-10-03, remote-ssh-edit's corpus): files a case extracts into its case folder before its own
# fixture.files, built from a definition fixtures/workspace/<name>/fixture.yaml (name, version, description, used_by,
# files). Each entry of `files` is one of
#   {path, lines: [...], eol: lf|crlf, final_newline: true|false, bom: false, mode: "0644"}   a text file
#   {path, copy_of: <path>, eol?, final_newline?, bom?, mode?}                               a copy, other line ends ...
#   {path, symlink: <relative target>}                                                       a symbolic link
#   {path, generate: {kind: long-lines, prefix, lengths: [...], filler?, tail: [...]}}      generated text
# Lines are YAML strings (double-quoted, so tabs, trailing spaces, U+2028 and NUL stay visible). The tarball is
# deterministic (sorted members, owner 0, fixed mtime, gzip without a timestamp): one definition, one sha256, on every
# machine, so the catalogue entry serves every platform (`any`) and a rebuilt fixture equals the published one.
WS_MTIME = 946684800   # 2000-01-01T00:00:00Z
WS_NAME = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def _ws_bytes(spec, by_path):
    """The bytes of a text file entry (lines, copy_of or generate)."""
    if "copy_of" in spec:
        src = by_path.get(spec["copy_of"])
        if not src or ("lines" not in src and "generate" not in src):
            raise RuntimeError(f"{spec['path']}: copy_of {spec['copy_of']!r} is not a text file of this definition")
        base = dict(src, **{k: v for k, v in spec.items() if k in ("eol", "final_newline", "bom")})
        return _ws_bytes({k: v for k, v in base.items() if k != "copy_of"}, by_path)
    if "generate" in spec:
        g = spec["generate"]
        if g.get("kind") != "long-lines":
            raise RuntimeError(f"{spec['path']}: unknown generator {g.get('kind')!r}")
        lines = []
        for n in g["lengths"]:
            line, filler = g["prefix"], g.get("filler", "x")
            while len(line) < n:
                line += filler
            lines.append(line[:n])
        lines += list(g.get("tail") or [])
    else:
        lines = spec.get("lines")
        if not isinstance(lines, list) or not all(isinstance(x, str) for x in lines):
            raise RuntimeError(f"{spec['path']}: lines must be a list of strings")
    eol = {"lf": "\n", "crlf": "\r\n"}[spec.get("eol", "lf")]
    text = eol.join(lines)
    if lines and spec.get("final_newline", True):
        text += eol
    data = text.encode("utf-8")
    return b"\xef\xbb\xbf" + data if spec.get("bom") else data


def workspace_members(d):
    """[(path, kind, data or link target, mode)] of a workspace definition, sorted (folders along each path first)."""
    by_path = {}
    for spec in d.get("files") or []:
        p = spec.get("path", "")
        if not p or p.startswith("/") or ".." in p.split("/") or p in by_path:
            raise RuntimeError(f"bad or repeated path {p!r}")
        by_path[p] = spec
    members, dirs = [], set()
    for p in by_path:
        parts = p.split("/")
        dirs |= {"/".join(parts[:i]) for i in range(1, len(parts))}
    members += [(p, "dir", None, 0o755) for p in dirs]
    for p, spec in by_path.items():
        if "symlink" in spec:
            t = spec["symlink"]
            if not t or t.startswith("/"):
                raise RuntimeError(f"{p}: symlink targets are relative paths inside the fixture")
            members.append((p, "symlink", t, 0o777))
        else:
            members.append((p, "file", _ws_bytes(spec, by_path), int(str(spec.get("mode", "0644")), 8)))
    return sorted(members, key=lambda m: m[0])


def workspace_tarball(members):
    import gzip
    import io
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as tf:
        for path, kind, data, mode in members:
            ti = tarfile.TarInfo(path)
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = ""
            ti.mtime, ti.mode = WS_MTIME, mode
            if kind == "dir":
                ti.type = tarfile.DIRTYPE
                tf.addfile(ti)
            elif kind == "symlink":
                ti.type, ti.linkname = tarfile.SYMTYPE, data
                tf.addfile(ti)
            else:
                ti.size = len(data)
                tf.addfile(ti, io.BytesIO(data))
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb", mtime=0, compresslevel=9, filename="") as gz:
        gz.write(raw.getvalue())
    return out.getvalue()


def build_workspace(name):
    if not WS_NAME.match(name):
        raise RuntimeError(f"bad workspace fixture name {name!r}")
    path, d = definition("workspace", name)
    if not isinstance(d, dict) or d.get("name") != name or not isinstance(d.get("version"), int):
        raise RuntimeError(f"{path}: needs name: {name} and an integer version")
    members = workspace_members(d)
    blob = workspace_tarball(members)
    digest = hashlib.sha256(blob).hexdigest()
    folder = os.path.dirname(path)
    for old in os.listdir(folder):   # one tarball per version: an older build of the same version goes
        if re.fullmatch(rf"{re.escape(name)}-v{d['version']}-[0-9a-f]{{12}}\.tar\.gz", old) and digest[:12] not in old:
            os.remove(os.path.join(folder, old))
    final = os.path.join(folder, f"{name}-v{d['version']}-{digest[:12]}.tar.gz")
    with open(final, "wb") as f:
        f.write(blob)
    entry = {
        "name": name, "kind": "workspace", "version": d["version"], "platform": "any",
        "file": os.path.relpath(final, caselib.ROOT), "sha256": digest, "size": len(blob),
        "build": f"{BUILD_CMD} workspace/{name}",
        "definition": os.path.relpath(path, caselib.ROOT), "definition_sha256": sha256_file(path),
        "inputs": {"format": "workspace definition (lines as YAML strings; deterministic tar.gz)"},
        "contents": {"files": [m[0] for m in members if m[1] == "file"],
                     "symlinks": {m[0]: m[2] for m in members if m[1] == "symlink"},
                     "modes": {m[0]: oct(m[3])[2:].zfill(4) for m in members if m[1] == "file" and m[3] != 0o644},
                     "used_by": d.get("used_by") or []},
        "description": " ".join(str(d.get("description") or "").split()),
        "date": now(), "built_on": LOCAL_HOST,
    }
    put_entry(entry)
    print(f"workspace {name}: {entry['file']} ({len(entry['contents']['files'])} files, "
          f"{len(entry['contents']['symlinks'])} links) sha256 {digest}")
    return entry


def workspace_rebuilds(entry):
    """True when the entry's definition still gives exactly its tarball (the definition is the source)."""
    _, d = definition("workspace", entry["name"])
    return hashlib.sha256(workspace_tarball(workspace_members(d))).hexdigest() == entry["sha256"]


def workspace_paths(paths):
    """A case's fixture.workspace_paths as [(source, destination)]: a list keeps each path, a mapping renames."""
    if paths is None:
        return None
    return list(paths.items()) if isinstance(paths, dict) else [(p, p) for p in paths]


def workspace_selection(entry, paths):
    """(missing sources, {member path: destination path}) of a case's selection; paths None = every member. A source
    names a file or link of the fixture, or a folder (everything under it, renamed along)."""
    names = list((entry.get("contents") or {}).get("files") or []) + list(((entry.get("contents") or {}).get("symlinks") or {}))
    pairs = workspace_paths(paths)
    if pairs is None:
        return [], {n: n for n in names}
    out, missing = {}, []
    for src, dst in pairs:
        src, dst = str(src).strip("/"), str(dst).strip("/")
        hit = [n for n in names if n == src or n.startswith(src + "/")]
        if not hit:
            missing.append(src)
        out.update({n: dst + n[len(src):] for n in hit})
    return missing, out


def extract_workspace(entry, dest, paths=None):
    """Extract a workspace fixture's selected members into a case folder (modes and relative links as built). Returns
    the destination paths written."""
    missing, sel = workspace_selection(entry, paths)
    if missing:
        raise RuntimeError(f"workspace fixture {entry['name']} has no {', '.join(missing)}")
    root = os.path.realpath(dest)
    written = []
    with tarfile.open(fixture_file(entry)) as tf:
        for m in tf.getmembers():
            if m.name not in sel or m.isdir():
                continue
            target = os.path.join(dest, sel[m.name])
            parent = os.path.realpath(os.path.dirname(target))
            if parent != root and not parent.startswith(root + os.sep):
                raise RuntimeError(f"workspace fixture {entry['name']}: {sel[m.name]} leaves the case folder")
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if os.path.lexists(target):
                os.remove(target)
            if m.issym():
                if m.linkname.startswith("/"):
                    raise RuntimeError(f"workspace fixture {entry['name']}: {m.name} links to an absolute path")
                os.symlink(m.linkname, target)
            elif m.isfile():
                with tf.extractfile(m) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
                os.chmod(target, m.mode & 0o777)
            else:
                raise RuntimeError(f"workspace fixture {entry['name']}: {m.name} is neither a file nor a link")
            written.append(sel[m.name])
    return sorted(written)


# ---------------------------------------------------------------- verify / list / pin
def verify(names=()):
    cat, bad = load_catalog(), 0
    for e in cat["fixtures"]:
        if names and e["name"] not in names:
            continue
        msgs = []
        if e.get("definition") and os.path.exists(os.path.join(caselib.ROOT, e["definition"])) and \
                sha256_file(os.path.join(caselib.ROOT, e["definition"])) != e.get("definition_sha256"):
            msgs.append("definition changed since the build (rebuild and bump its version)")
        if e["kind"] == "mirror" and e.get("built_on", LOCAL_HOST) != LOCAL_HOST:
            print(f"{e['kind']:7} {e['name']}@{e['sha256'][:12]} v{e['version']}: served on {e['built_on']}; "
                  f"verify it there (ENCODE_THIS_HOST={e['built_on']} fixture.py verify {e['name']})")
            continue
        if e["kind"] == "mirror":
            for c in e["contents"]:
                repo = c["mirror"].split("/", 1)[1].rsplit(":", 1)[0]
                if not mirror_has(e["address"], repo, c["digest"]):
                    msgs.append(f"mirror does not serve {repo}@{c['digest']}")
        else:
            f = fixture_file(e)
            if not os.path.exists(f) and not serves(e, caselib.local_platform()):
                print(f"{e['kind']:7} {e['name']}@{e['sha256'][:12]} v{e['version']} [{entry_platform(e)}]: another "
                      f"platform's tarball, not on this machine (verified on its own hosts)")
                continue
            if not os.path.exists(f):
                msgs.append(f"tarball missing: {e['file']}")
            elif sha256_file(f) != e["sha256"]:
                msgs.append("tarball hash differs from the catalogue")
            elif e["kind"] == "workspace" and not msgs and not workspace_rebuilds(e):
                msgs.append("the definition gives another tarball (rebuild; bump the version if a case pinned it)")
        bad += bool(msgs)
        print(f"{e['kind']:7} {e['name']}@{e['sha256'][:12]} v{e['version']} [{entry_platform(e)}]: "
              + ("; ".join(msgs) if msgs else "ok"))
    return 1 if bad else 0


def list_catalog():
    for e in load_catalog()["fixtures"]:
        size = (f"{e['size'] >> 20} MiB" if e["size"] >= 1 << 20 else f"{e['size'] >> 10} KiB") if e.get("size") else ""
        print(f"{e['kind']:7} {e['name']:21} v{e['version']}  {entry_platform(e):12}  {e['sha256'][:12]}  {size:>8}  {e['date']}  "
              f"{e.get('file') or e.get('address') + ' on ' + e.get('built_on', '?')}")
        if e["kind"] == "mirror":
            for c in e["contents"]:
                print(f"          {c['image']} ({c['source_digest'][:19]}...) -> {c['mirror']}@{c['digest']}")


def default_platform():
    """The recording platform a pin is for: the stream worker's (ENCODE_WORKER), else this machine's."""
    return caselib.local_platform()


def pin(paths, platform=None):
    platform = platform or default_platform()
    for p in paths:
        case = caselib.load_yaml(p)
        # the profile's CURRENT version (profiles get bumped, e.g. 2026-10-01 to the public editor fixture)
        pname, pver = caselib.parse_profile_ref(case["profile"])
        prof = caselib.load_yaml(f"{caselib.PROFILES}/{pname}.yaml")
        binds = {}
        for env in prof.get("environments") or []:
            if env.get("fixture"):
                e = find(env["kind"], env["fixture"], platform=platform)
                if not e:
                    raise SystemExit(f"{p}: fixture {env['kind']}/{env['fixture']} is not built for {platform}")
                binds[env["id"]] = f"{env['fixture']}@{e['sha256'][:12]}"
        def ws_pin(m):   # a case's workspace fixture (fixture.workspace_fixture): the newest build of that name
            e = find("workspace", m.group(2))
            if not e:
                raise SystemExit(f"{p}: workspace fixture {m.group(2)} is not in the catalogue")
            binds["workspace_fixture"] = f"{m.group(2)}@{e['sha256'][:12]}"
            return f"{m.group(1)}{m.group(2)}@{e['sha256'][:12]}"
        text = re.sub(r"(?m)^(\s+workspace_fixture:\s*)([a-z0-9][a-z0-9-]*)@[0-9a-f]{12}", ws_pin,
                      open(p, encoding="utf-8").read())
        if pver != prof["version"]:
            text = re.sub(rf"^profile: {re.escape(pname)}@{pver}(?!\d)", f"profile: {pname}@{prof['version']}", text, count=1, flags=re.M)
        block = "fixtures:\n" + "".join(f"  {k}: {v}\n" for k, v in binds.items() if k != "workspace_fixture")
        if re.search(r"^fixtures:\n(  .*\n)*", text, re.M):
            text = re.sub(r"^fixtures:\n(  .*\n)*", block, text, count=1, flags=re.M)
        else:
            text = re.sub(r"^(profile:.*\n)", r"\1" + block, text, count=1, flags=re.M)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"{os.path.relpath(p, caselib.ROOT)}: profile {pname}@{prof['version']}, {platform}, "
              + ", ".join(f"{k}={v}" for k, v in binds.items()))




def main(a):
    pull = "--pull" in a
    a = [x for x in a if x != "--pull"]
    if a[:1] == ["build"] and len(a) == 2:
        if a[1].split("/")[0] == "mirror":
            build_mirror(a[1].split("/", 1)[1] if "/" in a[1] else None, pull=pull)
        elif a[1].split("/")[0] == "engine":
            build_engine(a[1].split("/", 1)[1])
        elif a[1].split("/")[0] == "editor":
            build_editor(a[1].split("/", 1)[1])
        elif a[1].split("/")[0] == "git":
            import gitfixture
            gitfixture.build(a[1].split("/", 1)[1])
        elif a[1].split("/")[0] == "workspace":
            build_workspace(a[1].split("/", 1)[1])
        else:
            sys.exit(__doc__)
    elif a[:1] == ["verify"]:
        return verify(a[1:])
    elif a[:1] == ["list"]:
        list_catalog()
    elif a[:1] == ["pin"] and len(a) > 1:
        plat = None
        if "--platform" in a:
            i = a.index("--platform")
            plat = a[i + 1]
            a = a[:i] + a[i + 2:]
            if plat not in caselib.PROFILE_ARCH:
                sys.exit(f"--platform is one of {sorted(caselib.PROFILE_ARCH)}")
        pin([os.path.abspath(x) for x in a[1:]], plat)
    else:
        sys.exit(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
