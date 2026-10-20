# Task card coverage-51: F-1101's and F-1102's criteria in the containers coverage file (ports)

Containers increment 2, ports. Size: S. Builder: `task:local` (selene). Specs: remote-oss/remote-containers#42
(F-1101, `spec:reviewed`, 40 criteria) and #58 (F-1102, `spec:reviewed`, 31 criteria). Design: athena's ports rulings
on #1204, ruling 8: the release-1 file. Everything is decided here. If what you find differs, comment on this issue
and stop.

## 1. The changes

1. `tools/spec-acceptance-criteria.ts`, `CONTAINERS_RELEASE_ONE_FEATURES`: add `'F-1101'` and `'F-1102'` after
   `'F-0906'`, before `'F-1401'`.
2. `docs/architecture/catalogue/coverage-containers-r1.tsv`: right after the last `F-0906.` line, one line per
   criterion, all of F-1101's in order and then all of F-1102's. **Don't run `seed-coverage`.** Take the ids from the
   issues:
   ```sh
   gh issue view 42 -R remote-oss/remote-containers --json body -q .body | grep -oE '^- \*\*F-1101\.AC-[0-9]+\*\*' | sed -E 's/^- \*\*(.*)\*\*$/\1/'
   gh issue view 58 -R remote-oss/remote-containers --json body -q .body | grep -oE '^- \*\*F-1102\.AC-[0-9]+\*\*' | sed -E 's/^- \*\*(.*)\*\*$/\1/'
   ```
   They must print 40 and 31 ids. Tags:

   | Criteria | Tag | Reason |
   |---|---|---|
   | F-1101 AC-4, AC-19, AC-27 | `deferred` | `containers release 1: later (Compose)` |
   | F-1101 AC-23, AC-29 | `deferred` | `containers release 1: later (remote engines)` |
   | every other F-1101 and every F-1102 criterion | `todo` | (empty) |

3. `docs/architecture/catalogue.tsv` and the `F-1101` and `F-1102` objects in
   `docs/architecture/catalogue/remote-containers-*.json`: `label` becomes `spec:reviewed`, and `acCount` becomes 40
   and 31.

## 2. Checks

- `node tools/check-coverage.ts` passes. If it reports anything about F-1101 or F-1102, comment on this issue with the
  output and stop.
- `pnpm test` in `tools/` passes, and the whole diff is linted.

## 3. Done when

The checks pass. PR title: `docs: F-1101's and F-1102's criteria in the containers coverage file (card coverage-51,
#1229)`. Request athena only.
