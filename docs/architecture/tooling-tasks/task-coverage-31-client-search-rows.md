# Task card coverage-31: the client-search rows of F-2101 that need a reload, a failure or a local window

Issue: #714. Why: the 0.2 gate's acceptance rows. coverage-11 (#632, #696) runs F-2101's client search
(`remote-oss/remote-ssh#19`) once per client launch, and every one of those launches connects. Six ACs need more than
that:
- a client that fails or prints nothing;
- a connect that stops before any client runs;
- a reload;
- a local window.

This card adds three client cases and three windows rows. Builder: selene. Size: S–M, about 1 agent-day.
**Depends on coverage-14 (#568)** for `userSettings` and `connectionHelpers`. If coverage-14 hasn't merged, add them
to `windows/harness.ts` as coverage-14 §1 says, and tell iris on #568.

## 1. The fake clients (`tools/acceptance-clients.ts`)

`FakeClient` gains `vanishes?: boolean`. Two fakes join `FAKE_CLIENTS`:

| Folder | Banner | Stream | Status | Mode | `vanishes` |
|---|---|---|---|---|---|
| `silent` | `''` | `stderr` | 0 | `0o755` | — |
| `vanishing` | `OPENSSH_BANNER` | `stderr` | 0 | `0o755` | `true` |

`clientScript` changes in two ways:
- **An empty banner prints nothing:** the check branch has no `printf` line, so a check with `-V` writes no byte to
  either stream.
- **A vanishing client deletes itself:** in the check branch, after its banner and before its `exit`, it runs
  `rm -f "$0"`. Every later call finds no program.

**Tools rows** (`acceptance-clients.test.ts`):
- the `silent` script has no `printf` in its check branch, and run with `-V` it prints nothing and exits 0;
- the `vanishing` script, run with `-V` in a temporary folder, prints its banner and the file is gone afterwards;
- every other fake's script is unchanged (compare with today's text for `path`).

## 2. The client cases (`tests/acceptance/suite-client/cases.json`)

