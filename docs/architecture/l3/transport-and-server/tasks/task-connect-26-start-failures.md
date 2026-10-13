# Task card connect-26: STR:S135 for a failed start with useExecServer off, a 15 s start wait, and a malformed range fails before the start (F-2409)

Issue: #557. Why: F-2409 7.E2, 7.E3, 7.E7, BR-9, BR-10 and AC-9, 10, 14, 25, 29 (`remote-oss/remote-ssh#54`). Card
coverage-13 (#556) found two gaps, and athena's ruling on #253 (the Q7 follow-up: a 15 s ready wait, contracts
"Bounds" amended in a898d5c) adds a third:
- a failed server start never shows STR:S135: `ofStart` gives `serverStart` no reason;
- a range such as `45030` reaches the host, where the server takes it as a plain port ([oss] `src/server-main.ts`,
  `parsePort`), so the connect succeeds where AC-14 wants F-2601's dialog;
- the start waits 60 s for the server's port, and reports a server that exits early at once. BR-10 wants about 15 s,
  with the failure reported at the end of the wait even when the server has already exited (AC-25: 13–20 s after the
  launch).

Builder: hestia or iris (hermes assigns). Size: about 1 agent-day. **Depends on coverage-13 (#556)**, for
`suite-ports`, its case launches and its host setup.

## 1. The behaviour

**STR:S135** (7.E2, 7.E3, BR-9). When the server start fails with `serverStart` and `remote.SSH.useExecServer` is
`false`, the failure's reason is `{id: 'S135'}`. The dialog then reads `Could not establish connection to "<host>":
The VS Code Server failed to start.`, with the full stop the dialog already adds. With `useExecServer` true, nothing
changes: no reason (7.E4's dialog, BR-9). The other start failures are unchanged.

**The start wait** (BR-10, AC-25).
- `SERVER_BOUNDS.readySeconds` is 15. Its comment cites F-2409 BR-10 and the ruling. The CLI's ready wait uses the same
  value, as it does now.
- In the start script (`lib-server/src/scripts/bootstrap.ts`, `startBody`), a launched server that ends before it
  reports a port no longer ends the wait at once. Exit status 207 still leaves `LinuxPrereqs` at once (F-2401). Any
  other exit sets `SERVER_ENDED=yes`, and the loop goes on reading the log until the ticks run out, then leaves
  `ServerFailedToStart`. The log is still read, so a port line that was written before the exit still counts. A server
  that's still running is unchanged.
- CI measurement (run 38365857629, VSCodium job): the whole first connect of the run (download, install and start)
  took about 10 s from the window's start to the server's grace-time line, which fits inside 15 s.

**The range's form** (7.E7, AC-14). A range entry is well formed when it is empty (no range) or matches `^(\d+)-(\d+)$`
with 0 < start ≤ end ≤ 65535. Otherwise:
- **reversed:** both numbers in 1–65535 and start > end;
- **malformed:** anything else, for example `abc`, `45030`, `70000-70010` or `0-10`.

The connect's `validate` step checks the host's range first. A reversed or malformed range fails with `{kind:
'invalidSetting'}` and no reason. That's before the pre-connection script and before any `ssh` (AC-13's "before any ssh
process starts"; 7.E7's dialog is STR:S030 with no reason). The reversed range's reason waits for decision Q3 (a)
(remote-oss/remote-ssh#93); until then it has none, as today.

## 2. Files

| File | Change |
|---|---|
| `packages/lib-server/src/lifecycle/runtime.ts`, `index.ts` | `rangeProblem(range: string): 'reversed' \| 'malformed' \| undefined` replaces `isReversedRange`. The start's own check fails with `invalidPortRange` when `rangeProblem` gives either, so other callers keep the guard. Update the unit rows of `isReversedRange` to the new function, one row per kind and per boundary (`1-1`, `65535-65535`, `0-10`, `1-65536`, `10-5`, `abc`, `45030`, `''`) |
| `packages/remote-ssh/src/pipeline/bounds.ts`, `test/unit/bounds.test.ts` | `readySeconds: 15`; the row expects `{downloadSeconds: 1800, readySeconds: 15}` |
| `packages/lib-server/src/scripts/bootstrap.ts`, `tests/acceptance/server/start.test.ts` | the start wait as above; the real-shell rows of §3 |
| `packages/remote-ssh/src/pipeline/server-steps.ts` | `validate` calls `rangeProblem` on the host's `portRange` before the target check |
| `packages/remote-ssh/src/pipeline/failure.ts` | `ofStart(failure, {useExecServer})`: `serverStart` gives `reason: {id: 'S135'}` when `useExecServer` is false. `unreadableServerFacts` keeps no reason |
| `packages/remote-ssh/src/pipeline/connect.ts`, `wiring.ts`, `cli/cli-connect.ts` | pass `useExecServer` from the settings `wiring.ts` already reads (`ports.settings.useExecServer()`) to `ofStart`'s callers |
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | `FailureStringId` and `FAILURE_TEMPLATES` gain `S135: 'The VS Code Server failed to start'` |
| `packages/remote-ssh/l10n/bundle.l10n*.json` | the template in every bundle, English as the value |
| `packages/remote-ssh/src/surfaces/scripted-adapters.ts`, `tests/acceptance/suite-local/script.ts` | a `mitigationPick` record line gains `items`, the labels of `pick.items` in order |
| `tests/acceptance/suite-ports/cases.json`, `ports.test.ts` | section 3 |

## 3. Rows

**Unit rows** (remote-ssh and lib-server at their gates):

| Name | Expected |
|---|---|
| `F-2409 7.E2: a failed start with useExecServer off gives STR:S135` | `ofStart({kind: 'serverStart'}, {useExecServer: false})` has reason `S135` |
| `F-2409 BR-9: a failed start with useExecServer on gives no reason` | no reason |
| `F-2409 7.E7: a malformed range fails the connect before ssh, with no reason` | `validate` with `45030` fails `invalidSetting`, no reason; nothing after `validate` ran |
| `F-2409 7.E6: a reversed range fails the connect before ssh` | the same with `5000-4000` |
| `F-2409 BR-2: a well-formed range passes validate` | `45000-45010` and `''` |
| `a mitigation pick record line carries its items` | the scripted adapter records the five labels |
| `F-2409 AC-29: no failure kind offers the Output Log's mitigation steps` | for every `FailedKind`, with and without a reason, the dialog's message and buttons, and `mitigationPickOf`'s items, contain no `View the Output Log to see mitigation steps` |

**Real-shell rows** (`tests/acceptance/server/start.test.ts`, the stand-in server, `readySeconds` 2):

| Name | Expected |
|---|---|
| `F-2409 BR-10: a server that exits before reporting a port fails at the end of the wait` | the stand-in exits at once with status 1; the start fails `serverStart` no sooner than 2 s after it began |
| `F-2401: a server that exits with 207 fails at once` | status 207; `prerequisitesMissing` within 1 s |
| `F-2409 BR-10: a port written before the exit still counts` | the stand-in writes the ready line and exits; the start reports that port |

**Acceptance cases** for `suite-ports/cases.json`, after coverage-13's cases. They use its setup, its script (the
dialog and the pick of actions dismissed) and its rows of §3 where they apply. `PortsCase.outcome` gains
`'dialog'`, with `dialog: string` the expected text, as the table gives it:

