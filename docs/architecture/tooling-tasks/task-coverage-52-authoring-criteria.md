# Task card coverage-52: F-0801's and F-0802's criteria in the containers coverage file (authoring)

Containers increment 2, authoring. Size: S. Builder: `task:local` (selene). Specs: remote-oss/remote-containers#53
(F-0801) and #40 (F-0802), both `spec:reviewed`. Brief: `docs/architecture/l3/containers-engine/brief-increment-2-authoring.md`
§5. Everything is decided here. If what you find differs, comment on this issue and stop.

## 1. The changes

1. `tools/spec-acceptance-criteria.ts`, `CONTAINERS_RELEASE_ONE_FEATURES`: add `'F-0801'` and `'F-0802'` after
   `'F-0505'`, before `'F-0901'`.
2. `docs/architecture/catalogue/coverage-containers-r1.tsv`: right after the last `F-0505.` line, one line per
   criterion, F-0801's in order and then F-0802's. **Don't run `seed-coverage`.** Take the ids from the issues, each id
   once:
   ```sh
   gh issue view 53 -R remote-oss/remote-containers --json body -q .body | grep -oE '^- \*\*F-0801\.AC-[0-9]+[a-z]?\*\*' | sed -E 's/^- \*\*(.*)\*\*$/\1/' | awk '!seen[$0]++'
   gh issue view 40 -R remote-oss/remote-containers --json body -q .body | grep -oE '^- \*\*F-0802\.AC-[0-9]+[a-z]?\*\*' | sed -E 's/^- \*\*(.*)\*\*$/\1/' | awk '!seen[$0]++'
   ```
   Write the counts the commands print in the PR (F-0802 has 37). Tags:

   | Criteria | Tag | Reason |
   |---|---|---|
   | F-0801 AC-11, AC-21, AC-32, AC-33; F-0802 AC-23, AC-32, AC-36 | `deferred` | `containers release 1: later (Compose)` |
   | F-0801 AC-12 | `deferred` | `containers release 1: later (remote engines)` |
   | F-0801 AC-13 | `deferred` | `containers release 1: later (multi-root)` |
   | F-0801 AC-19 | `deferred` | `containers release 1: later (tunnel windows, D-55)` |
   | F-0801 AC-20 | `deferred` | `containers release 1: later (the recovery container)` |
   | F-0801 AC-22, AC-23, AC-28, AC-29 | `deferred` | `containers release 1: later (Windows, WSL and macOS)` |
   | F-0801 AC-25, AC-26, AC-31, AC-34 | `deferred` | `containers release 1: later (virtual workspaces)` |
   | F-0801 AC-27; F-0802 AC-15, AC-17 | `deferred` | `containers release 1: later (volumes and Clone in Volume)` |
   | F-0802 AC-16 | `deferred` | `containers release 1: later (New Dev Container, F-0806)` |
   | every other criterion | `todo` | (empty) |

   F-0801 AC-32 and F-0802 AC-23 and AC-36 have a Dockerfile half that the reuse-chooser card proves with its rows,
   and a Compose half that waits for F-0413 (the brief's ruling 5). The line takes the Compose reason, and the rows stay.
   The criteria that wait for the user's §2 answer (F-0801 AC-3, 5, 8, 17, 40, 41, 42; F-0802 AC-6, 7, 8) stay
   `todo`. Don't tag them anything else.
3. `docs/architecture/catalogue.tsv` and the `F-0801` and `F-0802` objects in
   `docs/architecture/catalogue/remote-containers-*.json`: `label` becomes `spec:reviewed`, and `acCount` becomes the
   count you wrote down.

## 2. Checks

- `node tools/check-coverage.ts` passes. If it reports anything about F-0801 or F-0802, comment with the output and
  stop.
- `pnpm test` in `tools/` passes, and the whole diff is linted.

## 3. Done when

The checks pass. PR title: `docs: F-0801's and F-0802's criteria in the containers coverage file (card coverage-52,
#1237)`. Request athena only.
