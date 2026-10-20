"""Normalization of volatile values in observations before two runs (or a replay and its expectation) are compared.

Every replacement is a NAMED rule with a named placeholder; the list of rules (with NORM_VERSION) is written into each
case's `recorded.normalization` and each transcript, so a reviewer can see exactly what was abstracted away.
Run-specific paths come first (longest first), then identity, then the pattern rules in order.
"""
import os
import re

import yaml

import redact

NORM_VERSION = 18  # 2: ${FIXTURES_WS}; 3: ${bind.<name>}; 4: R-34 command lines (<docker command> ...);
#                  5: environment noise dropped from notification observations (ENV_NOISE)
#                  6: the extension's host temp root (per window since the R-42 temp-root amendment)
#                  7: VS Code core's keychain-write warning is environment noise (kit parity, 2026-10-02)
#                  8: ${SSH_HOST}, an SSH window's host alias (2026-10-03; only runs of SSH-window profiles have one)
#                  9: ${SSH_TARGET_ADDR}, a per-run SSH target's address (kit #170; only runs with an sshtarget variant)
#                 10: VS Code core's extension-recommendation prompt is environment noise, matched by its buttons (R-106)
#                 11: ${RELAY}, the kit's askpass relay path (athena on kit #186: remote.SSH.path holds it, F-2101 AC-26
#                     logs that setting, and the kit is not under ROOT)
#                 12: ${SSH_HOST_UPPER}, the SSH host alias in upper case (athena on F-2409 BR-3/AC-4), before ssh-host
#                 13: ${SSH_TARGET_FINGERPRINT} and ${SSH_TARGET_FINGERPRINT_NEW}, the per-case target's own host key
#                     fingerprints, bound per run (athena on #198: a pattern would let a wrong fingerprint pass)
#                 14: ${SSH_HOST}, ${SSH_HOST_UPPER} and ${SSH_TARGET_ADDR} also before a sentence's full stop ("... on
#                     <alias>."): a '.' ends the token unless a name character follows it (dirty-side, F-2601 AC-23/29)
#                 15: the remote indicator's label cut by core ("SSH: " + the alias's first 35 characters + "…", F-2502
#                     BR-9) is "SSH: ${SSH_HOST}", the uncut form; any other cut stays literal (athena on #229)
#                 16: a notification's determinate progress is `determinate: true`, not its run-dependent `percent`
#                     (athena on kit #241: F-2403 AC3-1/AC4-2 recorded 1 and 4 where runs read 1, 6 and 18)
#                 17: Docker Compose's own container label com.docker.compose.version is <COMPOSE_VERSION>, not the
#                     engine fixture's Compose plugin version (dirty-side, 2026-10-14: 5.5.1 in the arm64 captures, 5.6.0
#                     in the pinned x86_64 one; the reference extension never sets it)
#                 18: ${PORT_<NAME>}, a client port the case's fixture.client_ports made (kit #289, K1): a whole number,
#                     never part of a longer one (only runs with client ports; nothing an older expect holds changes)
# athena on kit #236: the versions whose rules RENAME a placeholder an older expect already holds, so "an older version
# compares as before" cannot hold for such an expect. Versions that only add a placeholder for text an older expect held
# literally are not listed. An expect recorded before a version here, holding that version's old-form token, is
# not-comparable for a runner at or past it: "re-record", never a pass or a fail (record.norm_version_refusal).
RENAMING_VERSIONS = {13: "the per-case target's fingerprint: ${bind.<name>} -> ${SSH_TARGET_FINGERPRINT}",
                     16: "a notification's progress: percent -> determinate: true",
                     17: "Compose's version label: its value -> <COMPOSE_VERSION>"}
# v17: Docker Compose stamps every container it creates with its own version under this label; the value is the engine
# fixture's, never the extension's. As a mapping key (a container's labels) or as text (`name=value`, or JSON in a
# captured string), the value becomes the marker; the label's presence still counts.
COMPOSE_LABEL = "com.docker.compose.version"
COMPOSE_PLACEHOLDER = "<COMPOSE_VERSION>"
COMPOSE_IN_TEXT = re.compile(r'(?:(?<=com\.docker\.compose\.version=)|(?<=com\.docker\.compose\.version":")'
                             r'|(?<=com\.docker\.compose\.version": "))(?!<COMPOSE_VERSION>)[0-9A-Za-z.+_-]+')
