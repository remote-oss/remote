# Task card tooling-07: the listed-files rule does not depend on leftover build output

Why (#226): `checkConsumerProgram` in `tools/check-workspace.ts` skips every listed `.d.ts`. On a tree where a
library's declaration output (`packages/<lib>/.tsc/`) is left from an earlier `pnpm typecheck`, a consumer that
declares the library but has no project reference to it resolves the library's `exports` `types` entry to that
output: `tsc --listFilesOnly` lists `.tsc/**/*.d.ts` and no source, and the check passes. CI starts from a clean
checkout, where the same consumer compiles the library's sources and the check fails. Reproduced on main at 36481a0
by removing the `lib-ssh` references from `tests/acceptance/server/tsconfig.json`: `pnpm check-layout` passes after
`pnpm typecheck` and fails after the `.tsc` folders are removed. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`tools/check-workspace.ts` and `tools/check-workspace.test.ts`. Nothing else changes.

## 2. Contract

- Exported signatures are unchanged: `checkWorkspace(root: string): string[]`.
- In `checkConsumerProgram(owner, config)`, a listed path ending in `.d.ts`, outside `node_modules`, whose real path
  is inside another workspace package `other` (the same `isInside(this.realDirectory(candidate), real)` test the
  source rule uses) is a declaration hit on `other`.
- A declaration hit is a problem only when both hold: `owner` declares `other` as a `workspace:` dependency
  (`declaredDependencyNames(owner)`), and `other` is not among the packages that `config` reaches through project
  references, followed transitively. To follow them: start at `config`; for each project parsed with
  `typescript.getParsedCommandLineOfConfigFile`, take each entry of `projectReferences`, record
  `this.packageAt(path.resolve(reference.path))` when it is not undefined, and continue with the config file at
  `typescript.resolveProjectReferencePath(reference)`; visit each config file once. Put this in one new private
  method `referencedPackages(config: string): Set<WorkspacePackage>`. A config that cannot be parsed contributes no
  packages (its parse errors are already reported by `checkTsconfig`).
- Transitive references count: `packages/remote-ssh/tsconfig.json` reaches `lib-host` only through `lib-server`'s
  reference, and a clean `pnpm typecheck` accepts that. `tsconfig.test.json` reaches its libraries through
  `./tsconfig.json`.
- A package reached only through declarations of another library (lib-host through lib-server's output, for a
  package that does not declare lib-host) is not a problem.
- Message, one per package per config, sorted by package name, after the existing source messages of the same
  config:
  `` `${where}: resolves ${other.name} through its declaration output; ${owner.name} declares ${other.name} but is missing a reference to ${other.manifestDir}` ``
- A package already named by the source rule for this config is not named again by the declaration rule.

## 3. Test table

All rows are `it` cases in the `describe('the listed-files rule')` block of `tools/check-workspace.test.ts`, reusing
`declarationProjects()` and `this.timeout(10_000)`. "Emitted" means the test writes
`packages/lib-x/.tsc/src/index.d.ts` with `export declare const x = 1;` before calling `problems()`.

| Given | Expected |
|---|---|
| remote-a declares lib-x, no reference, lib-x emitted | exactly the declaration message for `packages/remote-a/tsconfig.json` and lib-x |
| remote-a declares lib-x, no reference, lib-x not emitted | exactly the existing source message (`compiles lib-x sources; …`), and no declaration message |
| remote-a declares lib-x, references `../lib-x`, lib-x emitted | `[]` |
| remote-a's `tsconfig.test.json` references only `./tsconfig.json`, which references `../lib-x`; lib-x emitted; the test file imports lib-x | `[]` (transitive) |
| remote-a references `../lib-y` only; lib-y references `../lib-x` and re-exports `x`; remote-a declares lib-x and lib-y; both emitted | `[]` (transitive through another package) |
| remote-a declares only lib-y; lib-y's emitted declaration imports lib-x; remote-a references lib-y; both emitted | `[]` (lib-x is not declared by remote-a) |
| a reference cycle between two configs (A references B, B references A) | the walk ends; no problem from this rule |
| the current tree after `pnpm typecheck` (`pnpm check-layout`) | `check-layout: ok` |
| the current tree after `pnpm typecheck`, with the two `lib-ssh` references removed from `tests/acceptance/server/tsconfig.json` (by hand, not committed) | the declaration message for that config and lib-ssh; state the output in the PR |

## 4. Rule for the worker

As card log-01. No change to the source rule's messages or to any other check. The tools ratchet may only rise.

## 5. Gates and review

PR title `tooling: the listed-files rule sees declaration output (card tooling-07, #226)`.

## 6. Open rows

None. If a row of section 3 cannot pass with the contract of section 2, stop and report the row and the output.
