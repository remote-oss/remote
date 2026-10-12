"""Provision and tear down one recording run from versioned fixtures (testing-kit.md 2a), then remove all of it again.

Order (the profile is a graph; provisionable today: editor -docker-socket-> engine, and an editor alone):
  engine   fixture workspaces at their fixed paths -> private daemon on a COPY of the engine fixture's data root
           (labiso.docker_up with data_root) -> running/paused containers restored (fixture.restore_states);
           an editor-only profile has no daemon: the window gets a dead Docker socket instead
  HOME     fresh (<homes>/encode-s<slot>)
  folder   the case workspace <workspaces>/<case-id>, fresh: the case's workspace fixture (fixture.workspace_fixture,
           selected by fixture.workspace_paths), its fixture.files over it, its fixture.links
  editor   slot profile replaced by the editor fixture snapshot -> settings merged (remote.SSH.configFile removed
           unless the profile or case sets it) -> extensions installed BY ID (the extension under test) -> nothing
           started yet (user-data exists before the extensions folder, so lab-code never copies its own extension set
           over it)
  case     declarative fixture containers and volumes -> the profile's state scripts, in order -> the case's
           fixture.modes (last, so the window sees them)
  window   lab-code start -> ready wait
Teardown: window, daemon (with everything in it), case workspace and HOME (write permission restored first). Fixture workspaces stay (shared, read-only by
convention; record_batch never runs two cases of the same engine fixture with workspaces at once).
"""
import json
import re
import os
import shlex
import shutil
import subprocess
import sys
import tarfile
import time

import caselib
import driver
import fixture
import gitfixture

LABISO_DIR = os.path.dirname(os.path.abspath(__file__))   # dind.py, through its labiso.py shim
import labiso  # noqa: E402

CODE = fixture.CODE
GITCONFIG = labiso.GITCONFIG
SHIMS_DIR = os.environ.get("ENCODE_SHIMS_DIR", "")   # optional; bin/lab-code puts it first on the window's PATH
DAEMON_ARGS = ["--tls=false"]   # dockerd waits 15 s before serving an unauthenticated TCP socket unless told explicitly
VERIFIED = f"{fixture.FIXTURES}/.verified.json"   # (size, mtime) -> sha256 of tarballs already hashed on this host


class ProvisionError(RuntimeError):
    pass


def make_writable(path):
    """u+rwX over a folder tree on this machine, so a case's read-only files and folders (fixture.modes, a state
    script's) can be removed: chmod -R changes each folder before it descends and never follows a symbolic link."""
    if os.path.isdir(path) and not os.path.islink(path):
        subprocess.run(["chmod", "-R", "u+rwX", path], capture_output=True, timeout=300)


def remove_tree(path):
    make_writable(path)
    shutil.rmtree(path, ignore_errors=True)


def verified_sha256(path):
    st = os.stat(path)
    key = f"{path}|{st.st_size}|{st.st_mtime_ns}"
    try:
        cache = json.load(open(VERIFIED))
    except (OSError, ValueError):
        cache = {}
    if key not in cache:
        cache = {k: v for k, v in cache.items() if not k.startswith(path + "|")}
        cache[key] = fixture.sha256_file(path)
        tmp = f"{VERIFIED}.{os.getpid()}"
        json.dump(cache, open(tmp, "w"))
        os.replace(tmp, VERIFIED)
    return cache[key]


def counterpart(e, platform, cat):
    """The build of the same fixture definition (kind, name, version, definition_sha256) for another platform."""
    hits = [x for x in cat["fixtures"] if x["kind"] == e["kind"] and x["name"] == e["name"] and x["version"] == e["version"]
            and x.get("definition_sha256") == e.get("definition_sha256") and fixture.serves(x, platform)]
    return hits[0] if len(hits) == 1 else None


def case_fixtures(case, profile, platform=None, counterparts=False):
    """{env id: catalogue entry} for the fixtures the case names; raises ProvisionError on any mismatch (also when an
    engine fixture is another platform's build than `platform`, the recording host's). counterparts: use the same
    definition's build for `platform` instead (a replay or confirmation of a case on a platform it was not recorded on;
    a recording never does this: a case is pinned for the platform it is recorded on)."""
    out, cat = {}, fixture.load_catalog()
    for env in profile.get("environments") or []:
        if not env.get("fixture"):
            continue
        name, sha12 = fixture.parse_ref((case.get("fixtures") or {}).get(env["id"]))
        if name != env["fixture"]:
            raise ProvisionError(f"the case must name fixtures.{env['id']}: {env['fixture']}@<sha12> (fixture.py pin)")
        e = fixture.resolve_pin(env["kind"], name, sha12, cat)
        if not e:
            raise ProvisionError(f"fixture {env['kind']}/{name}@{sha12} is not in the catalogue")
        if platform and not fixture.serves(e, platform) and counterparts:
            e = counterpart(e, platform, cat) or e
        if platform and not fixture.serves(e, platform):
            raise ProvisionError(f"fixtures.{env['id']}: {name}@{sha12} is the {fixture.entry_platform(e)} build; this host "
                                 f"records {platform}: pin the case for it (fixture.py pin --platform {platform})")
        out[env["id"]] = e
    return out


# the placeholders only a per-case SSH target defines (provision_ssh_target, step 8)
TARGET_PH = re.compile(r"\$\{(?:SSH_HOST|SSH_HOST_UPPER|SSH_TARGET_ADDR)\}")


