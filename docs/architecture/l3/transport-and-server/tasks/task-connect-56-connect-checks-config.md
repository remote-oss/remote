# Task card connect-56: a window's connect checks the config file first and names its parse problem

Issue: #810. Release 0.2, **gating**: F-2201 AC-22 (`remote-oss/remote-ssh#28`, 7.E2, BR-8) is a slice-1 criterion.
Size: S. Builder: assigned by hermes (`task:local`). Measured by iris while building coverage-18 (#588), whose AC-22 row
waits on this card.

## 1. The defect

**The rule:**
- **F-2201 AC-22:** "Given the file in effect cannot be parsed, when a window connects to any host, then no ssh process
  is started, the window stays disconnected and an error naming the parse problem is shown."
- **7.E2:** "ssh is never started"; the error carries the reader's message. A host defined only in another, valid
  file fails the same way.
- **BR-8:** a parse failure of a file in effect aborts the operation that needed the list.

**What main does** (iris, measured with `Host "broken` appended to the run's `ssh_config`):
- the connect runs the client check: `Checking ssh client: ssh`, `ssh client: OpenSSH_10.2p1…`, `Using ssh client: ssh`;
- then `ssh -G`, which fails with ssh's own stderr: `…/ssh_config line 236: invalid quotes`, `…: terminating, 1 bad
  configuration options`;
- the connect ends `connect failed: unknown`, and the dialog reads `Could not establish connection to "harness".`,
  which names nothing.

The connect commands already refuse such a file before any pick: `connect/connect-commands.ts` throws
`` `${file}: ${reason}` `` from lib-ssh's `listHosts` (F-2201 AC-19). The window's own connect has no such check.

## 2. The fix

1. **A new first check.** `ConnectSteps` (`pipeline/steps.ts`) gains `checkConfigFile(input): StepResult<undefined>`,
   with the JSDoc "The SSH configuration files in effect, read and parsed before anything runs". `connect.ts`'s
   `CHECKS` becomes `['checkConfigFile', 'checkStartSettings', 'validate', 'checkInstallFolder']`, so it runs before
   the client search and before `ssh -V`. A reconnection runs it too, since it runs every check.
2. **The step** (`pipeline/wiring.ts`) calls a new `WiringPorts.configuredHosts(): HostListResult`. It's the same
   reading the host pick uses: `extension.ts`'s `configuredHosts(host)`, over lib-ssh's `listHosts` and
   `nodeConfigReader`. Pass that function through `connect-ports.ts`, and don't write a second reader.
   - `{hosts}` → `{kind: 'done', value: undefined}`;
   - `{parseError: {file, reason}}` → `{kind: 'failed', failure: {kind: 'configFileUnparsable', reason: {text:
     `${file}: ${reason}`}, logDetail: `the SSH configuration file cannot be parsed: ${file}: ${reason}`}}`.
   - `configFileUnparsable` is a new failure kind of its own in remote-ssh's failure mapping (`pipeline/failure.ts`'s
     kinds). The one place that maps a failure to lib-authority's `Failed` maps this kind, and only this kind, to
     **`silent: true`**, `retryable: false`, keeping the reason. `invalidSetting` and every other kind keep their
     current mapping.
3. **What the user sees (F-2201 Q1 = (a), athena on #811): core's own error notification**, as 7.E2 observes:
   `Failed to connect to the remote extension host server (Error: <file>: <reason>)`, with "Open Developer Tools".
   - **How it gets there:** lib-authority's resolver host turns a `silent` failure into `notAvailable(message, handled:
     false)`, with `message` the reason's text (`resolver/host.ts`, `messageOf`, `errorFor`). Core shows the
     notification for an error that isn't handled ([oss] `remoteAgentService.ts`).
   - **No new code** is needed in lib-authority or core. Our failure presenter isn't called: no dialog, no Retry, no More
     Actions…
   - **Unused strings:** S010, S099 (as an action) and S114 stay unused, as on every observed route.
4. **Unchanged:** a file reached only through `Include` keeps 7.E4's behaviour: our reader drops it, and ssh rejects it
   at connect. `listHosts` already reports only files in effect.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `connect.test.ts` (the pipeline fixture) | `F-2201 AC-22: an unparsable file in effect fails the connect before the client check, naming the problem` | `checkConfigFile` failing with the parse failure above | the result is `Failed` `configFileUnparsable` with the reason text `<file>: <reason>`; `locateClient`, `decideTerms` and `preconnect` were never called |
| `connect.test.ts` | `F-2201 BR-8: the configuration check runs first` | every check failing | the failure is `checkConfigFile`'s |
| `wiring.test.ts` | `F-2201 AC-22: the check reads the files in effect through the host list` | `configuredHosts` answering `{parseError: {file: '/h/.ssh/config', reason: 'unterminated quote after Host'}}`, then `{hosts: []}` | failed with reason text `/h/.ssh/config: unterminated quote after Host`; done |
| `connector.test.ts` (or the file holding the failure-to-`Failed` mapping's rows) | `F-2201 AC-22: an unparsable file is a silent, non-retryable failure that our presenter never shows` | the connect failing with `configFileUnparsable` and the reason text `/h/.ssh/config: unterminated quote after Host` | the `Failed` has `silent: true`, `retryable: false` and that reason text; the presenter fake was never called |
| `failure.test.ts` | `F-2201 AC-22: only the parse failure is silent` | `invalidSetting` with a reason | not silent, as today |

**Defect rule:** the first and third rows (`connect.test.ts`'s parse row and `wiring.test.ts`'s) must fail on main and
pass with the fix. Paste both runs.

**Acceptance:** coverage-18's AC-22 row (#588; iris holds it out) goes back in after this card merges, with these
assertions:
- `q1` has **no** `failureDialog` line;
- `connectionLog()` has no `Checking ssh client:` line after the step began;
- `q1` is disconnected;
- core's notification text `Failed to connect to the remote extension host server (Error: <file>: <reason>)`, if the
  window agent can read core's notifications. If it can't, say so in the PR. The text is then a unit fact, from the
  connector row plus lib-authority's existing `errorFor` rows.

Tell iris on #588 when this merges.

## 4. Catalogue

No tag change here. coverage-18's row tags F-2201 AC-22 `acceptance`.

## 5. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-consumed,
check-coverage and coverage, with the changed files at 100 %. Use the PR title
`remote-ssh: a window's connect checks the config file first and names its parse problem (card connect-56, #810)`.
Request athena only; hermes assigns the peer.

## 6. Open rows (stop and report on #810)

None. Open row 1 (a reconnection with an unparsable file) is answered by `retryable: false` and athena's Q1 ruling: the
failure is final, and core shows its notification.
