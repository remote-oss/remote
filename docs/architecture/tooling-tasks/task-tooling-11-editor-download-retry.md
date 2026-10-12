# Task card tooling-11: the editor download is retried once, and an empty error says where it came from

Why: proteus's finding on CI run 38217917613 (job 114706909450). The acceptance job (slice 1) failed 0.27 s after
`downloadAndUnzipVSCode` printed "Resolving version...", before any test ran, and the log's only line was
`acceptance: ` with nothing after it. The download works from the runner and passed on the next run, so it was a
brief error of the update service. Two causes of a lost run: one transient failure ends the job, and `messageOf`
prints an `Error` whose message is empty as an empty string. Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

| File | Change |
|---|---|
| `tools/acceptance.ts` | `editorCli` downloads through `withOneRetry`; `runAcceptance` prints `failureText(error)` (section 2) |
| `tools/acceptance.test.ts` | the rows of section 3 |

Nothing else. `messageOf` in `tools/repository.ts` stays as it is: it has 28 other callers, and this card changes
only the harness's own line.

## 2. Contract

In `tools/acceptance.ts`, both exported for the tests:

```ts
/** How long the harness waits before its one retry of a step that failed, in milliseconds. */
export const RETRY_PAUSE_MILLISECONDS = 5000;

/**
 * Runs `step`; when it throws, reports the failure through `report`, waits `RETRY_PAUSE_MILLISECONDS`, and runs it once
 * more. The second attempt's result or error is the outcome.
 */
export async function withOneRetry<Value>(
  step: () => Promise<Value>,
  sleep: (milliseconds: number) => Promise<void>,
  report: (line: string) => void,
): Promise<Value>;

/**
 * The text of a failure for the harness's line: an Error's message; when that is empty, its cause's text; when it
 * has none, the first two lines of its stack, trimmed and joined with a space, or its name when it has no stack.
 * Anything else as `String(caught)`.
 */
export function failureText(caught: unknown): string;
```

- `withOneRetry` reports `acceptance: <failureText(error)>; retrying once in 5 s` (the pause in whole seconds) before
  the pause. It does not catch the second attempt's error.
- The retry is tested through `withOneRetry`; the real `editorCli` uses it with `delay` and `console.log`:

  ```ts
  async function editorCli(): Promise<string> {
    const executable = await withOneRetry(
      () => downloadAndUnzipVSCode(EDITOR_VERSION),
      delay,
      console.log.bind(console),
    );
    return resolveCliPathFromVSCodeExecutablePath(executable);
  }
  ```

  `HarnessDependencies.editorCli` keeps its type; only the real function changes.
- `runAcceptance`'s catch prints `acceptance: ${failureText(error)}` instead of `messageOf(error)`. If `messageOf`
  then has no caller left in `acceptance.ts`, its import goes.

## 3. Test table

One assertion per `it`. The sleeper and the reporter are recording fakes.

| Given | Expected |
|---|---|
| `withOneRetry` with a step that resolves `'ok'` | `'ok'`, no sleep, no report |
| a step that rejects `new Error('busy')` once, then resolves `'ok'` | `'ok'` |
| the same | sleeps `[5000]` |
| the same | reports `['acceptance: busy; retrying once in 5 s']` |
| a step that rejects twice, the second time `new Error('down')` | rejects with that second error (`rejects(…, /down/)`) |
| a step that rejects twice | the step ran twice |
| `failureText(new Error('boom'))` | `'boom'` |
| `failureText(new Error('', {cause: new Error('ECONNRESET')}))` | `'ECONNRESET'` |
| `failureText(new Error('', {cause: 'socket hang up'}))` | `'socket hang up'` |
| an `Error('')` whose `stack` is `'Error\n    at a (x.js:1:1)\n    at b (y.js:2:2)\n    at c (z.js:3:3)'` | `'Error at a (x.js:1:1)'` |
| an `Error('')` whose `stack` is `undefined` | `'Error'` |
| `failureText(42)` | `'42'` |
| `runAcceptance` whose `bundleSuite` rejects `new Error('', {cause: 'no space'})` | exit code 1, and the error line is `acceptance: no space` (capture `console.error` for the `it`) |

The `failureText` rows were checked on a prototype (2026-10-12).

## 4. Rule for the worker

As card log-01; the tools' coverage ratchet holds.

## 5. Gates and review

PR title `tools: the editor download is retried once, and an empty error says where it came from (card tooling-11)`.

## 6. Open rows

None.
