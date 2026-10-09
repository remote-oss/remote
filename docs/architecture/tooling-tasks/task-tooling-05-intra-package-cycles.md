# Task card tooling-05: import cycles inside a package are reported

Why: the layout forbids cycles, but the lint and check-workspace see only edges between packages; a cycle between two
modules of one package (found in #153) passes today. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`tools/eslint-layout/` (a new rule or an option of `layout/package-imports`), its RuleTester tests,
`eslint.config.ts` (enable it), `docs/adr/0003` one line under "No dead code" or the layout check row.

## 2. Contract

A rule `layout/no-intra-package-cycles` that resolves relative imports (static, `import type`, `export … from`,
dynamic `import()` with a literal) inside a package's `src/` and reports every cycle once, naming the files in order
(`a.ts → b.ts → a.ts`); test files are out of scope; the rule runs per package; its cost must stay under one second
per package on the current tree (measure and state it in the PR).

## 3. Test table

| Given | Expected |
|---|---|
| `a.ts` imports `b.ts`, `b.ts` imports `a.ts` | one report naming `a.ts → b.ts → a.ts` |
| a three-file cycle | one report naming the three |
| `import type` closing a cycle | reported (types count: the layout rule says "in code and in types") |
| a cycle through `export * from` | reported |
| a cycle through `import('./a.ts')` with a literal | reported |
| two files importing each other only from `test/` | not reported |
| a DAG of ten files | nothing |
| the current tree (`pnpm lint`) | passes after #155 (authority-01b) breaks the codec cycle; before it, the rule reports exactly that cycle (run it on a checkout of #153's head to show) |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `tooling: report import cycles inside a package (card tooling-05)`.

## 6. Open rows

None expected.
