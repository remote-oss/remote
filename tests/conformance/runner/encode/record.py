#!/usr/bin/env python3
"""Record conformance cases against the reference (a program, not an agent; D-22).

usage: record.py <case.yaml>... [--runs 2] [--host H] [--slot N] [--allow-platform-change]
       record.py --replay <case.yaml> --slot N [--host H] --result <file.json>   (one run compared to `expect`; suite.py)
       record.py --confirm <case.yaml>... [--runs 2] --host H [--slot N]      (add H's platform to recorded cases)

Platforms: a recording's runs all run on one host; recorded.platform is that host's platform, and the expect is valid
for it alone (plus every platform recorded.confirmed lists, after a --confirm whose runs all matched). A replay on any
other platform is not-applicable.

For each run: provision (private Docker + HOME, fresh slot profile, fixture, state script), drive the steps through
`lab` with LAB_JSON=1, capture every observe, tear everything down, and write one transcript
<recordings>/<case-id>/<run-id>.json. Then compare the runs' normalized observations:
  all equal         -> status: recorded, expect: <observations>, recorded: <metadata>
  different         -> status: flaky, flaky: true, observations: {<run-id>: ...}
  a step failed     -> status: failed, failure: {run, step, error, observation}
Exit status: 0 when every case was recorded (or the replay passed), 1 otherwise.
"""
import argparse
import contextlib
import datetime
import fcntl
import json
import os
import re
import sys
import time
import traceback

import caselib
import driver
import fixture
import normalize
import redact
import provision
import schema

CMD_WAIT = 30  # seconds a cmd step waits for its command to appear in the Command Palette
SINGLE = {"cmd", "palette", "pick", "check", "type", "key", "button", "link", "menu", "focus", "view"}


SECRET_PH = re.compile(r"\$\{(SSH_PASSWORD|SSH_PASSPHRASE|SSH_OTP|SSH_PASSWORD_NEW|SSH_ANSWER_(?:[1-9]|1[0-6]))\}")

class StepFailure(Exception):
    def __init__(self, index, step, error):
        super().__init__(error)
        self.index, self.step, self.error = index, step, error


# The per-case target's secrets the run has typed (athena on #209): every text the run writes passes write_text, which
# redacts them to their placeholders and refuses to write a password or passphrase that is still there.
SECRETS = {}   # value -> placeholder name; filled by type_secret, emptied after each run


class SecretLeak(RuntimeError):
    pass


def redact_secrets(text):
    """Every typed secret value to its placeholder: a password or passphrase anywhere; a one-time code as a whole token
    only (six digits collide with ports and process ids)."""
    for value, name in sorted(SECRETS.items(), key=lambda kv: -len(kv[0])):
        if name == "SSH_OTP":
            text = re.sub(r"(?<!\d)" + re.escape(value) + r"(?!\d)", "${SSH_OTP}", text)
        else:
            text = text.replace(value, "${" + name + "}")
    return text


def write_text(path, text):
    """The one place the run writes a file: redacted, then scanned; a password or passphrase still present means the file
    is not written and the run fails (fail closed)."""
    text = redact_secrets(redact.redact_captured(text))
    leaked = [n for v, n in SECRETS.items() if n != "SSH_OTP" and v in text]
    if leaked:
        raise SecretLeak(f"refusing to write {os.path.basename(path)}: {', '.join(sorted(set(leaked)))} still in it")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def write_json(path, obj):
    """Writes obj through write_text and returns it as written (redacted), so what a caller keeps is clean too."""
    text = json.dumps(redact.redact_obj(obj), indent=1, ensure_ascii=False)
    write_text(path, text)
    return json.loads(redact_secrets(redact.redact_captured(text)))


