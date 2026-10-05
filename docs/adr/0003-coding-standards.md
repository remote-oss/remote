# ADR-0003: Google TypeScript style, enforced by lint and coverage gates

- Status: accepted (the user, 2026-10-05, stated directly to the lead; the thresholds in the Decision are the lead's
  choice and the user may change them)
- Date: 2026-10-05
- Deciders: the user; enforcement designed by `remote-architect`
- Scope: all packages, and the tooling under `tools/`
- Requirements: ADR-0002 (ESLint, Prettier, Mocha, CI); the user's standards below

## Context

Most code in this repository is written by agents in separate sessions. Agent-written code tends to carry
conversational comments, short names, copies of nearby code, code nothing reaches and tests that prove only the
happy path. The user reads the code, not the comments, and asked for strict standards. Five things are named as the
worst:

1. Verbose or apologetic comments addressed to a reader of the conversation rather than of the code.
2. Identifiers of three characters or fewer.
3. Duplicated code, and dead code nothing reaches.
4. Missing tests, or tests that do not cover every scenario.
5. Low coverage.

A standard that lives only in a document is not followed by an agent under time pressure. Each rule below has a
check that fails the build, or a review rule that names what the reviewer looks for.

## Decision

The code follows the [Google TypeScript style guide](https://google.github.io/styleguide/tsguide.html). Where
this ADR is stricter than the guide, this ADR wins.

| Rule | Check |
|---|---|
| **Comments.** Only comments the Google guide calls for: JSDoc on every exported symbol, stating what it is for and its contract; a comment inside a body only where the code cannot say why (a workaround with its reference, a non-obvious invariant). No comments that narrate what the next line does, no apologies, no "note that", no TODO without an issue number, no commented-out code, no conversation. | ESLint: `jsdoc/require-jsdoc` for exports, `no-warning-comments` (TODO/FIXME without `#NNN`), `no-inline-comments`; the comment density per file is reported by lint; review rule R1 |
| **Names.** Every identifier has at least four characters and says what it holds. Allowed exceptions, and no others: `_` for an ignored value; the loop indices `i`, `j`, `k` inside a `for` statement of at most five lines; `x`, `y` as coordinates; `id` as a property name of an object that has one id. Abbreviations are not words: `cfg`, `ctx`, `res`, `req`, `err`, `evt`, `fn`, `cb`, `tmp`, `val` are out. | ESLint `id-length` with `min: 4` and the exception list, plus `id-denylist` for the abbreviations; review rule R2 |
| **No duplicated code.** The same logic exists once. A second copy with small changes is a parameter or a shared function; a copy across packages is a library candidate for the lead. | `jscpd` in CI: fails on any clone of 10 lines or 75 tokens or more across `packages/` and `tools/`; review rule R3 |
| **No dead code.** No unused exports, files, dependencies, parameters or locals; no unreachable code; no feature flags left off forever; no "for later" scaffolding. | `tsc` `noUnusedLocals` and `noUnusedParameters`; `knip` in CI for unused exports, files and dependencies; ESLint `no-unreachable`; review rule R4 |
| **Tests cover every scenario.** Each function with branches has tests for each branch, each error path and each boundary; each spec acceptance criterion a component implements maps to a named unit or integration test and to its conformance case; a bug fix adds the test that would have caught it. Tests have one assertion target per case, names that state the scenario, and no logic of their own. | Coverage gates below; the traceability matrix (AC → test name) checked by a lint; review rule R5 |
| **Coverage.** Line, branch and function coverage are measured per package with `c8` on the unit and integration tests. Gates: **90 % lines, 85 % branches, 90 % functions** per package, failing CI; a ratchet file per package records the last passing numbers and CI fails when a number drops by more than 0.5 points. Files may be excluded only by name in the package's coverage config with a one-line reason, and the exclusions are listed in the package README. | `c8 --check-coverage` in CI; ratchet check script; review rule R6 |
| **Formatting and the rest of the guide.** Prettier is the formatter; ESLint carries the guide's rules through `gts` (Google's own ESLint and Prettier configuration), adjusted only where this ADR says. | `format:check`, `lint` in CI |

Review rules, applied by the lead and by every reviewer of a coding PR, each a yes/no question:

- **R1** Can every comment be deleted without losing information a reader of the code needs? If yes, it goes.
- **R2** Does every name say what the value is, without reading its definition?
- **R3** Is any block of this PR a near-copy of another block in the repository?
- **R4** Does everything added have a caller, and is every branch reachable?
- **R5** For each acceptance criterion the PR claims, which test fails if the code is wrong?
- **R6** Did coverage go up or stay; are the excluded files justified?

A PR that fails a check or a review question is not merged; the author fixes it, nobody waives it.

## Options considered

| Option | For | Against |
|---|---|---|
| Google guide with lint and coverage gates (chosen) | One public, complete guide; every rule has a check; `gts` gives most of it ready-made | Some rules need custom lint configuration; coverage gates slow the first PRs |
| Standards as a document and review only | No tooling work | Agents under pressure do not follow documents; the user's five points are exactly what review alone misses |
| Another guide (Airbnb, StandardJS) | Also complete | The user named Google's; the others carry no JSDoc rule |
| Mutation testing (Stryker) in the gates now | Catches tests that assert nothing | Slow on seven packages; adopted later for libraries if coverage proves hollow |

## Consequences

- The first coding worker adds the tooling: `gts` configuration merged into the existing ESLint and Prettier setup,
  the `id-length` and `id-denylist` rules, `jsdoc`, `jscpd`, `knip`, `c8` with the gates and the ratchet script, and
  the CI jobs. The lead reviews it against this ADR.
- Every coding-worker brief cites this ADR, and every coding PR description answers R1–R6 in one line each.
- Coverage below the gate is a failed build, not a note. A package that cannot reach the gate because of untestable
  editor interaction isolates that interaction behind an adapter (ADR-0002) and tests the rest.
- The tooling scripts under `tools/` meet the same rules; `tools/check-layout` and `tools/check-workspace.ts` are
  brought up to them in the same PR that adds the checks.

## Check

CI: `lint` (gts rules, `id-length`, `id-denylist`, `jsdoc`, `no-warning-comments`, `no-inline-comments`,
`no-unreachable`), `typecheck` (`noUnusedLocals`, `noUnusedParameters`), `dupes` (`jscpd`), `dead` (`knip`),
`coverage` (`c8 --check-coverage` and the ratchet). Review: R1–R6 answered in the PR description and checked by the
reviewer.
