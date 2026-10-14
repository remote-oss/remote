# Task card coverage-29: the progress rows of F-2304 that no recorded case covers

Issue: #712. Why: the 0.2 gate's acceptance rows. F-2304 (`remote-oss/remote-ssh#37`) is the connect's progress
notification. The D-65 recorded cases cover most of its open ACs, so they need no card. Three stay for us:
- AC-5, the download stage;
- AC-8, a progress that ends while the remote side is still starting;
- AC-20, a dismissed platform pick during core's reconnection attempts.

AC-23 and AC-32 need a trust-enabled launch (§5).

Builder: iris or hestia. Size: S–M, about 1 agent-day. **Depends on coverage-14 (#568)** for `userSettings`. If
coverage-14 hasn't merged, add `userSettings` to `windows/harness.ts` as coverage-14 §1 says, and tell iris on #568.

## 1. A record line for the end of a progress

**What's missing:** the record has a `progress` line for the title and for each phase, but none when the progress
ends (`progressFor` in `packages/remote-ssh/src/surfaces/scripted-adapters.ts`: "Nothing is appended when the progress
ends"). AC-8 is about that end.

**The change:**
- `progressFor`'s `withProgress` appends one more line when the task's promise settles, fulfilled or rejected:
  `{surface: 'progressEnd', question: <the request's title>, answer: 'ended', matched: true, window, time}`. The
  promise the port returns is the task's, unchanged; a rejection still rejects.
- `RecordLine['surface']` gains `'progressEnd'` in `scripted-adapters.ts`, in `tests/acceptance/suite-local/script.ts`
  and in `tests/acceptance/windows/harness.ts` (whose `surface` is a `string`, so only its comment names it).
- `progressEnd` is display-only. It isn't in `SCRIPT_SURFACES`, so it never moves a window's cursor.
- `suite-failure/failure-window.test.ts` filters display lines out before it compares the record with the script. Add
  `'progressEnd'` to that list (`['progress', 'downloadProgress', 'progressEnd']`).
- Search `tests/acceptance` for any other row that compares every record line, and treat it the same way. List the
  rows you changed in the PR.

**Unit rows** (`scripted-adapters.test.ts`):
- a task that fulfils: the last line is the `progressEnd` line with the title, after the phase lines;
- a task that rejects: the same line, and the port's promise rejects with the task's error;
- the switch off: no line at all, as today.

## 2. The rows

| Cite | Where | Setup and steps | Assertions |
|---|---|---|---|
| F-2304 AC-5 | `suite-remote/remote-window.test.ts`, beside the AC-11 row (the run's first remote launch connects a host without a server, `useExecServer` at its default `true`) | — | the `progress` line whose question is `Downloading VS Code Server` has `details: false`; no `progress` line's question matches `/\d+\s*%/`; the record has no `downloadProgress` line (the host downloads in this mode, so the client shows no percentage) |
| F-2304 AC-8 | `suite-slow/slow-start.test.ts` (the `slow` launch, whose remote extension host waits 15 s for `slow-remote`) | the `slow` launch gets `ownScript: true` in `tools/acceptance-launches.ts`, so its record holds only its own lines. The run writes no script for it: a missing script is an empty one, as for the client launches | the record has exactly one `progressEnd` line. Its `time` is at least 10 000 ms before `/tmp/acceptance-slow-done`'s mtime × 1000. No `progress` line comes after it |
| F-2304 AC-20 | a new file `tests/acceptance/windows/progress.test.ts`, window `pg1` | `userSettings({'remote.SSH.useLocalServer': false, 'remote.SSH.enableDynamicForwarding': false, 'remote.SSH.useExecServer': false})`, with no `remote.SSH.remotePlatform` entry for `noforward`. Script for `pg1`, in order: `platformPick` `"noforward"` → `linux`; `platformPick` → `dismiss`; `platformPick` → `linux` with `after: 'never'`. Open `pg1` on `noforward` (TCP forwarding refused) | at least two `progress` lines of `pg1` whose question is `Setting up SSH Host noforward`, so core retried after the first resolve. After the `dismiss` line, within 10 s: no `failureDialog` line of `pg1`. Within 5 s of the `dismiss` line, a new `Setting up SSH Host noforward` line, and after it a new `platformPick` line (the held one) |

**After AC-20:** close `pg1`, then put the three settings back to the run's base (remove the keys).

**The slow launch's time:** the host and the client share the machine's clock. The mtime has whole seconds, which the
10 s margin absorbs: the slow extension takes 15 s.

**Measure first:**
- AC-5: the download phase's exact question, in the record of a run.
- AC-20: what the first resolve returns, and that core starts a second resolve on its own within 60 s of it. In
  F-2304 6.9's setup the first resolve returns (the connect succeeds), and core reconnects when the forward is refused,
  so the dismissed pick happens in a reconnection, which is retryable (athena, 2026-10-14). Record the gap in the PR.
  If no second attempt comes, or a `failureDialog` line of `pg1` appears (after the first resolve or after the
  dismissed pick), stop (§6).

## 3. The catalogue

In `docs/architecture/catalogue/coverage-slice1.tsv`, F-2304 AC-5, AC-8 and AC-20 go from `todo` to `acceptance`.

**Core halves** (list them in #142's tracking comment):
- AC-5: how core renders the message, and the "slow link" that makes the stage visible long enough to see. The record
  proves the message and its flag whatever the link's speed;
- AC-8: core's "Opening Remote..." indicator;
- AC-20: core's reconnection loop itself.

## 4. Done when

The repository's gates pass, `scripted-adapters.ts` stays at 100 %, and `pnpm test:acceptance:vscodium` passes with the
new rows. Paste the `remote`, `slow` and `windows` summaries.

## 5. Review

PR title `tests: the progress rows of F-2304 that no recorded case covers (card coverage-29, #712)`. themis or triton
reviews; athena gives the tag check.

## 6. Open rows (stop and report on #712)

1. **F-2304 AC-23 and AC-32** stay `todo`: terminal mode in an untrusted folder, with core's trust dialog left open,
   needs a trust-enabled launch (#456, harness item H1). List them in #142 with that wait.
2. **No second resolve, or a failure dialog,** in AC-20's setup: report what the record and the log show after the
   first resolve. A dialog there is a product gap (the dismissed pick in a reconnection must be retried, not shown):
   report it on #712 as one, and don't change the row.
3. **The download stage** of the first remote launch has `details: true`, or a percentage: report the line. Don't
   change the row.
