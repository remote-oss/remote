"""Shared helpers for the conformance "encode" tools (D-22): paths, loading cases and profiles, placeholders, and
rewriting the recorder-owned blocks of a case file without touching what the writer wrote.

A case file is YAML. The writer owns every top-level key except RECORDER_KEYS, which only the recorder (record.py)
writes (it strips and re-appends them, so the writer's comments and layout survive a re-recording).
"""
import glob
import os
import re

import yaml

# The lab driver's own failures (kit/lab/lab.mjs): "lab error: …" and its waits' "timed out after N ms waiting for …".
# Such a text is the tool failing, never behavior of the product: an observation holding one is a failed step, and an
# expect may not contain one (remote-ssh-edit, 2026-10-06: two agreeing timeouts were "recorded" as the expectation).
LAB_ERROR = re.compile(r"lab error:|timed out after (?:\d+ ms|<DURATION>) waiting for")   # <DURATION>: normalized


def lab_error_in(value):
    """The first lab-driver error text anywhere in an observation or expect value, or None."""
    if isinstance(value, str):
        m = LAB_ERROR.search(value)
        return value[max(0, m.start() - 20):m.start() + 160] if m else None
    if isinstance(value, dict):
        value = list(value.values())
    if isinstance(value, (list, tuple)):
        for v in value:
            hit = lab_error_in(v)
            if hit:
                return hit
    return None


# Every location can be set from the environment (ENCODE_*); the defaults are the machine's own layout.
_env = os.environ.get
_RUNNER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # .../tests/conformance/runner
ROOT = _env("ENCODE_ROOT") or _env("CONFORMANCE_WORK") or os.path.expanduser("~/conformance-work")   # scratch space
TESTS = _env("ENCODE_TESTS") or os.path.join(os.path.dirname(_RUNNER), "suite")
PROFILES = f"{TESTS}/profiles"
RECORDINGS = _env("ENCODE_RECORDINGS") or f"{ROOT}/results/transcripts"
RESULTS = _env("ENCODE_RESULTS") or f"{ROOT}/results"
WS_BASE = _env("ENCODE_WORKSPACES") or f"{ROOT}/workspaces/encode"
HOMES = _env("ENCODE_HOMES") or f"{ROOT}/homes"
ISO = _env("ENCODE_ISO") or f"{ROOT}/iso"
SLOTS_DIR = _env("ENCODE_SLOTS_DIR") or f"{ROOT}/slots"
SPECS = _env("ENCODE_SPECS") or f"{ROOT}/specs"            # not shipped with the suite: spec lookups find nothing
FEATURES = _env("ENCODE_FEATURES") or f"{ROOT}/features"   # likewise
LAB = _env("ENCODE_LAB") or f"{_RUNNER}/bin/lab"
LAB_CODE = _env("ENCODE_LAB_CODE") or f"{_RUNNER}/bin/lab-code"
RECORDER_MARK = "# --- written by the recorder (encode/record.py; do not edit by hand) ---"

RECORDER_KEYS = ("status", "expect", "recorded", "flaky", "observations", "failure")

# images a fixture or profile may seed into the private daemon (the base images the fixtures are built from)
BASE_IMAGES = (
    "mcr.microsoft.com/devcontainers/base:ubuntu", "mcr.microsoft.com/devcontainers/base:alpine",
    "mcr.microsoft.com/devcontainers/javascript-node:22", "mcr.microsoft.com/devcontainers/python:3",
    "alpine:latest", "postgres:16-alpine",
)
# extensions a case fixture may install into the run's slot, by id or as a package file; value: (how, only-for-feature)
FIXTURE_EXTENSIONS = {
    "memfs-sample.vsix": ("vsix", None), "remote-ssh.vsix": ("vsix", None), "remote-ssh-edit.vsix": ("vsix", None),
    "remote-explorer.vsix": ("vsix", None), "ms-azuretools.vscode-containers": ("id", None),
    "ms-azuretools.vscode-docker": ("id", None), "GitHub.copilot-chat": ("id", "F-0811"),
}
# Recording platforms (2026-10-02): a case's recorded.platform names the platform its expect was recorded on, from the
# recording machine's `uname -m`. A case counts only for that platform (and any platform recorded.confirmed adds).
PLATFORM_OF_MACHINE = {"aarch64": "linux/arm64", "arm64": "linux/arm64", "x86_64": "linux/x86_64", "amd64": "linux/x86_64"}
PROFILE_ARCH = {"linux/arm64": "arm64", "linux/x86_64": "x86_64"}       # a profile's `arch:` names
OCI_PLATFORM = {"linux/arm64": "linux/arm64", "linux/x86_64": "linux/amd64"}   # image platforms (mirror, engine fixtures)


