# ADR-0003: Google TypeScript style, enforced by lint and coverage gates

- Status: accepted (the user, 2026-10-05, D-50; enforcement R-74; the thresholds in the Decision are the lead's
  choice and the user may change them). Revised 2026-10-05 after a check against the guide's text.
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
check that fails the build, or a review question that names what the reviewer looks for.

## Decision

The code follows the [Google TypeScript style guide](https://google.github.io/styleguide/tsguide.html) ("the
guide"). This ADR adds rules of its own, marked **(ours)**; where it is stricter than the guide, this ADR wins. The
guide names no tools; the tools here are our choice.

### Comments

The guide's rules, enforced as written: `/** JSDoc */` for documentation that a user of the code reads, `//` for
implementation comments, multi-line comments as several `//` lines; JSDoc on every exported symbol and on every
property or method whose purpose is not obvious from its name; descriptions that add information and never restate
a name or a type; no types in `@param` or `@return`; a comment is required at an empty `catch`, a type or
non-null assertion, a caught-and-rethrown non-Error, a suppressed `any`, and a `@deprecated` symbol; parameter-name
comments `foo(/* enable= */ true)` where a literal argument's meaning is unclear.

**(ours)** No other comment class exists. No comment narrates what the next line does; no apology, no
"note that", no "we need to", no address to a reader of the conversation; no commented-out code; a `TODO`, `FIXME`
or `HACK` carries an issue number as `TODO(#123)` or does not exist.

Check: `jsdoc/require-jsdoc` (exports, and the public members of exported classes, which are exported API),
`jsdoc/require-description`, `jsdoc/no-types`, `jsdoc/check-tag-names`, `jsdoc/no-blank-blocks`;
`jsdoc/require-param` and `jsdoc/require-returns` stay off, because the guide wants `@param` and `@return` only
where they add information; `multiline-comment-style: separate-lines` for implementation comments; three local rules with tests: `comments/no-commented-out-code` (a comment whose text
parses as code), `comments/no-conversation` (a phrase denylist kept in one place in the config), `comments/todo-issue`
(a warning term not followed by `(#NNN)`); review question R1.

### Names

The guide's rules: descriptive names, no ambiguous or unfamiliar abbreviations, no letters deleted inside a word, no
decoration with information the type carries, no `_` prefix or suffix, and `_` is not an identifier (a destructuring
hole takes an unused array element). The guide allows single-letter names in scopes of ten lines or fewer; **(ours)
this ADR does not**: every identifier, property names included, has at least four characters and says what it
holds. The only exceptions: `i`, `j`, `k` inside a `for` statement of at most five lines; `x`, `y` as coordinates;
`id` as a property name; single upper-case type parameters (`T`, `K`, `V`), checked by the local rule because `id-length` does not visit type parameters; and property keys that a third-party API
imposes, each listed once in the ESLint config with the API that imposes it. Abbreviations are not words: `cfg`,
`ctx`, `res`, `req`, `err`, `evt`, `fn`, `cb`, `tmp`, `val`, `idx`, `len`, `num`, `str`, `obj`, `arr`, `elem`, `msg`,
`opts`, `args` are out. An unused trailing parameter is removed, not renamed; an unused leading parameter keeps its
descriptive name.

Short names that fail the rule but are worth keeping (the user's standing rule, 2026-10-08): deliberated by the lead
for contract names and by the PM for cross-cutting tooling, never escalated to the user. Allowed only when the name
is a widely recognised term or an external API's own name, clear in context, and renaming would cost more
(awkward names spreading, disables across files); otherwise renamed (`key` → `onceKey`, `pid` → `startedByProcessId`).
Mechanism: an exception line here citing the decision plus one tooling PR adding the name to
`SHORT_NAME_EXCEPTIONS`; never a per-file disable. A contract that needs one says so in its card, and the tooling PR
lands before the card is built. Current exceptions beyond the fixed list: `now` (2026-10-08).

Check: `id-length` (`min: 4`, `properties: always`, the exception list); `id-denylist` for the abbreviations; a local
rule `names/scoped-exceptions` for the scoped cases; `@typescript-eslint/no-unused-vars` with `args: after-used`
and `noUnusedLocals` in `tsc`, and no `_`-prefix allowance; review question R2.

### No duplicated code **(ours)**

The same logic exists once. A second copy with small changes is a parameter or a shared function; a copy across
packages is a library candidate for the lead.

Check: `jscpd` over `packages/` and `tools/`, one run, `minLines: 5` and `minTokens: 50`, `threshold: 0` (any clone
fails); review question R3.

### No dead code **(ours)**

No unused exports, files, dependencies, parameters or locals; no unreachable code; no flag that is never on; no
scaffolding "for later".

Check: `tsc` `noUnusedLocals`; `knip` for unused exports, files and dependencies; `no-unreachable`; review
question R4.

### Tests cover every scenario **(ours)**

Each function with branches has tests for each branch, each error path and each boundary; each acceptance criterion
a component implements maps to a named unit or integration test and to its conformance case; a bug fix adds the
test that would have caught it. A test states its scenario in its name, asserts one thing, and has no logic of its
own.

Check: the coverage gates; the traceability matrix (acceptance criterion → test name), checked by a lint once it
exists; review question R5.

### Coverage **(ours)**

Line, branch and function coverage are measured per package, and for `tools/` as one unit, with `c8` on the unit and
integration tests. Gates: **90 % lines, 85 % branches, 90 % functions**, failing CI. A ratchet per unit records the
last passing numbers; CI fails when a number drops by more than 0.5 points below the record, and an update writes
the maximum of record and current, so repeated small drops cannot creep. A file is excluded only by name in the
unit's `coverage.json` with a one-line reason; the package README lists the exclusions; a stale or unexplained
exclusion fails the check. A package without `src/` is skipped until it has code.

Check: `c8 --check-coverage`, the ratchet script, the exclusion check; review question R6.

### The rest of the guide, by lint

`gts` (Google's open-source configuration; not an official Google product and thinner than the guide) is not
installed, because it pins ESLint 9 and this repository runs ESLint 10. Its Prettier settings are copied
(80 columns, single quotes, trailing commas everywhere, no bracket spacing, no parentheses around a single arrow
parameter), with the `gts` version named in a comment, and the whole tree is reformatted once. The ESLint base is
`@eslint/js` recommended plus `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`, and these rules for
the guide's sections:

| Guide section | Rule |
|---|---|
| Exports: no default exports, no `export let`, no container classes | `no-restricted-syntax` (`ExportDefaultDeclaration`; the configuration files whose tools read a default export are exempt by name) |
| Modules, not namespaces; no `import x = require()` | `@typescript-eslint/no-namespace`, `no-require-imports` |
| `import type` / `export type` for type-only use | `consistent-type-imports`, `consistent-type-exports` |
| `const` and `let`, one per declaration, no `var` | `no-var`, `prefer-const`, `one-var: never` |
| Classes: `readonly` where possible, no `#private`, no private static methods, `new X()` with parentheses. **Deviation (ours):** no parameter properties; fields are declared in the class body and assigned in the constructor, because the toolchain runs tests and tools on Node's type stripping, which cannot erase them (ADR-0002, `erasableSyntaxOnly`) | `prefer-readonly`, `parameter-properties: {prefer: class-property}`, `no-restricted-syntax`, `new-parens` |
| Functions: declarations, not expressions; arrow callbacks | `func-style: declaration`, `prefer-arrow-callback` |
| Strings: single quotes, template literals, no line continuations | Prettier, `prefer-template`, `no-multi-str` |
| `===` always, `== null` allowed | `eqeqeq: [error, always, {null: ignore}]` |
| `switch`: `default` present and last, no fall-through | `default-case`, `default-case-last`, `no-fallthrough` |
| Exceptions: throw `Error` only, no empty `catch` without a comment | `only-throw-error`, `prefer-promise-reject-errors`, `no-empty: {allowEmptyCatch: false}` |
| Type assertions: `as`, not angle brackets; avoid; annotate literals | `consistent-type-assertions`, `non-nullable-type-assertion-style` |
| `const enum`, `debugger`, `with`, `eval`, wrapper objects: banned. **Deviation (ours):** no `enum` at all, for the same reason as parameter properties; a union of string literals or a `const` object with `as const` takes its place | `no-restricted-syntax`, `no-debugger`, `no-with`, `no-eval`, `no-restricted-types`, `erasableSyntaxOnly` in `tsc` |
| `any`: avoid, prefer `unknown`; `{}` avoided | `no-explicit-any`, `no-unsafe-*`, `no-restricted-types` |
| No `@ts-ignore`, `@ts-nocheck`; `@ts-expect-error` only in tests | `ban-ts-comment` as error, relaxed for test files |
| Interfaces over type literal aliases; `T[]` for simple types | `consistent-type-definitions: interface`, `array-type: array-simple` |
| Floating promises | `no-floating-promises`, `no-misused-promises` |
| Undefined and null: no `\|null` in type aliases, prefer `?:` | review question R2 extended to types |

### Review questions

Applied by the lead and by every reviewer of a coding PR; the PR description answers each in one line.

- **R1** Can every comment be deleted without losing information a reader of the code needs? Is every non-obvious
  member documented?
- **R2** Does every name say what the value is, without reading its definition?
- **R3** Is any block of this PR a near-copy of another block in the repository?
- **R4** Does everything added have a caller, and is every branch reachable?
- **R5** For each acceptance criterion the PR claims, which test fails if the code is wrong?
- **R6** Did coverage go up or stay; are the excluded files justified?

A PR that fails a check or a review question is not merged; the author fixes it, nobody waives it.

## Options considered

| Option | For | Against |
|---|---|---|
| The guide, with lint and coverage gates (chosen) | One public, complete guide; every rule has a check | Custom lint rules for the comment classes; coverage gates slow the first PRs |
| Standards as a document and review only | No tooling work | Agents under pressure do not follow documents; the user's five points are what review alone misses |
| Install `gts` | Ready-made | Pins ESLint 9; enforces only a recommended set, none of the guide's export, namespace, enum, class or JSDoc rules |
| Another guide (Airbnb, StandardJS) | Also complete | The user named Google's |
| Mutation testing (Stryker) in the gates now | Catches tests that assert nothing | Slow on seven packages; adopted later for libraries if coverage proves hollow |

## Consequences

- The first coding worker adds the tooling: the ESLint base and rule table, the three comment rules and the name
  rule as local plugins with tests, `jsdoc`, `jscpd`, `knip`, `c8` with the gates, the ratchet and the exclusion
  check, the Prettier settings and the one-time reformat, and the CI jobs. The lead reviews it against this ADR.
- Every coding-worker brief cites this ADR, and every coding PR description answers R1–R6.
- Coverage below the gate is a failed build, not a note. A package that cannot reach the gate because of untestable
  editor interaction isolates that interaction behind an adapter (ADR-0002) and tests the rest.
- The tooling under `tools/` meets the same rules: the bash layout check is ported to TypeScript behind a shim at
  its old path, and the tooling has its own tests and coverage unit. `tools/spec-watch` stays a shell script and is
  checked with `shellcheck` where available.
- Third-party tools are checked for telemetry and update checks before they are added (ADR-0002 rule 8).

## Check

CI: `lint` (the rule table, the comment and name rules, `jsdoc`), `format:check`, `typecheck` (`noUnusedLocals`),
`dupes` (`jscpd`), `dead` (`knip`), `coverage` (`c8 --check-coverage`, the ratchet, the exclusion check). Review:
R1–R6 answered in the PR description and checked by the reviewer.
