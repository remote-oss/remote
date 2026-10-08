# Task card tooling-01: one automatic retry of the acceptance job on an unresponsive editor window

Why: an editor hang on the CI runner ("CodeWindow: detected unresponsive") failed a branch run whose code was sound
(main went green at the same commit). Reviewing coder: `remote-coding-worker-1` (repository-wide tooling: the lead
design-checks).

## 1. File boundary

`tools/acceptance.ts` (the runner invocation), `.github/workflows/ci.yml` (the acceptance job), tests
`tools/test/unit/acceptance-retry.test.ts` (or the existing tools test folder convention). Nothing under `packages/`.

## 2. Contract

```ts
export const HANG_MARKERS: readonly string[];   // ['CodeWindow: detected unresponsive']
export function shouldRetry(attempt: number, exitCode: number, output: string, maxAttempts = 2): boolean;
// true only when attempt < maxAttempts, exitCode !== 0 and output contains one of HANG_MARKERS
export async function runWithRetry(run: () => Promise<{ exitCode: number; output: string }>, log: (line: string) => void, maxAttempts = 2): Promise<number>;
// runs; on shouldRetry logs `acceptance: editor window unresponsive on attempt ${n}; retrying once` and runs again; returns the last exit code; never more than maxAttempts runs
```

`tools/acceptance.ts` uses `runWithRetry` around the editor run. The workflow does not change its steps (the retry is
inside the tool, so the job's log shows both attempts); add one comment in `ci.yml` next to the acceptance step
naming the retry.

## 3. Test table

| Given | Expected |
|---|---|
| `shouldRetry(1, 1, '... CodeWindow: detected unresponsive ...')` | `true` |
| `shouldRetry(2, 1, same)` | `false` (no third attempt) |
| `shouldRetry(1, 0, same)` | `false` (success is never retried) |
| `shouldRetry(1, 1, 'assertion failed: expected 3 to equal 4')` | `false` (a real failure is not retried) |
| `shouldRetry(1, 1, '')` | `false` |
| `runWithRetry` with run results [hang exit 1, exit 0] | returns 0; two runs; one log line with "attempt 1" |
| results [hang exit 1, hang exit 1] | returns 1; two runs; one log line |
| results [exit 0] | returns 0; one run; no log line |
| results [assertion exit 1] | returns 1; one run; no log line |
| `HANG_MARKERS` | frozen; contains exactly the one marker |

## 4. Rule for the worker

Tests first; no behaviour beyond the table; ADR-0003; the tools coverage ratchet may only rise; all gates.

## 5. Gates and review

PR title `tooling: retry the acceptance run once on an unresponsive editor window (card tooling-01)`.

## 6. Open rows (stop and report)

None expected.
