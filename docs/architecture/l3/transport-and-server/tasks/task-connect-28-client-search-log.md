# Task card connect-28: the resolve logs the client search (F-2101 §9) and the probed platform (F-2206 §9)

Issue: #563. Why: F-2101 §9 and AC-6, AC-26 (`remote-oss/remote-ssh#19`); F-2206 §9 (`#33`). triton found the gap on
#549:
- the locate step (`pipeline/locate-step.ts`) logs only a failed `ssh -G`;
- the phrase "not a valid SSH binary" is in no source file;
- `diagnostics/log-content.ts`, the formatter of F-2003 BR-6 (card connect-04), has no caller;
- nothing logs the host platform the probe found.

The spec's wording isn't a contract (F-2101 §9: "the reimplementation must give the same pieces of information"); the
pieces and their order are. Builder: hestia, before coverage-11 (#548). Size: about 1 agent-day.

## 1. The lines

Each line is written at `info` through the connect's logger, when its fact is known. The client search's lines are, in
this order (F-2101 §9):

| # | When | Line |
|---|---|---|
| 1 | the locate step starts | `remote.SSH.path = <value>`, where `<value>` is `JSON.stringify` of the setting's value, `""` when unset |
| 2 | each candidate is checked | `Checking ssh client: <program>` |
| 3 | a check ends | `ssh client: <banner>`: the first non-empty line of its standard error, or `(no banner)` |
| 4 | a check rejects the candidate | `ssh client <program> was rejected: <why>`, where `<why>` is `exit status <n>`, `it could not be started: <error>` (the spawner's error message, which `runBounded` keeps in its `unstarted` outcome instead of dropping it), `it timed out`, or `its banner does not name OpenSSH` |
| 5 | after 4, for the candidate from the setting | `remote.SSH.path "<value>" is not a valid SSH binary` |
| 6 | before the search-path candidate is checked | `Searched for ssh in: <folder>`, one line per folder of the search path, in order |
| 7 | a candidate is accepted | `Using ssh client: <program>` |

The sequences:
- a configured value that's checked and accepted gives lines 1, 2, 3, 7;
- an unset or empty setting gives 1, 6, 2, 3, 7;
- a missing configured file gives 1, 2, 3, 4, 5, 6, 2, 3, 7.

The logger masks any run of 32 or more word characters. A folder or banner holding one would differ from the
builder's text in the log, so a row that compares them must avoid such names. The harness's own folders have none.

The probe's line (F-2206 §9) is written once the probe has read the host, in both modes: `Host platform:
<operatingSystem> <architecture>`, for example `Host platform: linux arm64` (`ProbedHost`'s own terms, as the host script normalises them). It isn't written when the platform was
decided without a probe.

## 2. Files

| File | Change |
|---|---|
| `packages/remote-ssh/src/diagnostics/log-content.ts` | the pure line builders, exported: `searchedLines(folders)`, `bannerLine(banner)`, `clientSearchLines`, one builder per row of §1, and `hostPlatformLine(probed)`. `windowLines` uses `searchedLines` and `bannerLine`, so each wording lives in one place |
| `packages/remote-ssh/src/pipeline/locate-step.ts` | `accepted` gives the outcome's reason (status, start failure, timeout, banner), not a bare boolean. The step writes §1's lines. The search path's folders come from `dependencies.environment.searchPath`, split with `path.delimiter` |
| `packages/remote-ssh/src/pipeline/connect.ts` | after `probe` succeeds, `options.logger.info(hostPlatformLine(host))` |
| `packages/remote-ssh/test/unit/log-content.test.ts`, `locate-step.test.ts`, `connect.test.ts` | the rows of §3; the existing rows stay green |

Not in this card:
- the whole record of F-2003 BR-6 (`resolveLogLines`). athena on #564: F-2003 isn't in slice 1, so it's carded with
  its slice;
- F-2206 §9's login shell and parent shell beside the detected platform. No 0.2 AC reads them.

## 3. Rows

| Name | Expected |
|---|---|
| `F-2101 §9: a configured client that works is logged as set, checked, its banner and used` | lines 1, 2, 3, 7 in order |
| `F-2101 AC-6: a missing configured file is logged as not a valid SSH binary, then the search path is used` | 1, 2, 3, 4 (`it could not be started: <the spawner's error>`), 5, 6, 2, 3, 7 |
| `F-2101 §9: an unset setting goes straight to the search path` | 1, 6, 2, 3, 7 |
| `F-2101 §9: a rejected banner says why` | a PuTTY banner: line 4 with `its banner does not name OpenSSH` |
| `F-2101 §9: a failed check gives its exit status` | status 1: `exit status 1` |
| `F-2101 §9: a check that outlasts its bound says it timed out` | `it timed out` |
| `F-2101 §9: an unset setting is logged as ""` | `remote.SSH.path = ""` |
| `F-2101 §9: the banner is read from standard error only` | a banner on standard output only: `ssh client: (no banner)`. The candidate is still judged on both streams, as `judge` does |
| `F-2206 §9: the probed platform is logged` | `Host platform: linux x64` after the probe |
| `F-2206 §9: no platform line when the probe didn't run` | a decided `windows` entry in default mode: no `Host platform:` line |

remote-ssh stays at 100/100/100.

## 4. What follows

- coverage-11 (#548) asserts these lines for F-2101 AC-6 and AC-26 in the VSCodium run.
- coverage-12 (#551) uses `Host platform:` for its no-probe row and its positive control.

## 5. Review

PR title `remote-ssh: the resolve logs the client search and the probed platform (card connect-28, #563)`. themis or
triton reviews; athena checks the lines against F-2101 §9 and their place beside F-2003's formatter.