TARGET_ENV_RE = re.compile(r"\bENC_SSH_(?:HOST|TARGET_ADDR)\b|\$\{(?:SSH_HOST|SSH_HOST_UPPER|SSH_TARGET_ADDR)\}")


def target_substituted(body, ph):
    """A late state script's text with ${SSH_HOST} and ${SSH_TARGET_ADDR} replaced by the run's values (themis on #188:
    the placeholder moved the script late but stayed literal). The values are an ssh alias and an IPv4 address, which
    need no quoting in either quote style; anything else is refused rather than written into a shell script."""
    def value(m):
        v = str(ph.get(m.group(0)[2:-1]) or "")
        if not re.fullmatch(r"[\w.-]+", v):
            raise ProvisionError(f"state script: {m.group(0)} has no plain value in this run ({v!r})")
        return v
    return TARGET_PH.sub(value, body)


def uses_fingerprints(case):
    """Whether a case needs its target's fingerprints bound: it names ${SSH_TARGET_FINGERPRINT[_NEW]} or rekeys."""
    text = json.dumps(case)
    return "${SSH_TARGET_FINGERPRINT" in text or any(isinstance(s, dict) and "target" in s for s in case.get("steps") or [])


def names_target(body):
    """Whether a state script uses the SSH target: ENC_SSH_HOST or ENC_SSH_TARGET_ADDR, or a placeholder for them."""
    return bool(TARGET_ENV_RE.search(body))


def split_target_scripts(scripts, per_case_target):
    """([(name, body)] run at step 6, [(name, body)] run after the per-case target exists), in profile order each."""
    late = [x for x in scripts if per_case_target and names_target(x[1])]
    return [x for x in scripts if x not in late], late


def split_target_settings(settings, per_case_target):
    """(written at step 4, written after the per-case target exists): a top-level setting that names the target in its
    key or anywhere in its value goes second, whole; without a per-case target everything goes first."""
    late = {k: v for k, v in settings.items() if per_case_target and TARGET_PH.search(json.dumps({k: v}))}
    return {k: v for k, v in settings.items() if k not in late}, late

