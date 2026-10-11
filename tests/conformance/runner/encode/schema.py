#!/usr/bin/env python3
"""Validate conformance cases and profiles (the case format: the suite's README.md).

usage: schema.py [path ...]        files or folders; default: every case and profile of the suite
Prints one line per error and exits 1 if there is any. Importable: validate_case(), validate_profile(),
case_validity() (a valid case: schema clean, recorded twice, with its expectation).
"""
import json
import os
import re
import sys

import caselib
import redact

WRITER_KEYS = ("id", "feature", "title", "ac", "atoms", "kind", "covers", "profile", "fixtures", "fixture", "steps", "notes",
               "reference-only", "issue", "ac_issue_refs")   # the last two are added when a case is published
VERBS = ("cmd", "palette", "pick", "check", "type", "key", "button", "link", "remote", "view", "rowmenu", "rowaction",
         "viewaction", "menu", "focus", "hover", "window", "wait", "observe", "engine", "settings", "restart",
         "goto", "open")   # goto/open: the editor helpers of the lab driver (remote-ssh-edit, 2026-10-02)
ENGINE_CONTAINER_ACTIONS = ("pause", "unpause", "stop", "start", "kill", "remove")
ENGINE_ACTIONS = ENGINE_CONTAINER_ACTIONS + ("create_volume", "remove_volume", "run")
INFRA_NAME = re.compile(r"^(labdind-|encode-registry|lab-k8s-)")
STRING_VERBS = ("cmd", "palette", "pick", "check", "type", "key", "button", "link", "view", "menu", "focus", "window")
FORBIDDEN_VERBS = ("sleep", "shell", "sh", "bash", "run", "exec", "docker", "kubectl", "typeraw", "script", "pause")
SIMPLE_WHATS = ("title", "dialogs", "notifications", "statusbar", "contextmenu", "banner", "editors", "welcome",
                "sidebar", "quickpick", "notification_center", "windows", "files")
WAIT_KINDS = ("quickpick", "dialog", "no_dialog", "no_notification", "notification", "statusbar", "title", "windows", "view", "container",
              "volume", "quiet")
STATUSES = ("recorded", "flaky", "failed", "unconfirmed")
# identity rule (D-14, R-29, F-1401): nothing the writer writes may name the reference's identity
REFERENCE_ID = redact.ROOM_RULES.get("REFERENCE_ID") or re.compile(redact.NOTHING)
REFERENCE_PUBLISHER = redact.ROOM_RULES.get("REFERENCE_PUBLISHER") or re.compile(redact.NOTHING)
IDENTITY_PATTERNS = [
    (REFERENCE_ID, "the reference extension id / publisher"),
    (re.compile(r"\bpublisher\b", re.I), "publisher"),
    (re.compile(r"marketplace", re.I), "marketplace listing"),
    (REFERENCE_PUBLISHER, "the reference publisher's name"),
    (re.compile(r"\bdisplayName\b"), "the extension display name"),
    (re.compile(r"\bicon\.png\b|dev-containers\.png", re.I), "the extension icon"),
]
COVERS_RE = re.compile(r"^(7\.E\d+|\d+(\.\d+)*|(8\.)?BR-\d+|observed: \S.*)$")
ID_RE = re.compile(r"^(F-\d{4})-AC(\d+)-(\d+)$")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
HOSTS = ("local",)


def _filter_errors(where, flt):
    if not isinstance(flt, dict) or len(flt) != 1 or next(iter(flt)) not in ("name", "name_prefix", "label"):
        return [f"{where}: a filter is exactly one of name / name_prefix / label (the case's own objects only)"]
    if not str(next(iter(flt.values()))).strip():
        return [f"{where}: empty filter"]
    return []


def _wait_errors(where, arg):
    errs = []
    if not isinstance(arg, dict) or set(arg) - {"until", "timeout"} or "until" not in arg or "timeout" not in arg:
        return [f"{where}: wait needs exactly `until` and `timeout` (never a bare sleep)"]
    t = arg["timeout"]
    if not isinstance(t, (int, float)) or not 1 <= t <= 600:
        errs.append(f"{where}: timeout must be a number of seconds, 1..600")
    conds = arg["until"] if isinstance(arg["until"], list) else [arg["until"]]
    if not conds:
        errs.append(f"{where}: empty until")
    for c in conds:
        if not isinstance(c, dict) or len(c) != 1 or next(iter(c)) not in WAIT_KINDS:
            errs.append(f"{where}: condition {c!r} is not one of {', '.join(WAIT_KINDS)}")
            continue
        (k, v), = c.items()
        if k in ("dialog", "notification", "statusbar", "title") and not (isinstance(v, str) and v):
            errs.append(f"{where}: {k} wants a text")
        elif k == "quickpick" and not (v in ("visible", "hidden", True, False) or (isinstance(v, dict) and set(v) == {"contains"})):
            errs.append(f"{where}: quickpick wants visible | hidden | {{contains: text}}")
        elif k == "no_dialog" and v is not True:
            errs.append(f"{where}: no_dialog: true")
        elif k == "no_notification" and not (v is True or (isinstance(v, dict) and set(v) == {"contains"}
                                                         and isinstance(v["contains"], str) and v["contains"])):
            errs.append(f"{where}: no_notification: true (no toast at all) or {{contains: <text>}} (R-49)")
        elif k == "windows" and not isinstance(v, int):
            errs.append(f"{where}: windows wants a count")
        elif k == "view" and not (isinstance(v, dict) and "name" in v and set(v) <= {"name", "row", "welcome"}):
            errs.append(f"{where}: view wants {{name, row?, welcome?}}")
        elif k in ("container", "volume"):
            if not isinstance(v, dict):
                errs.append(f"{where}: {k} wants a mapping")
                continue
            extra = {"state"} if k == "container" else {"exists"}
            errs += _filter_errors(where + f" {k}", {x: y for x, y in v.items() if x not in extra})
            if k == "container" and v.get("state", "running") not in ("running", "exited", "paused", "created", "absent"):
                errs.append(f"{where}: container state must be running|exited|paused|created|absent")
        elif k == "quiet" and not (isinstance(v, (int, float)) and 1 <= v <= 60):
            errs.append(f"{where}: quiet wants 1..60 seconds")
    return errs


