# Task card log-01: lib-log package and core (logger, levels, once-per-session, redaction, memory sink)

Brief: `../brief-lib-log.md`. Contract: the brief's "What is built" table and the lib-log row of
`docs/architecture/c4-l2-containers.md`. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Create `packages/lib-log` in the shape of `packages/lib-host` on main: `package.json` (name `lib-log`, private,
`exports` with `.` → `src/index.ts` and `./testing/*` → `src/testing/*.ts`), `tsconfig.json` and
`tsconfig.test.json` extending the root pair, `coverage.json`, `README.md` (two paragraphs in the product's voice:
what the library does, allowed imports: none), and add the two tsconfig references to the root `tsconfig.json`
exactly as `lib-host` is referenced. Files of this card: `src/index.ts`, `src/logger.ts`, `src/levels.ts`,
`src/once.ts`, `src/redaction.ts`, `src/testing/memory-sink.ts`, and the tests
`test/unit/logger.test.ts`, `test/unit/levels.test.ts`, `test/unit/once.test.ts`, `test/unit/redaction.test.ts`.
Nothing else changes. No `vscode` import anywhere in this card.

## 2. Contract (signatures to implement exactly)

```ts
export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export const LEVEL_ORDER: readonly Level[]; // trace < debug < info < warn < error
export interface LogLine { level: Level; scope: readonly string[]; message: string; time: number }
export interface Sink { write(line: LogLine): void }
export interface Logger {
  readonly scope: readonly string[];
  trace(message: string): void; debug(message: string): void; info(message: string): void;
  warn(message: string): void; error(message: string): void;
  child(scopeName: string): Logger;
}
export interface LoggerOptions { minimumLevel: () => Level; clock?: () => number; secrets?: () => readonly string[] }
export function createLogger(sink: Sink | undefined, options: LoggerOptions): Logger;
export function secret(value: string): Secret;            // an opaque marker type, never a plain string
export function redact(message: string, secrets: readonly string[]): string;
export function logOncePerSession(logger: Logger, key: string, message: string, level?: Level): boolean;
export function resetOncePerSession(): void;               // testing only, exported from ./testing/once
export class MemorySink implements Sink { readonly lines: LogLine[]; write(line: LogLine): void }
```

Rules the code must follow: a logger with `sink === undefined` accepts every call and writes nothing; `minimumLevel`
is read on every call; `child` appends one scope name; `redact` runs on every message before the sink; a message that
still matches the token shape `/\b[A-Za-z0-9_-]{32,}\b/` after redaction is replaced whole by `[redacted]`; a
`Secret` cannot be concatenated into a message by accident (its `toString` returns `[secret]`); `logOncePerSession`
returns true when it wrote and false when the key was already seen in this process; the registry of seen keys is a
module-level `Set` cleared only by `resetOncePerSession`.

## 3. Test table (test names are the "given" column; each row is one test)

| Given | Expected |
|---|---|
| `createLogger(undefined, {minimumLevel: () => 'trace'})`; call all five methods | no throw; nothing observable |
| MemorySink; minimum `info`; `logger.debug('a')`, `logger.info('b')` | `lines` has one entry, message `b`, level `info` |
| minimum getter returns `error` then `trace` between two `info` calls | first call not written, second written |
| `logger.child('ssh').child('session').info('x')` | line scope `['ssh','session']`, parent's scope unchanged `[]` |
| `createLogger(sink, {..., clock: () => 42})`; `info('t')` | line `time === 42` |
| `LEVEL_ORDER` | equals `['trace','debug','info','warn','error']`; frozen (`Object.isFrozen`) |
| `redact('token abcdefghijklmnopqrstuvwxyz012345 ok', [])` (32 chars) | `'[redacted]'` |
| `redact('token abc ok', ['abc'])` | `'token [redacted] ok'` |
| `redact('two abc and abc', ['abc'])` | `'two [redacted] and [redacted]'` |
| `redact('plain text', [])` | `'plain text'` |
| `redact('x', ['']) ` | `'x'` (empty secrets are ignored) |
| `` `${secret('p4ss')}` `` | `'[secret]'` |
| `String(secret('p4ss')).includes('p4ss')` | `false` |
| logger with `secrets: () => ['hunter2']`; `info('pw hunter2')` | written message `'pw [redacted]'` |
| `logOncePerSession(logger, 'k', 'm')` twice | returns `true` then `false`; sink has one line |
| two keys `'k1'`, `'k2'` | both written, two lines |
| `resetOncePerSession()` then `logOncePerSession(logger, 'k', 'm')` | returns `true` again |
| `logOncePerSession(logger, 'k', 'm', 'warn')` | the line's level is `warn`; default level is `info` |
| `logOncePerSession` with a sink-less logger | returns `true` (counted as written), nothing observable |
| MemorySink `write` of two lines | `lines` keeps insertion order and the same objects |

## 4. Rule for the worker

Write the tests from the table first, run them, then write the code until they pass. Do not add exports, options or
behaviour the table does not need. Comments only where the Google TypeScript guide requires them; no identifiers
under four characters; no `_`-prefixed identifiers; no duplication. Run, in order: `pnpm identifiers`,
`pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`,
`pnpm coverage`, `pnpm check-licences`. Coverage of `packages/lib-log` must be 100/100/100 for this card's files;
record the ratchet in `coverage.json` with `pnpm coverage:update`.

## 5. Gates and review

PR title `lib-log: package and core (card log-01)`; body: the table rows as the test list, and R1–R6 in one line
each. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected. If the root `tsconfig.json` references or the `knip` library block need a different form than
`lib-host` uses, stop and report instead of guessing.
