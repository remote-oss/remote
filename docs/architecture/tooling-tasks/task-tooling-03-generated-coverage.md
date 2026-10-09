# Task card tooling-03: one coverage rule for generated files

Why: `src/identifiers.generated.ts` is 0 % covered in a package until something imports it, and per-package
exclusions by name repeat. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`tools/coverage.ts` and its tests; the README's coverage section (one sentence).

## 2. Contract

Files matching `**/*.generated.ts` are excluded from every unit's coverage measurement by rule, and a `coverage.json`
that lists such a file by name is reported as a problem ("covered by the generated-file rule; remove the entry").
The exclusion check still fails on a stale or unexplained named exclusion as before.

## 3. Test table

| Given | Expected |
|---|---|
| a package with `src/x.generated.ts` uncovered and no exclusion entry | coverage passes the gate on the other files; the generated file is not counted |
| a `coverage.json` naming `src/x.generated.ts` | problem reported, exit 1 |
| a non-generated uncovered file without an entry | fails the gate as before |
| the existing fixtures of the exclusion checks | unchanged results |

## 4. Rule for the worker

As card log-01; the tools ratchet may only rise.

## 5. Gates and review

PR title `tooling: generated files excluded from coverage by rule (card tooling-03)`.

## 6. Open rows

None.