| Label | Settings | Holders | Dialog | AC |
|---|---|---|---|---|
| `start-range-full` | `useExecServer: false`, `serverPickPortsFromRange: {"harness": "45000-45010"}` | 45000–45010 | `Could not establish connection to "harness": The VS Code Server failed to start.` | AC-9, AC-29 |
| `start-bind-absent` | `useExecServer: false`, `bindHost: {"harness": "10.99.99.99"}` | — | the same | AC-10, AC-29 |
| `range-abc` | `serverPickPortsFromRange: {"harness": "abc"}` | — | `Could not establish connection to "harness".` | AC-14, AC-29 |
| `range-port-only` | `serverPickPortsFromRange: {"harness": "45030"}` | — | the same | AC-14, AC-29 |
| `range-too-high` | `serverPickPortsFromRange: {"harness": "70000-70010"}` | — | the same | AC-14, AC-29 |
| `range-reversed` | `serverPickPortsFromRange: {"harness": "5000-4000"}` | — | the same, until Q3 (a) | AC-29 |

Rows, in each of these launches:

| Name | Assertion |
|---|---|
| `` `${cite}: the dialog is the case's` `` | the `failureDialog` line's question |
| `` `F-2409 AC-29 (${label}): neither the dialog nor More Actions... offers the Output Log's mitigation steps` `` | neither the dialog's question nor any of the `mitigationPick` line's `items` contains `View the Output Log to see mitigation steps` |
| `` `F-2409 AC-14 (${label}): the window stays usable` `` (the three AC-14 cases) | `vscode.workspace.openTextDocument({content: 'usable'})` resolves |
| `F-2409 AC-25 (start-bind-absent): the dialog comes 13 to 21 s after the server's launch` | the `failureDialog` line's `time` minus the launch time is within 13 000–21 000 ms. The launch time is the mtime of the server's pid file, from `onHost('stat', '-c', '%Y', '/home/harness/.vscodium-server-insiders/.<commit>.pid')` × 1000, where `<commit>` is `hostServer().commits[0]`. The script writes the file right after the launch. The mtime has whole seconds, hence 21 s and not 20. Host and client share the machine's clock |

The `start-bind-absent` server may stay alive without a port (7.E3). The next case's setup kills it.

## 4. The catalogue

F-2409 AC-9, 10, 14, 25 and 29 go to `acceptance`. AC-29 holds in every mode: the Output Log step is in neither our
dialog nor our fixed list of actions (athena on #558), which the unit row proves for every kind. AC-13 stays `todo`
until Q3 (a) is answered. AC-26 waits for a slow stand-in server in the VSCodium run and tooling-20's Retry.

## 5. Done when

The repository's gates pass, and `pnpm test:acceptance:vscodium` passes with coverage-13's cases plus these six. Paste
the `suite-ports` summaries.

## 6. Review

PR title `remote-ssh, lib-server: STR:S135 and the range's form (card connect-26, #557)`. themis or triton reviews;
athena checks the move of the range check into `validate`.
