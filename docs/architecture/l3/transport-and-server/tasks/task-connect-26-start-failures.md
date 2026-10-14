# Task card connect-26: F-2409's start failures and setting checks (S135, S136, S168, the range's form, the 15 s wait)

Issue: #557. Why: F-2409 as republished after remote-oss/remote-ssh#93 (`remote-oss/remote-ssh#54`): 7.E1–7.E4, 7.E6–7.E9,
BR-9, BR-10 and AC-7, 9, 10, 12, 13, 14, 15, 19, 25, 28, 29, and the source of AC-30. Card coverage-13 (#556) found the gaps, metis decided
Q1, Q2, Q3 (a, b) and Q5 on #93, and athena ruled a 15 s ready wait on #253 (contracts "Bounds", a898d5c). Today:

- a failed server start never shows STR:S135 or STR:S136: `ofStart` gives `serverStart` no reason;
- a rejected bind host is replaced by the loopback address in silence: lib-server's `bindHostRejected` notice is
  dropped, and `""` or an object never reaches the check;
- a range such as `45030` reaches the host, where the server takes it as a plain port ([oss] `src/server-main.ts`,
  `parsePort`), so the connect succeeds; a reversed range fails only at the start, without its reason;
- the start waits 60 s for the server's port, and reports a server that exits early at once.

Builder: hestia or iris (hermes assigns). Size: about 2 agent-days. **Depends on coverage-13 (#556)**, for `suite-ports`,
its case launches and its host setup, **and on tooling-24 (#552)**, for the `NoticePort`.

## 1. The behaviour

### 1.1 The bind host (7.E1, 7.E11, AC-7, AC-8, AC-27, AC-28)

The host's `remote.SSH.bindHost` entry (exact key, as today) is decided in the connect's `validate` step, which comes
before the pre-connection script, `ssh` and every progress stage after the title:

| Entry | Bind host used | Notice |
|---|---|---|
| none | `127.0.0.1` | none |
| a string `isAcceptedBindHost` accepts (lib-server, unchanged: the observed set with R-97's hyphen rule) | the string | none |
| any other string, `""` included | `127.0.0.1` | STR:S168, `{1}` = the string as written |
| a JSON object (not `null`, not an array) | `127.0.0.1` | STR:S168, `{1}` = `JSON.stringify(entry)`, for example `{"a":1}` |
| a number, a boolean, `null` or an array | `127.0.0.1` | none (7.E11; AC-27 lets the entry be ignored) |

**The notice** is STR:S168, `{1} is not a valid host to bind`. It's an error notice with no buttons:
`NoticePort.showError(text, [])`, not awaited, and the connect goes on. Its values are `[alias, configured]`, so
`{1}` is the configured value.

lib-server's own check in the start stays as the library's guard. remote-ssh now only passes it accepted values.

### 1.2 The range (7.E6–7.E8, AC-13, AC-14, AC-15)

`rangeProblem(entry: unknown): 'reversed' | 'malformed' | undefined`, in lib-server:

| Entry | Result |
|---|---|
| `undefined` (no entry) or `""` | `undefined` |
| a string `^(\d+)-(\d+)$` with 0 < start ≤ end ≤ 65535 | `undefined` |
| a string `^(\d+)-(\d+)$` with both numbers in 1–65535 and start > end | `reversed` |
| any other string (`abc`, `45030`, `70000-70010`, `0-10`) | `malformed` |
| any value that isn't a string (number, boolean, `null`, object, array) | `malformed` (Q3 b) |

`validate` checks the host's raw entry before anything else:
- **reversed:** fails `invalidSetting` with the reason `{id: 'reversedPortRange'}`, whose text is `Invaid port range
  set`. The dialog reads `Could not establish connection to "<host>": Invaid port range set.` (Q3 a);
- **malformed:** fails `invalidSetting` with no reason, so the dialog is STR:S030.

Both fail before any `ssh` runs. lib-server's start keeps its own guard (`invalidPortRange` when `rangeProblem` gives
either).

### 1.3 The start wait (BR-10, AC-25)

- `SERVER_BOUNDS.readySeconds` is 15. Its comment names the ruling. The CLI's ready wait uses the same value, as it
  does now.
- **The start script** (`lib-server/src/scripts/bootstrap.ts`, `startBody`). A launched server that ends before it
  reports a port no longer ends the wait at once, with two exceptions:
  - exit status 207 still leaves `LinuxPrereqs` at once (F-2401);
  - a log that holds `Server terminated due to presence of CVE-2020-1416` leaves at once, through `start_failed`.
  Any other end sets `SERVER_ENDED=yes`. The loop goes on reading the log until the ticks run out, so a port line
  written before the exit still counts, and then calls `start_failed`.
- **`start_failed`** replaces every `leave ServerFailedToStart` of the wait (the reuse path's checks before the launch
  are unchanged). It writes `fact server.failure noFreePort` when the log holds `Could not find free port in range`, or
  `fact server.failure cveTerminated` when it holds the CVE line, then leaves `ServerFailedToStart`. Both texts are the
  OSS server's own: `server-main.ts`'s `parsePort`, which calls its message an API, and
  `remoteExtensionHostAgentServer.ts`, whose check runs on Windows only.
- **CI measurement** (run 38365857629, VSCodium job): the run's first connect, download, install and start included,
  took about 10 s from the window's start to the server's grace-time line.

### 1.4 The start failure's reason (7.E2–7.E4, 7.E9, BR-9, Q2, Q5)

lib-server's `serverStart` failure gains `cause?: 'noFreePort' | 'cveTerminated'`, from the `server.failure` fact.
Other values of the fact are ignored. `ofStart(failure, {useExecServer})` gives `serverStart` this reason:

| Cause | `useExecServer` | Reason |
|---|---|---|
| `cveTerminated` | either | STR:S136 |
| `noFreePort` | either | STR:S135 (Q2: both modes) |
| none | `false` | STR:S135 |
| none | `true` | none (7.E4) |

`unreadableServerFacts` keeps no reason. STR:S149, the Session Summary's description, belongs to F-2605's summary and
isn't built here.

## 2. Files

| File | Change |
|---|---|
| `packages/lib-server/src/lifecycle/runtime.ts`, `index.ts` and tests | `rangeProblem` replaces `isReversedRange`; `serverStart`'s `cause` from the fact; unit rows per kind and boundary (`1-1`, `65535-65535`, `0-10`, `1-65536`, `10-5`, `abc`, `45030`, `''`, `45030` as a number, `null`, `{}`) |
| `packages/lib-server/src/scripts/bootstrap.ts`, `tests/acceptance/server/start.test.ts` | §1.3; the real-shell rows of §3 |
| `packages/remote-ssh/src/pipeline/bounds.ts`, `test/unit/bounds.test.ts` | `readySeconds: 15` |
| `packages/remote-ssh/src/pipeline/host-settings.ts` | the raw range entry beside `portRange`; `bindHostOf(setting, alias): {bindHost: string; rejected?: string}` as §1.1's table, replacing `entryText(…) \|\| LOOPBACK` |
| `packages/remote-ssh/src/pipeline/server-steps.ts` | `validate`: the range first, then the bind host (calls the new dependency `rejectBindHost(configured)` when `rejected` is set), then the target check as today |
| `packages/remote-ssh/src/pipeline/failure.ts`, `connect.ts`, `wiring.ts`, `cli/cli-connect.ts` | `ofStart(failure, {useExecServer})` as §1.4; the callers pass `ports.settings.useExecServer()` |
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | `FailureStringId` and `FAILURE_TEMPLATES` gain `S135: 'The VS Code Server failed to start'`, `S136: 'The VS Code Server terminated due to presence of CVE-2020-1416. Check the Remote-SSH output channel for more details.'` and `reversedPortRange: 'Invaid port range set'`, with the comment `The reference's fixed text; the misspelling is reproduced on purpose.` |
| `packages/remote-ssh/src/surfaces/own-strings.ts` | `OWN_TEMPLATES` gains `S168: '{1} is not a valid host to bind'`. If connect-25 hasn't landed, make its fileoverview change too ("the spec's ids used elsewhere") |
| `packages/remote-ssh/src/editor-surfaces.ts`, `connect-ports.ts` | wire `rejectBindHost` to `adapters.notice.showError(ownText({id: 'S168', values: [alias, configured]}, translate), [])`, not awaited, logging a rejection at `warn` |
| `packages/remote-ssh/l10n/bundle.l10n*.json` | the four templates in every bundle, English as the value |
| `packages/remote-ssh/src/surfaces/scripted-adapters.ts`, `tests/acceptance/suite-local/script.ts` | a `mitigationPick` line gains `items`, the labels in order. A `notice` line gains `buttons`, the labels passed; connect-25 adds the same field, and whichever card lands second rebases onto it |
| `tests/acceptance/suite-ports/cases.json`, `ports.test.ts` | §3 |

## 3. Rows

**Unit rows** (remote-ssh and lib-server at their gates):

| Name | Expected |
|---|---|
| `F-2409 7.E2: a failed start with useExecServer off gives STR:S135` | `ofStart({kind: 'serverStart'}, {useExecServer: false})`: reason `S135` |
| `F-2409 BR-9: a failed start with useExecServer on gives no reason` | no reason |
| `F-2409 6.2: no free port in the range gives STR:S135 in both modes` | cause `noFreePort`, `useExecServer` true and false: `S135` |
| `F-2409 AC-30: a server that ended for CVE-2020-1416 gives STR:S136` | cause `cveTerminated`, both modes: `S136`; the dialog text is `Could not establish connection to "harness": The VS Code Server terminated due to presence of CVE-2020-1416. Check the Remote-SSH output channel for more details.` |
| `F-2409 7.E1: a rejected bind host is announced and replaced by the loopback address` | `bindHostOf` for each rejected value of 7.E1's table (`not a host!`, `127.0.0.1 ` with its trailing space, `::1`, `1.2.3.4:5`, `my_host`, `ho$t`, `host/x`, `héllo`, `[::1`, `[1.2.3.4]`, `-a`, `""`): `127.0.0.1` and `rejected` as written |
| `F-2409 7.E1: an object bind host is announced as its JSON text` | `{a: 1}` → `rejected: '{"a":1}'` |
| `F-2409 7.E1: an accepted bind host is used as written` | `0.0.0.0`, `10.99.99.99`, `1.2.3`, `myhost`, `[::1]`, `localhost`: used, no `rejected` |
| `F-2409 7.E11: a bind host that is a number, boolean, null or array is ignored` | `127.0.0.1`, no `rejected` |
| `F-2409 7.E1: validate shows the notice and goes on` | `rejectBindHost` called once with the value; `validate` is `done` |
| `F-2409 7.E6: a reversed range fails before ssh with the reference's reason` | `validate` with `5000-4000`: `invalidSetting`, reason `reversedPortRange`; no later step ran |
| `F-2409 7.E7: a malformed range fails before ssh, with no reason` | `45030` and `abc`: `invalidSetting`, no reason |
| `F-2409 7.E8: a range that isn't a string fails like a malformed one` | `45030` as a number, `null`, `{}`: the same |
| `F-2409 BR-2: a well-formed range or none passes validate` | `45000-45010`, `''`, no entry |
| `F-2409 AC-29: no failure kind offers the Output Log's mitigation steps` | for every `FailedKind`, with and without a reason, the dialog's message and buttons and `mitigationPickOf`'s items: no `View the Output Log to see mitigation steps` |
| `a mitigation pick record line carries its items` | five labels |

**Real-shell rows** (`tests/acceptance/server/start.test.ts`, the stand-in server, `readySeconds` 2):

| Name | Expected |
|---|---|
| `contracts V7: F-2409 BR-10, a server that exits before reporting a port fails at the end of the wait` | the stand-in exits at once with status 1: `serverStart`, no `cause`, no sooner than 2 s after the start began |
| `contracts V7: F-2401, a server that exits with 207 fails at once` | `prerequisitesMissing` within 1 s |
| `contracts V7: F-2409 BR-10, a port written before the exit still counts` | the stand-in writes the ready line, then exits: the start reports that port |
| `contracts V7: F-2409 6.2, a server with no free port in its range fails with that cause` | the stand-in prints `--port: Could not find free port in range: 1 - 2 (inclusive).` and exits 1: cause `noFreePort` |
| `F-2409 AC-30: a server that ended for CVE-2020-1416 fails at once with that cause` | the stand-in (the test double of AC-30) prints `* !!!! Server terminated due to presence of CVE-2020-1416 !!!!` and exits 0: cause `cveTerminated`, within 1 s |

**Acceptance cases** for `suite-ports/cases.json`, after coverage-13's cases. They use coverage-13's setup and script,
plus a `notice` entry (`match: 'is not a valid host to bind'`, `answer: 'dismiss'`) in every case. `PortsCase.outcome`
gains `'dialog'`, with `dialog: string`. The default mode is `useExecServer` true, which the setting gives when unset.

| Label | Settings | Holders | Expected | AC |
|---|---|---|---|---|
| `start-range-full` | `useExecServer: false`, range `45000-45010` | 45000–45010 | dialog `Could not establish connection to "harness": The VS Code Server failed to start.` | AC-9 |
| `start-range-full-default` | range `45000-45010` | 45000–45010 | the same dialog | AC-19 |
| `start-range-one-busy` | range `45005-45005` | 45005 | the same dialog | AC-19 |
| `start-bind-absent` | `useExecServer: false`, bind host `10.99.99.99` | — | the same dialog | AC-10, AC-25 |
| `start-bind-absent-default` | bind host `10.99.99.99` | — | dialog `Could not establish connection to "harness".`; no `notice` line | AC-12 |
| `bind-unusable-dotted` | bind host `1.2.3` | — | dialog `Could not establish connection to "harness".`; no `notice` line | AC-28 |
| `bind-unusable-name` | bind host `myhost` | — | the same | AC-28 |
| `bind-unusable-bracketed` | bind host `[::1]` | — | the same | AC-28 |
| `bind-rejected-text` | bind host `not a host!` | — | connected; listens on `127.0.0.1`; one `notice` line `not a host! is not a valid host to bind`, `buttons` `[]` | AC-7 |
| `bind-rejected-ipv6` | bind host `::1` | — | the same, with `::1 is not a valid host to bind` | AC-7 |
| `bind-rejected-empty` | bind host `""` | — | the same, with ` is not a valid host to bind` (empty `{1}`) | AC-7 |
| `bind-rejected-underscore` | bind host `my_host` | — | the same, with `my_host is not a valid host to bind` | AC-7 |
| `bind-rejected-port` | bind host `1.2.3.4:5` | — | the same, with `1.2.3.4:5 is not a valid host to bind` | AC-7 |
| `bind-rejected-object` | bind host `{"a": 1}` | — | the same, with `{"a":1} is not a valid host to bind` | AC-7 |
| `range-abc` | range `abc` | — | dialog `Could not establish connection to "harness".` | AC-14 |
| `range-port-only` | range `45030` | — | the same | AC-14 |
| `range-too-high` | range `70000-70010` | — | the same | AC-14 |
| `range-number` | range `45030` as a JSON number | — | the same; no `notice` line | AC-15 |
| `range-reversed` | range `5000-4000` | — | dialog `Could not establish connection to "harness": Invaid port range set.` | AC-13 |

Bind host and range are the host's entries: `{"harness": …}` under `remote.SSH.bindHost` and
`remote.SSH.serverPickPortsFromRange`.

Rows, in each of these launches (`cite` as in coverage-13):

| Name | Assertion |
|---|---|
| `` `${cite}: the connect ended as the case says` `` | connected, or the `failureDialog` line's question |
| `` `${cite}: the notice is the case's` `` | the `notice` lines: exactly the case's one, or none |
| `` `F-2409 AC-7 (${label}): the notice came before the download progress` `` (the `bind-rejected-*` cases) | the `notice` line's `time` is before that of the second `progress` line, the first stage after the title. `validate` shows the notice before any stage is reported, so this holds whether or not the host downloads. A download stage, when there is one, is always later than that first stage |
| `` `F-2409 AC-29 (${label}): neither the dialog nor More Actions... offers the Output Log's mitigation steps` `` (every dialog case) | neither the question nor the `mitigationPick` line's `items` contains `View the Output Log to see mitigation steps` |
| `` `${cite}: the window stays usable` `` (AC-14 and AC-15 cases) | `vscode.workspace.openTextDocument({content: 'usable'})` resolves |
| `F-2409 AC-25 (start-bind-absent): the dialog comes 13 to 21 s after the server's launch` | the `failureDialog` line's `time` minus the launch time is within 13 000–21 000 ms. The launch time is the mtime of the server's pid file: `onHost('stat', '-c', '%Y', '/home/harness/.vscodium-server-insiders/.<commit>.pid')` × 1000, where `<commit>` is `hostServer().commits[0]`. The script writes the file right after the launch. The mtime has whole seconds, hence 21. Host and client share the machine's clock |

A server that failed to listen may stay alive without a port (7.E3). The next case's setup kills it.

## 4. The catalogue

F-2409 AC-7, 9, 10, 12, 13, 14, 15, 19, 25, 28 and 29 go to `acceptance`. AC-11, 16 and 22 need no row here: the
recorded cases cover them (the coverage list on `remote-oss/remote-ssh#54`). They stay `todo` until our x86_64 replay
passes, and are then tagged `recorded`. F-2409 AC-18 goes to `deferred`, with the reason
`D-86: only clearAllSessionHints of F-2605 is in 0.2` (athena, 2026-10-14): nothing writes the hint store in 0.2,
because the session recorder belongs to F-2605. AC-30 stays `todo`: its outcome is the
window's dialog, and no window case can make the real server end for CVE-2020-1416 (its check runs on Windows only). The
unit row proves the dialog's text and the real-shell row proves the cause, but by athena's reading on #481 and #522 a
server-level row doesn't carry `acceptance` for a window outcome. List AC-30 under "harness capability missing" in #142:
a window case over a stand-in server. In #142's tracking comment:
- **core halves:** the indicator and title of AC-9 and AC-13; the notice's toolbar in AC-7;
- **the three buttons of AC-12:** F-2601 AC-2's row proves them for every dialog.

For athena, in the PR:
- AC-12, 19 and 28 are exec-server mode. In 0.2 that is `useExecServer` true with the direct start, because the CLI
  path is dormant. The rows prove the outcomes the ACs name;

AC-26 waits for a slow stand-in in the VSCodium run and tooling-20's Retry.

## 5. Done when

The repository's gates pass, and `pnpm test:acceptance:vscodium` passes with coverage-13's cases plus these 19. Paste the `suite-ports` summaries.

## 6. Review

PR title `remote-ssh, lib-server: F-2409's start failures and setting checks (card connect-26, #557)`. themis or
triton reviews; athena checks the decisions of §1 against #93 and the move of both checks into `validate`.
