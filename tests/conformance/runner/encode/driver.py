"""Drive one lab slot for the encode tools: `lab` calls in JSON mode (LAB_JSON=1), waits with explicit conditions,
observations, and Docker queries against the run's PRIVATE daemon.

Nothing here opens its own CDP or WebSocket connection: every UI interaction goes through the `lab` command.
Docker is only ever asked for state, labels and mounts (never command lines, never exec into anything).
"""
import json
import signal
import os
import shlex
import subprocess
import time

import caselib
import normalize
import redact

# environment for subprocesses that must talk to the HOST's Docker / lab tooling, never to some DOCKER_HOST of ours
BASE_ENV = {k: v for k, v in os.environ.items()
            if k not in ("DOCKER_HOST", "DOCKER_CONTEXT", "LAB_DOCKER_SOCK", "LAB_HOME", "LAB_WINDOW", "LAB_JSON",
                         "LAB_HOST", "LAB_SLOT", "LAB_PASSENV", "LAB_AGENT", "LAB_RUN_TARGET", "LAB_CMD_EXACT")}

STATE_WHATS = ("title", "dialogs", "notifications", "statusbar", "contextmenu", "banner", "editors", "welcome",
               "sidebar")
SIMPLE_WHATS = STATE_WHATS + ("quickpick", "notification_center", "windows", "files", "opened_urls")
DICT_WHATS = ("view", "hover", "docker", "panel", "statusbar", "contextmenu", "suggest", "hovertext", "markers", "tokens", "folds", "outline",
              "breadcrumbs", "target_files", "user_settings", "notification_order")
TARGET_FILES_INTERVAL = 2   # seconds between the two reads of a target_files observation (the case may say 1 to 30)
# Editor observations (lab verbs of the same name, remote-ssh-edit 2026-10-02): the payload keys kept from the verb's
# JSON output. Expectation key: <kind>:<file or "active">[@line[:col]].
EDITOR_PAYLOAD = {
    "suggest": ("items", "total", "message"),
    "hovertext": ("text", "parts", "actions"),
    "markers": ("items",),
    "tokens": ("text", "length", "language", "tokenType", "scopes"),
    "folds": ("items",),
    "outline": ("items",),
    "breadcrumbs": ("items",),
}
# Arguments of an editor observation that the recorder reads itself and never hands to the lab verb (2026-10-03):
# `timeout`, the seconds the verb may take (default EDITOR_TIMEOUT); `fields`, for suggest, the item fields kept
# (`order` always), so a case records only what its AC asserts (a list whose documentation is not the contract).
EDITOR_TIMEOUT = 120
RECORDER_ARGS = ("timeout", "fields")
SUGGEST_FIELDS = ("label", "kind", "preselected", "detail", "documentation", "links", "labelDetail", "qualifier",
                  "description", "deprecated")


def editor_key(kind, arg):
    pos = f"@{arg['line']}" + (f":{arg['col']}" if "col" in arg else "") if "line" in arg else ""
    return f"{kind}:{arg.get('file') or 'active'}{pos}"
WAIT_KINDS = ("quickpick", "dialog", "no_dialog", "no_notification", "notification", "statusbar", "title", "windows", "view", "container",
              "volume", "quiet")



_SCALE = []


def wait_scale():
    """Every case wait times this factor: ENCODE_WAIT_SCALE, else the package's identity file (runner: wait_scale),
    else 1. remote-ssh-edit runs at 2 (remote-oss/remote#72 triage: 22 timeouts passed at twice the wait)."""
    if not _SCALE:
        v = os.environ.get("ENCODE_WAIT_SCALE")
        if not v:
            try:
                v = ((normalize.identity_config() or {}).get("runner") or {}).get("wait_scale")
            except Exception:
                v = None
        _SCALE.append(float(v or 1))
    return _SCALE[0]