BIND_TOKEN = re.compile(r"\$\{bind\.([a-z0-9_]+)\}")
# a bind that holds a host key fingerprint, from its own definition: its name, observation path or match regex
FINGERPRINT_HINT = re.compile(r"(?i)fingerprint|host_?key|sha256|md5|(?:^|[^a-z])fp(?:$|[^a-z])")


def bind_definitions(case):
    """{name: (path, match)} of the case's observe-step binds."""
    out = {}
    for st in case.get("steps") or []:
        arg = st.get("observe") if isinstance(st, dict) else None
        for name, spec in ((arg or {}).get("bind") or {}).items() if isinstance(arg, dict) else ():
            path, rx = (spec, None) if isinstance(spec, str) else ((spec or {}).get("path"), (spec or {}).get("match"))
            out[name] = (str(path or ""), str(rx or ""))
    return out


def renamed_tokens(case, version):
    """For an expect recorded under `version`: [(renaming version, why)] for each rename past it whose old-form token
    the expect holds. v13: a ${bind.<name>} in the expect whose bind is a fingerprint by its definition, or has no
    definition in the case (undecidable: this case alone, athena on #236)."""
    out = []
    if 13 in RENAMING_VERSIONS and version < 13 <= NORM_VERSION:
        import json as _json
        used = sorted(set(BIND_TOKEN.findall(_json.dumps(case.get("expect")))))
        defs = bind_definitions(case)
        fps = [b for b in used if b in defs and any(FINGERPRINT_HINT.search(x) for x in (b, *defs[b]))]
        undecided = [b for b in used if b not in defs]
        if fps:
            out.append((13, f"${{bind.{fps[0]}}} holds the target fingerprint"))
        elif undecided:
            out.append((13, f"${{bind.{undecided[0]}}} has no bind definition in the case (undecidable)"))
    if 16 in RENAMING_VERSIONS and version < 16 <= NORM_VERSION:
        where = _notification_percent(case.get("expect"))
        if where:
            out.append((16, f"{where} holds a percent"))
    if 17 in RENAMING_VERSIONS and version < 17 <= NORM_VERSION:
        where = compose_version_at(case.get("expect"))
        if where:
            out.append((17, f"{where} holds Compose's version"))
    return out


def compose_version_at(obj, path="", key=None):
    """The first path in an expect where Compose's version label holds a value, not the v17 marker, or None."""
    if isinstance(obj, str):
        return (path or "/") if (key == COMPOSE_LABEL and obj != COMPOSE_PLACEHOLDER) or COMPOSE_IN_TEXT.search(obj) else None
    items = obj.items() if isinstance(obj, dict) else enumerate(obj) if isinstance(obj, list) else ()
    for k, v in items:
        hit = compose_version_at(v, f"{path}/{k}", k if isinstance(obj, dict) else key)
        if hit:
            return hit
    return None


def compose_marker(obj, key=None):
    """`obj` with v17 applied alone: Compose's version label's value is the marker (renormalize's allowed rewrite)."""
    if isinstance(obj, str):
        return COMPOSE_PLACEHOLDER if key == COMPOSE_LABEL else COMPOSE_IN_TEXT.sub(COMPOSE_PLACEHOLDER, obj)
    if isinstance(obj, list):
        return [compose_marker(v, key) for v in obj]
    if isinstance(obj, dict):
        return {k: compose_marker(v, k) for k, v in obj.items()}
    return obj


def _notification_percent(obj, path="", key=None):
    """The first path in an expect where a notification item holds `percent` (v16 renamed it), or None."""
    if isinstance(obj, dict):
        if key in NOTIFICATION_KEYS and "percent" in obj:
            return path or "/"
        for k, v in obj.items():
            hit = _notification_percent(v, f"{path}/{k}", k)
            if hit:
                return hit
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            hit = _notification_percent(v, f"{path}/{i}", key)
            if hit:
                return hit
    return None