**`ClientCase` changes** (`tools/acceptance-launches.ts`, and the suite's own interface):
- `used` becomes `string | null`, where `null` means no program was used for the lookup or the connection;
- `dialog?: string` is the failure dialog's text, for a case that fails;
- `script?: ScriptEntry[]` holds the case's answers.

`tools/acceptance.ts` writes each client case's script file (`launchFiles(runFolder, <label>).script`) with
`{entries: <script or []>}`, as it does for the failure cases.

**`recordAfterDialog`** moves from `suite-failure/failure-window.test.ts` into `suite-local/script.ts`, exported, and
both suites import it (no copy: `pnpm dupes` would fail).

**The three cases**, after the existing ones. `<dialog script>` is `failureDialog` `"harness"` → `dismiss`, then
`mitigationPick` `Pick an action to help resolve the problem.` → `dismiss`.

| Label | Cite | Setting | Settings | Checked | Used | Dialog | Script |
|---|---|---|---|---|---|---|---|
| `client-silent` | F-2101 AC-20 | `<run>/clients/silent/ssh` | — | `silent/ssh`, `path/ssh` | `path/ssh` | — | — |
| `client-vanishing` | F-2101 AC-19 | `<run>/clients/vanishing/ssh` | — | `vanishing/ssh` | `null` | `Could not establish connection to "harness".` | `<dialog script>` |
| `client-platform-escape` | F-2101 AC-28 | `<run>/clients/configured/ssh` | `{"remote.SSH.useLocalServer": false}` (no `remote.SSH.remotePlatform`) | none | `null` | `Could not establish connection to "harness": Connecting was canceled.` | `platformPick` `"harness"` → `dismiss`, then `<dialog script>` |

**The rows** (`client.test.ts`):
- **Connected cases** keep today's rows unchanged.
- **The calls row** for a case with `used: null` expects exactly the `checked` lines: no `options` or `connect` line.
  `client-platform-escape` therefore expects an empty `calls.log`.
- **A case with a `dialog`** waits for `recordAfterDialog()`. Its rows replace "the window connected" and "no
  notification or dialog":
  - `` `${cite} (${label}): the connect failed with the case's dialog` ``: the `failureDialog` line's question is the
    case's `dialog`;
  - `` `${cite} (${label}): the dialog has Close Remote, Retry and More Actions...` ``: its `buttons` are
    `["Close Remote", "Retry", "More Actions..."]`;
  - `` `${cite} (${label}): no notice` ``: the record has no `notice` line. That's S009 and S074 for AC-19.
- **`client-silent` only**, a row
  `F-2101 AC-20 (client-silent): the window connected within 30 s of the connect's first progress line`: the
  `Date.now()` of the row, minus the `time` of the record's first `progress` line, is at most 30 000 ms. Its "no
  notification or dialog" row is AC-20's "neither S009 nor S074".

## 3. The windows rows (`tests/acceptance/windows/client-search.test.ts`, window `cs1`)

**Before the file:**
- close every window of the earlier files that is still open;
- wait until `connectionHelpers()` is empty (bounded at 60 s);
- keep the user settings' bytes, and write them back after the file whatever failed.

**Terms:**
- **`C(name)`** is `<run>/clients/<name>/ssh`, with `<run>` from `variable('HARNESS_RUN_FOLDER')`.
- **"New calls"** are the lines of `callsLogOf(<run>)` added since the step began. The file still holds the last
  client launch's lines, so count from the step's own start.
- **"New log lines"** are the lines of `connectionLog()` added since the step began. Compare them as the log writes
  them, through `redact(line, [])` from lib-log, as `client.test.ts`'s `logged` does.
- **"Connected"** is coverage-14 §2's.

| Cite | Steps | Assertions |
|---|---|---|
| F-2101 AC-14 | `userSettings({'remote.SSH.path': C('configured')})`. Open `cs1` on `harness`, and wait until it's connected. Note `connectionHelpers()` | the new calls are `configured/ssh\tcheck`, `configured/ssh\toptions`, `configured/ssh\tconnect`, in that order |
| F-2101 AC-14 | `userSettings({'remote.SSH.path': C('fails')})` (a client whose check fails). Reload `cs1` | `cs1` is connected; there are no new calls; no new log line is a `checkingLine(…)`; the helper is the same process. Close `cs1`, and wait until no helper runs |
| F-2101 AC-15 | `userSettings({'remote.SSH.useLocalServer': false, 'remote.SSH.remotePlatform': {harness: 'linux'}, 'remote.SSH.path': C('fails')})`. Open `cs1` on `harness` | connected; the new calls are exactly one `fails/ssh\tcheck`; the new log lines hold `notValidLine(C('fails'))` once |
| F-2101 AC-15 | reload `cs1` | connected; since the reload, again exactly one `fails/ssh\tcheck` and one `notValidLine(C('fails'))`. The PATH client was used: the window is connected and no fake logged an `options` or `connect` call. Close `cs1` |
| F-2101 AC-16 | the settings back to the kept bytes, then `userSettings({'remote.SSH.path': C('configured')})`. In `local`, run `opensshremotes.openEmptyWindow`, with a script entry `hostPick` → `dismiss` for `local` | a `hostPick` line of `local`; no new calls; no new log line is a `checkingLine(…)` or a `usingLine(…)` |

If `variable('HARNESS_RUN_FOLDER')` throws in the windows launch, pass the variable to the plain launches in
`tools/acceptance.ts` with a tools row, and say so in the PR.

## 4. The catalogue

In `docs/architecture/catalogue/coverage-slice1.tsv`, F-2101 AC-14, 15, 16, 19, 20 and 28 go from `todo` to
`acceptance`. The "Retry" form of AC-15 rests on the reload row: Retry reloads the window the same way. Name that in
the PR. The dialog's look is core's.

## 5. Done when

The repository's gates pass, the changed tools files are at 100 %, and `pnpm test:acceptance:vscodium` passes with the
three new client launches and the new windows file. Paste the `client-silent`, `client-vanishing`,
`client-platform-escape` and `windows` summaries. If a row fails because the extension does something else, don't
change the row: report it on #714.

## 6. Review

PR title `tests: the client-search rows of F-2101 that need a reload, a failure or a local window (card coverage-31,
#714)`. themis or triton reviews; athena gives the tag check.

## 7. Open rows (stop and report on #714)

1. `client-platform-escape` logs a client call: the check runs before the platform pick. Paste `calls.log` and the log.
2. `client-vanishing` ends with a dialog other than the case's, or with a notice. Paste the record.