class Docker:
    """docker CLI against one daemon (DOCKER_HOST=tcp://...)."""

    def __init__(self, docker_host, remote=None):
        self.docker_host, self.remote = docker_host, remote

    def run(self, args, check=False, timeout=180):
        p = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout,
                           env=dict(BASE_ENV, DOCKER_HOST=self.docker_host))
        if check and p.returncode != 0:
            raise RuntimeError(f"docker {' '.join(args[:3])} failed: {p.stderr.strip()[:300]}")
        return p

    def containers(self, ids=False):
        """State, labels and mounts of every container (with ids=True also its id, for `bind`)."""
        want_ids = ids
        ids = self.run(["ps", "-aq", "--no-trunc"]).stdout.split()
        if not ids:
            return []
        out = []
        for c in json.loads(self.run(["inspect", *ids]).stdout or "[]"):
            mounts = []
            for m in c.get("Mounts") or []:
                rec = {"type": m.get("Type"), "destination": m.get("Destination"), "rw": m.get("RW")}
                if m.get("Type") == "volume":
                    rec["name"] = m.get("Name")
                else:
                    rec["source"] = m.get("Source")
                mounts.append(rec)
            mounts.sort(key=lambda r: (r.get("destination") or ""))
            out.append({"name": (c.get("Name") or "").lstrip("/"), "image": (c.get("Config") or {}).get("Image"),
                        "state": (c.get("State") or {}).get("Status"),
                        "labels": (c.get("Config") or {}).get("Labels") or {}, "mounts": mounts})
            if want_ids:
                out[-1]["id"] = c.get("Id")
        return out

    def volumes(self, containers=None):
        names = self.run(["volume", "ls", "-q"]).stdout.split()
        if not names:
            return []
        containers = self.containers() if containers is None else containers
        out = []
        for v in json.loads(self.run(["volume", "inspect", *names]).stdout or "[]"):
            users = sorted(c["name"] for c in containers if any(m.get("name") == v["Name"] for m in c["mounts"]))
            out.append({"name": v["Name"], "driver": v.get("Driver"), "labels": v.get("Labels") or {}, "used_by": users})
        return out

    def images(self):
        ids = sorted(set(self.run(["images", "-q", "--no-trunc"]).stdout.split()))
        if not ids:
            return []
        out = []
        for i in json.loads(self.run(["image", "inspect", *ids]).stdout or "[]"):
            out.append({"tags": sorted(i.get("RepoTags") or []), "labels": (i.get("Config") or {}).get("Labels") or {}})
        return out


def match_filter(rec, flt, kind):
    """Case-scoped filters: {name: x} exact, {name_prefix: x}, {label: k} or {label: k=v}."""
    names = rec.get("tags") if kind == "images" else [rec.get("name")]
    names = [n for n in names or [] if n]
    if "name" in flt and flt["name"] not in names:
        return False
    if "name_prefix" in flt and not any(n.startswith(flt["name_prefix"]) for n in names):
        return False
    if "label" in flt:
        k, _, v = str(flt["label"]).partition("=")
        labels = rec.get("labels") or {}
        if k not in labels or ("=" in str(flt["label"]) and labels[k] != v):
            return False
    return True


BOOKKEEPING = {"ok", "command", "args", "messages", "error", "errorDetail"}
NAVIGATION_ERRORS = ("Execution context was destroyed", "Target page, context or browser has been closed",
                     "frame was detached", "Target closed", "navigation", "has been closed")


def shown_has(shown, want):
    """Whether `shown` holds `want`, or core's cut of it: a label longer than 40 characters shows as its first 40 plus "…"
    (F-2502 BR-9; [oss] remoteIndicator.ts REMOTE_STATUS_LABEL_MAX_LENGTH). `want` is the whole host label, such as
    "SSH: ${SSH_HOST}" substituted; no other cut matches (athena on #229)."""
    return want in shown or (len(want) > 40 and want[:40] + "\u2026" in shown)