def platform_of(machine):
    """linux/<arch> of a `uname -m` value (an unknown machine keeps its own name)."""
    m = str(machine or "").strip()
    return PLATFORM_OF_MACHINE.get(m, f"linux/{m}" if m else None)


def local_platform():
    return platform_of(os.uname().machine)


def case_platforms(case):
    """The platforms a recorded case's expect is valid for: recorded.platform, plus every platform recorded.confirmed
    lists (a replay there matched the expect). Empty when the case was never recorded."""
    rec = (case or {}).get("recorded") or {}
    out = [rec["platform"]] if rec.get("platform") else []
    for c in rec.get("confirmed") or []:
        if isinstance(c, dict) and c.get("platform") and c["platform"] not in out:
            out.append(c["platform"])
    return out


_a, _, _b = (_env("ENCODE_SLOTS") or "31-32").partition("-")   # free slots of this machine, "a-b"
SLOTS = {"local": range(int(_a), int(_b or _a) + 1)}
LOCAL_HOST = "local"
HOST_INFO = {"local": {"platform": local_platform(), "remote": None, "workspaces": "local", "git": "container"}}


def host_info(host):
    return HOST_INFO.get(host) or HOST_INFO["local"]


def host_platform(host):
    return host_info(host)["platform"]


def host_remote(host):
    return None


def ssh_host(host):
    """The SSH host an SSH-window profile reaches: ENCODE_SSH_HOST, an ssh alias of this machine whose sessions see
    the case folders at the same paths (runner/README.md); None when unset."""
    return _env("ENCODE_SSH_HOST") or None


def provisionable(profile, host):
    """None when a profile can run on `host`, else why not (topology, then what the shape needs from the host)."""
    try:
        topology(profile)
    except NotProvisionable as e:
        return str(e)
    if ssh_target(profile) is not None and not ssh_variant(profile) and not ssh_host(host):
        return f"an SSH-window profile, and {host} names no SSH host (hosts.yaml: ssh_target, or provides ssh-target)"
    return None


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def case_paths(feature=None):
    pat = f"{TESTS}/{feature or 'F-[0-9][0-9][0-9][0-9]'}/F-*-AC*-*.yaml"
    return sorted(glob.glob(pat))


def parse_profile_ref(ref):
    m = re.fullmatch(r"([a-z0-9][a-z0-9-]*)@(\d+)", str(ref or ""))
    return (m.group(1), int(m.group(2))) if m else (None, None)


def load_profile(ref):
    name, version = parse_profile_ref(ref)
    if not name:
        raise ValueError(f"bad profile reference {ref!r} (want <name>@<version>)")
    path = f"{PROFILES}/{name}.yaml"
    if not os.path.exists(path):
        raise ValueError(f"profile {name} not defined ({path})")
    prof = load_yaml(path)
    if prof.get("version") != version:
        raise ValueError(f"profile {name} is version {prof.get('version')}, the case wants @{version}")
    return prof


# fixture.env (athena's ruling, 2026-10-12; F-2305's askpass relay): a case may pass named variables to its window. The
# room allow-lists the names ([lab] window_env); a value may use ${WORKSPACE} (the case folder) and ${HOME} (the run's
# private lab HOME, never the recorder's), and a value that is a path must resolve inside one of them.
# Never allowed, whatever the room says: the guard's own variables and anything credential-shaped.
WINDOW_ENV_DENY = re.compile(r"^(?:SSH_AUTH_SOCK|SSH_AGENT_PID|DR_[A-Z_]*|CC_[A-Z_]*|KIT[A-Z_]*|LAB_[A-Z_]*|ENCODE_[A-Z_]*|"
                             r"DOCKER_[A-Z_]*|KUBECONFIG|GH_[A-Z_]*|GITHUB_[A-Z_]*|GIT_ASKPASS|SSH_ASKPASS|"
                             r"ANTHROPIC_[A-Z_]*|CLAUDE_[A-Z_]*|OPENAI_[A-Z_]*|AWS_[A-Z_]*|AZURE_[A-Z_]*|"
                             r"HOME|PATH|LD_[A-Z_]*|PYTHON[A-Z_]*|NODE_[A-Z_]*|XDG_[A-Z_]*|DISPLAY|DBUS_[A-Z_]*|"
                             r"[A-Z_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|API_KEY|APIKEY|PRIVATE_KEY))$")
