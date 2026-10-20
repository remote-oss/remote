# Task card coverage-50: F-0417's criteria in the containers coverage file (shutdown, C9)

Containers increment 2, shutdown. Size: S. Builder: `task:local` (selene). Spec: remote-oss/remote-containers#62
(F-0417, `spec:reviewed`, 71 criteria, AC-1 to AC-71). Design: athena's C9 ruling on #737. The first cards cover image
and Dockerfile configurations; Compose's halves stay with F-0413 (later). Everything is decided here. If what you find
differs, comment on this issue and stop.

## 1. The changes

1. `tools/spec-acceptance-criteria.ts`, `CONTAINERS_RELEASE_ONE_FEATURES`: add `'F-0417'` after `'F-0416'`.
2. `docs/architecture/catalogue/coverage-containers-r1.tsv`: right after the last `F-0416.` line, one line per
   criterion, `F-0417.AC-1` to `F-0417.AC-71` in order. **Don't run `seed-coverage`.** Check the ids against the issue:
   ```sh
   gh issue view 62 -R remote-oss/remote-containers --json body -q .body | grep -oE '^- \*\*F-0417\.AC-[0-9]+\*\*' | sed -E 's/^- \*\*(.*)\*\*$/\1/'
   ```
   It must print 71 ids. Tag each line as follows, with the reason text exactly as written (the file already uses
   each one):

   | Criteria | Tag | Reason |
   |---|---|---|
   | AC-10, 11, 13, 15, 16, 18, 38, 39, 40, 41, 42, 47, 48, 49, 52, 53, 59, 63, 64 | `deferred` | `containers release 1: later (Compose)` |
   | AC-14, 44, 71 | `deferred` | `containers release 1: later (attach)` |
   | AC-29, 31, 32 | `deferred` | `containers release 1: later (remote engines)` |
   | AC-30, 33, 34, 36, 37 | `deferred` | `containers release 1: later (Windows, WSL and macOS)` |
   | AC-20 | `deferred` | `containers release 1: later (multi-root)` |
   | AC-54 | `deferred` | `containers release 1: later (Reopen Folder Locally)` |
   | AC-55 | `deferred` | `containers release 1: later (Switch Container, F-0407)` |
   | every other criterion | `todo` | (empty) |

3. `docs/architecture/catalogue.tsv` and the `F-0417` object in `docs/architecture/catalogue/remote-containers-*.json`:
   `label` becomes `spec:reviewed`, and `acCount` becomes 71 if it isn't already.

## 2. Checks

- `node tools/check-coverage.ts` passes. If it reports a row that cites an F-0417 criterion, or an acceptance row whose
  name starts with `F-0417` and cites no AC, comment on this issue with the output and stop.
- `pnpm test` in `tools/` passes, and the whole diff is linted.

## 3. Done when

The checks pass. PR title: `docs: F-0417's criteria in the containers coverage file (card coverage-50,
#1224)`. Request athena only.