def screen_only(st):
    """What `quiet` compares: the screen, without how long the `lab` call took (`_seconds`) or other bookkeeping;
    on a busy host the timing changed on every poll and the quiet timer never settled (F-0419, 2026-10-01)."""
    if isinstance(st, dict):
        return {k: screen_only(v) for k, v in st.items() if not k.startswith("_") and k not in BOOKKEEPING}
    if isinstance(st, list):
        return [screen_only(v) for v in st]
    return st


class Session:
    """One run's view of its slot: lab calls, waits, observations."""

    def __init__(self, slot, host, ph, docker=None, known_names=(), log=None, run_target=None):
        self.slot, self.host, self.ph, self.docker = slot, host, ph, docker
        self.run_target = run_target   # "<alias>:<case folder>": the run's narrower R-63 rule (fixture.window_start: local)
        self.exact = False             # cmd matches the exact palette title only (LAB_CMD_EXACT; window: {close})
        self.known_names = set(known_names)
        self.target_files = None   # the run's `sshtarget files` on its per-case target (record sets it), else None
        self.user_settings = None  # the run's reader of its slot profile's settings.json (record sets it), else None
        self.urls_start = 0        # how many URLs the slot's log held when the case began (mark_urls); older ones are not its
        self.window = None
        self.log = log or (lambda *_: None)

    # ---- lab
    def lab(self, *args, timeout=180, stdin=None):
        """A lab verb; stdin (text) goes to the process's standard input, never its command line."""
        env = dict(BASE_ENV, LAB_SLOT=str(self.slot), LAB_JSON="1")
        if self.window:
            env["LAB_WINDOW"] = self.window
        if self.run_target:
            env["LAB_RUN_TARGET"] = self.run_target
        if self.exact:
            env["LAB_CMD_EXACT"] = "1"
        t0 = time.time()
        try:
            p = subprocess.run([caselib.LAB, *map(str, args)], capture_output=True, text=True, env=env, timeout=timeout,
                               input=stdin)
            out = p.stdout.strip().splitlines()
            try:
                res = json.loads(out[-1]) if out else {"ok": False, "error": "no output: " + p.stderr.strip()[:300]}
            except json.JSONDecodeError:
                res = {"ok": False, "error": "unparseable lab output", "raw": p.stdout[-2000:]}
        except subprocess.TimeoutExpired:
            res = {"ok": False, "error": f"lab {args[0]} timed out after {timeout}s"}
        if isinstance(res, dict) and "ok" not in res:
            res["ok"] = True
        res["_seconds"] = round(time.time() - t0, 1)
        # R-34: a command line shown on screen is redacted the moment it is captured, so waits, observations, step
        # outputs and failure observations never hold one
        return redact.redact_obj(res)

    def state(self):
        st = self.lab("state", timeout=60)
        return st if st.get("ok") and "title" in st else None

    def act(self, *args, timeout=180, stdin=None):
        """An action verb. When its own action reloads or navigates the window, `lab` loses the page before it can
        print the state ("Execution context was destroyed"); the action happened, so it counts as done as soon as a
        fresh state read works (F-0419-AC14-13, 2026-10-01)."""
        res = self.lab(*args, timeout=timeout, stdin=stdin)
        err = str(res.get("error") or "") + " " + str(res.get("errorDetail") or "")
        if res.get("ok") or not any(n in err for n in NAVIGATION_ERRORS):
            return res
        deadline = time.time() + 60
        while time.time() < deadline:
            time.sleep(2)
            st = self.state()
            if st:
                return {"ok": True, "navigated": True, "lostPage": str(res.get("error"))[:200], "state": st}
        return res

    # ---- waits
    def wait(self, until, timeout):
        conds = until if isinstance(until, list) else [until]
        conds = [caselib.subst(c, self.ph) for c in conds]
        timeout = float(timeout) * wait_scale()
        deadline = time.time() + timeout
        quiet = next((float(c["quiet"]) for c in conds if "quiet" in c), None)
        if any("notification_seen" in c for c in conds) and not self.keeper_alive():
            # athena on kit #241 (A): a gap in the log must never pass as "not shown"
            return {"ok": False, "error": "notification_seen: the notification log keeper (lab notification-log-keep) is "
                                          "not running for this window", "polls": 0, "conditions": {}}
        last, since, polls = None, time.time(), 0
        detail = {}
        while True:
            polls += 1
            st = self.state()
            snap = json.dumps(screen_only(st), sort_keys=True) if st else None
            if snap != last:
                last, since = snap, time.time()
            ok_all = True
            for c in conds:
                (kind, arg), = c.items()
                if kind == "quiet":
                    ok = st is not None and time.time() - since >= quiet
                else:
                    ok = self._cond(kind, arg, st)
                detail[kind] = ok
                ok_all = ok_all and ok
            if ok_all:
                return {"ok": True, "polls": polls, "conditions": detail}
            if time.time() > deadline:
                return {"ok": False, "error": f"wait timed out after {timeout}s: " + json.dumps(conds)[:300],
                        "polls": polls, "conditions": detail, "state": st}
            time.sleep(1.0)

    def _lab_env(self):
        env = dict(BASE_ENV, LAB_SLOT=str(self.slot), LAB_JSON="1")
        return env

    def start_keeper(self):
        """athena on kit #241 (A): the resident `lab notification-log-keep` of this window (CDP init scripts live only
        while their session stays attached). The provisioner starts it with the window and again on restart."""
        self.stop_keeper()
        self._keeper = subprocess.Popen([caselib.LAB, "notification-log-keep"], env=self._lab_env(), stdin=subprocess.DEVNULL,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

    def stop_keeper(self):
        k = getattr(self, "_keeper", None)
        self._keeper = None
        if k and k.poll() is None:
            try:
                os.killpg(k.pid, signal.SIGTERM)
                k.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                k.kill()

    def keeper_alive(self):
        k = getattr(self, "_keeper", None)
        return bool(k) and k.poll() is None

    def notifications_seen(self):
        """{epoch, seen: [{seq, text}]}: every notification appearance since the log began (lab.mjs keeps it in the page),
        or None when the window cannot be read."""
        r = self.lab("notifications-seen", timeout=60)
        return r if r.get("ok") and isinstance(r.get("seen"), list) else None

    def begin_step(self, i):
        """athena on kit #241 (A): notification_seen counts appearances since its step began: from window start for the
        first step (a remote start's short stages happen while provisioning), from the log's length at the step's start
        for every later one (a new epoch, after a reload, counts whole)."""
        if i == 0:
            self._seen_mark = None
            return
        r = self.notifications_seen()
        self._seen_mark = (r["epoch"], len(r["seen"])) if r else None

    def _seen_since_mark(self, text):
        r = self.notifications_seen()
        if r is None:
            return False
        mark = getattr(self, "_seen_mark", None)
        entries = [e for e in r["seen"] if not (mark and mark[0] == r.get("epoch") and e.get("seq", 0) < mark[1])]
        return any(text in str(e.get("text") or "") for e in entries)

    def _cond(self, kind, arg, st):
        if kind == "notification_seen":   # a stage shorter than a poll counts: any appearance since the step began
            return self._seen_since_mark(arg)
        if kind in ("quickpick", "dialog", "no_dialog", "no_notification", "notification", "statusbar", "title") and st is None:
            return False
        if kind == "quickpick":
            vis = bool(st["quickInput"].get("visible"))
            if arg in ("visible", True):
                return vis
            if arg in ("hidden", False):
                return not vis
            q = st["quickInput"]
            text = " ".join(str(x) for x in [q.get("title"), q.get("placeholder")] + [i["label"] for i in q.get("items", [])] if x)
            return vis and str(arg.get("contains", "")) in text
        if kind == "dialog":
            return any(arg == "*" or arg in " ".join(filter(None, [d.get("message"), d.get("detail")] + d.get("body", [])))
                       for d in st["dialogs"])
        if kind == "no_dialog":
            return not st["dialogs"]
        if kind == "no_notification":   # R-49: no visible toast at all, or none whose text contains the given text
            return not st["notifications"] if arg is True else not any(arg["contains"] in (n.get("text") or "") for n in st["notifications"])
        if kind == "notification":
            return any(arg in (n.get("text") or "") for n in st["notifications"])
        if kind == "statusbar":
            return any(shown_has(i.get("text") or "", arg) or shown_has(i.get("aria") or "", arg) for i in st["statusBar"])
        if kind == "title":
            return arg in st["title"]
        if kind == "windows":
            w = self.lab("windows", timeout=60)
            return w.get("ok") and len([x for x in w.get("windows", []) if not x["auxiliary"]]) == int(arg)
        if kind == "view":
            v = self.lab("view", arg["name"], timeout=60)
            if not v.get("ok") or "rows" not in v:
                return False
            if "row" in arg and not any(r["label"] == arg["row"] for r in v["rows"]):
                return False
            if "welcome" in arg and not any(arg["welcome"] in w for w in v["welcome"]):
                return False
            return True
        if kind == "container":
            recs = [c for c in self.docker.containers() if match_filter(c, arg, "containers")]
            if arg.get("state") == "absent":
                return not recs
            return any(c["state"] == arg.get("state", "running") for c in recs)
        if kind == "volume":
            recs = [v for v in self.docker.volumes() if match_filter(v, arg, "volumes")]
            return bool(recs) == bool(arg.get("exists", True))
        raise ValueError(f"unknown wait condition {kind}")

    # ---- observations
    def observe(self, what):
        what = caselib.subst(what, self.ph)
        st = self.state() or {}
        out = {}
        for w in what:
            if isinstance(w, str):
                out[w] = self._observe_simple(w, st)
            else:
                (kind, arg), = w.items()
                if kind == "view":
                    v = self.lab("view", arg, timeout=60)
                    out[f"view:{arg}"] = {k: v.get(k) for k in ("expanded", "titleActions", "welcome", "welcomeLinks", "messages", "rows")} \
                        if v.get("ok") and "rows" in v else {"visible": False, "error": v.get("error")}
                elif kind == "hover":
                    h = self.lab("hover", arg["view"], arg["row"], timeout=60)
                    out[f"hover:{arg['view']}/{arg['row']}"] = h.get("hovers", []) if h.get("ok") else {"error": h.get("error")}
                elif kind == "docker":
                    out["docker"] = self._observe_docker(arg)
                # {contextmenu: {labels: [...]}} keeps only the named rows (plain label text) of each open menu, in menu
                # order: VS Code core adds gallery-dependent rows a reimplementation not installed from a gallery lacks
                # (remote-ssh-edit, F-4002 review). Generic, so the public runner replays such cases too.
                elif kind == "contextmenu":
                    keep = set(arg.get("labels") or [])
                    out["contextmenu"] = [[i for i in m if isinstance(i, dict) and i.get("label") in keep]
                                          for m in self._observe_simple("contextmenu", st)]
                elif kind == "statusbar":   # the remote indicator and the extension's items, plus the core items named
                    out["statusbar"] = self._observe_simple("statusbar", st, core=arg.get("core") or [])
                elif kind == "panel":   # R-49: the panel part, its tabs, terminals and Output channel; never their text
                    out["panel"] = self._observe_panel()
                elif kind == "user_settings":   # athena on kit #227 (item 3): the named keys of settings.json only
                    out["user_settings"] = self.user_settings(arg["keys"]) if self.user_settings else \
                        {"error": "user_settings needs the run's profile"}
                elif kind == "target_files":
                    out[f"target_files:{arg['path']}"] = self._observe_target_files(arg)
                elif kind == "notification_order":
                    out["notification_order"] = self._observe_order(arg)
                elif kind in EDITOR_PAYLOAD:
                    out[editor_key(kind, arg)] = self._observe_editor(kind, arg)
        return redact.redact_obj(out)

    def mark_urls(self):
        """Note how many URLs the slot's log already holds, so `opened_urls` gives only this case's (athena on #228)."""
        u = self.lab("urls", timeout=60)
        self.urls_start = len(u.get("urls", [])) if u.get("ok") else 0

    def _observe_order(self, pair):
        """athena on kit #241 (option (2), F-2403 AC6-1): whether A's first appearance in the window's notification log
        (from the window's start; the log notification_seen reads, matched the same way) comes before B's first. Records
        the pair and `held`, or why not (`A not seen`, `B not seen`, `B before A`); no times, so replays compare equal. An
        observation, never a wait: the case waits for the state that ends the flow first. A notification whose text holds
        both is not an order, so it gives `B before A`."""
        a, b = pair
        if not self.keeper_alive():   # a gap in the log must never pass as "not seen" (athena on #241 (A))
            return {"error": "lab error: notification_order: the notification log keeper is not running for this window"}
        r = self.notifications_seen()
        if r is None:
            return {"error": "lab error: notification_order: the window's notification log cannot be read"}

        def first(text):
            return next((i for i, e in enumerate(r["seen"]) if text in str(e.get("text") or "")), None)
        ia, ib = first(a), first(b)
        result = "A not seen" if ia is None else "B not seen" if ib is None else "held" if ia < ib else "B before A"
        return {"pair": [a, b], "result": result}

    def _observe_target_files(self, arg):
        """athena on kit #218 (item 3): the per-case target after the connection closed, read twice `interval` seconds
        apart through the kit's own exec. Each entry's size is recorded as its change between the two reads (grew, same,
        shrank, gone, new), never the bytes, so two runs can agree; processes are executable names (comm) from the
        second read. Never contents, argv or environment."""
        if not self.target_files:
            return {"error": "target_files needs the case's own SSH target"}
        first = self.target_files(arg["path"])
        time.sleep(float(arg.get("interval") or TARGET_FILES_INTERVAL))
        second = self.target_files(arg["path"])
        if "error" in first or "error" in second:
            return {"error": first.get("error") or second.get("error")}
        a = {e["name"]: e for e in first["entries"]}
        b = {e["name"]: e for e in second["entries"]}

        def change(name):
            if name not in b:
                return "gone"
            if name not in a:
                return "new"
            if b[name]["type"] != "file":
                return "same"
            return "grew" if b[name]["size"] > a[name]["size"] else "shrank" if b[name]["size"] < a[name]["size"] else "same"
        return {"exists": second["exists"],
                "entries": [{"name": n, "type": (b.get(n) or a[n])["type"], "change": change(n)} for n in sorted(set(a) | set(b))],
                "processes": second["processes"]}

    def _observe_panel(self):
        """`lab panel` without the call's bookkeeping. `_seconds` (how long the call took) stayed in, so a closed panel's
        {"visible": false, "_seconds": 0.2} never agreed with the next run's (F-2304-AC33-1, 2026-10-12)."""
        p = self.lab("panel", timeout=60)
        if not p.get("ok"):
            return {"error": p.get("error")}
        return {k: v for k, v in p.items() if k not in ("command", "args", "ok") and not k.startswith("_")}

    def _observe_editor(self, kind, arg):
        """One editor observation through the lab verb of the same name (one JSON argument; LAB_JSON output)."""
        verb_arg = {k: v for k, v in arg.items() if k not in RECORDER_ARGS}
        r = self.lab(kind, json.dumps(verb_arg), timeout=int(arg.get("timeout") or EDITOR_TIMEOUT))
        if not r.get("ok"):
            return {"error": r.get("error")}
        keys = EDITOR_PAYLOAD[kind]
        if kind == "tokens" and "col" not in arg:
            keys = ("tokens",)
        out = {k: r.get(k) for k in keys} if len(keys) > 1 else r.get(keys[0])
        if kind == "suggest" and arg.get("fields") and isinstance(out.get("items"), list):
            want = ("order",) + tuple(f for f in SUGGEST_FIELDS if f in arg["fields"])
            out["items"] = [{k: it[k] for k in want if k in it} if isinstance(it, dict) else it for it in out["items"]]
        return out

    def _observe_simple(self, w, st, core=()):
        if w == "title":
            return st.get("title")
        if w == "dialogs":
            return st.get("dialogs", [])
        if w == "notifications":
            return st.get("notifications", [])
        if w == "statusbar":
            ident = normalize.identity_config()
            ids = [x["extension_id"] for x in (ident.get("reimplementation") or {},) if x.get("extension_id")]
            # `core` (the dict form {statusbar: {core: [ids]}}): VS Code core's items with those ids too, e.g.
            # status.editor.mode (the language), status.editor.eol, status.editor.indentation, status.editor.selection
            return [i for i in st.get("statusBar", []) if i.get("id") == "status.host" or i.get("id") in core
                    or any(e in (i.get("id") or "") for e in ids)]
        if w == "contextmenu":
            return st.get("contextMenus", [])
        if w == "banner":
            return st.get("banner")
        if w == "editors":
            return {"active": st.get("activeEditor"), "groups": st.get("editorTabs", [])}
        if w == "welcome":
            return st.get("welcome", [])
        if w == "sidebar":
            return {"title": st.get("sideBar"), "sections": st.get("sideBarSections", [])}
        if w == "quickpick":
            q = dict(st.get("quickInput") or {"visible": False})
            if q.get("visible"):
                q.pop("items", None)
                it = self.lab("items", "400", timeout=120)
                q["items"] = it.get("items", []) if it.get("ok") else {"error": it.get("error")}
            return q
        if w == "opened_urls":   # athena on kit #227 (item 2): the URLs this case's windows asked to open, in order
            u = self.lab("urls", timeout=60)
            return u.get("urls", [])[self.urls_start:] if u.get("ok") else {"error": u.get("error")}
        if w == "notification_center":
            n = self.lab("notifications", timeout=60)
            return n.get("notifications", []) if n.get("ok") else {"error": n.get("error")}
        if w == "windows":
            ws = self.lab("windows", timeout=60)
            return sorted(({"title": x["title"], "auxiliary": x["auxiliary"]} for x in ws.get("windows", [])),
                          key=lambda x: (x["auxiliary"], x["title"])) if ws.get("ok") else {"error": ws.get("error")}
        if w == "files":
            root = self.ph.get("WORKSPACE")
            files = []
            for d, dirs, fs in os.walk(root):
                rel = os.path.relpath(d, root)
                files += [os.path.join(rel, x).removeprefix("./") + "/" for x in dirs]
                files += [os.path.join(rel, x).removeprefix("./") for x in fs]
            return sorted(files)
        raise ValueError(f"unknown observation {w}")

    def _observe_docker(self, spec):
        out = {}
        cons = self.docker.containers(ids=bool(spec.get("ids")))
        for c in cons:
            if c["name"] not in self.known_names and normalize.GENERATED_NAME.match(c["name"]):
                c["name"] = "<GENERATED_NAME>"
        if "containers" in spec:
            out["containers"] = sorted((c for c in cons if match_filter(c, spec["containers"], "containers")),
                                       key=lambda c: (c["name"], c["image"] or ""))
        if "volumes" in spec:
            out["volumes"] = sorted((v for v in self.docker.volumes(cons) if match_filter(v, spec["volumes"], "volumes")),
                                    key=lambda v: v["name"])
        if "images" in spec:
            out["images"] = sorted((i for i in self.docker.images() if match_filter(i, spec["images"], "images")),
                                   key=lambda i: i["tags"])
        return out

    def full_observation(self):
        """Everything observable at a failure point (UI plus the run's own daemon), for the transcript."""
        obs = {"state": self.state(), "windows": self.lab("windows", timeout=60).get("windows")}
        if self.docker:
            try:
                cons = self.docker.containers()
                obs["docker"] = {"containers": cons, "volumes": self.docker.volumes(cons)}
            except Exception as e:  # the profile may have taken the daemon away on purpose
                obs["docker"] = {"error": str(e)[:300]}
        return redact.redact_obj(obs)
