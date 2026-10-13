# Task card connect-44: with no CLI source, the log says once that the CLI path was not used

Issue: #689. Release 0.2, not gating. Size: S. Builder: assigned by hermes. Spec: F-3902 AC-6 (remote-oss/remote-ssh#79,
rule 5 (iii)). Found while building coverage-17 (#581, PR #688), which left AC-6 `todo` for it.

## 1. The defect

**The rule:** F-3902 AC-6 says that with no `cliDownloadUrlTemplate` in the product (VSCodium's case) and
`remote.SSH.useExecServer` true, the host ends with `bin/<commit>/` and no CLI, and "the log says once that the CLI was
not used because the editor names no CLI source".

**What main does:** `packages/remote-ssh/src/pipeline/server-steps.ts` logs that line from the planner's notes
(`the CLI path was not used: ${CLI_NOT_USED_REASONS[note.reason]}`), and `noCliSource` maps to
`the editor names no CLI source`. But the step passes the planner a `cliMode` only when `cliAddressOf` finds an address.

With no template, `cliAddressOf` answers `{kind: 'none'}`. Then:
- `cliMode` is left out;
- lib-server's `decideCliMode` never runs, so there's no `noCliSource` note and no log line.

## 2. The fix

In `server-steps.ts`'s plan step, pass `cliMode` when the CLI source is an address **or `none`**, unless the call is a
`direct` re-plan (`options?.direct === true`). With `none`:
- `cliMode.cliTemplate` is `''` (`profile.cliDownloadUrlTemplate` as it is), so `decideCliMode` answers
  `{kind: 'direct', reason: 'noCliSource'}` and the plan carries the note;
- `cliName` and `cliPresentOnHost` are passed as for an address. The planner doesn't use them on a direct plan. If the
  types demand an address-only shape, make the CLI fields optional in the step's own parameter, not in lib-server.

An `unusable` template keeps its own existing line ("the CLI template is unusable") and no `cliMode`. With
`useExecServer` false, the decision's `settingOff` isn't logged, as today: `CLI_NOT_USED_REASONS` excludes it.

**Once per connect:** the plan runs once per connect, but a CLI-path failure re-plans with `direct: true`, which this
fix leaves without `cliMode`. So the line can't appear twice.

Export the line's builder, `cliNotUsedLine(reason)`, from `server-steps.ts` (coverage-17's card asked for it), and use
it for both the notes and the `unusable` line, so the rows build the expected text from it.

## 3. Rows

**Unit rows** (`server-steps.test.ts`):

| Cite | Given | Expected |
|---|---|---|
| F-3902.AC-6 | a profile with `cliDownloadUrlTemplate: ''`, `useExecServer` true, a fresh host | a direct download plan; the log has exactly one line `cliNotUsedLine('noCliSource')` |
| F-3902.AC-6 | the same with `useExecServer` false | no such line |
| F-3902 rule 5 | a template that expands | a CLI plan, no line (unchanged) |
| F-3902 rule 5 | an unusable template | the unusable line once, no `noCliSource` line |
| F-3902.AC-6 | a CLI-path failure's re-plan with `direct: true` after a `none` plan | still one line in all |

**Acceptance row** (coverage-17's design, `tests/acceptance/suite-remote/remote-window.test.ts`): the run's first remote
launch connects with exec server on by default and no CLI source (cli-05's archive is opt-in). Row
`F-3902 AC-6: the host has bin/<commit> and no CLI, and the log says once that the CLI was not used`:
- `onHost` shows `/home/harness/.vscodium-server-insiders/bin/<commit>/` exists, and no `cli/` folder and no CLI file
  in the data folder;
- `connectionLog()` has exactly one line equal to `cliNotUsedLine('noCliSource')`.

It must fail on main (no line) and pass with the fix. Paste both.

Catalogue: F-3902 AC-6 goes from `todo` to `acceptance` in `coverage-slice1.tsv`.

## 4. Gates and review

All gates, `server-steps.ts` at 100 %, and the VSCodium run green. PR title
`remote-ssh: with no CLI source, the log says once that the CLI path was not used (card connect-44, #689)`. themis or
triton reviews; athena gives the tag check.

## 5. Open rows (stop and report on #689)

1. The run's first remote launch takes the CLI path after all (a CLI source set somewhere). Report where it comes from.
2. Passing `cliMode` with an empty template changes any other plan on main (a reuse case, for example). Report the
   row.
