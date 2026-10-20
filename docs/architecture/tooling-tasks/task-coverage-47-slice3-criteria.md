# Task card coverage-47: the criteria of Remote - SSH slice 3 in the coverage file (F-2108, F-2509, F-2704)

Release 0.2, slice 3. Size: S. Builder: `task:local` (selene). Brief: `docs/architecture/build-order.md`, "Slice 3".
The three specs are now `spec:reviewed`, so their criterion ids are final:
- remote-oss/remote-ssh#26 (F-2108), 42 criteria;
- remote-oss/remote-ssh#67 (F-2509), 21;
- remote-oss/remote-ssh#77 (F-2704), 33, of which AC-10 is reference-only (its section 13 says so), so it gets no line:
  32.

Everything is decided here. If what you find differs, comment on this issue and stop.

## 1. The changes

1. `tools/spec-acceptance-criteria.ts`, `SLICE_ONE_FEATURES`: add `'F-2108'` after `'F-2106'`, `'F-2509'` after
   `'F-2508'`, and `'F-2704'` after `'F-2605'`.
2. `docs/architecture/catalogue/coverage-slice1.tsv`: add one line per criterion, `<id>\ttodo\t` (tag `todo`, empty
   reason), in AC order. **Don't run `tools/seed-coverage.ts`**: it rewrites the whole file and loses every tag.
   Take the ids from the issues:
   ```sh
   gh issue view 26 -R remote-oss/remote-ssh --json body -q .body | grep -oE '^- \*\*F-2108\.AC-[0-9]+\*\*' | sed -E 's/^- \*\*(.*)\*\*$/\1/'
   gh issue view 67 -R remote-oss/remote-ssh --json body -q .body | grep -oE '^- \*\*F-2509\.AC-[0-9]+\*\*' | sed -E 's/^- \*\*(.*)\*\*$/\1/'
   gh issue view 77 -R remote-oss/remote-ssh --json body -q .body | grep -oE '^- \*\*F-2704\.AC-[0-9]+\*\*' | sed -E 's/^- \*\*(.*)\*\*$/\1/'
   ```
   The counts must be 42, 21 and 33. **Leave `F-2704.AC-10` out**: the spec marks it reference-only, and a
   reference-only criterion has no coverage line. The others it notes (the fish cases of AC-11, AC-12, AC-23,
   AC-24, AC-28 and AC-32) apply with their other causes, so they keep their lines. That gives 42, 21 and 32 lines.
   Where the lines go:
   - the F-2108 lines right after the last `F-2106.` line;
   - the F-2509 lines right after the last `F-2508.` line;
   - the F-2704 lines right after the last `F-2605.` line, before `F-3902.AC-1`.
3. `docs/architecture/catalogue.tsv`: in the rows `F-2108`, `F-2509` and `F-2704`, set `label` to `spec:reviewed` and
   `acCount` to 42, 21 and 32. F-2704's count leaves out the reference-only AC-10; say so in the PR. Do the same in the matching objects of `remote-ssh-23.json` (F-2108),
   `remote-ssh-29.json` (F-2509) and `remote-ssh-30.json` (F-2704): `"label"` and `"acCount"`, nothing else.

## 2. Checks

- `node tools/check-coverage.ts` passes. All the new lines stay `todo`: a `todo` line with rows citing it is fine, and
  the later cards tag them. The check will report two kinds of rows. Fix exactly these and nothing else:
  - **A row citing a criterion that has no line:** `tests/acceptance/server/login-shells.test.ts`,
    `'#443, F-2704 AC-10: two multi-line scripts run one after the other…'`. AC-10 is now the reference-only fish
    timeout, so remove `, F-2704 AC-10` from the name, which becomes `'#443: two multi-line scripts run one after the
    other…'`.
  - **An acceptance row whose name starts with `F-2108`, `F-2509` or `F-2704` and cites no AC:** for example, in the
    same file, `` `F-2704 BR-4: ${layer.title}` `` and `'F-2704 BR-4, #443: every login shell…'`. Move the issue
    reference to the front: `` `#443, F-2704 BR-4: ${layer.title}` `` and `'#443, F-2704 BR-4: every login
    shell…'`.
  If it reports anything else, comment on this issue with the output and stop.
- `pnpm test` in `tools/` passes (the scope tests).
- Lint the whole diff.

## 3. Done when

The checks pass. PR title: `docs: the criteria of Remote - SSH slice 3 in the coverage file (card coverage-47,
#1215)`. Request athena only.