_HERE = os.path.dirname(os.path.abspath(__file__))
# Where a host alias or an address ends (version 14): no name character next, and a '.' only as punctuation, not as the
# start of a longer dotted name ("sshlab-x." ends a sentence; "sshlab-x.example" is another host).
NAME_END = r"(?![\w-]|\.[\w-])"
ADDR_END = r"(?!\w|\.\w)"


def _client_ports(ctx):
    """The run's client ports (kit #289, K1), longest number first so a port is never cut by a shorter one."""
    return sorted(((k, str(v)) for k, v in ctx.items() if k.startswith("PORT_") and str(v).isdigit()),
                  key=lambda kv: (-len(kv[1]), kv[0]))
ELLIPSIS = "\u2026"
# athena on #229: core cuts the remote indicator's host label to its first LABEL_MAX characters plus "…" (F-2502 BR-9 and
# AC-19; [oss] remoteIndicator.ts REMOTE_STATUS_LABEL_MAX_LENGTH), so "SSH: <alias>" keeps 35 characters of the alias.
LABEL_MAX = 40
SSH_LABEL = "SSH: "


def cut_label(label):
    """The host label as core shows it: unchanged up to LABEL_MAX characters, else its first LABEL_MAX plus "…"."""
    return label if len(label) <= LABEL_MAX else label[:LABEL_MAX] + ELLIPSIS

# (name, placeholder, regex, description); applied to every string value, in this order, after the path rules
PATTERN_RULES = [
    ("sha256-digest", "<SHA256>", r"sha256:[0-9a-f]{64}", "image ids and digests"),
    ("hex-64", "<HEX64>", r"(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])", "container ids, volume-name and image-name hashes"),
    ("hex-40", "<HEX40>", r"(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])", "commit ids (VS Code commit, git heads)"),
    ("hex-12", "<HEX12>", r"(?<![0-9A-Za-z])(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{12}(?![0-9A-Za-z])",
     "short container/image ids"),
    ("iso-timestamp", "<TIMESTAMP>", r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?",
     "timestamps"),
    ("date", "<DATE>", r"(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)", "dates"),
    ("clock", "<TIME>", r"(?<![\d:])\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?![\d:])", "clock times"),
    ("relative-age", "<AGO>",
     r"\b(?:a few seconds|a minute|an hour|a day|a week|a month|a year|\d+ (?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)) ago\b",
     "relative ages (\"4 days ago\")"),
    ("duration", "<DURATION>", r"(?<![\w.])\d+(?:\.\d+)?\s?(?:ms|s)\b", "durations (\"1.2s\", \"350 ms\")"),
    ("host-port", r"\1:<PORT>", r"\b(127\.0\.0\.1|localhost|0\.0\.0\.0):\d{2,5}\b", "local ports"),
    ("private-daemon", "labdind-<RUN>", r"labdind-encode-s\d+", "the run's private daemon container"),
    ("slot-unit", "lab-code-<SLOT>", r"lab-code-\d+", "the run's slot unit"),
] + [tuple(r) for r in redact.ROOM_RULES.get("NORM_PATTERN_RULES", ())]   # then the extension's own (its host temp root)
_COMPILED = [(n, p, re.compile(rx)) for n, p, rx, _ in PATTERN_RULES]
# the container names the extension's engine generates (none without the room's rule)
GENERATED_NAME = redact.ROOM_RULES.get("GENERATED_NAME") or re.compile(redact.NOTHING)

