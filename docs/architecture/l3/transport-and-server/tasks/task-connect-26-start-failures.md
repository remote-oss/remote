# Task card connect-26: STR:S135 for a failed start with useExecServer off, and a malformed range fails before the start (F-2409)

Issue: #557. Why: F-2409 7.E2, 7.E3, 7.E7, BR-9 and AC-9, 10, 14, 29 (`remote-oss/remote-ssh#54`). Card coverage-13
(#556) found two gaps:
- a failed server start never shows STR:S135: `ofStart` gives `serverStart` no reason;
- a range such as `45030` reaches the host, where the server takes it as a plain port ([oss] `src/server-main.ts`,
  `parsePort`), so the connect succeeds where AC-14 wants F-2601's dialog.

Builder: hestia or iris (hermes assigns). Size: about 1 agent-day. **Depends on coverage-13 (#556)**, for
`suite-ports`, its case launches and its host setup.

## 1. The behaviour

**STR:S135** (7.E2, 7.E3, BR-9). When the server start fails with `serverStart` and `remote.SSH.useExecServer` is
`false`, the failure's reason is `{id: 'S135'}`. The dialog then reads `Could not establish connection to "<host>":
The VS Code Server failed to start.`, with the full stop the dialog already adds. With `useExecServer` true, nothing
changes: no reason (7.E4's dialog, BR-9). The other start failures are unchanged.

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

The `start-bind-absent` server may stay alive without a port (7.E3). The next case's setup kills it.

## 4. The catalogue

F-2409 AC-9, 10, 14 and 29 go to `acceptance`. AC-29's failures of 7.E4 are exec-server mode, which needs the CLI path
(dormant in 0.2). Note that in the PR, so athena can rule on whether AC-29 waits for it. AC-13 stays `todo` until Q3
(a) is answered.

## 5. Done when

The repository's gates pass, and `pnpm test:acceptance:vscodium` passes with coverage-13's cases plus these six. Paste
the `suite-ports` summaries.

## 6. Review

PR title `remote-ssh, lib-server: STR:S135 and the range's form (card connect-26, #557)`. themis or triton reviews;
athena checks the move of the range check into `validate`.
