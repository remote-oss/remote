# Task card coverage-01: the slice's acceptance criteria in one file, and `tools/check-coverage` (#142)

Why: #463; athena's ruling on #142, items 1–3. Every acceptance criterion (AC) of a slice gets exactly one tag in one file,
and a tool check keeps the tags and the test names in agreement, so "done" for #142 and #141 can be checked
mechanically. This card builds the file's format, the check and its CI step, and seeds the file with every slice-1 AC
id. The tags themselves are chosen later, feature by feature (daedalus with athena). Builder: iris.

## 1. Package and file boundary

| File | Change |
|---|---|
| `tools/check-coverage.ts` | new: the check (section 3) |
| `tools/check-coverage.test.ts` | its rows (section 5) |
| `tools/spec-acceptance-criteria.ts` | new: the AC ids of a spec issue body (section 4) |
| `tools/seed-coverage.ts` | new: writes the seed file (section 4); run once by the worker, kept for slice 2 |
| `docs/architecture/catalogue/coverage-slice1.tsv` | new: the seed, every slice-1 AC with the tag `todo` (section 2) |
| `package.json` | `"check-coverage": "node tools/check-coverage.ts"` |
| `.github/workflows/ci.yml` | `- run: pnpm check-coverage` in the `checks` job, after `check-string-tables` |
| `tools/coverage.json` | the new files at the ratchet's 100/100/100 |

## 2. The file

`docs/architecture/catalogue/coverage-slice1.tsv`: UTF-8, tab-separated, a header line, then one line per AC, sorted by
feature id and then by AC number.

```
ac	tag	reason
F-2001.AC-1	todo	
```