def type_secret(run, sess, name):
    """A `type` step whose whole value is ${SSH_PASSWORD}, ${SSH_PASSPHRASE} or ${SSH_OTP}: the value comes from the run's
    private map (the code computed now, with time to spare), is registered for redaction first, then typed."""
    if name not in run.secrets:
        return {"ok": False, "error": f"${{{name}}}: this run's target has no such secret"}
    if run.remote:   # a per-case target runs on this machine only; a secret never takes a remote host's path
        return {"ok": False, "error": f"${{{name}}}: typed only on this machine's lab"}
    value = provision.otp_now(run.ssh_run, run.ssh_variant.split("+")[0]) if name == "SSH_OTP" else run.secrets[name]
    SECRETS[value] = name
    return sess.act("type", "--stdin", stdin=value)   # never in a command line (athena on #210)


def lab_args(verb, arg):
    if verb == "button" and arg == {"dialog_close": True}:   # athena on #227 item 1
        return ["button", "--dialog-close"]
    if verb in SINGLE:
        return [verb, str(arg)]
    if verb == "remote":
        return ["remote"]
    if verb == "open":
        return ["open", arg]
    if verb == "goto":
        return ["goto", f"{arg['line']}:{arg['col']}"] + (["--file", arg["file"]] if arg.get("file") else [])
    if verb in ("rowmenu", "hover"):
        return [verb, arg["view"], arg["row"]]
    if verb == "rowaction":
        return ["rowaction", arg["view"], arg["row"], arg["action"]]
    if verb == "viewaction":
        return ["viewaction", arg["view"], arg["action"]]
    raise ValueError(verb)


def pick_by_open_order(windows, nth):
    """The one window of `windows` at `nth` (first, last or the k-th, from 1) in the order they opened, by the lab's
    `opened` id; [] when there is none, or when a window has no id (its order is unknown). The pick records its rank, not
    the id, so two runs compare."""
    if not windows or any(w.get("opened") is None for w in windows):
        return []
    ranked = sorted(windows, key=lambda w: w["opened"])
    k = 0 if nth == "first" else len(ranked) - 1 if nth == "last" else int(nth) - 1
    if not 0 <= k < len(ranked):
        return []
    return [dict(ranked[k], opened_rank=k + 1)]


RECORDING_LOCK = "recording.lock"   # under the room's pipeline/ (athena on kit #247)


def recording_lock_path():
    return os.path.join(caselib.ROOT, "pipeline", RECORDING_LOCK)


@contextlib.contextmanager
def recording_lock():
    """athena on kit #247: every case run holds the room's recording lock shared (flock LOCK_SH), so the kit follower,
    which takes it exclusive for a whole kit move (its suites, the move and any rollback), never moves the room under a
    run and no run starts during a move. A run waits while a move holds it."""
    path = recording_lock_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_SH)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


@contextlib.contextmanager
def case_runs():
    """All runs of one case under one hold of the recording lock (the dirty side, 2026-10-14: a confirm's two runs, each
    holding the lock alone, let a follower move land between them, leaving the pair on two kit commits). run_once inside
    takes its own shared hold too, which a shared hold of the same process never blocks."""
    with recording_lock():
        yield


def run_once(case, profile, slot, host, run_id, log=print, out_dir=None, counterparts=False):
    """One run of a case, under the room's recording lock (shared)."""
    with recording_lock():
        return _run_once(case, profile, slot, host, run_id, log=log, out_dir=out_dir, counterparts=counterparts)


