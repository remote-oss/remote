# Task card tooling-04: `tests/acceptance` as a workspace package

Why: the acceptance suite must import the libraries and extensions it drives (lib-server, lib-ssh, remote-ssh)
through declared dependencies, not esbuild aliases (which bypass the import rules). Reviewing coder:
`remote-coding-worker-1`.

## 1. File boundary

`pnpm-workspace.yaml`, `tools/check-workspace.ts` and its tests, `tools/check-layout.ts` if it lists workspace
folders, `docs/architecture/layout.md` (one rule, text given below), `tests/acceptance/package.json` (new: name
`acceptance`, private, no `main`, `workspace:*` dependencies on what the suite imports today), `.vscodeignore`
is unaffected (nothing under tests/ ships).

## 2. Contract

- `pnpm-workspace.yaml` `packages:` is exactly `['packages/*', 'tests/acceptance']`; check-workspace requires exactly
  that list (the earlier "exactly packages/*" rule is widened to this list and nothing else).
- Import rules: the `acceptance` package may depend on any extension or library (`workspace:` only, as for
  everything else); no package may depend on `acceptance`; `acceptance` is never bundled into a VSIX and never
  published (`private: true`; check-workspace reports a dependency on it from any `packages/*` manifest).
- layout.md rule to add, verbatim: "`tests/acceptance` is a private workspace package that may import any extension
  or library; nothing imports it; it never ships."
- knip and the coverage tool treat it as a package with tests only (no coverage unit; its code is exercised by the
  acceptance job).

## 3. Test table

| Given | Expected |
|---|---|
| `packages:` exactly the two entries | check-workspace passes |
| `packages:` with a third entry | fails naming the entry |
| `packages:` without `tests/acceptance` | fails |
| `tests/acceptance/package.json` depending on `lib-server` and `remote-ssh` with `workspace:*` | passes |
| `packages/remote-ssh/package.json` depending on `acceptance` | fails: nothing may depend on the acceptance package |
| `acceptance` missing `private: true` | fails |
| the existing planted-route tests | unchanged results |

## 4. Rule for the worker

As card log-01; the tools ratchet may only rise; run the acceptance job once locally (`pnpm test:acceptance`) to
show the bundle still builds.

## 5. Gates and review

PR title `tooling: tests/acceptance as a workspace package (card tooling-04)`.

## 6. Open rows

None expected.
