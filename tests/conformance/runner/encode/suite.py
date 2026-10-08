#!/usr/bin/env python3
"""Replay recorded cases and compare them to their recorded expectation.

usage: suite.py run --feature F-0601 [--feature ...] [--profile linux-ce-clean[@1]] [--case <id>] [--slots 31-36]

Each selected case runs once in its profile (same provisioning as record.py) and gets one JSON result,
<results>/<suite-run-id>/<case-id>.json:
  pass            every observation equals `expect` after normalization
  fail            a step failed or an observation differs (the mismatches and the full observation are in the result)
  flaky           the case is marked flaky (its two recordings disagreed); it still runs, mismatches are reported
  not-applicable  the case's profile is not available on any host given (or the case has no recording yet)
plus summary.json (counts, per-case result, timing). Exit 0 when every applicable case passed.
"""
import argparse
import datetime
import json
import os
import sys

import caselib
import record_batch
import redact

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--feature", action="append", required=True)
    r.add_argument("--profile")
    r.add_argument("--case", action="append", help="only these case ids (repeatable)")
    r.add_argument("--slots", default=os.environ.get("ENCODE_SLOTS") or "31-32")
    a = ap.parse_args()
    workers = [("local", s) for s in record_batch.parse_slots(a.slots, "local")]
    hosts = {h for h, _ in workers}
    run_id = datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + "-suite"
    out_dir = f"{caselib.RESULTS}/{run_id}"
    os.makedirs(out_dir, exist_ok=True)

    selected, results = [], {}
    for feat in a.feature:
        for p in caselib.case_paths(feat):
            case = caselib.load_yaml(p) or {}
            if a.profile and not (case.get("profile") == a.profile or str(case.get("profile", "")).split("@")[0] == a.profile):
                continue
            if a.case and (case.get("id") or os.path.basename(p)[:-5]) not in a.case:
                continue
            cid = case.get("id") or os.path.basename(p)[:-5]
            reason = None
            try:
                prof_hosts = set(caselib.load_profile(case.get("profile")).get("hosts") or [])
                if not prof_hosts & hosts:
                    reason = f"profile {case.get('profile')} is not available on {sorted(hosts)}"
            except ValueError as e:
                reason = str(e)
            if not reason and case.get("status") not in ("recorded", "flaky"):
                reason = f"no recording to compare with (status {case.get('status') or 'none'})"
            # a case counts only on the platforms it was recorded (or confirmed) for: never silently on another one
            plats = {caselib.host_platform(h) for h in hosts & prof_hosts} if not reason else set()
            if not reason and not plats & set(caselib.case_platforms(case)):
                reason = (f"recorded for {', '.join(caselib.case_platforms(case)) or 'no platform'}; the hosts given are "
                          f"{', '.join(sorted(plats))}")
            if reason:
                results[cid] = {"case": cid, "file": os.path.relpath(p, caselib.ROOT), "profile": case.get("profile"),
                                "result": "not-applicable", "reason": reason}
                with open(f"{out_dir}/{cid}.json", "w") as f:
                    json.dump(results[cid], f, indent=1)
            else:
                selected.append(p)

    print(f"suite {run_id}: {len(selected)} case(s) to run, {len(results)} not applicable", flush=True)
    record_batch.run_pool(
        selected, workers,
        lambda p, h, s: [f"{HERE}/record.py", "--replay", "--host", h, "--slot", str(s), "--result",
                         f"{out_dir}/{os.path.basename(p)[:-5]}.json", p],
        lambda p: f"{out_dir}/{os.path.basename(p)[:-5]}.log",
        lambda p, rc, h, s, secs: print(f"  {os.path.basename(p)[:-5]}: done ({h} slot {s}, {secs}s)", flush=True),
        hosts_for=record_batch.replay_hosts)
    for p in selected:
        cid = os.path.basename(p)[:-5]
        try:
            with open(f"{out_dir}/{cid}.json") as f:
                results[cid] = json.load(f)
        except (OSError, json.JSONDecodeError):
            results[cid] = {"case": cid, "result": "fail", "reason": f"no result written (see {out_dir}/{cid}.log)"}

    counts = {}
    for res in results.values():
        counts[res["result"]] = counts.get(res["result"], 0) + 1
    summary = {"suite_run": run_id, "features": a.feature, "profile": a.profile, "hosts": sorted(hosts),
               "platforms": sorted({caselib.host_platform(h) for h in hosts}),
               "counts": counts, "cases": {cid: {k: res.get(k) for k in ("result", "reason", "seconds", "transcript", "platform")}
                                           for cid, res in sorted(results.items())}}
    with open(f"{out_dir}/summary.json", "w") as f:
        json.dump(redact.redact_obj(summary), f, indent=1)
    print("summary: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) + f"  ({os.path.relpath(out_dir, caselib.ROOT)}/summary.json)")
    for cid, res in sorted(results.items()):
        print(f"  {cid:24} {res['result']:15} {res.get('reason') or ''}")
        for m in (res.get("mismatches") or [])[:10]:
            print(f"      {m}")
    applicable = [r for r in results.values() if r["result"] != "not-applicable"]
    sys.exit(0 if applicable and all(r["result"] == "pass" for r in applicable) else 1)


if __name__ == "__main__":
    main()