WINDOW_ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")


def window_env_names():
    """The names the room lets a case pass to its window ([lab] window_env), refusing any WINDOW_ENV_DENY name."""
    import json   # the package's allow-list, in its rules.json beside the suite (publish_tests.rules_json)
    path = _env("ENCODE_RULES") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules.json")
    with open(path, encoding="utf-8") as f:
        names = list(json.load(f).get("WINDOW_ENV") or [])
    bad = [n for n in names if not WINDOW_ENV_NAME.match(str(n)) or WINDOW_ENV_DENY.match(str(n))]
    if bad:
        raise SystemExit(f"caselib: [lab] window_env names {bad}: a guard, credential or launcher variable never reaches a "
                         "window (fixture.env)")
    return frozenset(names)


def window_env_errors(env, names=None):
    """Why a case's fixture.env is malformed, as a list (empty when fine); values are checked at run time."""
    if env is None:
        return []
    if not isinstance(env, dict):
        return ["fixture.env must be a mapping of NAME: value"]
    names = window_env_names() if names is None else names
    errs = [f"fixture.env: {k} is not allowed in this room ([lab] window_env: {sorted(names) or 'none'})"
            for k in env if k not in names]
    errs += [f"fixture.env: {k}'s value must be a string" for k, v in env.items() if not isinstance(v, str)]
    errs += [f"fixture.env: {k}'s value names {sorted(set(re.findall(r'\$\{([^}]*)\}', v)) - {'WORKSPACE', 'HOME'})}; "
             "only ${WORKSPACE} and ${HOME}" for k, v in env.items()
             if isinstance(v, str) and set(re.findall(r"\$\{([^}]*)\}", v)) - {"WORKSPACE", "HOME"}]
    return errs


def window_env_values(env, workspace, home):
    """fixture.env with ${WORKSPACE} and ${HOME} filled in; a value that is a path must resolve inside the workspace or
    the run's lab HOME, else ValueError (refused before the window starts)."""
    out = {}
    roots = [os.path.realpath(r) for r in (workspace, home) if r]
    for k, v in (env or {}).items():
        val = v.replace("${WORKSPACE}", workspace or "").replace("${HOME}", home or "")
        if val.startswith(("/", "~", "./", "../")) or "/" in val:
            real = os.path.realpath(os.path.expanduser(val))
            if not any(real == r or real.startswith(r + os.sep) for r in roots):
                raise ValueError(f"fixture.env: {k} resolves to {real}, outside the case workspace and the run's lab HOME")
        out[k] = val
    return out


def workspace_of(case_id):
    return f"{WS_BASE}/{case_id}"


PLACEHOLDER = re.compile(r"\$\{([A-Z_]+|bind\.[a-z][a-z0-9_]*)\}")


def subst(value, ph):
    """Replace ${NAME} placeholders and ${bind.<name>} values bound by an earlier observe (recursively in lists and
    dicts) with the run's values; anything else (VS Code's own ${rootName} ...) is left as it is."""
    if isinstance(value, str):
        return PLACEHOLDER.sub(lambda m: str(ph.get(m.group(1), m.group(0))), value)
    if isinstance(value, list):
        return [subst(v, ph) for v in value]
    if isinstance(value, dict):
        return {subst(k, ph): subst(v, ph) for k, v in value.items()}
    return value


