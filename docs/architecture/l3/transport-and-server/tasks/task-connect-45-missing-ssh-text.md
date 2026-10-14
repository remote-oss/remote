# Task card connect-45: a missing ssh shows "An SSH installation couldn't be found"

Issue: #733. Release 0.2, **gating**: F-2101 AC-21 (`remote-oss/remote-ssh#25`) is a slice-1 criterion. Size: S.
Builder: selene. Found by coverage-26's card writer (#724).

## 1. The defect

**What the spec says:** F-2101 AC-21: when no candidate passes the check, the attempt fails with the text "An SSH
installation couldn't be found" (STR:S009) shown to the user. No connection program is run, and nothing is stored.

**What main does:**
- `packages/remote-ssh/src/pipeline/locate-step.ts` fails with `{kind: 'prerequisiteMissing', reason: {id: 'S009'}}`.
  The row `F-2101 S009: no accepted client fails with the missing-installation reason, and keeps nothing`
  (`locate-step.test.ts`) proves that part, and the "nothing run" and "nothing stored" halves.
- `surfaces/failure-strings.ts` has no `S009` in `FailureStringId` or `FAILURE_TEMPLATES`, so `reasonText` answers
  `undefined` (`isKnownId` is false).
- So the dialog reads `Could not establish connection to "<alias>".`, without the reason.

## 2. The fix

1. In `failure-strings.ts`:
   - add `'S009'` to `FailureStringId`, in id order;
   - add `S009: "An SSH installation couldn't be found"` to `FAILURE_TEMPLATES`, in id order. That's the spec's text
     as it stands, with no full stop: the presenter adds one.
2. Add the template as a key, with the English text as its value, to every `packages/remote-ssh/l10n/bundle.l10n*.json`,
   in the place the bundles' ordering gives it (as S071 was added by connect-38).
3. Run `pnpm check-string-tables` and make sure it passes.

Nothing else changes.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `failure-strings.test.ts` | the existing `F-2304, F-2601: the table holds the ids …` row | the key list | gains `'S009'` first |
| `failure-presenter.test.ts` | `F-2101 AC-21: a missing ssh shows its text in the dialog` | `textFor({reason: {id: 'S009'}})`, beside the S094 row | `Could not establish connection to "box": An SSH installation couldn't be found.` |
| `string-ids.test.ts` (new) | `contracts §3.2: every string id the remote-ssh sources name has a template` | read each `.ts` file under `packages/remote-ssh/src` (find the package as `docs.test.ts` does, `path.join(import.meta.dirname, '..', '..')`), and collect every match of `` id: ['"](S\d{3})['"] ``, in every form: a `reason: {id: …}`, a `FailureReason` constant, a nested value, a `logged(…, {id: …})` argument or an `ownText` reference | each id is a key of `FAILURE_TEMPLATES`, `PROMPT_TEMPLATES` or `OWN_TEMPLATES`, their union. Export `PROMPT_TEMPLATES` from `prompt-strings.ts` for it. The row fails on main for S009 only (dike measured it on #735); paste that run in the PR |

**Defect rule:** the `F-2101 AC-21` row and the `string-ids.test.ts` row must fail on main and pass with the fix. Paste both runs.

## 4. Catalogue

In `docs/architecture/catalogue/coverage-slice1.tsv`, set `F-2101.AC-21` from `todo` to `unit`.

## 5. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-string-tables, check-identifiers,
check-coverage and coverage, with the changed files at 100 %. Use the PR title
`remote-ssh: a missing ssh shows "An SSH installation couldn't be found" (card connect-45, #733)`. themis or triton
reviews; athena gives the design check.

## 6. Open rows (stop and report on #733)

1. The `string-ids.test.ts` row finds an id other than S009 with no template. List it on #733, and don't add its text by guess.
2. An id is built in a form the pattern can't see (a template literal or a computed id). Report the form you found.
