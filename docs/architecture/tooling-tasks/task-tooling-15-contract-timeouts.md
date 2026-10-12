# Task card tooling-15: a timeout for the channel contract suites that run real processes

Issue: #480. Why: CI run 38312314819 (PR #475, a Markdown-only change) failed `pnpm test:unit` on one row of lib-ssh's shared-channel
contract: `streams a local file to the script's input byte for byte` hit Mocha's default 2000 ms timeout. The row spawns
a real `/bin/sh` that pipes 258 bytes through `sha256sum`. Locally it takes about 0.1 s (8 runs of 8), and the re-runs
of the same commit passed. The self-hosted runner was starting other jobs at the time. The two lib-ssh suites that run
real processes keep the 2 s default, while every other suite that spawns processes sets its own, for example
`packages/lib-helper/test/unit/helper-process.test.ts` (`this.timeout(20000)`). Builder: selene.

## 1. Files

| File | Change |
|---|---|
| `packages/lib-ssh/test/unit/shared-channel-contract.test.ts` | the `describe` at line 88 takes a `function` and sets the timeout (section 2) |
| `packages/lib-ssh/test/unit/host-channel-contract.test.ts` | the same for the `describe` at line 185 |

Nothing else. No row's name, body or assertion changes.

## 2. The change

In each file, turn the arrow function of that one `describe` into a `function` expression, and make its first statement
`this.timeout(20000);`, as `helper-process.test.ts` line 42 does:

```ts
describe('host channel over the shared ssh session: the lib-host contract', function () {
  this.timeout(20000);
  for (const contractCase of channelContractCases(HARNESS)) {
```

Keep everything else in the body as it is. The recording-channel suite in lib-host
(`packages/lib-host/test/unit/channel-contract.test.ts`) runs no process and keeps the default: don't change it.

## 3. Done when

- `pnpm lint` passes. If a rule objects to the `function` form, use the exact form `helper-process.test.ts` uses: it
  passes lint today.
- `pnpm test:unit` passes, with the same number of passing rows as before.
- `pnpm format:check`, `pnpm typecheck` and `pnpm coverage` pass (test files only, so coverage doesn't move).

## 4. Review

PR title `lib-ssh: a 20 s timeout for the channel contract suites that run real processes (card tooling-15)`. themis or
triton reviews.