def spec_acs(feature):
    """AC numbers the spec defines ("- **F-XXXX.AC-n**" lines in section 13)."""
    path = f"{SPECS}/{feature}.md"
    if not os.path.exists(path):
        return []
    acs = []
    for line in open(path, encoding="utf-8"):
        m = re.match(r"- \*\*" + re.escape(feature) + r"\.AC-(\d+)\b", line)
        if m:
            acs.append(int(m.group(1)))
    return sorted(set(acs))


def spec_errors(feature):
    """Error ids of section 7 ("### 7.E3 ..." headings) -> heading text."""
    path = f"{SPECS}/{feature}.md"
    out = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            m = re.match(r"###\s+(7\.E\d+)\b\s*(.*)", line)
            if m:
                out[m.group(1)] = m.group(2).strip()
    return out


def owned_atoms(feature):
    path = f"{FEATURES}/{feature}.yaml"
    return list((load_yaml(path) or {}).get("own") or []) if os.path.exists(path) else []


def split_case_text(text):
    """The writer's part of a case file: every line that does not belong to a recorder-owned top-level key."""
    keep, cur = [], None
    for line in text.splitlines():
        if line.strip() == RECORDER_MARK:
            continue
        m = re.match(r"([A-Za-z_][\w-]*)\s*:", line)
        if m and not line[:1].isspace():
            cur = m.group(1)
        if cur in RECORDER_KEYS:
            continue
        keep.append(line)
    while keep and not keep[-1].strip():
        keep.pop()
    return "\n".join(keep) + "\n"


def write_recorder_blocks(path, blocks):
    """Replace the recorder-owned blocks of a case file with `blocks` (an ordered dict), keeping the rest verbatim."""
    import redact  # R-34: no command line the reference ran ever reaches a case file
    blocks = redact.redact_obj(blocks)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    body = split_case_text(text)
    dumped = yaml.safe_dump(blocks, sort_keys=False, allow_unicode=True, width=120, default_flow_style=False)
    new = body + "\n" + RECORDER_MARK + "\n" + dumped
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(new)
    os.replace(tmp, path)


# ---- profiles are graphs (testing-kit.md 2a): environments + links
ENV_KINDS = ("editor", "engine", "sshtarget", "wsl", "tunnel")
LINK_KINDS = ("docker-socket", "ssh", "tunnel", "wsl")
# which environment kinds a link kind may join (from -> to)
LINK_ENDS = {
    "docker-socket": ({"editor", "sshtarget", "wsl", "tunnel"}, {"engine"}),
    "ssh": ({"editor", "sshtarget", "wsl"}, {"sshtarget"}),
    "wsl": ({"editor", "sshtarget"}, {"wsl"}),
    "tunnel": ({"editor"}, {"tunnel"}),
}


class NotProvisionable(Exception):
    pass


def profile_extensions(env, default):
    """The extensions an editor environment installs: `default` (the extension under test) when the profile names none;
    nothing for an explicit empty list or [none] (a baseline without any extension)."""
    exts = env.get("extensions")
    if exts is None:
        return [default]
    return [x for x in exts if x != "none"]


def ssh_target(profile):
    """The sshtarget environment of an SSH-window profile (editor -ssh-> sshtarget), else None. Without a `variant` the
    window reaches the recording host's own SSH host (ssh_host()); with one, a target made for the run (ssh_variant(),
    kit #170)."""
    envs = profile.get("environments") or []
    links = profile.get("links") or []
    if sorted(e.get("kind") for e in envs) != ["editor", "sshtarget"] or len(links) != 1:
        return None
    ed = next(e for e in envs if e["kind"] == "editor")
    st = next(e for e in envs if e["kind"] == "sshtarget")
    l = links[0]
    return st if (l.get("from"), l.get("to"), l.get("kind")) == (ed.get("id"), st.get("id"), "ssh") else None


def ssh_variant(profile):
    """The variant spec of a profile whose SSH target is made per run (its sshtarget environment's `variant`, e.g.
    `debian`, `debian+password`, `alpine+noforward`, made by the sshtarget plugin), else None: the host's shared SSH
    host."""
    return (ssh_target(profile) or {}).get("variant") or None


