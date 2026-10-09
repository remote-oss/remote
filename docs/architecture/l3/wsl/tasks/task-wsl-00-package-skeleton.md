# Task card wsl-00: the `packages/lib-wsl` package skeleton

Why: the pure parts of the WSL support (brief `../brief-lib-wsl-pure.md`) live in a new library. This card creates
the empty package in the shape of `packages/lib-log` as it is on main (checked 2026-10-09: its `exports` has no
`types` condition, so this card has none either). Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

New: `packages/lib-wsl/package.json`, `tsconfig.json`, `tsconfig.test.json`, `coverage.json`, `README.md`,
`src/index.ts`. Edited: root `tsconfig.json` (two `references` entries), `pnpm-lock.yaml` (the `packages/lib-wsl: {}`
importer, written by `pnpm install`, never by hand). `pnpm-workspace.yaml` lists `packages/*` and needs no edit.
Nothing else. No `vscode` dependency, no `vscode-dts` folder, no `src/testing/` folder.

## 2. Contract

`package.json` is exactly the shape of `packages/lib-log/package.json`:

```json
{ "name": "lib-wsl", "version": "0.0.0", "private": true, "exports": { ".": "./src/index.ts" } }
```

- `tsconfig.json`: `{ "extends": "../../tsconfig.base.json" }`. `tsconfig.test.json`: extends
  `../../tsconfig.base.test.json` with `"references": [{"path": "./tsconfig.json"}]` (both as in lib-log).
- `coverage.json`: `{ "exclude": {}, "ratchet": { "lines": 100, "branches": 100, "functions": 100 } }` (lib-log's
  ratchet; the integrator re-records it with `pnpm coverage:update` after the module cards merge).
- Root `tsconfig.json`: append `{"path": "packages/lib-wsl"}` and `{"path": "packages/lib-wsl/tsconfig.test.json"}`
  after the `packages/lib-authority` pair, in that order.
- `src/index.ts` is only this (the module cards each append their own export line):

```ts
/**
 * @fileoverview lib-wsl: the pure parts of the WSL support: the decoding and parsing of `wsl.exe` text, the
 * distro matching and the path forms of the distro shares. Nothing here starts a process or touches a file.
 */
export {};
```

- `README.md` in the voice of lib-log's: what the library does for a reader of the product (the decoding and parsing
  of `wsl.exe` management text, matching a typed distro name against the registered names, the share path forms);
  one line that it is bundled into the extensions that use it and never published; then a "For maintainers" table
  with rows Maintainers `remote-oss`, Entry points `lib-wsl` (`src/index.ts`), Allowed imports `none` (a later card
  may add `lib-authority`), Coverage exclusions `none`. No process, clean-room or decision wording (ADR-0008).

## 3. Test table

No test file in this card. The checks are the gates of section 5.

| Check | Expected |
|---|---|
| `pnpm install` | succeeds; `pnpm-lock.yaml` gains only `packages/lib-wsl: {}` |
| `pnpm typecheck` | green with the two new references |
| `pnpm check-layout` | green for `packages/lib-wsl` (folder, manifest) |
| `pnpm lint`, `pnpm format:check`, `pnpm dead`, `pnpm dupes` | green |
| `diff` of the five config files against `packages/lib-log` | only the name, the `exports` and the README text differ |

## 4. Rule for the worker

As card log-01; copy, do not redesign; ADR-0002 (TypeScript strict, relative imports with `.ts`, no native modules,
Node target) and ADR-0003 apply to everything the card writes; no comment beyond what the guide requires.

## 5. Gates and review

PR title `lib-wsl: package skeleton (card wsl-00)`; answers R1–R6. Merge this card first; cards wsl-01 to wsl-06
start from its branch or from main after it.

## 6. Open rows (stop and report)

- `docs/architecture/layout.md` ("Libraries") does not list `lib-wsl` though `c4-l2-containers.md` accepts it and
  says a library needs two consumers (`remote-wsl`, `remote-containers`). If `pnpm check-layout` rejects the folder,
  stop and report; do not edit `layout.md` or `tools/`.
- If `pnpm coverage` fails only because the package has no measurable file, stop and report; do not add a dummy
  function or an exclusion.
