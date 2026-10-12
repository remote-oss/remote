# Task card coverage-04: the check reads a template name's cite, and the seed skips removed ACs (#142)

Issue: #478. Why: two gaps hestia found while tagging (coverage-03a, #473), both in coverage-01's tools (PR #467):
- `tools/check-coverage.ts` leaves out every `it(` name that is a template literal with a placeholder. Four F-2202 unit
  rows in `packages/lib-ssh/test/unit/hosts.test.ts` are loops named `` `F-2202.AC-9: an Include after ${…}` `` (also
  AC-10, AC-13 and AC-18). Their cite is fixed text, but the check never sees it, so those ACs can't be tagged.
- `tools/spec-acceptance-criteria.ts` seeds every `- **F-xxxx.AC-n**` line, including ones the spec marks removed:
  `F-2304.AC-26` ("Removed: the trigger of STR:S026 is not known …") and `F-2403.AC-20` ("Removed: replaced by AC-26 …").
  A removed AC has nothing to prove, so it doesn't belong in the coverage file.

**Depends on coverage-01 (PR #467) merged.**

## 1. Files

| File | Change |
|---|---|
| `tools/check-coverage.ts` | a template name's static cite (section 2) |
| `tools/check-coverage.test.ts` | section 4's check rows |
| `tools/spec-acceptance-criteria.ts` | `acceptanceCriteriaOf` skips removed ACs (section 3) |
| `tools/spec-acceptance-criteria.test.ts` | section 4's seed rows |
| `docs/architecture/catalogue/coverage-slice1.tsv` | the two removed lines deleted (section 3) |

## 2. A template name's cite

Today `rowNamesOf` drops a template literal that holds `${`. Change it so such a name is kept as its **static prefix**,
the text before the first `${`. The cite parser then reads that prefix as it reads any name:
- `` `F-2202.AC-9: an Include after ${kind}` `` gives the prefix `F-2202.AC-9: an Include after `, which cites
  `F-2202.AC-9`;
- `` `${name}: …` `` gives the empty prefix, which cites nothing (as today);
- `` `F-2202.AC-${number}: …` `` gives `F-2202.AC-`, which doesn't match the cite pattern, so it cites nothing. For an
  acceptance row, rule 6 then applies to it like any name: a slice-1 feature id followed by anything but ` AC-<n>` or
  `.AC-<n>` fails.

A template without a placeholder is read whole, as today. The cases file's `cite` fields are unchanged.

## 3. Removed ACs

`acceptanceCriteriaOf(body, feature)` skips a line whose text after the bold id starts with `Removed` (after optional
spaces), for example `- **F-2304.AC-26** Removed: …`. Then:
- run `tools/seed-coverage.ts` once more;
- check that the only difference in `coverage-slice1.tsv` is the two lines `F-2304.AC-26` and `F-2403.AC-20` gone, with
  every other line, its tag and its reason unchanged (tags written by #473 and #474 kept);
- if the tool would change anything else, delete the two lines by hand instead, and say so in the PR.

A row that cites a removed AC fails rule 5 ("cites …, which the slice's file doesn't have"). This is intended: it names a
criterion the spec withdrew.

## 4. Test table

One assertion per `it`.

**check-coverage.test.ts**

| Cite | Given | Expected |
|---|---|---|
| #473 | a unit test `` `F-2601 AC-12: case ${name}` `` and the TSV tagging AC-12 `unit` | it passes |
| #473 | an acceptance test `` `F-2601 AC-1, AC-3: ${x}` `` and both tagged `acceptance` | it passes |
| #473 | a unit test `` `${name}: something` `` | it cites nothing |
| #473 | an acceptance test `` `F-2409.AC-${n}: …` `` | it fails, `names F-2409 without an AC` |
| #473 | a unit test `` `F-2409.AC-${n}: …` `` | it passes (rule 6 covers acceptance rows only) |
| #473 | a template with no placeholder `` `F-2601 AC-6: plain` `` | it cites AC-6 |

**spec-acceptance-criteria.test.ts**

| Cite | Given | Expected |
|---|---|---|
| #473 | a body with AC-1, then `- **F-2304.AC-2** Removed: …`, then AC-3 | `['F-2304.AC-1', 'F-2304.AC-3']` |
| #473 | `- **F-2304.AC-2**  Removed: …` (two spaces) | AC-2 is skipped |
| #473 | `- **F-2304.AC-2** Given … then removed` (the word later in the line) | AC-2 is kept |

Plus: `pnpm check-coverage` on the repository passes.

## 5. Gates and review

As card coverage-01, with the new code at 100/100/100. PR title `tools: check-coverage reads a template name's cite, and
the seed skips removed criteria (card coverage-04, #142)`. themis or triton reviews.
