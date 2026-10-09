# Tooling card tooling-06: consumers compile a library's declarations, not its sources

Why: every package's `package.json` exports `./src/index.ts`, so a consumer's `tsc` program compiles the library's
sources inside its own program (no project reference in the consumer's tsconfig). ADR-0002 decision 4 says the
opposite: `tsc --build` over project references, declarations emitted per project. The gap surfaced 2026-10-08:
remote-ssh importing a type from lib-authority compiled `gate/vscode-api.ts`, whose proposed members are declared
only in lib-authority's `vscode-dts`, and failed with TS2339. The interim ruling (ADR-0007) is a copy of the
declaration files in the consuming extension; this card closes the gap itself. Approval: the architect plus CI
(R-99). Reviewer: `remote-coding-worker-1`.

## 1. File boundary

`tsconfig.base.json`, `tsconfig.json` (the root references), each `packages/*/tsconfig.json` (a `references` entry
per workspace dependency, generated or checked by `tools/check-workspace.ts`), each library's `package.json`
(`exports` with a `types` condition pointing at the emitted declaration entry, the `default` kept at the source for
esbuild), `tools/check-workspace.ts` and its tests. No package source changes.

## 2. Contract

- A consumer's program never compiles a file under another package's `src/`; `check-workspace` fails when it does
  (`tsc --listFilesOnly` per package, every listed path inside the package, `node_modules`, or a referenced
  project's declaration output).
- A library's declaration output is what consumers resolve for `lib-<x>`; the esbuild bundle keeps resolving
  sources.
- `pnpm typecheck` stays one `tsc --build` at the root; incremental outputs stay git-ignored.

## 3. Test table

| Given | Expected |
|---|---|
| remote-ssh importing `Connected` from lib-authority without any `vscode-dts` copy of its own | typecheck passes |
| a package tsconfig missing a reference for a `workspace:` dependency | `check-workspace` names the package and the missing reference |
| `pnpm typecheck` on a clean checkout | passes; a second run is a no-op on build info |
| `pnpm build` (esbuild) | bundles unchanged (byte-identical VSIX contents for remote-ssh-edit) |
| `tools/check-workspace.test.ts` | the listed-files rule has a passing and a failing fixture |

## 4. Rule for the worker

As card tooling-04; no `paths` mapping, no `skipLibCheck` changes.

## 5. Gates and review

PR title `tooling: libraries consumed by declarations (card tooling-06)`.

## 6. Open rows

If `exports` conditions and `tsc --build` cannot be made to agree without `paths`, stop and report the smallest
working alternative.