def _run_once(case, profile, slot, host, run_id, log=print, out_dir=None, counterparts=False):
    """One provisioned run of a case. Returns the transcript, also written to <recordings>/<case-id>/ (or out_dir)."""
    t0 = time.time()
    run = provision.Run(case, profile, slot, host, run_id, log=log, counterparts=counterparts)
    tr = {"case": case["id"], "run_id": run_id, "host": host, "slot": slot, "profile": case["profile"],
          "started": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "steps": [],
          "observations": {}, "normalized": {}, "binds": {}, "failure": None}
    sess = None
    try:
        run.provision()
        known = [c["name"] for c in (case.get("fixture") or {}).get("containers") or []] + run.known_names
        sess = driver.Session(slot, host, run.ph, docker=run.docker, known_names=known, log=log, run_target=run.run_target())
        sess.user_settings = lambda keys: run.read_user_settings(keys)
        sess.mark_urls()   # opened_urls counts from here: this case's URLs only
        run.start_window()
        run.ready(sess)
        uses_seen = "notification_seen" in json.dumps(case["steps"])
        for i, step in enumerate(case["steps"]):
            (verb, arg), = step.items()
            if uses_seen:
                sess.begin_step(i)
            s0 = time.time()
            rec = {"i": i, "step": step}
            missing = caselib.unbound(caselib.subst(arg, run.ph))
            if missing:
                res = {"ok": False, "error": f"unbound {missing}: no earlier observe bound them"}
            elif verb == "wait":
                res = sess.wait(arg["until"], arg["timeout"])
            elif verb == "observe":
                obs = sess.observe(arg["what"])
                tr["observations"][arg["id"]] = obs
                res = {"ok": True, "observed": arg["id"]}
                bad = caselib.lab_error_in(obs)
                if bad:   # the driver failed to read the screen: a failed step, never an expectation
                    res = {"ok": False, "error": f"observation {arg['id']} holds a lab driver error: {bad}"}
                for name, spec in (arg.get("bind") or {}).items():
                    # a per-run value for later steps (${bind.<name>}); read from the RAW observation
                    path, rx = (spec, None) if isinstance(spec, str) else (spec["path"], spec.get("match"))
                    try:
                        val = caselib.resolve_path(obs, path)
                        if isinstance(val, (dict, list)) or val is None:
                            raise KeyError(f"{path}: not a single value")
                        val = str(val)
                        if rx:
                            m = re.search(rx, val)
                            if not m:
                                raise KeyError(f"{path}: {rx!r} does not match {val!r}")
                            val = m.group(1) if m.groups() else m.group(0)
                    except KeyError as e:
                        res = {"ok": False, "error": f"bind {name}: {e}"}
                        break
                    run.ph[f"bind.{name}"] = val
                    tr["binds"][name] = val
                    res.setdefault("bound", {})[name] = val
            elif verb == "engine":
                try:
                    res = run.engine_action(arg)
                except provision.ProvisionError as e:
                    res = {"ok": False, "error": str(e)}
            elif verb == "settings":
                res = run.merge_settings(arg)
            elif verb == "target":
                res = run.target_action(arg)
            elif verb == "restart":
                try:
                    res = run.restart(sess)
                except provision.ProvisionError as e:
                    res = {"ok": False, "error": str(e)}
            elif verb == "window" and isinstance(arg, dict) and "close" in arg:
                res = close_window(sess, caselib.subst(str(arg["close"]), run.ph), float(arg["timeout"]))
            elif verb == "window":
                # `window: <title or #n>` (#n: the lab's window index, from 0) looks once; `window: {title, timeout, count?}` waits (bounded) until a window
                # matches and, with count, until that many (non-auxiliary) windows exist
                spec = arg if isinstance(arg, dict) else {"title": arg}
                want = caselib.subst(str(spec.get("title", "")), run.ph)
                nth = spec.get("nth")   # athena on #227 items 6 and 8: by the order windows opened (`opened`)
                deadline, polls = time.time() + float(spec.get("timeout") or 0), 0
                while True:
                    polls += 1
                    ws = sess.lab("windows", timeout=60)
                    hit = [w for w in ws.get("windows", []) if (want.startswith("#") and f"#{w['index']}" == want) or want in w["title"]]
                    if nth is not None:
                        hit = pick_by_open_order([w for w in hit if not w.get("auxiliary")], nth)
                    count_ok = spec.get("count") is None or \
                        len([w for w in ws.get("windows", []) if not w.get("auxiliary")]) == int(spec["count"])
                    if (hit and count_ok) or time.time() >= deadline:
                        break
                    time.sleep(1)
                res = {"ok": bool(hit) and count_ok, "windows": ws.get("windows")}
                if isinstance(arg, dict):
                    res["polls"] = polls
                if res["ok"]:
                    sess.window = f"#{hit[0]['index']}" if nth is not None else want
                    if nth is not None:
                        res["picked"] = {"nth": nth, "opened_rank": hit[0]["opened_rank"]}
                else:
                    res["error"] = f"no window matches {want!r}" + (f" at nth {nth!r}" if nth is not None else "") + \
                        ("" if count_ok else f" with {spec['count']} window(s) open")
            elif verb == "cmd":
                # the palette lists a contributed command only once the window has registered its extensions, which
                # can lag the window showing its folder: wait (bounded) for the command to appear, never longer
                deadline, attempts = time.time() + CMD_WAIT, 0
                while True:
                    attempts += 1
                    res = sess.act("cmd", caselib.subst(str(arg), run.ph))
                    if res.get("ok") or not str(res.get("error", "")).startswith("COMMAND NOT FOUND") or time.time() > deadline:
                        break
                    time.sleep(2)
                res["attempts"] = attempts
            elif verb == "type" and isinstance(arg, str) and SECRET_PH.fullmatch(arg):
                res = type_secret(run, sess, SECRET_PH.fullmatch(arg).group(1))
            else:
                res = sess.act(*lab_args(verb, caselib.subst(arg, run.ph)))
            rec.update(seconds=round(time.time() - s0, 1), ok=bool(res.get("ok")), error=res.get("error"), output=res)
            tr["steps"].append(rec)
            log(f"  [{run_id}] step {i} {verb}: {'ok' if rec['ok'] else 'FAILED ' + str(rec['error'])[:160]}")
            if not rec["ok"]:
                raise StepFailure(i, step, rec["error"])
    except StepFailure as f:
        tr["failure"] = {"step": f.index, "verb": next(iter(f.step)), "error": str(f.error)[:600],
                         "observation": sess.full_observation() if sess else None}
    except Exception as e:  # provisioning or tool failure: also a failed run, with whatever can still be seen
        tr["failure"] = {"step": None, "error": f"{type(e).__name__}: {e}"[:800], "trace": traceback.format_exc()[-2000:],
                         "observation": sess.full_observation() if sess else None}
    finally:
        if sess and hasattr(sess, "stop_keeper"):   # athena on kit #241 (A): the keeper ends with the window
            sess.stop_keeper()
        try:
            meta = run.versions()
        except Exception:
            meta = {}
        tr["teardown"] = run.teardown()
    norm_ctx = dict(run.ph)
    tr["normalized"] = {k: normalize.normalize(v, norm_ctx) for k, v in tr["observations"].items()}
    tr["normalization"] = normalize.rules_used(norm_ctx)
    tr["normalization"]["dropped"] = normalize.dropped_noise(tr["observations"], case=norm_ctx.get("CASE"))   # R-106
    tr["provision"] = run.info
    tr["placeholders"] = run.ph
    tr.update(meta)
    tr["engine"] = run.info.get("engine")
    tr["finished"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    tr["seconds"] = round(time.time() - t0, 1)
    path = f"{out_dir or caselib.RECORDINGS + '/' + case['id']}/{run_id}.json"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:   # R-34 and #209's secrets, at the one sink; the caller gets the transcript as written (a replay's result, a
        tr = write_json(path, tr)   # confirm's observations are built from it after the secrets are forgotten)
    finally:
        SECRETS.clear()
    tr["_path"] = os.path.relpath(path, caselib.ROOT)
    return tr


def new_run_id(host, slot, k):
    return datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{host}-s{slot}-r{k}"


def platform_refusal(case, profile, host, allow_platform_change=False, purpose="record"):
    """Why `case` may not be recorded (or confirmed) on `host`, or None. A case is recorded for one platform: the host's
    must be in the profile's `arch`; a case recorded (or flaky) on one platform is not re-recorded on another unless
    asked (allow_platform_change); on the recording side, an architecture-sensitive case only on its platforms
    (archlib, tests/arch.yaml) and only on a host that provides what it needs (hosts.yaml)."""
    plat = caselib.host_platform(host)
    if not caselib.host_remote(host) and plat != caselib.local_platform():
        # 2026-10-14: the recording host became x86_64 while hosts.yaml still said linux/arm64 for this machine; every
        # check below and recorded.confirmed would name the wrong platform (an arm64-only case would pass on x86_64)
        return (f"hosts.yaml gives {host} the platform {plat}, but this machine is {caselib.local_platform()}: "
                f"correct the host's platform in hosts.yaml before recording or confirming here")
    if caselib.PROFILE_ARCH.get(plat) not in (profile.get("arch") or []):
        return f"profile {case['profile']} lists arch {profile.get('arch')}, not {caselib.PROFILE_ARCH.get(plat, plat)} ({host})"
    rec = case.get("recorded") or {}
    if purpose == "record" and case.get("status") in ("recorded", "flaky") and rec.get("platform") not in (None, plat) \
            and not allow_platform_change:
        return (f"recorded on {rec.get('platform')}; a recording on {host} ({plat}) would replace that expect "
                f"(record.py --allow-platform-change, or --confirm to add {plat})")
    return None


def record_case(path, runs, host, slot, log=print, allow_platform_change=False):
    case = caselib.load_yaml(path)
    errs = schema.validate_case(path, case, for_recording=True)
    if errs:
        log(f"{path}: not recorded, schema errors:\n  " + "\n  ".join(errs))
        return "invalid"
    profile = caselib.load_profile(case["profile"])
    if host not in (profile.get("hosts") or []):
        log(f"{case['id']}: profile {case['profile']} is not available on {host}")
        return "not-applicable"
    why = caselib.provisionable(profile, host)
    if why:
        log(f"{case['id']}: not-applicable: {why}")
        return "not-applicable"
    why = platform_refusal(case, profile, host, allow_platform_change)
    if why:
        log(f"{case['id']}: not-applicable on {host}: {why}")
        return "not-applicable"
    log(f"{case['id']}: recording {runs} run(s) on {host} slot {slot}")
    trs = []
    with case_runs():   # every run of the case on one kit commit
        for k in range(1, runs + 1):
            tr = run_once(case, profile, slot, host, new_run_id(host, slot, k), log=log)
            trs.append(tr)
            if tr["failure"]:
                break
    recorded = {
        "reference_version": trs[0].get("reference_version"), "vscode_version": trs[0].get("vscode_version"),
        "platform": trs[0].get("platform"), "host": host, "engine": trs[0].get("engine"), "profile": case["profile"],
        "date": datetime.date.today().isoformat(),
        "fixtures": dict(case.get("fixtures") or {}),
        "case_sha256": caselib.writer_digest(case),
        "mirror": next((f"{e['name']}@{e['sha256'][:12]}" for e in [fixture.mirror_for(trs[0].get("platform"))] if e), None),
        "runs": [{"run_id": t["run_id"], "transcript": t["_path"], "seconds": t["seconds"],
                  "provision_seconds": t["provision"].get("provision_seconds"),
                  "result": "failed" if t["failure"] else "ok"} for t in trs],
        "normalization": {"version": normalize.NORM_VERSION, "rules": [r["rule"] for r in trs[0]["normalization"]["rules"]]},
    }
    failed = next((t for t in trs if t["failure"]), None)
    if failed:
        fobs = normalize.normalize(failed["failure"].get("observation"), failed["placeholders"])
        blocks = {"status": "failed", "recorded": recorded,
                  "failure": {"run_id": failed["run_id"], "step": failed["failure"].get("step"),
                              "verb": failed["failure"].get("verb"), "error": failed["failure"]["error"],
                              "observation": fobs}}
        status = "failed"
    else:
        first = trs[0]["normalized"]
        diffs = {t["run_id"]: [d for oid in set(first) | set(t["normalized"])
                               for d in normalize.diff(first.get(oid), t["normalized"].get(oid), "/" + oid)]
                 for t in trs[1:]}
        if len(trs) < 2:
            blocks = {"status": "unconfirmed", "recorded": recorded, "observations": {trs[0]["run_id"]: first}}
            status = "unconfirmed"
        elif any(diffs.values()):
            blocks = {"status": "flaky", "flaky": True, "recorded": recorded,
                      "observations": {t["run_id"]: t["normalized"] for t in trs}}
            status = "flaky"
            for rid, d in diffs.items():
                log(f"  {case['id']}: run {rid} differs:\n    " + "\n    ".join(d[:20]))
        else:
            blocks = {"status": "recorded", "recorded": recorded, "expect": first}
            status = "recorded"
    caselib.write_recorder_blocks(path, blocks)
    log(f"{case['id']}: {status}")
    return status


def close_window(sess, want, timeout):
    """`window: {close: <title or #n>, timeout}` (athena's ruling; #n is the `index` that `lab windows` reports, counted
    from 0, so the first window is #0, dirty-side on F-2502-AC22): closes one window of the run's own slot through the
    editor core's Close Window command run in that window (an exact palette title: an extension's command shows its
    category), waits (bounded) until it is gone, and fails otherwise. The last non-auxiliary window is never closed (it
    would end the editor). Afterwards no window is selected; R-63's after-verb check runs on every lab call as before."""
    def windows():
        return [w for w in sess.lab("windows", timeout=60).get("windows", []) if not w.get("auxiliary")]
    def matches(w):
        return (want.startswith("#") and f"#{w['index']}" == want) or (not want.startswith("#") and want in w["title"])
    before = windows()
    hit = [w for w in before if matches(w)]
    if len(hit) != 1:
        return {"ok": False, "error": f"window: close needs exactly one window matching {want!r}, found {len(hit)}",
                "windows": before}
    if len(before) < 2:
        return {"ok": False, "error": "window: close refuses the last window (it would end the editor)", "windows": before}
    title = hit[0]["title"]
    sess.window, sess.exact = f"#{hit[0]['index']}", True
    try:
        ran = sess.lab("cmd", "Close Window", timeout=60)
    finally:
        sess.window, sess.exact = None, False
    err = f"{ran.get('error') or ''} {ran.get('errorDetail') or ''}"
    # Close Window ends the page it ran in, so `lab` can lose that page before it answers ("Target page, context or
    # browser has been closed"): the command ran, and the wait below decides (dirty-side, F-2502-AC22-1/-2, 2026-10-12).
    # Any other failure fails at once, not after the bound (triton on #205).
    page_gone = not ran.get("ok") and any(n in err for n in driver.NAVIGATION_ERRORS)
    if not ran.get("ok") and not page_gone:
        return {"ok": False, "error": f"Close Window did not run in {title!r}: {ran.get('error')}", "windows": before}
    titles = lambda ws: [w["title"] for w in ws]
    deadline, polls = time.time() + timeout, 0
    while True:
        polls += 1
        now = windows()
        # by count, not presence: another window may carry the same title (triton on #205: close '#1' of two 'same')
        gone = len(now) == len(before) - 1 and titles(now).count(title) == titles(before).count(title) - 1
        if gone or time.time() >= deadline:
            break
        time.sleep(1)
    res = {"ok": gone, "closed": title, "polls": polls, "windows": now, "command": {k: ran.get(k) for k in ("ok", "error")}}
    if page_gone:
        res["lostPage"] = True
    if not gone:
        res["error"] = f"window {title!r} still open after {timeout:g}s"
    return res


def norm_version_refusal(case):
    """Why a case cannot be compared by this normalizer, or None (athena, 2026-10-12: the monorepo runner at v8 compared
    cases recorded under v9-v12 and failed them silently on rule differences that look like the product's). A case
    recorded under a NEWER normalization version than this code's is not-comparable: named, counted, never a pass or a
    fail. An equal or older version (or none, before versions were recorded) compares as before, except an expect that
    holds a placeholder a later version renamed (normalize.RENAMING_VERSIONS, athena on kit #236): not-comparable,
    "re-record"."""
    rec = case.get("recorded") or {}
    norm = rec.get("normalization") if isinstance(rec, dict) else None
    if norm is None:   # recorded before versions were: older than any renaming version
        return _renamed(case, 0)
    if not isinstance(norm, dict):   # themis on #193: a non-mapping raised a TypeError; named instead
        return f"recorded normalization {type(norm).__name__} is not a mapping: not comparable"
    if "version" not in norm:
        return _renamed(case, 0)
    v = norm["version"]
    if not isinstance(v, int) or isinstance(v, bool) or v < 1:   # athena on #193: a hand-edited "9" fails closed
        return f"recorded normalization version {v!r} is not a whole number: not comparable"
    if v > normalize.NORM_VERSION:
        return (f"recorded under normalization v{v}, newer than this runner's v{normalize.NORM_VERSION}: sync the runner "
                "before comparing")
    return _renamed(case, v)


def _renamed(case, v):
    """athena on kit #236: an expect holding a placeholder a later version renamed is not-comparable ("re-record")."""
    for at, why in normalize.renamed_tokens(case, v):
        return (f"recorded under normalization {f'v{v}' if v else 'without a version'}, before v{at} renamed "
                f"{normalize.RENAMING_VERSIONS[at]}: {why}; re-record")
    return None


def replay_case(path, host, slot, result_path, log=print):
    """One run compared to the recorded expectation (suite.py)."""
    case = caselib.load_yaml(path)
    res = {"case": case.get("id"), "file": os.path.relpath(path, caselib.ROOT), "profile": case.get("profile"), "host": host}
    t0 = time.time()
    profile = None
    try:
        profile = caselib.load_profile(case["profile"])
    except ValueError as e:
        res.update(result="not-applicable", reason=str(e))
    topo_error = caselib.provisionable(profile, host) if profile else None
    plat = caselib.host_platform(host)
    res["platform"] = plat
    if profile and host not in (profile.get("hosts") or []):
        res.update(result="not-applicable", reason=f"profile not available on {host}")
    elif topo_error:
        res.update(result="not-applicable", reason=topo_error)
    elif profile and case.get("status") != "recorded" and not case.get("flaky"):
        res.update(result="not-applicable", reason=f"case not recorded (status {case.get('status')})")
    elif norm_version_refusal(case):
        res.update(result="not-comparable", reason=norm_version_refusal(case))
    elif profile and plat not in caselib.case_platforms(case):
        # a case counts only where it was recorded or confirmed: never silently on another platform
        res.update(result="not-applicable", reason=f"recorded for {', '.join(caselib.case_platforms(case)) or 'no platform'}, "
                                                   f"not {plat}")
    elif profile:
        tr = run_once(case, profile, slot, host, new_run_id(host, slot, "p"), log=log,
                      out_dir=f"{os.path.dirname(os.path.abspath(result_path))}/transcripts",
                      counterparts=plat != (case.get("recorded") or {}).get("platform"))
        res["transcript"] = tr["_path"]
        res["observation"] = tr["normalized"]
        if tr["failure"]:
            res.update(result="fail", reason="step failed: " + str(tr["failure"].get("error"))[:300])
        else:
            mism = [d for oid in set(case.get("expect") or {}) | set(tr["normalized"])
                    for d in normalize.diff((case.get("expect") or {}).get(oid), tr["normalized"].get(oid), "/" + oid)]
            if case.get("flaky"):
                res.update(result="flaky", mismatches=mism)
            else:
                res.update(result="pass" if not mism else "fail", mismatches=mism)
    res["seconds"] = round(time.time() - t0, 1)
    os.makedirs(os.path.dirname(result_path), exist_ok=True)
    write_json(result_path, res)
    log(f"{res['case']}: {res['result']}" + (f" ({res.get('reason')})" if res.get("reason") else ""))
    return res["result"]


def confirm_case(path, runs, host, slot, log=print):
    """Confirm a recorded case on another platform: `runs` runs on `host`, each compared to the recorded expect. When all
    match, recorded.confirmed gets {platform, host, date, fixtures, runs, normalization} and the case counts for that
    platform too; otherwise nothing changes. The expect itself is never touched, and an architecture-sensitive case is
    never confirmed. Returns confirmed | mismatch | failed | not-applicable | not-comparable."""
    case = caselib.load_yaml(path)
    profile = caselib.load_profile(case["profile"])
    plat = caselib.host_platform(host)
    if case.get("status") != "recorded" or not case.get("expect"):
        log(f"{case['id']}: only a recorded case can be confirmed (status {case.get('status')})")
        return "not-applicable"
    if plat in caselib.case_platforms(case):
        log(f"{case['id']}: already valid for {plat}")
        return "confirmed"
    if host not in (profile.get("hosts") or []):
        log(f"{case['id']}: profile {case['profile']} is not available on {host}")
        return "not-applicable"
    why = caselib.provisionable(profile, host) or platform_refusal(case, profile, host, purpose="confirm")
    if why:
        log(f"{case['id']}: not confirmed on {host}: {why}")
        return "not-applicable"
    if schema.validate_case(path, case):
        log(f"{case['id']}: not confirmed: the case does not validate (re-record it first)")
        return "not-applicable"
    if norm_version_refusal(case):
        log(f"{case['id']}: not confirmed: {norm_version_refusal(case)}")
        return "not-comparable"
    trs, mism = [], []
    with case_runs():   # the pair of a confirm on one kit commit
        for k in range(1, runs + 1):
            tr = run_once(case, profile, slot, host, new_run_id(host, slot, f"c{k}"), log=log, counterparts=True)
            trs.append(tr)
            if tr["failure"]:
                log(f"{case['id']}: confirmation run {tr['run_id']} failed: {str(tr['failure'].get('error'))[:300]}")
                return "failed"
            d = [x for oid in set(case["expect"]) | set(tr["normalized"])
                 for x in normalize.diff(case["expect"].get(oid), tr["normalized"].get(oid), "/" + oid)]
            if d:
                mism.append((tr["run_id"], d))
    if mism:
        for rid, d in mism:
            log(f"  {case['id']}: run {rid} differs from the expect recorded on {case['recorded'].get('platform')}:\n    "
                + "\n    ".join(d[:20]))
        return "mismatch"
    rec = dict(case["recorded"])
    rec["confirmed"] = list(rec.get("confirmed") or []) + [{
        "platform": plat, "host": host, "date": datetime.date.today().isoformat(),
        "fixtures": trs[0]["provision"].get("fixtures"), "vscode_version": trs[0].get("vscode_version"),
        "engine": trs[0].get("engine"),
        "runs": [{"run_id": t["run_id"], "transcript": t["_path"], "seconds": t["seconds"], "result": "ok"} for t in trs],
        "normalization": {"version": normalize.NORM_VERSION}}]
    caselib.write_recorder_blocks(path, {"status": case["status"], "recorded": rec, "expect": case["expect"]})
    log(f"{case['id']}: confirmed for {plat} ({len(trs)} runs on {host})")
    return "confirmed"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cases", nargs="+")
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--host", default="local", choices=sorted(caselib.SLOTS))
    ap.add_argument("--slot", type=int)
    ap.add_argument("--replay", action="store_true")
    ap.add_argument("--result")
    a = ap.parse_args()
    allowed = caselib.allowed_slots(a.host)   # the slots this process may use on that host
    slot = a.slot or allowed[0]
    if slot not in allowed:
        sys.exit(f"record.py: slot {slot} is not a recording slot of this process on {a.host} ({allowed})")
    if a.runs < 2 and not a.replay:
        print("record.py: note: fewer than two runs never produce `expect` (a case needs two agreeing runs)")
    log = lambda m: print(redact_secrets(redact.redact_captured(str(m))), flush=True)  # noqa: E731  (R-34, #209: logs too)
    if a.replay:
        if len(a.cases) != 1 or not a.result:
            sys.exit("record.py --replay takes one case and --result <file>")
        sys.exit(0 if replay_case(os.path.abspath(a.cases[0]), a.host, slot, a.result, log) == "pass" else 1)
    results = [record_case(os.path.abspath(c), a.runs, a.host, slot, log) for c in a.cases]
    sys.exit(0 if all(r == "recorded" for r in results) else 1)


if __name__ == "__main__":
    main()
