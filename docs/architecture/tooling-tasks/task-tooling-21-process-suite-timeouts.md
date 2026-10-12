# Task card tooling-21: a timeout for the other suites that run real processes

Issue: #494. Why: triton on #475. Three unit suites spawn real processes under Mocha's 2 s default, as
`shared-channel-contract.test.ts` did before tooling-15 (#480, #483). A busy CI runner can time them out:
`lib-ssh`'s `shell-runs.test.ts` (`spawnSync('/bin/sh', …)`) and `askpass-launcher.test.ts` (`execFileSync`), and
`lib-server`'s `cli-script.test.ts` (`spawnSync`: `tar`, `ps`, `test`, the bootstrap script). Builder: selene.

## 1. Files

| File | The `describe` | Line on main |
|---|---|---|
| `packages/lib-ssh/test/unit/shell-runs.test.ts` | `'the scripts on the shared session (contracts §4 S10)'` | 18 |
| `packages/lib-ssh/test/unit/askpass-launcher.test.ts` | `'askpass launcher'` | 28 |
| `packages/lib-server/test/unit/cli-script.test.ts` | `'the CLI steps of the bootstrap script (card cli-03b, contracts V7a)'` | 74 |

Nothing else. No row's name, body or assertion changes.

## 2. The change

The same as tooling-15: in each of the three, turn the arrow function of that top-level `describe` into a `function`
expression, and make its first statement `this.timeout(20000);`, exactly as
`packages/lib-ssh/test/unit/shared-channel-contract.test.ts` line 89 does on main:

```ts
describe('askpass launcher', function () {
  this.timeout(20000);
```

If a file already holds a nested `describe` or `it` with its own `this.timeout`, leave that one as it is.

## 3. Done when

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test:unit` pass, with the same number of passing rows
  as before;
- `pnpm coverage` passes (test files only, so coverage doesn't move).

## 4. Review

PR title `tests: a 20 s timeout for the other suites that run real processes (card tooling-21)`. themis or triton
reviews.
