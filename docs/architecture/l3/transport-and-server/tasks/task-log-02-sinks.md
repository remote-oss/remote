# Task card log-02: lib-log sinks (output channel, terminal) behind an editor port

Brief: `../brief-lib-log.md`. Depends on card log-01 (merged first). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `src/sinks/editor-port.ts`, `src/sinks/channel-sink.ts`, `src/sinks/terminal-sink.ts`, `src/index.ts` (add
the exports only), `src/testing/fake-editor-port.ts`, tests `test/unit/channel-sink.test.ts`,
`test/unit/terminal-sink.test.ts`. No `vscode` import: the editor is reached through the port below, which the
consuming package implements over `vscode`.

## 2. Contract

```ts
export interface EditorLogPort {
  createOutputChannel(name: string): { appendLine(text: string): void; dispose(): void };
  createTerminalWriter(name: string): { write(text: string): void; onDidClose(listener: () => void): void; dispose(): void };
}
export function createChannelSink(port: EditorLogPort, channelName: string, format?: (line: LogLine) => string): Sink & { dispose(): void };
export function createTerminalSink(port: EditorLogPort, terminalName: string, format?: (line: LogLine) => string): Sink & { show(): void; dispose(): void };
export const defaultFormat: (line: LogLine) => string; // `${iso time} [${level}] ${scope.join('.')}: ${message}`, scope part omitted when empty
```

Rules: the channel is created on the first `write`, never in the constructor; `dispose` before any write creates
nothing; the terminal sink buffers every formatted line from construction, creates the terminal on `show()`, replays
the whole buffer then streams; after the terminal closes, lines buffer again and the next `show()` creates a new
terminal and replays the buffer kept since the first line (the buffer is never truncated in this card; a cap is a
later card); `defaultFormat` uses `new Date(line.time).toISOString()`.

## 3. Test table

| Given | Expected |
|---|---|
| `createChannelSink(port, 'Remote - SSH')` and no write | `port.createOutputChannel` not called |
| first `write(line)` | `createOutputChannel('Remote - SSH')` called once; `appendLine(defaultFormat(line))` |
| three writes | one channel, three `appendLine` calls in order |
| custom `format` returning `'X'` | `appendLine('X')` |
| `dispose()` after writes | channel `dispose` called once; a later `write` creates a new channel |
| `dispose()` before any write | no port call at all |
| `defaultFormat({level:'info', scope:[], message:'m', time:0})` | `'1970-01-01T00:00:00.000Z [info] m'` |
| `defaultFormat({level:'warn', scope:['a','b'], message:'m', time:0})` | `'1970-01-01T00:00:00.000Z [warn] a.b: m'` |
| terminal sink: two writes, no `show` | `createTerminalWriter` not called |
| then `show()` | `createTerminalWriter('WSL')` once; `write` called with the two formatted lines, each followed by `'\r\n'`, in order |
| a write after `show()` | streamed at once: one more `write` call |
| the fake port fires `onDidClose`; then one write; then `show()` | a second `createTerminalWriter`; `write` called with all three lines |
| `show()` twice while open | one terminal only |
| `dispose()` | terminal `dispose` called once; buffer kept; `show()` after dispose creates a terminal and replays |

The fake port (`src/testing/fake-editor-port.ts`) records every call with its arguments and lets a test fire
`onDidClose` for the latest terminal.

## 4. Rule for the worker

As card log-01 (tests first; no extra behaviour; standards; the full gate list; 100 % coverage for this card's files).

## 5. Gates and review

PR title `lib-log: sinks (card log-02)`; body as log-01. Reviewer: `remote-coding-worker-1`.

## 6. Open rows

None expected. The buffer cap and the per-extension-host buffer sharing (F-6002) are a later card once WSL is
scheduled; do not implement them.