- `ac`: `F-<4 digits>.AC-<n>`, exactly as the spec issues write it.
- `tag`: one of `acceptance`, `unit`, `recorded`, `core`, `deferred` (athena's five), or `todo` (not tagged yet).
- `reason`: free text without a tab or a newline. Required, non-empty, for `core` and `deferred` (for `deferred`, it
  names the register entry). Empty for the other tags.

The slice's features are the build order's slice 1 (`docs/architecture/build-order.md`): F-2001, F-2101, F-2102,
F-2201, F-2202, F-2206, F-2301, F-2304, F-2305, F-2306, F-2307, F-2401, F-2403, F-2409, F-2501, F-2502, F-2601,
F-3902, and F-3901 and F-3903, which have no ACs (decision records). The seed holds 602 lines (measured on #142).

## 3. The check (`tools/check-coverage.ts`)

It reads the TSV and the names of every test row:
- **acceptance rows:** every `it(` name in `tests/acceptance/**/*.test.ts`, plus every `cite` field of
  `tests/acceptance/suite-failure/cases.json`;
- **unit rows:** every `it(` name in `packages/*/test/unit/**/*.test.ts`.

A row's **cited ACs** come from the start of its name: `F-2601 AC-12:` cites `F-2601.AC-12`; `F-2601 AC-1, AC-3:` cites
AC-1 and AC-3 of F-2601; `F-2601.AC-12:` (dotted) is read the same. A name or cite that starts with `contracts`, or
with no feature id, cites nothing. Names built at run time (a template literal) are read from their cases file only (the
failure suite's); any other template-literal name is ignored.

It fails, printing every problem on its own line, when:
1. a line of the TSV is malformed: wrong number of fields, an unknown tag, an AC id out of form, a repeated AC, or
   lines out of order;
2. a `core` or `deferred` line has an empty reason, or another tag has one;
3. an AC tagged `acceptance` has no acceptance row citing it;
4. an AC tagged `unit` has no unit row and no acceptance row citing it;
5. a row (acceptance or unit) cites an AC of a slice-1 feature that the TSV doesn't have;
6. **an acceptance row names a slice-1 feature without an AC** (athena on #465): its name or `cite` starts with a slice-1
   feature id followed by anything but ` AC-` or `.AC-`, for example `F-2409:`, `F-2409.BR-7:` or `F-2601 5.0:`. This
   keeps untraceable names from coming back after coverage-02's sweep. A row that proves no AC by itself is named
   `contracts <section>:` instead.

Rule 6 covers **acceptance rows only**. Measured at main 78e461f, 491 unit rows name a slice-1 feature without an AC
(for example `F-2502: a folder in the current window …`). Extending rule 6 to unit rows would need a sweep of its own,
which is athena's call and a separate card.

It **reports, but doesn't fail on**, the count per tag (`todo` included), so the progress shows in CI's log. With the
seed (all `todo`), the check passes. A later `--strict` flag (not in this card) will fail on `todo`.

Exit codes: 0 when it passes, 1 with problems, 2 for a missing or unreadable file. The output is stable (sorted).

## 4. The seed

`tools/spec-acceptance-criteria.ts` exports `acceptanceCriteriaOf(body: string, feature: string): string[]`: the AC ids in
the body's lines that start with `- **<feature>.AC-<n>**`, in body order, each once. `tools/seed-coverage.ts` fetches
each slice-1 feature's spec issue with `gh issue view <n> -R remote-oss/remote-ssh --json body` (the issue numbers are
in `docs/architecture/catalogue.tsv`'s `issue` column), and writes the TSV with every AC tagged `todo`. Run it once
and commit its output. Its network part is not unit-tested; `acceptanceCriteriaOf` is.

## 5. Test table (`tools/check-coverage.test.ts`)

One assertion per `it`; over a temporary workspace with its own TSV and test files.

| Cite | Given | Expected |
|---|---|---|
| #142 1 | a TSV with only `todo` lines and no tests | it passes |
| #142 1 | the same | the report has `todo: <n>` |
| #142 1 | a line with the tag `done` | it fails naming the line and `unknown tag` |
| #142 1 | a line `F-2601.AC-12	acceptance` with 2 fields only | it fails, `wrong number of fields` |
| #142 1 | `F-2601.AC-3` before `F-2601.AC-12` | it passes (numeric order) |
| #142 1 | `F-2601.AC-12` before `F-2601.AC-3` | it fails, `out of order` |
| #142 1 | the same AC twice | it fails, `repeated` |
| #142 1 | `F-2601.AC-x` | it fails, `AC id out of form` |
| #142 1 | a `core` line with an empty reason | it fails, `needs a reason` |
| #142 1 | a `deferred` line with a reason | it passes |
| #142 1 | an `acceptance` line with a reason | it fails, `reason only for core or deferred` |
| #142 2 | `F-2601.AC-12 acceptance` and an acceptance test `F-2601 AC-12: …` | it passes |
| #142 2 | the same TSV and no such test | it fails, `F-2601.AC-12 is tagged acceptance and no acceptance row cites it` |
| #142 2 | the same TSV and only a unit test citing it | it fails (a unit row doesn't satisfy `acceptance`) |
| #142 2 | `F-2601.AC-12 unit` and a unit test `F-2601 AC-12: …` | it passes |
| #142 2 | `F-2601.AC-12 unit` and only an acceptance row citing it | it passes |
| #142 2 | a test `F-2601 AC-1, AC-3: …` | it cites both (two `acceptance` lines pass) |
| #142 2 | a test `F-2601.AC-12: …` | it cites AC-12 |
| #142 2 | a test `F-2601: …` | it cites nothing |
| #142 2 | a test `contracts V7: …` | it cites nothing |
| #142 2 | `cases.json` with `cite: "F-2601 AC-6"` and the TSV tagging AC-6 `acceptance` | it passes |
| #142 2 | a test citing `F-2601.AC-99`, which the TSV lacks | it fails, `cites F-2601.AC-99, which the slice's file doesn't have` |
| #142 2 | a test citing `F-2407 AC-1` (not a slice-1 feature) | it passes (no problem) |
| athena on #465 | an acceptance test `F-2409: picks a free port` | it fails, `names F-2409 without an AC` |
| athena on #465 | an acceptance test `F-2409.BR-7: …` | it fails the same way |
| athena on #465 | an acceptance test `F-2601 5.0: …` | it fails the same way |
| athena on #465 | a `cases.json` `cite` of `F-2601` | it fails the same way |
| athena on #465 | an acceptance test `F-2407: …` (not a slice-1 feature) | it passes |
| athena on #465 | an acceptance test `contracts V7: …` | it passes |
| athena on #465 | a **unit** test `F-2409: …` | it passes (rule 6 covers acceptance rows only) |
| #142 | a missing TSV | exit code 2 |
| #142 | two problems | both lines are printed, sorted |
| #142 | `acceptanceCriteriaOf` of a body with AC-1, AC-2 and a later line quoting `F-2601.AC-1` | `['F-2601.AC-1', 'F-2601.AC-2']` |

Plus: `pnpm check-coverage` on the repository passes. **Order (athena on #465): coverage-02 (#464) merges first.**
Before it, rule 6 fails on the 42 rows it renames. Build against #464's branch and rebase once it merges.

## 6. Rule for the worker

As card log-01; coverage of the new tools at 100/100/100. The seed's 602 lines are generated, never hand-edited in this
card.

## 7. Gates and review

PR title `tools: check-coverage, and slice 1's acceptance criteria in one file (card coverage-01, #142)`. proteus
reviews the CI line.

## 8. Open rows

- Choosing the tags (602 lines from `todo` to one of the five) isn't this card's. daedalus and athena tag feature by
  feature, in their own PRs.
- The `pull_request` trigger for the cheap acceptance jobs (athena's item 4) is proteus's, not this card's.
