# Task card companion-01: the lib-companion package skeleton

Why: the payload codecs (card companion-02) and the history rules (card companion-03) need a package to live in.
Contract: `../contracts.md` section 4. Reviewing coder: `remote-coding-worker-1`. No `vscode` import anywhere, and
this card adds no behaviour.

## 1. Package and file boundary

`packages/lib-companion` does not exist on main (checked with `ls` and `git ls-files`). Create it in the shape of
`packages/lib-log` as it is on main (amended 2026-10-12, #257: since tooling-06 a library's `exports` carries a
`types` condition for its declaration output and its `tsconfig.json` a `references` list; this card copies both, as
card wsl-00 does). Files, all new except the two edits named last:

| File | Content |
|---|---|
| `packages/lib-companion/package.json` | `name` `lib-companion`, `version` `0.0.0`, `private` `true`, `exports` exactly `{".": {"types": "./.tsc/src/index.d.ts", "default": "./src/index.ts"}}` (lib-log's shape since tooling-06; no testing entries yet), no dependencies |
| `packages/lib-companion/tsconfig.json` | `{"extends": "../../tsconfig.base.json", "references": []}` |
| `packages/lib-companion/tsconfig.test.json` | `extends` `../../tsconfig.base.test.json`, `references` `[{"path": "./tsconfig.json"}]` |
| `packages/lib-companion/coverage.json` | `{"ratchet": {"lines": 100, "branches": 100, "functions": 100}}` |
| `packages/lib-companion/README.md` | the package sentence, a "For maintainers" table (rows: Maintainers `remote-oss`; Entry points `lib-companion` (`src/index.ts`); Allowed imports `none`; Coverage exclusions `none`), in the voice of `packages/lib-log/README.md` |
| `packages/lib-companion/src/index.ts` | a `@fileoverview` comment and `export {};` |
| `packages/lib-companion/test/unit/skeleton.test.ts` | new, section 3 |
| `tsconfig.json` (root) | add `{"path": "packages/lib-companion"}` and `{"path": "packages/lib-companion/tsconfig.test.json"}` to `references`, in the alphabetical place the other packages use |
| `pnpm-lock.yaml` | only the importer entry `packages/lib-companion: {}` that `pnpm install` writes |

Nothing else may change. No fixtures.

## 2. Contract

The README sentence (product voice, no feature, rule or decision id, no process wording): "The plain-data messages
that Remote Explorer and the extensions that serve it exchange: the version envelope, the payload shapes, and the
rules that read them." The package imports nothing; later cards add `src/payloads.ts`, `src/host-key.ts` and
`src/history.ts`, and each adds its exports to `src/index.ts`.

## 3. Test table

The test reads the files with `node:fs`, from `import.meta.dirname`.

| Cite | Given | Expected |
|---|---|---|
| F-5902.5.table | `package.json` | `name` `lib-companion`, `private` true, `version` `0.0.0` |
| F-5902.5.table | `package.json` `exports` | deep-equal `{".": {"types": "./.tsc/src/index.d.ts", "default": "./src/index.ts"}}` |
| F-5902.5.table | `package.json` | no `dependencies` and no `devDependencies` key |
| F-5902.5.table | `coverage.json` | ratchet 100/100/100 for lines, branches, functions |
| F-5902.5.table | `tsconfig.json` and `tsconfig.test.json` | the `extends` values of section 1; `tsconfig.json`'s `references` is `[]`; the test file references `./tsconfig.json` |
| F-5902.5.table | the root `tsconfig.json` | `references` holds both `packages/lib-companion` paths |
| F-5902.5.table | `README.md` | contains the section 2 sentence and the heading `## For maintainers` |
| F-5902.5.table | `README.md` | matches none of `/F-\d{4}/`, `/clean.?room/i`, `/\bR-\d+\b/` |
| F-5902.5.table | `import('../../src/index.ts')` | resolves; `Object.keys` of the module is empty |

9 rows.

## 4. Rule for the worker

As card log-01; tests first, one `it` per row, the name starting with the cite; fix only what fails; no signature or
contract change; names of four characters or more (`now` excepted); comments only where the Google TypeScript guide
requires them, none carrying a feature, rule or decision id; coverage 90/85/90 (the ratchet file holds 100);
no duplicated code.
Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: `remote-coding-worker-1`. PR title `lib-companion: package skeleton (task-companion-01)`. The description
answers R1 to R4 and R6 in one line each, R5 by a list mapping each cite to its test name, and gives the tail of
each gate's output.

## 6. Open rows (stop and report)

1. `pnpm check-layout` demands a file this card does not list (for example a `knip.jsonc` workspace entry).
   Question: who adds it? Stop and report the exact message.
2. `pnpm install` changes `pnpm-lock.yaml` beyond the one importer entry. Question: accept the diff? Stop.
