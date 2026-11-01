# The coverage files: tags, and how a line is set to `open`

Each `coverage-*.tsv` has one line per acceptance criterion: `ac`, `tag`, `reason`. `node tools/check-coverage.ts`
checks the files against the rows (`pnpm check-coverage`), and `pnpm coverage-table` prints every criterion with the
tag it counts as (never committed).

## The tags

- `acceptance`, `unit`, `todo`: set by hand, as before. A tag claims **every clause** of the criterion (the clause
  rule, #1353 and #1357): `acceptance` needs an acceptance row citing the criterion, `unit` any row.
- `recorded`, `core`, `deferred`: as before; `core` and `deferred` carry a reason.
- `open`: the criterion's clause table is in this PR, and the line names, in its reason, the acceptance rows that
  will assert the clauses, by their case labels: `(first-case), (second-case)`.

## What `open` does

A line set to `open` counts as `acceptance` once **every** row it names exists in `tests/acceptance` and cites the
criterion with that case label. Until then it counts as `todo`, and `check-coverage` prints a note naming the missing
rows. The check cannot read a run: a row that fails fails the PR's own launch, and a skipped row (`it.skip`) is not
seen, so it counts as missing.

The derivation applies a decision a person recorded; it never makes one. `open` is set only in a PR that carries the
line's clause table, and that PR's design and tag check reviews it like any tag change. The `coverage-table` diff of
the PR shows what changed.

## Rows that prove a part

A row whose case label ends in `-half` or `-part` proves part of a criterion, and never counts towards an `open`
line. A row that cites an `open` criterion with another partial word in its label (`half`, `part`, `clause`, `only`)
fails the check: end the label in `-half` or `-part`. A line may not name a partial row.

## Setting a line to `open`

1. Write the clause table in the PR: each clause, the row that asserts it, the result.
2. Set the line to `open`, with the rows' case labels as its reason.
3. When the rows land and pass, the line counts as `acceptance` with no further edit to the file.
