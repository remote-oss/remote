# Task card coverage-10: the failure-window rows of F-2601 and F-2304 (batch 1 of #142's acceptance rows)

Issue: #546. Why: #142's acceptance rows, batch 1 (hermes's order: highest risk to the 0.2 gate first), from
coverage-03's lists (#481, #522). Eight ACs are shown by a failed connect's window, the pattern of
`tests/acceptance/suite-failure/` (one launch per case of `cases.json`, answered from the case's own script, checked on
the record). Four small harness additions make them observable. Builder: selene, or hestia (hermes assigns). Size: about
1 agent-day.

| AC | What the row shows |
|---|---|
| F-2601 AC-2 | the failure dialog's buttons, as passed: `Close Remote`, `Retry`, `More Actions...`, and no other (left to right and the focus are core's rendering) |
| F-2601 AC-14 | after the pick of actions is dismissed, nothing more is asked |
| F-2601 AC-25 | the host-key pick answered `Cancel` (`no`): `Could not establish connection to "stranger".` |
| F-2601 AC-30 | `remote.SSH.showLoginTerminal` true and the refused host: the same dialog text as AC-1 |
| F-2601 AC-31 | dismissing the dialog opens the pick of actions, as `More Actions...` does (the existing AC-12, AC-13 row) |
| F-2304 AC-14, AC-27 | the host-key pick dismissed (Escape; a palette opening is the same dismissal): the dialog comes within 1 500 ms of the pick and has no "Connecting was canceled" |
| F-2304 AC-22 | a refused connection: the dialog comes within 2 000 ms of the progress starting |

## 1. The harness additions

**A case's own label and settings** (`tools/acceptance-launches.ts`, `FailureCase`):
- `label?: string`: the launch is `failure-<label ?? alias>`, so one alias can run twice. Labels must be unique, and
  must match `LABEL_FORM`. A repeat throws `two failing connects share the label "<label>"`;
- `settings?: Record<string, unknown>`: given to the launch's `settings`, as tooling-16's table already takes them;
- the launch's `environment` gains `HARNESS_FAILURE_CASE: <label ?? alias>`;
- `suite-failure/failure-window.test.ts` finds its case by `process.env.HARNESS_FAILURE_CASE` (matched against
  `label ?? alias`), no longer by the folder's authority.

**Record lines** (`packages/remote-ssh/src/surfaces/scripted-adapters.ts`, `RecordLine`):
- every line gains `time`, the `Date.now()` of the append;
- a `failureDialog` line gains `buttons`: the labels passed to `showError`, in order.

`RecordLine` in `tests/acceptance/suite-local/script.ts` mirrors both fields.

**Cites (daedalus's ruling on #546, option A).** A case's `cite`, a `bound.cite` and a row name may join several
features' cites with `, ` and may end in a lower-case case label in parentheses, then `:` or the end:
`F-2601 AC-6, F-2304 AC-14, AC-27` and `F-2206 AC-16 (platform-out-of-enum-solaris): …` both count. This card's PR
(#546) extends `tools/check-coverage.ts` to that grammar:

```ts
const FEATURE_CITE = String.raw`F-\d{4}[ .]AC-\d+(?:, ?AC-\d+)*`;
const CITE_PATTERN = new RegExp(
  `^(${FEATURE_CITE}(?:, ${FEATURE_CITE})*)(?: \\([a-z0-9-]+\\))?(?::|$)`,
);
```

- `citedBy` reads each `/(F-\d{4})[ .]AC-(\d+)((?:, ?AC-\d+)*)/g` match of group 1, in order;
- `casesCites` also reads `bound.cite`;
- unit rows in `tools/check-coverage.test.ts`:
  - a two-feature cite;
  - a cite with a label, then `:`;
  - a label with no AC before it cites nothing;
  - an upper-case label isn't one: `F-2206 AC-1 (Foo):` cites nothing;
  - `bound.cite` is counted.

The tool change and this card ship together.

**A timing bound per case** (`FailureCase.bound?: {from: string; milliseconds: number; cite: string}`): the dialog's
`time` minus the `time` of the first record line whose `surface` is `from` must be at most `milliseconds`.

## 2. `cases.json`

Keep the three cases, with these changes:

| Case | Change |
|---|---|
| `refused` | `bound: {from: 'progress', milliseconds: 2000, cite: 'F-2304 AC-22'}` |
| `stranger` | cite becomes `F-2601 AC-6, F-2304 AC-14, AC-27`; `bound: {from: 'pick', milliseconds: 1500, cite: 'F-2304 AC-14'}` |

And add these:

| `label` | `alias` | `cite` | `settings` | `script` | `dialog` |
|---|---|---|---|---|---|
| `refused-shown` | `refused` | `F-2601 AC-30` | `{"remote.SSH.showLoginTerminal": true}` | as `refused`'s | `Could not establish connection to "refused".` |
| `stranger-cancel` | `stranger` | `F-2601 AC-25` | none | `pick` `has fingerprint` → `no`, then `failureDialog` `"stranger"` → `dismiss`, then `mitigationPick` → `dismiss` | `Could not establish connection to "stranger".` |

F-2601 AC-7 and F-2304 AC-13 (the platform pick dismissed) aren't in this card. selene's run found that the
dialog lacks `Connecting was canceled`, a product defect: connect-27 (#559) fixes it and brings that case back.

## 3. The rows (`suite-failure/failure-window.test.ts`, run in every failure launch)

Keep the existing rows, renaming the third to `F-2601 AC-12, AC-13, AC-31: …` (rest unchanged). Add:

| Name | Assertion |
|---|---|
| `F-2601 AC-2: the dialog has exactly Close Remote, Retry and More Actions..., in that order` | the `failureDialog` line's `buttons` equal `['Close Remote', 'Retry', 'More Actions...']` |
| `F-2601 AC-14: once the pick of actions is dismissed, nothing more is asked` | 5 s after the `mitigationPick` line, the record's last line is still that `mitigationPick` line |
| `` `${bound.cite}: the dialog came within ${bound.milliseconds} ms of the ${bound.from}` `` (only for a case with `bound`) | as section 1 says |
| `F-2304 AC-14: the dialog of a dismissed host-key pick never says "Connecting was canceled"` (only for `stranger`) | the dialog doesn't contain `Connecting was canceled` |

`coverage-slice1.tsv`: tag F-2601 AC-2, 14, 25, 30, 31 and F-2304 AC-14, 22, 27 `acceptance` (check-coverage reads
`cases.json` cites and the `it(` names).

## 4. Done when

- `pnpm test:acceptance:vscodium` (under `xvfb-run --auto-servernum`) passes with the two new launches; paste the
  failure launches' summaries in the PR body;
- `pnpm test:unit`, the tools rows for the label, settings and environment (a repeat label throws; a case's settings
  and `HARNESS_FAILURE_CASE` reach its launch), lint, typecheck, dupes, coverage and check-coverage pass.

If a dialog text differs from the table, don't change the table's text: report the actual text on the issue (it's a
spec question or a bug).

## 5. Review

PR title `tests: the failure-window rows of F-2601 and F-2304 (card coverage-10, #142)`. themis or triton, and athena for
the record's new fields.
