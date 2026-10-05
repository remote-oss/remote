# ADR-0002: TypeScript, pnpm workspaces and esbuild for every package

- Status: accepted (the user, 2026-10-05, D-49), with pnpm workspaces in place of the proposed npm workspaces
- Date: 2026-10-05
- Deciders: the user (D-49); proposal by `remote-architect`
- Scope: all packages
- Requirements: D-48 (one repository, one package per extension and per shared library); D-27 and R-73 (the
  conformance runner is the acceptance suite); D-41 (MIT); R-28 (no telemetry)

## Context

Seven extensions and a set of shared libraries are built in one repository by several workers, most of them agents.
The extensions run in the editor's extension host, which runs JavaScript on the Node.js version the editor ships. The
editor's API is published as TypeScript declarations. A feature is accepted when its recorded conformance cases
pass, so the toolchain has to produce an installable VSIX per extension quickly and the same way on a worker's
machine and in CI.

This ADR is written before the specifications are read. It fixes what does not depend on them and lists what does.

## Decision

1. **Language: TypeScript in strict mode for all extension and library code.** No JavaScript sources apart from
   build scripts.
2. **Workspaces: pnpm workspaces** (D-49), one workspace per folder in `packages/`, one lockfile at the root.
   Libraries are private workspaces (`"private": true`), referenced with the `workspace:` protocol and never
   published. The pnpm version is pinned in the root `package.json` (`packageManager`) and CI uses that version.
3. **Bundling: esbuild.** Each extension is bundled into one file per entry point, with its libraries compiled in
   from source and `vscode` external. A VSIX contains no `node_modules`.
4. **Type checking: `tsc --noEmit` with project references**, separate from bundling. esbuild does not check types;
   CI runs both.
5. **Packaging: `@vscode/vsce package --no-dependencies`** per extension. Where and how the VSIX files are published
   is a later ADR and a decision for the user.
6. **Lint and format: ESLint with typescript-eslint, and Prettier.** ESLint also enforces the import rules of
   `docs/architecture/layout.md` (no extension imports an extension; no library imports an extension; no cycles).
7. **Tests, three levels:**
   - Unit tests with Mocha on plain Node for code that does not need the editor. Libraries keep the `vscode` API
     behind narrow adapters so that most of their logic is tested here.
   - Integration tests with the editor's harness (`@vscode/test-cli`, `@vscode/test-electron`, also Mocha) for code
     that needs a running extension host.
   - The conformance runner against the packaged VSIX. Only this level decides that a feature is done.
8. **Dependencies:** as few runtime dependencies as possible; licences compatible with MIT; no dependency that sends
   telemetry; no native Node modules without their own ADR, because a native module forces one VSIX per platform.
   CI checks the licences.
9. **Node.js:** current LTS for the tools. The bundle target is the Node.js version of the oldest editor version we
   support.

## Options considered

| Option | For | Against |
|---|---|---|
| TypeScript, pnpm workspaces, esbuild (chosen) | The editor's API is typed for it; a package can import only what it declares, which keeps the package boundaries honest; fast installs; esbuild builds all seven extensions in seconds | Type checking is a separate step; one more tool for every worker and CI job; pnpm's linked `node_modules` layout does not suit `vsce`'s own dependency collection |
| npm workspaces in place of pnpm (the proposal) | No extra tool | Hoisting lets a package import what it did not declare; the user chose pnpm |
| webpack in place of esbuild | Long used for editor extensions | Slower by an order of magnitude; more configuration per package |
| `tsc` output without a bundler | Simplest build | VSIX files would carry `node_modules`; slow activation; shared libraries would need publishing or copying |
| JavaScript with JSDoc types | No compile step | Weak checking across package boundaries, which is where several workers meet |
| Another language compiled to a helper program (Go, Rust) for the extension logic | Strong for network and process code | The extension host still needs a JavaScript layer; two toolchains; one binary per platform. It stays open only for programs that must run on the remote side |

## Consequences

- One `pnpm install --frozen-lockfile` and one build command produce all VSIX files. A worker changes a library and sees every extension
  that uses it fail or pass in the same run.
- Because of pnpm's linked `node_modules`, a VSIX is always built from the bundle with
  `vsce package --no-dependencies`; nothing may rely on `vsce` collecting dependencies.
- Library code that touches the editor must go through adapters. This costs some indirection and gives fast tests.
- Avoiding native modules constrains later choices, the SSH transport first of all (the system's `ssh` program or
  a pure-JavaScript library). That choice gets its own ADR after the Remote-SSH specifications are read.
- Every tool named here is open source and free of charge. The only running cost is CI time on a private
  repository; the testing ADR states it before any job runs automatically.

## Open until the specifications are read

- The oldest editor version we support (`engines.vscode`), which sets the bundle target and the API level.
- Whether any extension needs a browser entry point as well as the Node one.
- Whether we ship programs of our own to the remote side, and in which language.
- Use of proposed editor API and how it is enabled per product (its own ADR).

## Check

CI jobs: `tsc --noEmit`, ESLint with the import rules, unit tests, a build that fails if a VSIX contains
`node_modules`, and the licence check. `tools/check-layout` checks that every package folder is a workspace.