def _observe_errors(where, arg, seen):
    errs = []
    if not isinstance(arg, dict) or not {"id", "what"} <= set(arg) or set(arg) - {"id", "what", "bind"}:
        return [f"{where}: observe wants {{id, what}} and optionally bind"]
    for name, spec in (arg.get("bind") or {}).items():
        if not re.fullmatch(r"[a-z][a-z0-9_]*", str(name)):
            errs.append(f"{where}: bind name {name!r} must be lower-case letters, digits, _")
        path = spec if isinstance(spec, str) else spec.get("path") if isinstance(spec, dict) else None
        if not path or (isinstance(spec, dict) and set(spec) - {"path", "match"}):
            errs.append(f"{where}: bind {name}: a path into the observation, or {{path, match: <regex>}}")
        elif isinstance(spec, dict) and spec.get("match"):
            try:
                re.compile(spec["match"])
            except re.error as e:
                errs.append(f"{where}: bind {name}: bad regex: {e}")
    oid = arg["id"]
    if not (isinstance(oid, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]*", oid)):
        errs.append(f"{where}: observe id {oid!r} must be lower-case words joined by '-'")
    elif oid in seen:
        errs.append(f"{where}: observe id {oid!r} used twice")
    seen.add(oid)
    what = arg["what"]
    if not isinstance(what, list) or not what:
        return errs + [f"{where}: what must be a non-empty list"]
    for w in what:
        if isinstance(w, str):
            if w not in SIMPLE_WHATS:
                errs.append(f"{where}: unknown observation {w!r} (known: {', '.join(SIMPLE_WHATS)}, view, hover, docker, "
                            f"{', '.join(EDITOR_WHATS)})")
        elif isinstance(w, dict) and len(w) == 1:
            (k, v), = w.items()
            if k == "view" and not (isinstance(v, str) and v):
                errs.append(f"{where}: view wants a view title")
            elif k == "hover" and not (isinstance(v, dict) and set(v) == {"view", "row"}):
                errs.append(f"{where}: hover wants {{view, row}}")
            elif k == "docker":
                if not isinstance(v, dict) or not set(v) - {"ids"} or set(v) - {"containers", "volumes", "images", "ids"}:
                    errs.append(f"{where}: docker wants containers / volumes / images filters (and optionally ids: true)")
                else:
                    for kind, flt in v.items():
                        if kind == "ids":
                            if flt is not True:
                                errs.append(f"{where}: docker ids: true (adds container ids, for bind)")
                        else:
                            errs += _filter_errors(f"{where} docker {kind}", flt)
            elif k == "panel" and v != {}:
                errs.append(f"{where}: panel takes no arguments (panel: {{}})")
            elif k == "statusbar":
                core = v.get("core") if isinstance(v, dict) and set(v) == {"core"} else None
                if not (isinstance(core, list) and core and all(isinstance(x, str) and STATUS_ID.match(x) for x in core)):
                    errs.append(f"{where}: statusbar wants {{core: [<status bar item id>, ...]}} (VS Code core's items to "
                                f"keep, e.g. status.editor.mode), or the plain form `statusbar`")
            # the context menu restricted to the rows a case is about (remote-ssh-edit, F-4002 review)
            elif k == "contextmenu":
                labels = v.get("labels") if isinstance(v, dict) and set(v) == {"labels"} else None
                if not (isinstance(labels, list) and labels and all(isinstance(x, str) and x for x in labels)):
                    errs.append(f"{where}: contextmenu wants {{labels: [<row label>, ...]}} (the rows to keep), or the "
                                f"plain form `contextmenu`")
            elif k in EDITOR_WHATS:
                errs += _editor_arg_errors(where, k, v)
            elif k not in ("view", "hover", "docker", "panel", "statusbar", "contextmenu"):
                errs.append(f"{where}: unknown observation {k!r}")
        else:
            errs.append(f"{where}: bad observation {w!r}")
    return errs


# Editor observations (lab verbs of the same name, remote-ssh-edit 2026-10-02): kind -> (required keys, optional keys).
# `file` is relative to the case workspace (opened through Quick Open); without it the active editor. Lines and columns
# are 1-based model positions, as in Go to Line/Column.
# Every editor observation also takes `timeout` (seconds the verb may take, default 120; whole-line tokens of very long
# lines), and suggest takes `fields` (the item fields kept besides `order`). The recorder reads both itself.
EDITOR_WHATS = {
    "suggest": (set(), {"file", "line", "col", "type", "fields"}),
    "hovertext": ({"line", "col"}, {"file"}),
    "markers": (set(), {"file"}),
    "tokens": ({"line"}, {"file", "col"}),
    "folds": (set(), {"file"}),
    "outline": (set(), {"file"}),
    "breadcrumbs": ({"line", "col"}, {"file"}),
}
EDITOR_MAX_TIMEOUT = 1800
SUGGEST_FIELDS = ("label", "kind", "preselected", "detail", "documentation", "links", "labelDetail", "qualifier",
                  "description", "deprecated")   # driver.SUGGEST_FIELDS
STATUS_ID = re.compile(r"^[A-Za-z][\w.-]*$")


def _editor_arg_errors(where, kind, v, observation=True):
    need, opt = EDITOR_WHATS[kind]
    opt = opt | {"timeout"} if observation else opt - {"fields"}
    if not isinstance(v, dict) or not need <= set(v) or set(v) - need - opt:
        return [f"{where}: {kind} wants {{{', '.join(sorted(need) + [k + '?' for k in sorted(opt)])}}}"]
    bad = [k for k in ("line", "col") if k in v and not (isinstance(v[k], int) and v[k] >= 1)]
    bad += [k for k in ("file", "type") if k in v and not (isinstance(v[k], str) and v[k])]
    errs = [f"{where}: {kind}: {k} must be {'a positive integer' if k in ('line', 'col') else 'a non-empty string'}" for k in bad]
    if "timeout" in v and not (isinstance(v["timeout"], int) and 1 <= v["timeout"] <= EDITOR_MAX_TIMEOUT):
        errs.append(f"{where}: {kind}: timeout must be a whole number of seconds, 1..{EDITOR_MAX_TIMEOUT}")
    if "fields" in v and not (isinstance(v["fields"], list) and v["fields"] and len(set(v["fields"])) == len(v["fields"])
                              and set(v["fields"]) <= set(SUGGEST_FIELDS)):
        errs.append(f"{where}: suggest: fields is a non-empty list of {', '.join(SUGGEST_FIELDS)} (order is always kept)")
    return errs


def _step_errors(i, step, seen):
    where = f"steps[{i}]"
    if not isinstance(step, dict) or len(step) != 1:
        return [f"{where}: a step is one `verb: argument` mapping"]
    (verb, arg), = step.items()
    if verb in FORBIDDEN_VERBS:
        return [f"{where}: verb {verb!r} is forbidden (no sleeps, no shell steps; only fixture/state scripts touch Docker)"]
    if verb not in VERBS:
        return [f"{where}: unknown verb {verb!r} (lab verbs only: {', '.join(VERBS)})"]
    if verb == "window" and isinstance(arg, dict):   # the waiting form
        bad = set(arg) - {"title", "timeout", "count"}
        t, n = arg.get("timeout"), arg.get("count")
        if bad or not (isinstance(arg.get("title"), str) and (re.fullmatch(r"#\d+", arg["title"]) or len(arg["title"]) >= 2)) \
                or not (isinstance(t, int) and 1 <= t <= 600) or not (n is None or (isinstance(n, int) and n >= 1)):
            return [f"{where}: window wants #<n> or a title text, or {{title, timeout: 1..600, count?: <n>}}"]
        return []
    if verb in STRING_VERBS:
        if not (isinstance(arg, str) and arg.strip()):
            return [f"{where}: {verb} wants a non-empty text"]
        if verb == "window" and not (re.fullmatch(r"#\d+", arg) or len(arg) >= 2):
            return [f"{where}: window wants #<n> or a title text"]
        return []
    if verb == "open":
        return [] if isinstance(arg, str) and arg and not arg.startswith("/") else [f"{where}: open wants a workspace-relative file"]
    if verb == "goto":
        return _editor_arg_errors(where, "breadcrumbs", arg, observation=False)   # {line, col, file?}
    if verb == "remote":
        return [] if arg in (None, True, {}) else [f"{where}: remote takes no argument (remote: true)"]
    if verb in ("rowmenu", "hover"):
        return [] if isinstance(arg, dict) and set(arg) == {"view", "row"} else [f"{where}: {verb} wants {{view, row}}"]
    if verb == "rowaction":
        return [] if isinstance(arg, dict) and set(arg) == {"view", "row", "action"} else [f"{where}: rowaction wants {{view, row, action}}"]
    if verb == "viewaction":
        ok = isinstance(arg, dict) and set(arg) == {"view", "action"} and all(isinstance(v, str) and v.strip() for v in arg.values())
        return [] if ok else [f"{where}: viewaction wants {{view, action}} (the view's title and the action's name)"]
    if verb == "wait":
        return _wait_errors(where, arg)
    if verb == "observe":
        return _observe_errors(where, arg, seen)
    if verb == "engine":
        return _engine_errors(where, arg)
    if verb == "settings":
        if not isinstance(arg, dict) or not arg or not all(isinstance(k, str) and k.strip() for k in arg):
            return [f"{where}: settings wants {{<setting key>: <value or null to remove>}}"]
        return []
    if verb == "restart":
        return [] if arg is True else [f"{where}: restart: true (restarts the window on the same profile, folder and daemon)"]
    return []


def _engine_errors(where, arg):
    """Declarative actions on the case's own private daemon only (never a shell line)."""
    if not isinstance(arg, dict) or len(arg) != 1 or next(iter(arg)) not in ENGINE_ACTIONS:
        return [f"{where}: engine wants exactly one of {', '.join(ENGINE_ACTIONS)}"]
    (kind, v), = arg.items()
    errs = []
    if kind in ENGINE_CONTAINER_ACTIONS:
        if isinstance(v, str):
            if not NAME_RE.match(v) and not v.startswith("${bind."):
                errs.append(f"{where}: {kind}: a container name, or {{name | label: ...}}")
            name = v
        else:
            errs += _filter_errors(f"{where} {kind}", v if isinstance(v, dict) and set(v) <= {"name", "label"} else {"bad": 1})
            name = (v or {}).get("name", "") if isinstance(v, dict) else ""
        if INFRA_NAME.match(str(name)):
            errs.append(f"{where}: {kind}: {name} is lab infrastructure, never a case's")
    elif kind == "create_volume":
        if not isinstance(v, dict) or set(v) - {"name", "labels"} or not NAME_RE.match(str(v.get("name", ""))):
            errs.append(f"{where}: create_volume wants {{name, labels?}}")
        elif not isinstance(v.get("labels") or {}, dict):
            errs.append(f"{where}: create_volume labels must be a mapping")
    elif kind == "remove_volume":
        if not isinstance(v, str) or not (NAME_RE.match(v) or v.startswith("${bind.")) or INFRA_NAME.match(v):
            errs.append(f"{where}: remove_volume wants the name of one of the case's volumes")
    elif kind == "run":
        if not isinstance(v, dict) or set(v) - {"name", "image", "labels", "command", "state"} or not NAME_RE.match(str(v.get("name", ""))) or not v.get("image"):
            errs.append(f"{where}: run wants the fixture container form {{name, image, labels?, command?, state?}}")
        elif v.get("state", "running") not in ("running", "exited", "paused"):
            errs.append(f"{where}: run state running | exited | paused")
        elif INFRA_NAME.match(v["name"]):
            errs.append(f"{where}: run: {v['name']} is a lab infrastructure name")
    return errs


def _fixture_errors(fx, case, profile):
    errs = []
    if fx is None:
        return errs
    if not isinstance(fx, dict):
        return ["fixture must be a mapping"]
    bad = set(fx) - {"workspace", "files", "settings", "containers", "volumes", "extensions", "workspace_fixture",
                     "workspace_paths", "links", "modes"}
    if bad:
        errs.append(f"fixture: unknown keys {sorted(bad)}")
    if fx.get("workspace", "folder") not in ("folder", "empty-window"):
        errs.append("fixture.workspace: folder | empty-window")
    for rel, content in (fx.get("files") or {}).items():
        if not _inside(rel):
            errs.append(f"fixture.files: {rel!r} must be a relative path inside the workspace")
        if not isinstance(content, (str, dict, list)):
            errs.append(f"fixture.files: {rel!r} content must be text (or a JSON-like mapping)")
    errs += _workspace_fixture_errors(fx)
    links = fx.get("links") or {}
    if not isinstance(links, dict):
        errs.append("fixture.links: a mapping {<link path>: <relative target>}")
        links = {}
    for rel, target in links.items():
        if not _inside(rel):
            errs.append(f"fixture.links: {rel!r} must be a relative path inside the workspace")
        elif rel in (fx.get("files") or {}):
            errs.append(f"fixture.links: {rel!r} is also in fixture.files")
        if not (isinstance(target, str) and target and not target.startswith("/")
                and _inside(os.path.normpath(os.path.join(os.path.dirname(str(rel)), target)))):
            errs.append(f"fixture.links: {rel!r} -> {target!r}: the target is a relative path that stays inside the workspace")
    modes = fx.get("modes") or {}
    if not isinstance(modes, dict):
        errs.append("fixture.modes: a mapping {<path>: \"<octal mode>\"}")
        modes = {}
    for rel, mode in modes.items():
        if not (rel == "." or _inside(rel)):
            errs.append(f"fixture.modes: {rel!r} must be a relative path inside the workspace (or . for the folder itself)")
        elif rel in links:
            errs.append(f"fixture.modes: {rel!r} is a link (a mode would change its target)")
        if not (isinstance(mode, str) and re.fullmatch(r"0?[0-7]{3}", mode)):
            errs.append(f"fixture.modes: {rel!r}: the mode is a quoted octal string such as \"0444\" (unquoted, YAML reads "
                        f"0444 as a number)")
    if not isinstance(fx.get("settings") or {}, dict):
        errs.append("fixture.settings must be a mapping of user settings")
    if "images" in fx:
        errs.append("fixture.images: images come from the profile's engine fixture (pulled by digest from the mirror)")
    seeded = engine_images(case, profile)
    for j, c in enumerate(fx.get("containers") or []):
        w = f"fixture.containers[{j}]"
        if not isinstance(c, dict) or set(c) - {"name", "image", "labels", "state", "command"}:
            errs.append(f"{w}: keys name, image, labels, state, command")
            continue
        if not NAME_RE.match(str(c.get("name", ""))):
            errs.append(f"{w}: bad or missing name")
        if c.get("state", "running") not in ("running", "exited", "paused", "absent"):
            errs.append(f"{w}: state running | exited | paused | absent")
        if c.get("state", "running") != "absent" and c.get("image") not in seeded:
            errs.append(f"{w}: image {c.get('image')!r} is not in the engine fixture ({sorted(seeded)})")
    for j, v in enumerate(fx.get("volumes") or []):
        w = f"fixture.volumes[{j}]"
        if not isinstance(v, dict) or set(v) - {"name", "labels", "state"} or not NAME_RE.match(str(v.get("name", ""))):
            errs.append(f"{w}: keys name, labels, state (present | absent)")
        elif v.get("state", "present") not in ("present", "absent"):
            errs.append(f"{w}: state present | absent")
    for ext in fx.get("extensions") or []:
        if ext not in caselib.FIXTURE_EXTENSIONS:
            errs.append(f"fixture.extensions: {ext} is not a fixture AGENTS.md permits")
        elif caselib.FIXTURE_EXTENSIONS[ext][1] and caselib.FIXTURE_EXTENSIONS[ext][1] != case.get("feature"):
            errs.append(f"fixture.extensions: {ext} is only for {caselib.FIXTURE_EXTENSIONS[ext][1]}")
    return errs


def _engine_use_errors(case, profile):
    """A profile without an engine environment (an editor-only profile): nothing in the case may need a daemon."""
    if profile is None or any(isinstance(e, dict) and e.get("kind") == "engine" for e in profile.get("environments") or []):
        return []
    errs = []
    fx = case.get("fixture") if isinstance(case.get("fixture"), dict) else {}
    for k in ("containers", "volumes"):
        if fx.get(k):
            errs.append(f"fixture.{k}: profile {case.get('profile')} has no engine")
    for i, s in enumerate(case.get("steps") or []):
        if not isinstance(s, dict) or len(s) != 1:
            continue
        (verb, arg), = s.items()
        if verb == "engine":
            errs.append(f"steps[{i}]: engine: profile {case.get('profile')} has no engine")
        elif verb == "wait" and isinstance(arg, dict):
            conds = arg.get("until") if isinstance(arg.get("until"), list) else [arg.get("until")]
            if any(isinstance(c, dict) and set(c) & {"container", "volume"} for c in conds):
                errs.append(f"steps[{i}]: a container or volume wait needs an engine (profile {case.get('profile')} has none)")
        elif verb == "observe" and isinstance(arg, dict):
            if any(isinstance(w, dict) and "docker" in w for w in arg.get("what") or []):
                errs.append(f"steps[{i}]: a docker observation needs an engine (profile {case.get('profile')} has none)")
    return errs


def _inside(rel):
    """A relative path that stays inside the case folder."""
    rel = str(rel or "")
    return bool(rel.strip()) and not os.path.isabs(rel) and ".." not in rel.split("/") and os.path.normpath(rel) != "."


def _workspace_fixture_errors(fx):
    """fixture.workspace_fixture: <name>@<sha12> of a `workspace` fixture in the catalogue (fixture.py pin updates
    it); fixture.workspace_paths: the members to extract (default all), a list or a {source: destination} mapping."""
    import fixture  # noqa: E402 (catalogue)
    ref, paths = fx.get("workspace_fixture"), fx.get("workspace_paths")
    if ref is None:
        return ["fixture.workspace_paths: only with fixture.workspace_fixture"] if paths is not None else []
    name, sha12 = fixture.parse_ref(ref)
    if not name:
        return [f"fixture.workspace_fixture: want <name>@<12 hex digits of its sha256> (fixture.py pin), not {ref!r}"]
    errs = []
    if fixture.REFERENCE_CATALOG:   # the published suite: the pin names a published fixture, the local build is resolved
        entry = fixture.find("workspace", name, sha12, json.load(open(fixture.REFERENCE_CATALOG)))
        if not entry:
            return [f"fixture.workspace_fixture: {ref} is not in the published catalogue"]
    else:
        entry = fixture.find("workspace", name, sha12)
        if not entry:
            have = fixture.find("workspace", name)
            return [f"fixture.workspace_fixture: {ref} is not in fixtures/CATALOG.json"
                    + (f" (the catalogue has {name}@{have['sha256'][:12]}: re-pin and re-record)" if have else " (missing)")]
        f = fixture.fixture_file(entry)
        if not os.path.exists(f) or os.path.getsize(f) != entry.get("size"):
            errs.append(f"fixture.workspace_fixture: tarball {entry['file']} missing or not the catalogued size")
    if paths is not None:
        if not (isinstance(paths, (list, dict)) and paths):
            return errs + ["fixture.workspace_paths: a non-empty list of fixture paths, or a {source: destination} mapping"]
        pairs = fixture.workspace_paths(paths)
        for src, dst in pairs:
            if not (_inside(src) and _inside(dst)):
                errs.append(f"fixture.workspace_paths: {src!r} -> {dst!r}: relative paths inside the fixture and the workspace")
        if not errs:
            missing, _ = fixture.workspace_selection(entry, paths)
            errs += [f"fixture.workspace_paths: {name} has no file, link or folder {m!r}" for m in missing]
    return errs


def _identity_errors(path):
    """Scan the writer's part of the file (atoms and covers excluded) for identity assertions."""
    with open(path, encoding="utf-8") as f:
        body = caselib.split_case_text(f.read())
    errs = []
    for n, line in enumerate(body.splitlines(), 1):
        if re.match(r"\s*(atoms|covers)\s*:", line) or re.match(r"\s*-\s*(CMD|STR|SET|VIEW|WELCOME|MENU|TEL|KEY|CTX):", line):
            continue
        for rx, what in IDENTITY_PATTERNS:
            if rx.search(line):
                errs.append(f"line {n}: names {what} (identity rule: cases assert nothing about the reference's identity)")
    return errs


R34 = "unredacted command line (R-34: write <docker command> and assert only the message around it)"


def command_line_errors(text, captured=False, where="line"):
    """R-34: command lines the reference ran (on screen or described with their flags) must be redacted."""
    find = redact.find_captured if captured else redact.find_prose
    return [f"{where} {n}: {R34}: ...{hit}..." for n, line in enumerate(text.splitlines(), 1) for hit in find(line)]


def recording_errors(path):
    """R-34 check of a transcript, result or batch log (captured text)."""
    try:
        text = open(path, encoding="utf-8").read()
    except (OSError, UnicodeDecodeError):
        return []
    if path.endswith(".json"):
        try:
            hits = redact.find_obj(json.loads(text))
        except ValueError:
            hits = redact.find_captured(text)
        return [f"{R34}: ...{h}..." for h in hits[:3]] + ([f"... and {len(hits) - 3} more"] if len(hits) > 3 else [])
    return command_line_errors(text, captured=True)


PROFILE_KEYS = {"name", "version", "description", "os", "arch", "hosts", "state", "environments", "links",
                "state_scripts", "notes"}
ENV_KEYS = {
    "editor": {"id", "kind", "fixture", "extensions", "home", "settings"},
    "engine": {"id", "kind", "engine", "fixture", "known_names", "network"},
    "sshtarget": {"id", "kind", "fixture", "distro", "user", "host"},
    "wsl": {"id", "kind", "fixture", "distro", "wsl_version"},
    "tunnel": {"id", "kind", "fixture", "provider"},
}


def validate_profile(ref_or_path):
    """A profile is a graph: environments (editor, engine, sshtarget, wsl, tunnel) joined by links (docker-socket,
    ssh, tunnel, wsl). Every shape that validates is accepted; what is provisionable (caselib.topology: editor
    -docker-socket-> engine, or an editor alone) runs, the rest is reported
    not-applicable by the runner."""
    path = ref_or_path if ref_or_path.endswith(".yaml") else f"{caselib.PROFILES}/{caselib.parse_profile_ref(ref_or_path)[0]}.yaml"
    if not os.path.exists(path):
        return [f"profile file {path} does not exist"]
    p = caselib.load_yaml(path) or {}
    errs = []
    stem = os.path.basename(path)[:-5]
    if set(p) - PROFILE_KEYS:
        errs.append(f"{stem}: unknown keys {sorted(set(p) - PROFILE_KEYS)}")
    if p.get("name") != stem:
        errs.append(f"{stem}: name must equal the file name")
    if not isinstance(p.get("version"), int):
        errs.append(f"{stem}: version must be an integer")
    for k, allowed in (("os", ("linux", "windows", "macos")), ("state", ("clean", "dirty", "bad"))):
        if p.get(k) not in allowed:
            errs.append(f"{stem}: {k} must be one of {allowed}")
    m = re.match(r"^[a-z]+-[a-z]+-(clean|dirty|bad)(-|$)", stem)
    if not m or m.group(1) != p.get("state"):
        errs.append(f"{stem}: the name must read <os>-<engine>-<state>[-<what>] with state = {p.get('state')}")
    if not set(p.get("hosts") or []) or set(p.get("hosts") or []) - set(HOSTS):
        errs.append(f"{stem}: hosts must be a non-empty subset of {HOSTS}")
    if not p.get("arch"):
        errs.append(f"{stem}: arch missing")
    elif not isinstance(p["arch"], list) or set(p["arch"]) - set(caselib.PROFILE_ARCH.values()):
        errs.append(f"{stem}: arch must be a list of {sorted(caselib.PROFILE_ARCH.values())} (the platforms it may be recorded on)")
    if not p.get("description"):
        errs.append(f"{stem}: description missing")
    for sc in p.get("state_scripts") or []:
        if not os.path.exists(f"{caselib.PROFILES}/{sc}"):
            errs.append(f"{stem}: state script {sc} missing")
    if not p.get("state_scripts"):
        errs.append(f"{stem}: state_scripts missing (every state is a script, even a no-op check)")
    import fixture  # noqa: E402 (catalogue)
    cat = fixture.load_catalog()
    envs = p.get("environments")
    if not isinstance(envs, list) or not envs:
        return errs + [f"{stem}: environments must be a non-empty list"]
    ids = {}
    for j, e in enumerate(envs):
        w = f"{stem}: environments[{j}]"
        if not isinstance(e, dict) or e.get("kind") not in caselib.ENV_KINDS:
            errs.append(f"{w}: kind must be one of {caselib.ENV_KINDS}")
            continue
        if not re.fullmatch(r"[a-z][a-z0-9-]*", str(e.get("id", ""))) or e["id"] in ids:
            errs.append(f"{w}: id missing, malformed or repeated")
            continue
        ids[e["id"]] = e["kind"]
        if set(e) - ENV_KEYS[e["kind"]]:
            errs.append(f"{w}: keys for {e['kind']}: {sorted(ENV_KEYS[e['kind']])}")
        if e["kind"] in ("editor", "engine") and not e.get("fixture"):
            errs.append(f"{w}: an {e['kind']} environment names its golden fixture")
        if e.get("fixture") and not fixture.find(e["kind"], e["fixture"], cat=cat):
            errs.append(f"{w}: fixture {e['kind']}/{e['fixture']} is not in fixtures/CATALOG.json")
        if e["kind"] == "editor":
            for x in caselib.profile_extensions(e, "under-test"):
                if x not in ("under-test", "companions") and x not in caselib.FIXTURE_EXTENSIONS:
                    errs.append(f"{w}: extension {x} is neither `under-test`, `companions` nor a known fixture extension")
            if "none" in (e.get("extensions") or []) and len(e["extensions"]) != 1:
                errs.append(f"{w}: extensions [none] stands alone (no extension at all)")
            if e.get("home", "private") not in ("private", "none"):
                errs.append(f"{w}: home private | none")
        if e["kind"] == "engine":
            if e.get("engine", "docker-ce") not in ("docker-ce", "docker-desktop", "podman", "none"):
                errs.append(f"{w}: engine docker-ce | docker-desktop | podman | none")
            if e.get("network", "bridge") not in ("bridge", "offline"):
                errs.append(f"{w}: network bridge | offline")
    if list(ids.values()).count("editor") != 1:
        errs.append(f"{stem}: exactly one editor environment (the window under test)")
    adj = {}
    for j, l in enumerate(p.get("links") or []):
        w = f"{stem}: links[{j}]"
        if not isinstance(l, dict) or set(l) != {"from", "to", "kind"}:
            errs.append(f"{w}: a link is {{from, to, kind}}")
            continue
        if l["kind"] not in caselib.LINK_KINDS:
            errs.append(f"{w}: kind must be one of {caselib.LINK_KINDS}")
            continue
        if l["from"] not in ids or l["to"] not in ids:
            errs.append(f"{w}: from/to must name environments")
            continue
        froms, tos = caselib.LINK_ENDS[l["kind"]]
        if ids[l["from"]] not in froms or ids[l["to"]] not in tos:
            errs.append(f"{w}: a {l['kind']} link goes from {sorted(froms)} to {sorted(tos)}, not {ids[l['from']]} -> {ids[l['to']]}")
        adj.setdefault(l["from"], []).append(l["to"])
    editor = next((i for i, k in ids.items() if k == "editor"), None)
    seen, todo = set(), [editor] if editor else []
    while todo:
        n = todo.pop()
        if n not in seen:
            seen.add(n)
            todo += adj.get(n, [])
    for i in ids:
        if editor and i not in seen:
            errs.append(f"{stem}: environment {i} is not reachable from the editor through links")
    return errs


def _fixture_binding_errors(case, profile):
    """The case names every golden fixture of its profile as <name>@<sha12>; each must be in the catalogue with that
    hash, and its tarball present with the catalogued size (fixture.py verify checks the full hash)."""
    import fixture  # noqa: E402
    errs, cat = [], fixture.load_catalog()
    binds = case.get("fixtures")
    envs = {e["id"]: e for e in (profile or {}).get("environments") or [] if isinstance(e, dict) and e.get("fixture")}
    if not isinstance(binds, dict):
        example = ", ".join(f"{i}: {e['fixture']}@<sha12>" for i, e in envs.items())
        return [f"fixtures: name the profile's fixtures, e.g. {{{example}}} (fixture.py pin)"] if envs else []
    for k in set(binds) - set(envs):
        errs.append(f"fixtures.{k}: the profile has no environment {k} with a fixture")
    for i, e in envs.items():
        name, sha12 = fixture.parse_ref(binds.get(i))
        if not name:
            errs.append(f"fixtures.{i}: want {e['fixture']}@<12 hex digits of its sha256>")
        elif name != e["fixture"]:
            errs.append(f"fixtures.{i}: the profile's {i} uses fixture {e['fixture']}, not {name}")
        else:
            if fixture.REFERENCE_CATALOG:   # the published suite: the pin must name a published fixture; the local
                pub = json.load(open(fixture.REFERENCE_CATALOG))   # build is resolved and checked by the provisioner
                if not fixture.find(e["kind"], name, sha12, pub):
                    errs.append(f"fixtures.{i}: {name}@{sha12} is not in the published catalogue")
                continue
            entry = fixture.find(e["kind"], name, sha12, cat)
            if not entry:
                have = fixture.find(e["kind"], name, cat=cat)
                errs.append(f"fixtures.{i}: {name}@{sha12} is not in fixtures/CATALOG.json"
                            + (f" (the catalogue has {name}@{have['sha256'][:12]}: re-pin and re-record)" if have else " (missing)"))
            elif entry.get("file"):
                f = fixture.fixture_file(entry)
                if not os.path.exists(f) or os.path.getsize(f) != entry.get("size"):
                    errs.append(f"fixtures.{i}: tarball {entry['file']} missing or not the catalogued size")
    return errs


def engine_images(case, profile):
    import fixture  # noqa: E402
    for e in (profile or {}).get("environments") or []:
        if isinstance(e, dict) and e.get("kind") == "engine" and e.get("fixture"):
            name, sha12 = fixture.parse_ref((case.get("fixtures") or {}).get(e["id"]))
            entry = fixture.find("engine", e["fixture"], sha12 if name else None)
            return {i["tag"] for i in (entry or {}).get("contents", {}).get("images", [])}
    return set()


def validate_case(path, case=None, for_recording=False):
    """Schema errors of one case file (for_recording: ignore the recorder-owned blocks, the recorder replaces them)."""
    errs = []
    case = case if case is not None else caselib.load_yaml(path)
    if not isinstance(case, dict):
        return ["not a YAML mapping"]
    unknown = set(case) - set(WRITER_KEYS) - set(caselib.RECORDER_KEYS)
    if unknown:
        errs.append(f"unknown top-level keys {sorted(unknown)}")
    m = ID_RE.match(str(case.get("id", "")))
    stem, folder = os.path.basename(path)[:-5], os.path.basename(os.path.dirname(path))
    if not m:
        errs.append("id must read F-XXXX-AC<n>-<k>")
    else:
        if stem != case["id"]:
            errs.append(f"id {case['id']} does not match the file name {stem}")
        if case.get("feature") != m.group(1) or folder != m.group(1):
            errs.append("feature must equal the id's feature and the folder name")
    feat = case.get("feature")
    acs = case.get("ac")
    spec_acs = caselib.spec_acs(feat) if feat else []
    if not isinstance(acs, list) or not acs or not all(isinstance(a, int) for a in acs):
        errs.append("ac must be a non-empty list of AC numbers")
    else:
        if m and int(m.group(2)) not in acs:
            errs.append(f"the id's AC{m.group(2)} is not in ac")
        for a in acs:
            if spec_acs and a not in spec_acs:
                errs.append(f"AC-{a} is not an acceptance criterion of specs/{feat}.md")
    owned = set(caselib.owned_atoms(feat)) if feat else set()
    atoms = case.get("atoms", [])
    if not isinstance(atoms, list):
        errs.append("atoms must be a list (possibly empty)")
    elif os.path.exists(f"{caselib.FEATURES}/{feat}.yaml"):   # the published suite has no inventory to check against
        for at in atoms:
            if at not in owned:
                errs.append(f"atom {at} is not owned by {feat}")
    if "reference-only" in case and not isinstance(case["reference-only"], bool):
        errs.append("reference-only must be true or false")
    if "issue" in case and not isinstance(case["issue"], int):
        errs.append("issue must be the feature's issue number")
    for r in case.get("ac_issue_refs") or []:
        if not re.fullmatch(r"F-\d{4}\.AC-\d+ #\d+", str(r)):
            errs.append(f"ac_issue_refs: {r!r} must read F-XXXX.AC-n #<issue>")
    if case.get("kind") not in ("positive", "negative"):
        errs.append("kind must be positive or negative")
    errors = caselib.spec_errors(feat) if feat else {}
    for c in case.get("covers") or []:
        if not COVERS_RE.match(str(c)):
            errs.append(f"covers: {c!r} is not an error id (7.En), a section (5.0, 6.2), a BR-n or 'observed: <section>'")
        elif str(c).startswith("7.E") and c not in errors:
            errs.append(f"covers: {c} is not an error of specs/{feat}.md section 7")
    profile = None
    try:
        profile = caselib.load_profile(case.get("profile"))
        errs += [f"profile: {e}" for e in validate_profile(case["profile"])]
    except ValueError as e:
        errs.append(f"profile: {e}")
    if profile is not None:
        errs += _fixture_binding_errors(case, profile)
    errs += _fixture_errors(case.get("fixture"), case, profile)
    errs += _engine_use_errors(case, profile)
    steps = case.get("steps")
    seen = set()
    if not isinstance(steps, list) or not steps:
        errs.append("steps must be a non-empty list")
    else:
        bound = set()
        for i, s in enumerate(steps):
            errs += _step_errors(i, s, seen)
            for ref in caselib.bind_refs(s):
                if ref not in bound:
                    errs.append(f"steps[{i}]: ${{bind.{ref}}} is not bound by an earlier observe")
            if isinstance(s, dict) and isinstance(s.get("observe"), dict):
                bound |= set((s["observe"].get("bind") or {}))
            if isinstance(s, dict) and isinstance(s.get("engine"), dict) and isinstance(s["engine"].get("run"), dict):
                images = engine_images(case, profile)
                if images and s["engine"]["run"].get("image") not in images:
                    errs.append(f"steps[{i}]: engine run image {s['engine']['run'].get('image')!r} is not in the engine fixture")
        if not seen:
            errs.append("a case needs at least one observe step (expect is keyed by observe id)")
    errs += _identity_errors(path)
    with open(path, encoding="utf-8") as f:
        whole = f.read()
    errs += command_line_errors(caselib.split_case_text(whole))
    errs += [f"recorder blocks: {R34}: ...{h}..." for h in
             redact.find_obj({k: case.get(k) for k in ("expect", "observations", "failure") if k in case})]
    if not for_recording:
        errs += _recorder_errors(case, seen)
    return errs


def _recorder_errors(case, observe_ids):
    errs = []
    st = case.get("status")
    if st is None:
        if any(k in case for k in caselib.RECORDER_KEYS):
            errs.append("recorder blocks without status (only the recorder, record.py, writes them)")
        return errs
    if st not in STATUSES:
        errs.append(f"status {st!r} unknown")
    rec = case.get("recorded")
    if not isinstance(rec, dict):
        return errs + ["status without a recorded block"]
    for k in ("reference_version", "vscode_version", "platform", "host", "profile", "fixtures", "case_sha256", "date",
              "runs", "normalization"):
        if k not in rec:
            errs.append(f"recorded.{k} missing")
    if rec.get("profile") != case.get("profile"):
        errs.append("recorded.profile differs from the case profile: re-record")
    if (rec.get("fixtures") or {}) != (case.get("fixtures") or {}):
        errs.append("recorded.fixtures differ from the fixtures the case names: re-record")
    if rec.get("case_sha256") != caselib.writer_digest(case):
        errs.append("the case changed since it was recorded (recorded.case_sha256): re-record")
    errs += _platform_errors(case, rec)
    if st == "recorded":
        exp = case.get("expect")
        if not isinstance(exp, dict):
            errs.append("status recorded without expect")
        elif set(exp) != observe_ids:
            errs.append(f"expect keys {sorted(exp)} differ from the observe ids {sorted(observe_ids)}: re-record")
        if REFERENCE_ID.search(str(exp)):
            errs.append("expect contains the reference extension id (normalization missing): re-record")
        bad = caselib.lab_error_in(exp)
        if bad:
            errs.append(f"expect contains a lab driver error ({bad!r}): the recording failed to observe; reshape and re-record")
    elif "expect" in case:
        errs.append(f"expect present with status {st}")
    return errs


def _platform_errors(case, rec):
    """recorded.platform: the one platform the expect was recorded on; recorded.confirmed: platforms added later by
    runs that matched the expect (record.py --confirm), each another platform, with its runs."""
    errs = []
    plats = set(caselib.PROFILE_ARCH)
    if rec.get("platform") not in plats:
        errs.append(f"recorded.platform {rec.get('platform')!r} is not one of {sorted(plats)}")
    try:
        arch = caselib.load_profile(case.get("profile")).get("arch") or []
    except ValueError:
        arch = None
    if arch is not None and rec.get("platform") in plats and caselib.PROFILE_ARCH[rec["platform"]] not in arch:
        errs.append(f"recorded.platform {rec['platform']} is not in the profile's arch {arch}")
    conf = rec.get("confirmed")
    if conf is None:
        return errs
    if not isinstance(conf, list):
        return errs + ["recorded.confirmed must be a list"]
    seen = {rec.get("platform")}
    for j, c in enumerate(conf):
        w = f"recorded.confirmed[{j}]"
        if not isinstance(c, dict) or c.get("platform") not in plats:
            errs.append(f"{w}: platform one of {sorted(plats)}")
            continue
        if c["platform"] in seen:
            errs.append(f"{w}: {c['platform']} is already the recorded or a confirmed platform")
        seen.add(c["platform"])
        if not c.get("runs") or any(r.get("result") != "ok" for r in c["runs"]):
            errs.append(f"{w}: confirmation runs missing or not all ok")
        if case.get("status") != "recorded":
            errs.append(f"{w}: only a recorded case carries confirmations")
    return errs


def case_validity(path):
    """(valid, reasons): valid = schema clean, status recorded, at least two recorded runs whose transcripts exist,
    and an expect block."""
    case = caselib.load_yaml(path) or {}
    reasons = validate_case(path, case)
    st = case.get("status")
    runs = (case.get("recorded") or {}).get("runs") or []
    if st != "recorded":
        reasons.append(f"status {st or 'not recorded'}")
    if len([r for r in runs if r.get("result") == "ok"]) < 2:
        reasons.append("fewer than two recorded runs")
    for r in runs + [x for c in (case.get("recorded") or {}).get("confirmed") or [] for x in c.get("runs") or []]:
        tp = os.path.join(caselib.ROOT, r.get("transcript", "") or "/nonexistent")
        if not os.path.exists(tp):
            reasons.append(f"transcript missing: {r.get('transcript')}")
        else:
            reasons += [f"transcript {r.get('transcript')}: {e}" for e in recording_errors(tp)]
    if case.get("expect") and not runs:
        reasons.append("expect without transcripts")
    return (not reasons), reasons




def main(argv):
    targets = argv or [caselib.TESTS]
    files = []
    notes, recs = [], []
    for t in targets:
        if os.path.isdir(t):
            for d, _, fs in os.walk(t):
                if "/recordings" in d or "/results" in d:
                    recs += [os.path.join(d, f) for f in fs if f.endswith((".json", ".log"))]
                    continue
                files += [os.path.join(d, f) for f in fs if f.endswith(".yaml")]
                if "/profiles" not in d:   # the state scripts are the lab's own commands, not the reference's
                    notes += [os.path.join(d, f) for f in fs if f.endswith(".md") and f != "README.md"]
        else:
            files.append(t)
    n_err = 0
    for f in sorted(files):
        f = os.path.abspath(f)
        if f.startswith(caselib.PROFILES + "/"):
            errs = validate_profile(f)
        else:
            errs = validate_case(f)
        for e in errs:
            print(f"{os.path.relpath(f, caselib.ROOT)}: {e}")
        n_err += len(errs)
    for f in sorted(notes) + sorted(recs):   # R-34 in notes (prose) and in recordings and results (captured)
        errs = command_line_errors(open(f, encoding="utf-8").read()) if f.endswith(".md") else recording_errors(f)
        for e in errs:
            print(f"{os.path.relpath(f, caselib.ROOT)}: {e}")
        n_err += len(errs)
    print(f"{len(files)} file(s), {len(notes)} note(s), {len(recs)} recording file(s); {n_err} error(s)")
    return 1 if n_err else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