class Run:
    def __init__(self, case, profile, slot, host, run_id, log=print, counterparts=False):
        self.case, self.profile, self.slot, self.host, self.run_id = case, profile, int(slot), host, run_id
        self.counterparts = counterparts   # replay/confirm on another platform: the same fixture definitions' builds for it
        self.log = log
        self.fid = f"encode-s{self.slot}"
        self.ws = caselib.workspace_of(case["id"])
        self.home = f"{caselib.HOMES}/{self.fid}"
        self.slot_dir = f"{caselib.SLOTS_DIR}/{self.slot}"
        self.state_dir = f"{caselib.ISO}/{self.fid}/state"
        self.env = {}          # LAB_DOCKER_SOCK, DOCKER_HOST (of the private daemon), LAB_HOME
        self.docker = None
        self.t0 = time.time()
        self.info = {"fid": self.fid, "steps": []}
        self.editor_env, self.engine_env = caselib.topology(profile)   # NotProvisionable -> not-applicable
        # an SSH window: on the recording host's own SSH host (the case folder has the same path there), or on a target
        # made for this run (an sshtarget `variant`, kit #170: set by provision_ssh_target once the HOME exists)
        self.ssh_variant = caselib.ssh_variant(profile)
        self.late_settings = {}   # settings naming the per-case target, written once it exists (step 8)
        self.late_scripts = []    # state scripts naming it, run once it exists (step 8)
        self.late_files = {}      # fixture.files whose content names it, written once it exists (step 8)
        # fixture.window_start (athena on F-2409): local = the window starts on the case folder here, and the case's steps
        # open the SSH window; the run's R-63 rule is then its own target on its case folder only (LAB_RUN_TARGET)
        self.local_start = (case.get("fixture") or {}).get("window_start", "remote") == "local"
        self.ssh_run = f"{self.fid}-{case['id']}".lower() if self.ssh_variant else None
        self.ssh_agent = None
        self.ssh_host = (caselib.ssh_host(host) if caselib.ssh_target(profile) is not None and not self.ssh_variant
                         else None)
        if caselib.ssh_target(profile) is not None and not self.ssh_variant and not self.ssh_host:
            raise caselib.NotProvisionable(caselib.provisionable(profile, host))
        self.fixtures = {}
        self.known_names = list((self.engine_env or {}).get("known_names") or [])
        self.ph = {
            "WORKSPACE": self.ws, "WORKSPACE_NAME": os.path.basename(self.ws), "CASE": case["id"],
            "HOME": self.home, "SLOT_DIR": self.slot_dir, "STATE_DIR": self.state_dir,
            "ISO": f"{caselib.ISO}/{self.fid}", "FIXTURES_WS": fixture.FX_WS, "ROOT": caselib.ROOT,
        }
        if self.ssh_host:
            self.set_ssh_host(self.ssh_host)   # normalized to ${SSH_HOST}; cases may name it so in waits and settings
        # ${EXT_ID}: the id of the extension under test, for settings keyed by it (remote.extensionKind ...); a case never
        # names an identity itself, and observations already show it as ${EXT_ID} (normalize)
        self.ph["EXT_ID"] = (fixture.normalize.identity_config().get("reimplementation") or {}).get("extension_id") or ""

    # ---- host plumbing
    @property
    def remote(self):
        return None   # every run is on this machine

    @property
    def synced(self):
        """The host keeps its own copy of the workspaces (no shared folder): folders are copied there for each run."""
        return False

    def sh(self, cmd, env=None, input=None, timeout=600, check=False):
        """Run a command list on the run's host (env: extra variables)."""
        env = env or {}
        p = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, input=input, timeout=timeout,
                           env=dict(driver.BASE_ENV, **{k: str(v) for k, v in env.items()}))
        if check and p.returncode != 0:
            raise ProvisionError(f"{' '.join(map(str, cmd[:3]))}: exit {p.returncode}: {(p.stderr or p.stdout).strip()[:400]}")
        return p

    def step(self, name, **kw):
        self.info["steps"].append(dict(name=name, t=round(time.time(), 1), since_start=round(time.time() - self.t0, 1), **kw))
        self.log(f"  [{self.run_id}] {name}")


    # ---- provisioning
    def provision(self):
        self.fixtures = case_fixtures(self.case, self.profile, caselib.host_platform(self.host), self.counterparts)
        eng = self.fixtures[self.engine_env["id"]] if self.engine_env else None   # None: an editor-only profile
        edi = self.fixtures[self.editor_env["id"]]
        for e in (x for x in (eng, edi) if x):
            if verified_sha256(fixture.fixture_file(e)) != e["sha256"]:
                raise ProvisionError(f"{e['file']}: hash differs from the catalogue (fixture.py verify)")
        self.info["fixtures"] = {k: f"{e['name']}@{e['sha256'][:12]}" for k, e in self.fixtures.items()}
        if eng:
            self.provision_engine(eng)
        else:
            self.no_engine()
        self.provision_rest(eng)

    def no_engine(self):
        """An editor-only profile: no daemon. The window gets a dead Docker socket (as an editor fixture build does),
        so nothing about any engine, the machine's shared one included, is reachable from it."""
        dead = f"{self.ph['ISO']}/docker.sock"
        code = ("import os,socket,sys; d=sys.argv[1]; os.makedirs(os.path.dirname(d), exist_ok=True)\n"
                "if os.path.lexists(d): os.remove(d)\n"
                "s=socket.socket(socket.AF_UNIX); s.bind(d); s.close()")
        self.sh(["python3", "-c", code, dead], check=True)   # on the run's host, where the window starts
        self.env["LAB_DOCKER_SOCK"] = dead
        self.info["engine"] = None
        self.step("engine", fixture=None, note="editor-only profile: no Docker engine, a dead socket for the window")

    def provision_engine(self, eng):
        self.known_names += [c["name"] for c in eng["contents"]["containers"]]
        # 1. engine: fixture workspaces at their fixed paths, then a private daemon on a copy of the data root
        fixture.materialize_workspaces(eng)
        tar = fixture.fixture_file(eng)
        code = ("import json,sys; sys.path.insert(0, %r); import labiso; labiso.LABEL = labiso.LABEL or %r; "
                "print(json.dumps(labiso.docker_up(%r, %r, data_root=%r, daemon_args=%r)))") % (
            LABISO_DIR, labiso.LABEL, self.fid, str(self.slot), tar, DAEMON_ARGS)
        p = self.sh(["python3", "-c", code], timeout=900)
        if p.returncode != 0:
            raise ProvisionError("private daemon: " + p.stderr.strip()[-600:])
        self.env.update(json.loads(p.stdout.strip().splitlines()[-1]))
        self.docker = driver.Docker(self.env["DOCKER_HOST"], self.remote)
        restored = fixture.restore_states(eng, self.docker)
        ver = self.docker.run(["version", "--format", "{{.Server.Version}}"]).stdout.strip()
        self.info["engine"] = f"docker-ce {ver} (private dind on {eng['name']}@{eng['sha256'][:12]})"
        self.step("engine", fixture=self.info["fixtures"][self.engine_env["id"]], restored=restored)

    def provision_rest(self, eng):
        fx = self.case.get("fixture") or {}
        edi = self.fixtures[self.editor_env["id"]]
        # 1b. Git fixtures: the repositories the case clones (git://<address>/<repo>), served at that address
        gits, missing = gitfixture.for_case(self.case, self.profile)
        runner = None
        if missing:
            raise ProvisionError("no Git fixture provides " + ", ".join(f"git://{a}/{r}" for a, r in missing))
        if gits:
            try:
                self.info["git"] = gitfixture.ensure_served(gits, runner)
            except (RuntimeError, subprocess.SubprocessError) as e:
                raise ProvisionError(f"Git fixture: {e}")
            self.step("git", fixtures=self.info["git"])
        # 2. fresh HOME
        if self.editor_env.get("home", "private") == "private":
            self.sh(["sh", "-c", 'test -d "$1" && chmod -R u+rwX "$1"; rm -rf "$1"', "sh", self.home])
            self.sh(["mkdir", "-p", f"{self.home}/.ssh"], check=True)
            self.sh(["chmod", "700", f"{self.home}/.ssh"])
            self.sh(["sh", "-c", f"cat > {shlex.quote(self.home)}/.gitconfig"], input=GITCONFIG, check=True)
            self.env["LAB_HOME"] = self.home
            self.step("home", path=self.home)
        # 3. case workspace (always written on this machine; the lab hosts share the folder): the workspace fixture's
        # files, then the case's own files over them, then its symbolic links (its modes come last, see 7)
        remove_tree(self.ws)
        os.makedirs(self.ws)
        wsfx = self.workspace_fixture(fx)
        # a file whose content names the per-case target waits for it, step 8 (dirty-side, F-2502: an alias written into
        # an ssh configuration file; the same rule as the settings and state scripts). The target mounts the folder live.
        texts = {rel: c if isinstance(c, str) else json.dumps(c, indent=2) for rel, c in (fx.get("files") or {}).items()}
        self.late_files = {rel: t for rel, t in texts.items() if self.ssh_variant and TARGET_PH.search(t)}
        for rel, text in texts.items():
            if rel not in self.late_files:
                self.write_case_file(rel, text)
        for rel, target in (fx.get("links") or {}).items():
            path = os.path.join(self.ws, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            if os.path.lexists(path) and not os.path.isdir(path):
                os.remove(path)
            os.symlink(target, path)
        self.step("workspace", files=sorted((fx.get("files") or {}).keys()), links=sorted((fx.get("links") or {}).keys()),
                  **({"workspace_fixture": wsfx} if wsfx else {}))
        # 4. editor: the profile snapshot, then the extensions BY ID; VS Code is not started yet
        self.sh([caselib.LAB_CODE, "stop"], env={"LAB_SLOT": self.slot})
        etar = fixture.fixture_file(edi)
        self.sh(["rm", "-rf", self.slot_dir], check=True)
        os.makedirs(self.slot_dir)
        with tarfile.open(etar) as tf:
            tf.extractall(self.slot_dir, filter="data")
        # state.vscdb.backup is the editor's copy of a state database, written when the database closes; a snapshot
        # may carry one, and folder pickers over the profile then list it (remote-oss/remote#72 triage). Never provision it.
        self.sh(["find", f"{self.slot_dir}/user-data", "-name", "state.vscdb.backup", "-delete"], check=True)
        settings_path = f"{self.slot_dir}/user-data/User/settings.json"
        # a setting that names the per-case target (${SSH_HOST}, ${SSH_TARGET_ADDR}, in its key or value) waits for the
        # target, step 8 (dirty-side, F-2409 2026-10-12: written here it kept the literal placeholder and matched no host)
        now, self.late_settings = split_target_settings(
            dict(self.editor_env.get("settings") or {}, **(fx.get("settings") or {})), bool(self.ssh_variant))
        extra = caselib.subst(now, self.ph)
        self.write_settings(settings_path, extra)
        ids = []
        # An SSH window needs the Remote - SSH extensions: a profile that names nothing besides the extension under test
        # gets the companions too
        exts = caselib.profile_extensions(self.editor_env, "under-test")   # [] or [none]: nothing
        if self.ssh_host and not set(exts) - {"under-test"}:
            exts.append("companions")
        for x in exts:
            # "companions": the extensions an SSH window needs besides the one under test (ENCODE_COMPANIONS, ids or packages)
            ids += (fixture.under_test_ids() if x == "under-test" else os.environ.get("ENCODE_COMPANIONS", "").split()
                    if x == "companions" else [x])
        for ext in fx.get("extensions") or []:
            how, _ = caselib.FIXTURE_EXTENSIONS[ext]
            ids.append(os.path.join(os.environ.get("ENCODE_VSIX_DIR", f"{caselib.ROOT}/vsix"), ext) if how == "vsix" else ext)
        try:
            self.info["extensions"] = fixture.install_extensions(self.slot_dir, ids, self.remote)
        except RuntimeError as e:
            raise ProvisionError(f"extension install: {e}")
        self.step("editor", fixture=self.info["fixtures"][self.editor_env["id"]], settings=extra, extensions=self.info["extensions"])
        # 5. the case's own containers and volumes, labelled with the case id
        if (fx.get("volumes") or fx.get("containers")) and not self.docker:
            raise ProvisionError("the case declares containers or volumes, but its profile has no engine")
        for v in fx.get("volumes") or []:
            if v.get("state", "present") == "absent":
                self.docker.run(["volume", "rm", "-f", v["name"]])
                continue
            args = ["volume", "create", "--label", f"encode.case={self.case['id']}"]
            for k, val in caselib.subst(v.get("labels") or {}, self.ph).items():
                args += ["--label", f"{k}={val}"]
            self.docker.run(args + [v["name"]], check=True)
        for c in fx.get("containers") or []:
            self.make_container(c)
        if fx.get("volumes") or fx.get("containers"):
            self.step("case-docker", containers=[c["name"] for c in fx.get("containers") or []],
                      volumes=[v["name"] for v in fx.get("volumes") or []])
        # 6. the profile's state scripts, on top of the golden fixtures
        senv = {"ENC_CASE": self.case["id"], "ENC_SLOT": self.slot, "ENC_WORKSPACE": self.ws,
                "ENC_STATE_DIR": self.state_dir, "ENC_SETTINGS": settings_path,
                "ENC_HOME": self.env.get("LAB_HOME", ""), "ENC_DOCKER_SOCK": self.env.get("LAB_DOCKER_SOCK", ""),
                "ENC_RELAY_UNIT": f"labdind-relay-{self.fid}", "ENC_LABEL": f"encode.case={self.case['id']}",
                "ENC_FIXTURES_WS": fixture.FX_WS, "ENC_ISO_ROOT": caselib.ISO, "ENC_WS_ROOT": caselib.WS_BASE,
                "ENC_HOMES_ROOT": caselib.HOMES, "ENC_SLOTS_ROOT": caselib.SLOTS_DIR, "ENC_SHIMS_DIR": SHIMS_DIR,
                "ENC_FIXTURE_NAMES": " ".join([c["name"] for c in eng["contents"]["containers"]]
                                              + [v["name"] for v in eng["contents"]["volumes"]]) if eng else "",
                "DOCKER_HOST": self.env.get("DOCKER_HOST", "")}
        if self.ssh_host:   # an SSH window: the host it reaches and the folder it opens there
            senv.update(ENC_SSH_HOST=self.ssh_host, ENC_REMOTE_FOLDER=self.ws)
        # the shared guards (state/lib/guard.sh) go ahead of every script: the scripts check paths only against the roots
        # above, through them, wherever the script runs (another lab host has no copy of the lib folder)
        lib = f"{caselib.PROFILES}/state/lib"
        guard = open(f"{lib}/guard.sh", encoding="utf-8").read() if os.path.exists(f"{lib}/guard.sh") else ""
        senv["ENC_STATE_LIB"] = lib
        # a script that names the per-case target runs after it exists, step 8 (athena on F-2409: the same rule as the
        # case's settings); one that names a target this run has none of is refused, never run with an empty value
        scripts = [(s, open(f"{caselib.PROFILES}/{s}", encoding="utf-8").read()) for s in self.profile.get("state_scripts") or []]
        now, self.late_scripts = split_target_scripts(scripts, bool(self.ssh_variant))
        for script, body in now:
            if names_target(body) and not self.ssh_host:
                raise ProvisionError(f"state script {script} names the SSH target, and this run has none")
        self.state_env, self.state_guard = senv, guard
        for script, body in now:
            self.run_state_script(script, body)
        # 7. the case's file modes, last, so the window sees them whatever a state script did (the teardown gives the
        # owner write permission back before it removes the folder). With a file written after the target they wait for
        # it (triton on #197: a mode for a file not yet written was refused, and a folder's mode could block writing it)
        if not self.late_files:
            self.apply_modes(fx.get("modes") or {})
        # what the case owns from here on: everything its private daemon holds now (engine fixture, case fixture,
        # state scripts); engine steps add what they create (see owns_container / owns_volume)
        self.owned = {"containers": {c["name"] for c in self.docker.containers()},
                      "volumes": {v["name"] for v in self.docker.volumes([])}} if self.docker else \
            {"containers": set(), "volumes": set()}

    def write_case_file(self, rel, text):
        """One of the case's own files, over a workspace fixture's file or link of the same name, placeholders substituted."""
        path = os.path.join(self.ws, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.lexists(path) and not os.path.isdir(path):
            os.remove(path)   # a workspace fixture's file or link of the same name (it may be read-only)
        with open(path, "w", encoding="utf-8") as f:
            f.write(caselib.subst(text, self.ph))

    def run_target(self):
        """The run's R-63 rule for the driver under fixture.window_start: local: its own per-case target on its case
        folder (LAB_RUN_TARGET, which kitlib.remote_policy accepts only inside the room's own rule); None otherwise."""
        return f"{self.ssh_host}:{self.ws}" if self.local_start and self.ssh_variant and self.ssh_host else None

    def run_state_script(self, script, body):
        p = self.sh(["bash", "-s"], env=self.state_env, input=self.state_guard + "\n" + body, timeout=600)
        self.step("state-script", script=script, exit=p.returncode, output=(p.stdout + p.stderr).strip()[-1500:])
        if p.returncode != 0:
            raise ProvisionError(f"state script {script} failed: {(p.stderr or p.stdout).strip()[-400:]}")

    def set_ssh_host(self, alias):
        """${SSH_HOST} and its upper-case form ${SSH_HOST_UPPER} (athena on F-2409 BR-3/AC-4: a host key in another letter
        case must not match, so a case types the run's alias in upper case without naming it). A case that names the
        upper form on an alias with no letters would pass vacuously: refused."""
        self.ph["SSH_HOST"], self.ph["SSH_HOST_UPPER"] = alias, alias.upper()
        if alias.upper() == alias and "${SSH_HOST_UPPER}" in json.dumps(self.case):
            raise ProvisionError(f"the case names ${{SSH_HOST_UPPER}}, but the alias {alias!r} has no letters: its upper-case "
                                 "form is the alias itself, so the case would test nothing")

    def host_fingerprints(self):
        """Every host key the per-case target serves: [(key type, SHA256:<base64>, MD5:<hex pairs>)], read inside the
        target (sshtarget hostkeys), so every route works: a port, a jump host, a proxy, an inner network."""
        p = self.sshtarget("hostkeys", self.ssh_run, self.ssh_variant.split("+")[0], timeout=60)
        if p.returncode != 0:
            raise ProvisionError("the per-case target's host keys: " + (p.stderr or p.stdout).strip()[-300:])
        out = [tuple(l.split()[:3]) for l in p.stdout.splitlines() if len(l.split()) >= 3]
        if not out:
            raise ProvisionError("the per-case target reported no host key")
        return sorted(out)

    def bind_fingerprints(self, name):
        """${<name>}: the target's own fingerprints, every key type in both forms (athena on #198: bound values, so a
        wrong fingerprint stays literal and fails). normalize maps every bound value back; a case that names the
        placeholder in a wait or check gets the ssh-ed25519 SHA256 form, ssh's default (fingerprint_for_case)."""
        keys = self.host_fingerprints()
        keys.sort(key=lambda k: k[0] != "ssh-ed25519")   # ssh's default key first: the value a case gets (caselib._one)
        self.ph[name] = " ".join(v for _, sha, md5 in keys for v in (sha, md5))
        return keys

    def target_action(self, action):
        """One declarative step on the per-case target. `target: rekey`: new host keys, ${SSH_TARGET_FINGERPRINT_NEW}
        bound to them; the old ones keep ${SSH_TARGET_FINGERPRINT}. Returns a transcript record."""
        if action != "rekey":
            return {"ok": False, "error": f"unknown target action {action!r}"}
        if not self.ssh_run:
            return {"ok": False, "error": "target: rekey needs a per-case SSH target"}
        p = self.sshtarget("rekey", self.ssh_run, self.ssh_variant.split("+")[0], timeout=120)
        if p.returncode != 0:
            return {"ok": False, "error": "sshtarget rekey: " + (p.stderr or p.stdout).strip()[-300:]}
        try:
            keys = self.bind_fingerprints("SSH_TARGET_FINGERPRINT_NEW")
        except ProvisionError as e:
            return {"ok": False, "error": str(e)}
        return {"ok": True, "action": "rekey", "key_types": [k for k, _, _ in keys]}

    def write_settings(self, path, values):
        """Merge values into the slot's settings.json. A snapshot's remote.SSH.configFile (a path on the machine that
        captured it) never reaches a run: the window uses the SSH config of its own HOME unless the profile or the case
        sets the key (to a ${HOME} path)."""
        merge = ("import json,sys; p=sys.argv[1]; d=json.load(open(p)); d.pop('remote.SSH.configFile', None); "
                 "d.update(json.loads(sys.stdin.read())); json.dump(d, open(p,'w'), indent=2)")
        self.sh(["python3", "-c", merge, path], input=json.dumps(values), check=True)

    def workspace_fixture(self, fx):
        """Extract the case's workspace fixture (fixture.workspace_fixture, pinned <name>@<sha12>) into the case folder:
        every member, or the ones fixture.workspace_paths selects. Returns <name>@<sha12> of the build used."""
        name, sha12 = fixture.parse_ref(fx.get("workspace_fixture"))
        if not name:
            return None
        e = fixture.resolve_pin("workspace", name, sha12)
        if not e:
            raise ProvisionError(f"workspace fixture {name}@{sha12} is not in the catalogue")
        if verified_sha256(fixture.fixture_file(e)) != e["sha256"]:
            raise ProvisionError(f"{e['file']}: hash differs from the catalogue (fixture.py verify)")
        try:
            fixture.extract_workspace(e, self.ws, fx.get("workspace_paths"))
        except (RuntimeError, OSError, tarfile.TarError) as err:
            raise ProvisionError(f"workspace fixture: {err}")
        return f"{e['name']}@{e['sha256'][:12]}"

    def apply_modes(self, modes):
        """chmod the case's files and folders (fixture.modes: path -> octal string), never through a link."""
        if not modes:
            return
        done = {}
        for rel, mode in sorted(modes.items(), key=lambda kv: -len(kv[0])):   # deepest first: a folder may lose x
            path = os.path.normpath(os.path.join(self.ws, rel))
            if os.path.islink(path) or not os.path.lexists(path):
                raise ProvisionError(f"fixture.modes: {rel} is {'a link' if os.path.islink(path) else 'not in the case folder'}")
            os.chmod(path, int(mode, 8))
            done[rel] = mode
        self.step("modes", modes=done)

    def make_container(self, c):
        name, state = c["name"], c.get("state", "running")
        self.docker.run(["rm", "-f", name])
        if state == "absent":
            return
        args = ["run", "-d", "--name", name, "--label", f"encode.case={self.case['id']}"]
        for k, val in caselib.subst(c.get("labels") or {}, self.ph).items():
            args += ["--label", f"{k}={val}"]
        cmd = c.get("command") or (["true"] if state == "exited" else ["sleep", "infinity"])
        self.docker.run(args + [c["image"]] + [str(x) for x in cmd], check=True)
        if state == "exited":
            self.docker.run(["wait", name], timeout=120)
        elif state == "paused":
            self.docker.run(["pause", name], check=True)


    def start_window(self, mode="start"):
        folder = [] if (self.case.get("fixture") or {}).get("workspace", "folder") == "empty-window" else [self.ws]
        env = {"LAB_SLOT": str(self.slot)}
        for k in ("LAB_DOCKER_SOCK", "LAB_HOME"):
            if self.env.get(k):
                env[k] = self.env[k]
        # fixture.env: the case's own window variables (names the room allows; a path only inside the case workspace or
        # the run's lab HOME, refused before the window starts), handed through lab-code's LAB_PASSENV
        try:
            case_env = caselib.window_env_values((self.case.get("fixture") or {}).get("env"), self.ws, self.env.get("LAB_HOME"))
        except ValueError as e:
            raise ProvisionError(str(e))
        bad = caselib.window_env_errors(case_env)
        if bad:
            raise ProvisionError("; ".join(bad))
        env.update(case_env)
        if case_env:
            env["LAB_PASSENV"] = " ".join(sorted(case_env))
        if case_env:
            self.step("window-env", names=sorted(case_env))
        if self.ssh_host:
            # an SSH window on the case folder (an empty SSH window without one); its ssh authenticates with the
            # slot's lab agent (the throwaway lab key), never the recorder's own agent. With window_start: local the
            # window opens the folder here and the case's steps connect; the agent is the same either way
            if not self.local_start:
                folder = [f"--remote=ssh-remote+{self.ssh_host}"] + folder
            if self.ssh_agent:   # a per-run target: the run's own agent (a socket under LAB_HOME, which lab-code keeps)
                env["SSH_AUTH_SOCK"] = self.ssh_agent
            else:
                env["LAB_AGENT"] = "lab"
        p = subprocess.run([caselib.LAB_CODE, mode, *folder], capture_output=True, text=True, timeout=300,
                           env=dict(driver.BASE_ENV, **env))
        self.step("window" if mode == "start" else "window-restart", exit=p.returncode, output=(p.stdout + p.stderr).strip()[-400:])
        if p.returncode != 0:
            raise ProvisionError("window did not start: " + (p.stderr or p.stdout).strip()[-400:])

    def ready(self, session, timeout=120, label="ready"):
        """The window answers and shows its folder (or any title for an empty window), then the screen is quiet. An
        SSH window first connects: its title names the host ([SSH: <host>]), with a longer bound."""
        cond = [{"title": os.path.basename(self.ws)}] if (self.case.get("fixture") or {}).get("workspace", "folder") != "empty-window" else []
        if self.ssh_host and not self.local_start:
            cond.append({"title": f"[SSH: {self.ssh_host}]"})
            timeout = max(timeout, 300)
        r = session.wait(cond + [{"quiet": 3}], timeout)
        self.step(label, ok=r["ok"], polls=r.get("polls"))
        if label == "ready":
            self.info["provision_seconds"] = round(time.time() - self.t0, 1)
        if not r["ok"]:
            raise ProvisionError("window not ready: " + r.get("error", ""))
        return r

    # ---- mid-case steps (record.py): engine actions, settings, restart. Declarative only; never a shell line.
    def verify_daemon(self):
        """Refuse any daemon but the run's own: the client must point at the run's relay port, and the daemon behind
        it must be the dind container labdind-<fid> of this run (its hostname is that container's)."""
        if getattr(self, "_daemon_ok", False):
            return
        dh = self.env.get("DOCKER_HOST", "")
        # the relay port labiso.docker_up gives this slot (23750 + slot; slots 51-54 on the x86_64 recording host are 238xx)
        if not self.docker or self.docker.docker_host != dh or dh != f"tcp://127.0.0.1:{23750 + self.slot}":
            raise ProvisionError(f"refusing: {getattr(self.docker, 'docker_host', None)!r} is not this run's private daemon")
        inner = self.docker.run(["info", "--format", "{{.Name}}"]).stdout.strip()
        outer = self.sh(["docker", "inspect", "-f", "{{.Config.Hostname}}", f"labdind-{self.fid}"]).stdout.strip()
        if not inner or inner != outer:
            raise ProvisionError(f"refusing: the daemon at {dh} is not labdind-{self.fid} ({inner!r} != {outer!r})")
        self._daemon_ok = True

    def owns_container(self, c):
        """A container is the case's when its daemon held it at the end of provisioning, an engine step made it, or the
        window under test made it for this case (labelled for the case folder, a fixture folder, or the case)."""
        lab = c.get("labels") or {}
        folder = lab.get("devcontainer.local_folder", "")
        return (c["name"] in self.owned["containers"] or lab.get("encode.case") == self.case["id"]
                or folder == self.ws or folder.startswith(self.ws + "/") or folder.startswith(fixture.FX_WS + "/"))

    def owns_volume(self, v, containers):
        lab = v.get("labels") or {}
        return (v["name"] in self.owned["volumes"] or lab.get("encode.case") == self.case["id"]
                or "vsch.local.repository" in lab
                or any(c["name"] in v.get("used_by", []) for c in containers if self.owns_container(c)))

    def engine_action(self, action):
        """One declarative engine step on the case's own private daemon. Returns a transcript record."""
        self.verify_daemon()
        (kind, arg), = caselib.subst(action, self.ph).items()
        rec = {"action": kind, "arg": arg, "results": []}
        if kind in ("pause", "unpause", "stop", "start", "kill", "remove"):
            flt = {"name": arg} if isinstance(arg, str) else arg
            cons = self.docker.containers()
            hits = [c for c in cons if driver.match_filter(c, flt, "containers")]
            if not hits:
                return dict(rec, ok=False, error=f"no container in the case's daemon matches {flt}")
            foreign = [c["name"] for c in hits if not self.owns_container(c)]
            if foreign:
                return dict(rec, ok=False, error=f"refusing: {foreign} do not belong to the case")
            verb = ["rm", "-f"] if kind == "remove" else [kind]
            for c in sorted(hits, key=lambda c: c["name"]):
                p = self.docker.run(verb + [c["name"]], timeout=120)
                rec["results"].append({"name": c["name"], "exit": p.returncode, "stderr": p.stderr.strip()[-300:]})
        elif kind == "create_volume":
            args = ["volume", "create", "--label", f"encode.case={self.case['id']}"]
            for k, val in (arg.get("labels") or {}).items():
                args += ["--label", f"{k}={val}"]
            p = self.docker.run(args + [arg["name"]])
            self.owned["volumes"].add(arg["name"])
            rec["results"].append({"name": arg["name"], "exit": p.returncode, "stderr": p.stderr.strip()[-300:]})
        elif kind == "remove_volume":
            cons = self.docker.containers()
            vols = [v for v in self.docker.volumes(cons) if v["name"] == arg]
            if not vols:
                return dict(rec, ok=False, error=f"no volume {arg!r} in the case's daemon")
            if not self.owns_volume(vols[0], cons):
                return dict(rec, ok=False, error=f"refusing: volume {arg!r} does not belong to the case")
            p = self.docker.run(["volume", "rm", arg])
            rec["results"].append({"name": arg, "exit": p.returncode, "stderr": p.stderr.strip()[-300:]})
        elif kind == "run":
            same = [c for c in self.docker.containers() if c["name"] == arg["name"]]
            if same and not self.owns_container(same[0]):
                return dict(rec, ok=False, error=f"refusing: a container {arg['name']!r} exists and does not belong to the case")
            try:
                self.make_container(arg)
                self.owned["containers"].add(arg["name"])
                st = next((c["state"] for c in self.docker.containers() if c["name"] == arg["name"]), "absent")
                rec["results"].append({"name": arg["name"], "exit": 0, "state": st})
            except RuntimeError as e:
                rec["results"].append({"name": arg["name"], "exit": 1, "stderr": str(e)[-300:]})
        else:
            return dict(rec, ok=False, error=f"unknown engine action {kind}")
        bad = [r for r in rec["results"] if r["exit"] != 0]
        return dict(rec, ok=not bad, error=(f"docker failed for {[r['name'] for r in bad]}: {bad[0].get('stderr')}" if bad else None))

    def merge_settings(self, values):
        """Merge a user edit into the slot's settings.json (null removes a key), as one atomic replace of the file:
        VS Code watches the file and reloads it, as after an edit in its own settings editor."""
        values = caselib.subst(values, self.ph)
        path = f"{self.slot_dir}/user-data/User/settings.json"
        code = ("import json,os,sys; p=sys.argv[1]; d=json.load(open(p)); v=json.loads(sys.stdin.read())\n"
                "for k,x in v.items():\n    d.pop(k,None) if x is None else d.__setitem__(k,x)\n"
                "t=p+'.encode-tmp'; f=open(t,'w'); json.dump(d,f,indent=2); f.flush(); os.fsync(f.fileno()); f.close()\n"
                "os.replace(t,p)")
        p = self.sh(["python3", "-c", code, path], input=json.dumps(values))
        return {"ok": p.returncode == 0, "error": p.stderr.strip()[-300:] or None, "merged": values}

    def restart(self, session):
        """lab-code restart semantics: the same slot profile, case folder, HOME and private daemon; then the ready wait."""
        t = time.time()
        self.start_window(mode="restart")
        session.window = None
        r = self.ready(session, label="restart-ready")
        return {"ok": True, "seconds": round(time.time() - t, 1), "polls": r.get("polls")}

    # ---- teardown
    def teardown(self):
        out = {}
        env = {"LAB_SLOT": str(self.slot)}
        p = subprocess.run([caselib.LAB_CODE, "stop"], capture_output=True, text=True, timeout=120,
                           env=dict(driver.BASE_ENV, **env))
        out["window_stopped"] = p.returncode == 0
        code = "import sys; sys.path.insert(0, %r); import labiso; labiso.docker_down(%r)" % (LABISO_DIR, self.fid)
        p = self.sh(["python3", "-c", code], timeout=300)
        left = self.sh(["docker", "ps", "-aq", "--filter", f"name=labdind-{self.fid}"]).stdout.strip()
        vol = self.sh(["docker", "volume", "ls", "-q", "--filter", f"name=labdind-{self.fid}"]).stdout.strip()
        out["daemon_removed"] = p.returncode == 0 and not left and not vol
        remove_tree(self.ws)   # read-only files and folders of the case first get their owner's write permission back
        out["workspace_removed"] = not os.path.exists(self.ws)
        if self.env.get("LAB_HOME"):
            self.sh(["sh", "-c", 'test -d "$1" && chmod -R u+rwX "$1"; rm -rf "$1"', "sh", self.home])
            out["home_removed"] = self.sh(["test", "-e", self.home]).returncode != 0
        unit = self.sh(["systemctl", "--user", "is-active", f"lab-code-{self.slot}"]).stdout.strip()
        out["window_unit"] = unit or "inactive"
        return out

    # ---- recorded metadata
    def versions(self):
        ids = {str((fixture.normalize.identity_config().get("reimplementation") or {}).get("extension_id") or "").lower()}
        refver = next((e.split("@", 1)[1] for e in self.info.get("extensions", []) if e.split("@", 1)[0].lower() in ids), None)
        key = "extension_version"
        code = self.sh([CODE, "--version"]).stdout.split()
        # the recording platform: linux/arm64 or linux/x86_64 (caselib.platform_of); a case counts for it only
        return {key: refver, "vscode_version": code[0] if code else None,
                "platform": caselib.platform_of(self.sh(["uname", "-m"]).stdout.strip())}
