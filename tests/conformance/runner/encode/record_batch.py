#!/usr/bin/env python3
"""Record many cases concurrently, one case per slot at a time, never sharing a slot or a private daemon (the daemon
of a run is named after its slot: labdind-encode-s<slot>).

usage: record_batch.py --slots 31-36 [--runs 2] <case.yaml | <suite>/F-XXXX>...
       record_batch.py --host-slots HOST=SLOTS [--host-slots HOST=SLOTS ...] ...   (several recording hosts)

Each worker owns one (host, slot) and runs `record.py --host H --slot N --runs R <case>` for one case after the other;
a case only goes to a worker whose host its profile lists and whose platform the case may be recorded on (the
profile's `arch`; a case recorded or flaky on one platform stays there; in the dirty room also tests/arch.yaml and the
host's capabilities). Both runs of a case run on one host, so one recording never mixes platforms. One log per case and batch:
<recordings>/<case-id>/batch-<batch-id>.log. Prints a summary; exit 0 when every case was recorded.
"""
import argparse
import datetime
import os
import subprocess
import sys
import threading
import time

import caselib

HERE = os.path.dirname(os.path.abspath(__file__))


def parse_slots(text, host):
    if not text:
        return []
    out = []
    for part in text.split(","):
        a, _, b = part.partition("-")
        out += list(range(int(a), int(b or a) + 1))
    allowed = caselib.allowed_slots(host)   # the slots this process may use on that host
    bad = [s for s in out if s not in allowed]
    if bad:
        sys.exit(f"slots {bad} are not recording slots of this process on {host} (allowed: {allowed})")
    return out


def expand_cases(args):
    paths = []
    for a in args:
        if os.path.isdir(a):
            paths += caselib.case_paths(os.path.basename(os.path.normpath(a)))
        else:
            paths.append(os.path.abspath(a))
    return list(dict.fromkeys(paths))


_HOSTS = {}


def case_hosts(path):
    """The hosts a case may be recorded on: its profile's, minus those whose platform or capabilities the case refuses
    (record.platform_refusal). Cached per batch."""
    if path not in _HOSTS:
        try:
            import record
            case = caselib.load_yaml(path)
            prof = caselib.load_profile(case["profile"])
            _HOSTS[path] = {h for h in prof.get("hosts") or [] if h in caselib.SLOTS
                            and record.platform_refusal(case, prof, h) is None}
        except Exception:
            _HOSTS[path] = set(caselib.SLOTS)  # let record.py report the error
    return _HOSTS[path]


def replay_hosts(path):
    """The hosts a recorded case may be replayed on: its profile's whose platform the case is valid for."""
    if path not in _HOSTS:
        try:
            case = caselib.load_yaml(path)
            prof = caselib.load_profile(case["profile"])
            _HOSTS[path] = {h for h in prof.get("hosts") or [] if h in caselib.SLOTS
                            and caselib.host_platform(h) in caselib.case_platforms(case)}
        except Exception:
            _HOSTS[path] = set(caselib.SLOTS)
    return _HOSTS[path]


def case_locks(path):
    """Engine fixtures with fixed workspace folders this case uses: two such cases never run at the same time (the
    folders are shared by every run of the fixture, and a case may open them)."""
    try:
        import fixture
        case = caselib.load_yaml(path)
        prof = caselib.load_profile(case["profile"])
        out = set()
        for env in prof.get("environments") or []:
            if env.get("kind") == "engine" and env.get("fixture"):
                name, sha12 = fixture.parse_ref((case.get("fixtures") or {}).get(env["id"]))
                e = fixture.find("engine", env["fixture"], sha12 if name else None)
                if e and e.get("contents", {}).get("workspaces"):
                    out.add(env["fixture"])
        return out
    except Exception:
        return set()


def run_pool(paths, workers, argv_for, log_for, on_done=None, hosts_for=None):
    """Run argv_for(path, host, slot) for every path on a pool of (host, slot) workers. Returns {path: (rc, host, slot)}.
    hosts_for(path): the hosts a path may run on (default: case_hosts, the recording rule)."""
    pending, results, lock, active = list(paths), {}, threading.Lock(), {}
    hosts_for = hosts_for or case_hosts

    def worker(host, slot):
        while True:
            with lock:
                mine = [p for p in pending if host in hosts_for(p)]
                if not mine:
                    return
                busy = set().union(*active.values()) if active else set()
                pick = next((p for p in mine if not (case_locks(p) & busy)), None)
                if pick is not None:
                    pending.remove(pick)
                    active[pick] = case_locks(pick)
            if pick is None:
                time.sleep(5)  # every remaining case waits for a fixture-workspace lock
                continue
            t0 = time.time()
            logf = log_for(pick)
            os.makedirs(os.path.dirname(logf), exist_ok=True)
            with open(logf, "w") as lf:
                rc = subprocess.run([sys.executable, *argv_for(pick, host, slot)], stdout=lf, stderr=subprocess.STDOUT).returncode
            with lock:
                results[pick] = (rc, host, slot, round(time.time() - t0))
                active.pop(pick, None)
            if on_done:
                on_done(pick, rc, host, slot, round(time.time() - t0))

    threads = [threading.Thread(target=worker, args=w, daemon=True) for w in workers]
    for i, t in enumerate(threads):
        t.start()
        time.sleep(3 if i < len(threads) - 1 else 0)  # stagger the daemon starts (image seeding is I/O heavy)
    for t in threads:
        t.join()
    for p in pending:
        results[p] = (None, None, None, 0)  # no worker on a host this case may run on
    return results


def parse_host_slots(items):
    """[(host, slot)] from --host-slots HOST=31,32 / HOST=51-52 (each host must be in hosts.yaml)."""
    out = []
    for it in items or []:
        host, _, slots = it.partition("=")
        if host not in caselib.SLOTS:
            sys.exit(f"--host-slots {it}: unknown host {host!r} ({sorted(caselib.SLOTS)})")
        out += [(host, s) for s in parse_slots(slots, host)]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cases", nargs="+")
    ap.add_argument("--slots", default="")
    ap.add_argument("--runs", type=int, default=2)
    a = ap.parse_args()
    workers = [("local", s) for s in parse_slots(a.slots, "local")]
    if not workers:
        sys.exit("give --slots")
    paths = expand_cases(a.cases)
    batch = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

    def case_id(p):
        return os.path.basename(p)[:-5]

    def done(p, rc, host, slot, secs):
        st = (caselib.load_yaml(p) or {}).get("status", "?")
        print(f"  {case_id(p)}: {st} ({host} slot {slot}, {secs}s)", flush=True)

    print(f"batch {batch}: {len(paths)} case(s) on {len(workers)} worker(s): " + ", ".join(f"{h}:{s}" for h, s in workers), flush=True)
    res = run_pool(paths, workers,
                   lambda p, h, s: [f"{HERE}/record.py", "--host", h, "--slot", str(s), "--runs", str(a.runs), p],
                   lambda p: f"{caselib.RECORDINGS}/{case_id(p)}/batch-{batch}.log", done)
    print("summary:")
    ok = True
    for p in paths:
        rc, host, slot, secs = res[p]
        st = (caselib.load_yaml(p) or {}).get("status", "not run") if rc is not None else "not run (no worker on a host of its profile)"
        ok = ok and st == "recorded"
        print(f"  {case_id(p):24} {st:12} " + (f"{host} slot {slot} {secs}s  log {os.path.relpath(f'{caselib.RECORDINGS}/{case_id(p)}/batch-{batch}.log', caselib.ROOT)}" if rc is not None else ""))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