def topology(profile):
    """The provisionable shapes: an editor linked to an engine by docker-socket, both with fixtures; an editor alone
    (no link; an editor-language room needs no engine); an SSH window, editor -ssh-> sshtarget, where the target has no
    fixture and is the recording host's own SSH host (ssh_host; the editor's profile names the Remote - SSH extensions).
    Returns (editor_env, engine_env), engine_env None for the engine-less shapes; raises NotProvisionable (the runner
    reports not-applicable) otherwise."""
    envs = profile.get("environments") or []
    links = profile.get("links") or []
    kinds = sorted(e.get("kind") for e in envs)
    if kinds == ["editor"] and not links:
        if not envs[0].get("fixture"):
            raise NotProvisionable("an editor-only profile needs its editor fixture")
        return envs[0], None
    st = ssh_target(profile)
    if st is not None:
        ed = next(e for e in envs if e["kind"] == "editor")
        if not ed.get("fixture"):
            raise NotProvisionable("an SSH-window profile needs its editor fixture")
        if st.get("fixture"):
            raise NotProvisionable("an sshtarget environment names no catalogue fixture: its per-run target is a "
                                   "`variant` (kit #170), or none for the recording host's own SSH host")
        if st.get("variant"):   # the plugin's images do not cross: never a pass, never a fail (kit #170 (b))
            raise NotProvisionable("a per-run SSH target (sshtarget variant) is not provisionable by this runner")
        return ed, None
    if kinds != ["editor", "engine"] or len(links) != 1:
        raise NotProvisionable(f"topology not provisionable yet: environments {kinds}, links "
                               + ", ".join(f"{l.get('from')}-{l.get('kind')}->{l.get('to')}" for l in links))
    ed = next(e for e in envs if e["kind"] == "editor")
    en = next(e for e in envs if e["kind"] == "engine")
    l = links[0]
    if (l.get("from"), l.get("to"), l.get("kind")) != (ed["id"], en["id"], "docker-socket"):
        raise NotProvisionable("topology not provisionable yet: the pilot needs editor -docker-socket-> engine")
    if en.get("engine", "docker-ce") != "docker-ce" or not ed.get("fixture") or not en.get("fixture"):
        raise NotProvisionable("only docker-ce engines with editor and engine fixtures are provisionable")
    if en.get("network", "bridge") != "bridge":
        raise NotProvisionable(f"engine network {en.get('network')!r} not provisionable yet")
    return ed, en


WRITER_FIELDS = ("id", "feature", "title", "ac", "atoms", "kind", "covers", "profile", "fixtures", "fixture", "steps", "notes")


def writer_digest(case):
    """sha256 of the writer-owned fields (canonical JSON, comments and layout ignored): written into `recorded` by the
    recorder, so the lint can tell a case that changed after its recording."""
    import hashlib
    import json
    body = {k: case[k] for k in WRITER_FIELDS if k in case}
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def unbound(value):
    """${bind.<name>} references left in a (substituted) step argument."""
    return sorted(set(re.findall(r"\$\{(bind\.[a-z][a-z0-9_]*)\}", json_dumps(value))))


def json_dumps(value):
    import json
    return json.dumps(value, ensure_ascii=False)


def bind_refs(value):
    """Names of the ${bind.<name>} references in a step (for the schema's order check)."""
    return sorted(set(re.findall(r"\$\{bind\.([a-z][a-z0-9_]*)\}", json_dumps(value))))


def resolve_path(obj, path):
    """A value inside an observation: dot keys, [n] list indexes and ["quoted key"] (for keys such as "view:Dev
    Volumes"), e.g. quickpick.items[0].description or ["view:Dev Volumes"].rows[1].label."""
    tokens = re.findall(r'\["((?:[^"\\]|\\.)*)"\]|\[(\d+)\]|([^.\[\]]+)', path)
    cur = obj
    for quoted, index, key in tokens:
        if index:
            if not isinstance(cur, list) or int(index) >= len(cur):
                raise KeyError(f"{path}: no item [{index}]")
            cur = cur[int(index)]
        else:
            k = quoted or key
            if not isinstance(cur, dict) or k not in cur:
                raise KeyError(f"{path}: no key {k!r}")
            cur = cur[k]
    return cur


def allowed_slots(host):
    """The slots this process may use: the ones ENCODE_SLOTS names."""
    return list(SLOTS.get(host, ()))