# Environment noise (2026-10-02, version 5): notifications VS Code core raises because of the machine the editor runs on,
# not because of the extension under test. They are dropped from every notification observation (visible toasts and
# the notification center) before anything is compared; publish_tests.py refuses a crossing case whose expect still
# holds one. Only core notifications (no source) match. (rule, pattern on the notification text, why)
ENV_NOISE = [
    ("env-noise-core-file-watcher",
     re.compile(r"^(File changes watcher stopped unexpectedly\.|Unable to watch for file changes\.)"),
     "VS Code core's file-watcher warnings: the host ran out of inotify instances (watcher stopped) or watches (ENOSPC)"),
    ("env-noise-core-keychain-write", re.compile(r"^Writing login information to the keychain failed with error "),
     "VS Code core's keychain-write warning: the machine's OS keyring is locked or missing"),
]
# R-106 (athena): VS Code core's extension-recommendation prompt names a different extension each time, so it is matched
# by its BUTTONS, never its text: a notification with no source whose button set is exactly this one. A notification of
# the extension under test has a source and is never matched.
ENV_NOISE_BUTTONS = [
    ("env-noise-core-recommendation", ("Install", "Show Recommendations"),
     "VS Code core's extension-recommendation prompt: the editor's own default, not the extension under test"),
]
# Cases whose subject IS such a prompt keep it (R-106 guard a; dirty-side's scan): exempt from the button rule only.
R106_EXEMPT = frozenset({
    "F-1406-AC3-2",   # Dev Containers, reference-only: core recommends the extension for the folder and devcontainer.json
})
NOTIFICATION_KEYS = ("notifications", "notification_center")


def dropped_noise(obj, key=None, counts=None, case=None):
    """{ENV_NOISE rule: how many items it dropped} over an observation (R-106: every drop is counted, never silent)."""
    counts = {} if counts is None else counts
    if isinstance(obj, list):
        for v in obj:
            hit = env_noise(v, case) if key in NOTIFICATION_KEYS else None
            if hit:
                counts[hit] = counts.get(hit, 0) + 1
            else:
                dropped_noise(v, None, counts, case)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            dropped_noise(v, k, counts, case)
    return counts


def env_noise(item, case=None):
    """The ENV_NOISE rule a notification observation item matches, or None. A case in R106_EXEMPT keeps the
    recommendation prompt (the button rule); the text rules apply to every case."""
    if not isinstance(item, dict) or item.get("source"):
        return None
    text = str(item.get("text") or "")
    hit = next((name for name, rx, _ in ENV_NOISE if rx.search(text)), None)
    if hit:
        return hit
    buttons = item.get("buttons")
    if case in R106_EXEMPT:
        return None
    if isinstance(buttons, list) and all(isinstance(b, str) for b in buttons):   # both observers: a list of labels
        return next((name for name, want, _ in ENV_NOISE_BUTTONS if sorted(buttons) == sorted(want)), None)
    return None


