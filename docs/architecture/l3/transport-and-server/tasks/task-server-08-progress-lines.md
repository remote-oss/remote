# Task card server-08: the progress-line parser (pure)

Contract: `../contracts.md` §5 V1 (the ruled progress line: `remote-oss-server-progress <step> <percent>`). Depends on
the merged lib-server. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `packages/lib-server/src/scripts/progress-line.ts`, `src/index.ts` (exports only), test
`test/unit/progress-line.test.ts`. Nothing else; wiring into V4/V7's output handling is the Claude task that consumes
it (server-07 part 2 or a follow-up), not this card.

## 2. Contract

```ts
export const PROGRESS_PREFIX = 'remote-oss-server-progress';
export type ProgressStep = 'unpack' | 'download';
export interface ProgressLine { step: ProgressStep; percent: number }   // integer 0–100
export function parseProgressLine(line: string): ProgressLine | undefined;
// a whole line `${PROGRESS_PREFIX} ${step} ${percent}` with exactly one space between the three parts, trailing '\r' stripped;
// percent must be decimal digits only, 0–100, no sign, no leading '+'; anything else → undefined
export function progressLines(lines: readonly string[]): ProgressLine[];   // in order, non-progress lines skipped
```

## 3. Test table

| Given | Expected |
|---|---|
| `'remote-oss-server-progress unpack 40'` | `{step:'unpack', percent:40}` |
| `'remote-oss-server-progress download 100'` | `{step:'download', percent:100}` |
| `'remote-oss-server-progress unpack 0'` | `{step:'unpack', percent:0}` |
| `'remote-oss-server-progress unpack 40\r'` | `{unpack, 40}` |
| `'remote-oss-server-progress unpack 101'` | `undefined` |
| `'remote-oss-server-progress unpack -1'`, `'… +5'`, `'… 4.5'`, `'… 05'` | `undefined` each (leading zero refused: digits only and no leading zero unless the value is `0`) |
| `'remote-oss-server-progress install 10'` | `undefined` (unknown step) |
| `'remote-oss-server-progress  unpack 40'` (two spaces) | `undefined` |
| `' remote-oss-server-progress unpack 40'` (leading space) | `undefined` |
| `'remote-oss-server-progress unpack 40 extra'` | `undefined` |
| `'status=Ok'` | `undefined` |
| `progressLines(['a', 'remote-oss-server-progress unpack 5', 'b', 'remote-oss-server-progress unpack 10'])` | `[{unpack,5},{unpack,10}]` |
| `progressLines([])` | `[]` |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-server: progress-line parser (card server-08)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected.
