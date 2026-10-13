# Task card connect-27: a dismissed platform pick fails with "Connecting was canceled"

Issue: #559. Why: F-2304 6.5 and AC-13, F-2601 AC-7, F-2501 7.E5 (`remote-oss/remote-ssh#37`, `#68`, `#59`). Dismissing
a picker the extension itself shows during a connect fails the connect with STR:S027 as the reason of F-2601's dialog:
`Could not establish connection to "<alias>": Connecting was canceled.` selene's acceptance run on #546 showed
`Could not establish connection to "harness".` for the platform pick. `terms-steps.ts` fails the dismissal as
`{kind: 'cancelled'}` with no reason. The licence decline already attaches its reason (`connect.ts`,
`reason: {id: 'S027'}`). ssh's own prompts are not the extension's pickers: their dismissal keeps the dialog without a
reason (F-2304 AC-14, AC-27), and this card doesn't touch them. Builder: selene. Size: small.

## 1. Change

`packages/remote-ssh/src/pipeline/terms-steps.ts`, `decideTerms`: when `pickPlatform` gives nothing, return
`{kind: 'failed', failure: {kind: 'cancelled', reason: {id: 'S027'}}}`. Nothing else changes. Every other `cancelled`
(a host channel's cancel, a cancelled transfer, the connect's own cancellation) keeps no reason.

## 2. Rows

| File | Row | Expected |
|---|---|---|
| `packages/remote-ssh/test/unit/terms-steps.test.ts` | rename `fail as cancelled when the user dismisses the picker` to `F-2304 6.5: a dismissed platform pick fails as cancelled with "Connecting was canceled"` | `failure: {kind: 'cancelled', reason: {id: 'S027'}}` |
| `tests/acceptance/suite-failure/cases.json` | the `platform-escape` case of coverage-10 (#546), if #546 merged without it: `alias` `harness`, `label` `platform-escape`, `cite` `F-2601 AC-7, F-2304 AC-13`, `settings` `{"remote.SSH.useLocalServer": false}`, script as coverage-10 §2 | `dialog`: `Could not establish connection to "harness": Connecting was canceled.` |

In `docs/architecture/catalogue/coverage-slice1.tsv`, F-2601 AC-7 and F-2304 AC-13 go to `acceptance` once the
VSCodium run passes with the case.

## 3. Done when

`pnpm test:unit` and the repository's gates pass, and `pnpm test:acceptance:vscodium` passes with `failure-platform-escape`.
Paste its summary.

## 4. Review

PR title `remote-ssh: a dismissed platform pick fails with "Connecting was canceled" (card connect-27, #559)`. themis or
triton reviews; athena gives the design check, since this is product code.