def identity_config():
    with open(os.environ.get("ENCODE_IDENTITY") or f"{_HERE}/identity.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def rules_used(ctx):
    """The rule list recorded with every expectation."""
    paths = [{"rule": f"path-{k.lower()}", "placeholder": "${" + k + "}"} for k, _ in _path_pairs(ctx)]
    ident = [
        {"rule": "extension-id", "placeholder": "${EXT_ID}", "applies": "everywhere"},
        {"rule": "extension-display-name", "placeholder": "${EXT_NAME}", "applies": "notification source fields"},
        {"rule": "app-name", "placeholder": "${APP_NAME}", "applies": "window titles"},
    ] + ([{"rule": "generated-container-name", "placeholder": "<GENERATED_NAME>",
           "applies": "container names Docker generated (not declared by the case or profile)"}]
         if "GENERATED_NAME" in redact.ROOM_RULES else [])
    pats = [{"rule": n, "placeholder": p.replace("\\1", "<host>"), "what": d} for n, p, _, d in PATTERN_RULES]
    binds = [{"rule": f"bind-{k[5:]}", "placeholder": "${" + k + "}", "applies": "whole tokens"} for k, _ in _binds(ctx)]
    binds += [{"rule": "ssh-target-fingerprint" + ("-new" if k.endswith("_NEW") else ""), "placeholder": "${" + k + "}",
               "applies": "exact values, before every other rule (the per-case target's own host key fingerprints)"}
              for k in FINGERPRINT_KEYS if ctx.get(k)]
    binds += [{"rule": "ssh-host-upper", "placeholder": "${SSH_HOST_UPPER}",
               "applies": "whole tokens (the SSH window's host alias in upper case; before ssh-host)"}] if _upper_host(ctx) else []
    binds += [{"rule": "ssh-host", "placeholder": "${SSH_HOST}", "applies": "whole tokens (the SSH window's host alias)"}
              ] if ctx.get("SSH_HOST") else []
    binds += [{"rule": "ssh-target-addr", "placeholder": "${SSH_TARGET_ADDR}",
               "applies": "whole addresses (a per-run SSH target's address)"}] if ctx.get("SSH_TARGET_ADDR") else []
    binds += [{"rule": "client-port", "placeholder": "${" + k + "}",
               "applies": "whole numbers (a client port of the case's fixture.client_ports)"} for k, _ in _client_ports(ctx)]
    noise = [{"rule": n, "placeholder": "(dropped)", "applies": "notifications, notification_center: " + why}
             for n, _, why in ENV_NOISE]
    noise += [{"rule": n, "placeholder": "(dropped)", "applies": "notifications, notification_center with no source and "
               "exactly the buttons " + " + ".join(want) + ": " + why} for n, want, why in ENV_NOISE_BUTTONS]
    pats += [{"rule": "compose-version", "placeholder": COMPOSE_PLACEHOLDER,
              "what": f"Docker Compose's own {COMPOSE_LABEL} label (the engine fixture's Compose, not the extension)"}]
    return {"version": NORM_VERSION, "rules": noise + redact.RULES[:2] + paths + binds + ident + pats}


def _upper_host(ctx):
    """The upper-case SSH host alias when it differs from the alias, else None."""
    up = str(ctx.get("SSH_HOST_UPPER") or "")
    return up if up and up != str(ctx.get("SSH_HOST") or "") else None


def _path_pairs(ctx):
    pairs = [(k, ctx[k]) for k in ("WORKSPACE", "FIXTURES_WS", "STATE_DIR", "ISO", "HOME", "SLOT_DIR", "ROOT", "RELAY") if ctx.get(k)]
    return sorted(pairs, key=lambda kv: -len(kv[1]))


def _binds(ctx):
    """Values bound by observe steps (per-run values): replaced as whole tokens, longest first; values shorter than
    four characters are left alone (they would match inside ordinary words)."""
    out = [(k, str(v)) for k, v in ctx.items() if k.startswith("bind.") and v is not None and len(str(v)) >= 4]
    return sorted(out, key=lambda kv: -len(kv[1]))


FINGERPRINT_KEYS = ("SSH_TARGET_FINGERPRINT_NEW", "SSH_TARGET_FINGERPRINT")   # the newer key's first: a rekey keeps both


def _fingerprints(ctx):
    """[(placeholder name, exact value)] of the run's own target host keys: every key type's SHA256:<base64> and
    MD5:<hex pairs>, bound at provisioning and after a rekey (space-separated in the context). Only these values map
    back; any other fingerprint stays literal, so a case that shows a wrong one fails (athena on #198)."""
    return [(k, v) for k in FINGERPRINT_KEYS for v in str(ctx.get(k) or "").split() if v]


def norm_str(s, ctx, key=None):
    if key == COMPOSE_LABEL:   # v17: a container's labels mapping
        return COMPOSE_PLACEHOLDER
    s = redact.redact_captured(s)   # R-34: command lines first, so replays compare redacted to redacted
    for name, value in _fingerprints(ctx):   # first: exact values, before any pattern can cut into one
        s = re.sub(r"(?<![A-Za-z0-9+/:=])" + re.escape(value) + r"(?![A-Za-z0-9+/:=])", "${" + name + "}", s)
    for name, value in _path_pairs(ctx):
        s = s.replace(value, "${" + name + "}")
    # The extension id before the bound values (remote-oss/remote#72, F-4003-AC14-1): a bound publisher name can lie
    # inside the id ("remote-oss" in "remote-oss.remote-ssh-edit") and would split it. Bound values are matched with
    # the id already replaced in them too, so a value that contains the id still matches.
    ident = ctx.get("_identity") or identity_config()
    eids = [e for e in ((ident.get(side) or {}).get("extension_id") for side in ("reference", "reimplementation")) if e]
    for eid in eids:
        s = s.replace(eid, "${EXT_ID}")
    for name, value in _binds(ctx):
        for eid in eids:
            value = value.replace(eid, "${EXT_ID}")
        s = re.sub(r"(?<![A-Za-z0-9])" + re.escape(value) + r"(?![A-Za-z0-9])", "${" + name + "}", s)
    if _upper_host(ctx):   # its upper-case form first, so the two never collide (an alias with no letters has none)
        s = re.sub(r"(?<![\w.-])" + re.escape(_upper_host(ctx)) + NAME_END, "${SSH_HOST_UPPER}", s)
    if ctx.get("SSH_HOST"):   # the SSH window's host alias (title "[SSH: <host>]", the remote indicator)
        s = re.sub(r"(?<![\w.-])" + re.escape(str(ctx["SSH_HOST"])) + NAME_END, "${SSH_HOST}", s)
        # version 15: core's exact cut of the indicator's label maps to the uncut placeholder; any other cut stays literal
        label = SSH_LABEL + str(ctx["SSH_HOST"])
        if len(label) > LABEL_MAX:
            s = s.replace(cut_label(label), SSH_LABEL + "${SSH_HOST}")
    if ctx.get("SSH_TARGET_ADDR"):   # a per-run target's address (an IPv4 address; never part of a longer one)
        s = re.sub(r"(?<![\w.])" + re.escape(str(ctx["SSH_TARGET_ADDR"])) + ADDR_END, "${SSH_TARGET_ADDR}", s)
    for name, port in _client_ports(ctx):   # version 18: a client port, a whole number (127.0.0.1:<port>, port <port>)
        s = re.sub(r"(?<![\d.])" + re.escape(port) + r"(?!\d|\.\d)", "${" + name + "}", s)
    if key == "source":
        for side in ("reference", "reimplementation"):
            dn = (ident.get(side) or {}).get("display_name")
            if dn:
                s = re.sub(r"(?<![\w-])" + re.escape(dn) + r"(?![\w-])", "${EXT_NAME}", s)
    if key == "title":
        for app in ident.get("app_names") or []:
            if s == app or s.endswith(" - " + app):
                s = s[: len(s) - len(app)] + "${APP_NAME}"
    for _, placeholder, rx in _COMPILED:
        s = rx.sub(placeholder, s)
    return COMPOSE_IN_TEXT.sub(COMPOSE_PLACEHOLDER, s)   # v17: the label as text


def normalize(obj, ctx, key=None):
    """Recursively normalize every string (dict values and keys) of an observation."""
    if isinstance(obj, str):
        return norm_str(obj, ctx, key)
    if isinstance(obj, list):
        if key in NOTIFICATION_KEYS:   # environment noise is not part of what a case observes
            obj = [v for v in obj if not env_noise(v, (ctx or {}).get("CASE"))]
        if key == "items":   # the editor's copy of a state database, written whenever it likes (remote-oss/remote#72
            # triage): a picker over the profile folders lists it or not by timing, never by the extension
            obj = [v for v in obj if not (isinstance(v, dict) and v.get("label") == "state.vscdb.backup")]
        return [normalize(v, ctx, key) for v in obj]
    if isinstance(obj, dict):
        if key in NOTIFICATION_KEYS and "percent" in obj:   # v16 (athena on kit #241): presence, not the run's value
            obj = dict({k: v for k, v in obj.items() if k != "percent"}, determinate=True)
        return {norm_str(k, ctx) if isinstance(k, str) else k: normalize(v, ctx, k) for k, v in obj.items()}
    return obj


def diff(a, b, path=""):
    """Human-readable differences between two normalized observations (for flaky / fail reports)."""
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in list(a) + [k for k in b if k not in a]:
            if k not in a:
                out.append(f"{path}/{k}: missing in first, second has {b[k]!r}"[:400])
            elif k not in b:
                out.append(f"{path}/{k}: first has {a[k]!r}, missing in second"[:400])
            else:
                out += diff(a[k], b[k], f"{path}/{k}")
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(f"{path}: {len(a)} vs {len(b)} items: {a!r} != {b!r}"[:600])
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                out += diff(x, y, f"{path}[{i}]")
    elif a != b:
        out.append(f"{path}: {a!r} != {b!r}"[:400])
    return out
