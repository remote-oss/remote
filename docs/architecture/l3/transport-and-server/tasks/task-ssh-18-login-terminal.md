# Task card ssh-18: the login terminal (S8): port, recording fake, editor adapter (terminal mode T1)

Why: athena's terminal-mode brief (`brief-terminal-mode.md`, T1; 0.2 blocker #299). Terminal mode runs each
window's `ssh` in a terminal of the editor's (F-2308). This card is the terminal itself: a port in lib-ssh that the
later cards (T2 prompts, T4 runs over the terminal, T5 the connect, T7 the tunnel) use, a recording fake for their
tests, and the one adapter that touches `vscode`. Ruled on #299 (main 8cf50a0): the port promises **plain text**; the
adapter strips VT escape sequences. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/terminal/login-terminal.ts` | new: the port types (section 2.1) |
| `packages/lib-ssh/src/terminal/plain-text.ts` | new: `PlainTextFilter`, the VT stripper (section 2.2) |
| `packages/lib-ssh/src/testing/recording-terminal.ts` | new: `RecordingTerminals`, the fake (section 2.3) |
| `packages/lib-ssh/src/index.ts` | export the types of 2.1 and `PlainTextFilter` |
| `packages/lib-ssh/package.json` | an `exports` entry `"./testing/recording-terminal"` like lib-host's `./testing/recording-channel` |
| `packages/lib-ssh/test/unit/plain-text.test.ts` | new |
| `packages/lib-ssh/test/unit/recording-terminal.test.ts` | new |
| `packages/remote-ssh/src/surfaces/login-terminal.ts` | new: `loginTerminalsOf(editor)`, the adapter (section 2.4) |
| `packages/remote-ssh/test/unit/login-terminal.test.ts` | new |

Nothing else. Nothing calls the port yet; T5 and T7 do. Knip: the fake is reached through the package's `exports`,
and the adapter through its test until E6c-3 imports it; if knip flags `loginTerminalsOf` as unused, add it to the
package's knip `entry` the way an adapter awaiting its caller is listed today, with a comment naming T5.

## 2. Contract

### 2.1 The port (`lib-ssh/src/terminal/login-terminal.ts`)

```ts
import type {Invocation} from '../arguments/invocation.ts';

/** The names the spec gives the login terminals (F-2308 3.2, F-2104 6.2 step 4). */
export type LoginTerminalName = 'install' | 'SSH Tunnel' | 'Uninstall VS Code Server';

/** How a terminal ended: its exit code when the process gave one, and why it ended, as the editor reports it. */
export interface TerminalEnd {
  /** The exit code; undefined when the process gave none (closed by the user, or never started). */
  code: number | undefined;
  reason: 'process' | 'user' | 'extension' | 'shutdown' | 'unknown';
  /** Whether any output arrived before the end. */
  hadOutput: boolean;
}

/** One login terminal running one invocation. */
export interface LoginTerminalSession {
  /** Calls `listener` with each piece of output as plain text: no escape sequences, `\r` and `\n` kept. */
  onOutput(listener: (text: string) => void): void;
  /** Calls `listener` once when the terminal ends; at once if it has already ended. */
  onEnd(listener: (end: TerminalEnd) => void): void;
  /** Writes `text` to the terminal's input exactly as given; the caller adds any line end. */
  send(text: string): void;
  /** Shows the terminal and gives it focus. */
  reveal(): void;
  /** Closes the terminal, which ends its process. Safe to call more than once and after the end. */
  dispose(): void;
}

/** What makes login terminals. */
export interface LoginTerminals {
  /** Starts the invocation in a new terminal; hidden unless `reveal` is true. */
  open(invocation: Invocation, name: LoginTerminalName, reveal: boolean): LoginTerminalSession;
}
```

Rules every implementation keeps:
- Output arrives in order, as plain text (2.2's filter applied), and never after the end.
- `onEnd` fires exactly once. `hadOutput` is true when any non-empty plain text was delivered before it.
- A terminal the editor refused to start (the workspace-trust "Cancel" of F-2308 7.E7) ends with `code: undefined`
  and `hadOutput: false`. The port does **not** name that case "trust": T5 reads it from those facts.

### 2.2 The VT stripper (`lib-ssh/src/terminal/plain-text.ts`)

```ts
/** Removes terminal escape sequences from a stream given in pieces; a sequence split across pieces is held. */
export class PlainTextFilter {
  /** The plain text of `piece`, with any escape sequence it completes removed. */
  push(piece: string): string;
  /** What is held at the end of the stream: an unfinished sequence is dropped, so this gives ''. */
  flush(): string;
}
```

What is removed (ECMA-48, the forms a terminal emits):
- **CSI**: `ESC [` then parameter bytes `0x30–0x3F`, intermediate bytes `0x20–0x2F`, and one final byte `0x40–0x7E`.
  Examples: `\x1b[0m`, `\x1b[?2004l`, `\x1b[2K`, `\x1b[1;32m`.
- **OSC**: `ESC ]` up to and including BEL (`\x07`) or ST (`ESC \`). Example: `\x1b]0;title\x07`.
- **DCS, SOS, PM, APC**: `ESC P`, `ESC X`, `ESC ^`, `ESC _` up to and including ST.
- **Other two-byte escapes**: `ESC` followed by one byte `0x40–0x5F` that does not start one of the above
  (for example `\x1b=`, `\x1b>`), and `ESC` followed by `0x20–0x2F` intermediates then a final `0x30–0x7E`
  (for example `\x1b(B`).
- Nothing else: `\r`, `\n`, `\t` and every printable character stay, including `\x07` outside an OSC.

A sequence that a piece ends inside (for example a piece ending in `\x1b[` or `\x1b]0;tit`) is held and joined with
the next piece; the text before it is returned at once.

**A held string is bounded** (amended 2026-10-12, athena on #341; brief 311a9f5, after the DEC VT500 parser). An OSC,
DCS, SOS, PM or APC string ends at BEL (OSC only) or ST, and is also **cancelled** by:
- any other ESC: the string is dropped up to that ESC, and the ESC starts the next sequence;
- CAN (`\x18`) or SUB (`\x1a`): the string is dropped up to and including that byte.

And a string still open once more than 4096 characters from its ESC have arrived is **dropped through the next line
end** (the line end included), and the text after that line end flows as plain text (ruled on #341, option (ii);
brief c213613). When the piece holds no line end after the cap, the filter keeps dropping the following pieces up to
and including the first line end. The tail of an endless string is junk, and dropping it keeps it out of the line the
prompt matcher reads; the next line starts clean, so a stray `ESC ]` in a host's banner can never swallow the password
prompt or a marker that follows. A string whose terminator (or a cancelling byte) arrives before the cap ends normally,
also when it arrives in the piece that crosses 4096.

### 2.3 The recording fake (`lib-ssh/src/testing/recording-terminal.ts`)

```ts
/** Login terminals that record what was opened and sent, and that a test drives. */
export class RecordingTerminals implements LoginTerminals {
  /** Every terminal opened, in order. */
  readonly opened: RecordingTerminal[];
  open(invocation: Invocation, name: LoginTerminalName, reveal: boolean): LoginTerminalSession;
}

/** One opened terminal: what it was opened with, what was sent to it, and the test's controls. */
export interface RecordingTerminal {
  readonly invocation: Invocation;
  readonly name: LoginTerminalName;
  readonly revealedAtOpen: boolean;
  /** The texts given to `send`, in order. */
  readonly sent: string[];
  /** How often `reveal` was called after the open. */
  revealCount: number;
  disposed: boolean;
  /** Delivers `raw` as the terminal's output, through the same `PlainTextFilter` the adapter uses. */
  write(raw: string): void;
  /** Ends the terminal with `code` and `reason` (hadOutput is computed). */
  end(code: number | undefined, reason?: TerminalEnd['reason']): void;
}
```

`write` after the end and `end` after the end do nothing. `dispose` ends an open terminal with
`{code: undefined, reason: 'extension'}`.

### 2.4 The adapter (`remote-ssh/src/surfaces/login-terminal.ts`)

```ts
import type * as vscode from 'vscode';
import type {LoginTerminals} from 'lib-ssh';

/** Login terminals in the editor: one terminal per open, its output read through the terminal data event. */
export function loginTerminalsOf(
  editor: Pick<typeof vscode, 'window' | 'TerminalExitReason'>,
  homeFolder: string,
): LoginTerminals;
```

`open(invocation, name, reveal)`:
1. Subscribes to `editor.window.onDidWriteTerminalData` and `editor.window.onDidCloseTerminal` **before** creating the
   terminal, so no early output or end is missed; both listeners filter on the created terminal.
2. Creates it with `editor.window.createTerminal({name, shellPath: invocation.program, shellArgs:
   invocation.arguments, cwd: homeFolder, env: invocation.environment, hideFromUser: !reveal})`. No `isTransient`, no
   trust exemption (F-2308 §16, F-3903 rule 1). `reveal` true also calls `terminal.show(false)`.
3. Each data event's `data` goes through one `PlainTextFilter` per terminal; a non-empty result is delivered.
4. The close event maps `terminal.exitStatus` to `TerminalEnd`: `code` as given; `reason` from
   `editor.TerminalExitReason` (`Process` → `'process'`, `User` → `'user'`, `Extension` → `'extension'`, `Shutdown` →
   `'shutdown'`, anything else → `'unknown'`). A missing `exitStatus` is `{code: undefined, reason: 'unknown'}`. Both
   listeners are then disposed.
5. `send(text)` is `terminal.sendText(text, false)` (no line end added: the caller decides). `reveal()` is
   `terminal.show(false)`. `dispose()` is `terminal.dispose()`, once.

The adapter imports `vscode` only as a type and takes the editor as a value (the pattern of
`lib-authority/src/resolver/vscode-resolver.ts`), so its test passes a fake `editor` object.

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 `plain-text.test.ts`

| Cite | Pieces pushed | Expected (joined results, then `flush()`) |
|---|---|---|
| #299 | `'plain text\r\n'` | `'plain text\r\n'` |
| #299 | `'\x1b[1;32mgreen\x1b[0m\n'` (CSI) | `'green\n'` |
| #299 | `'\x1b[?2004lAbC123:start\r\n'` (athena's pty run) | `'AbC123:start\r\n'` |
| #299 | `'\x1b]0;user@host: ~\x07prompt$ '` (OSC with BEL) | `'prompt$ '` |
| #299 | `'\x1b]0;title\x1b\\after'` (OSC with ST) | `'after'` |
| #299 | `'\x1bP1$r0m\x1b\\x'` (DCS) | `'x'` |
| #299 | `'a\x1b=b\x1b(Bc'` (two-byte and charset escapes) | `'abc'` |
| #299 | `'ab\x1b['`, then `'0mcd'` (CSI split) | `'ab'` then `'cd'` |
| #299 | `'\x1b]0;ti'`, then `'tle\x07rest'` (OSC split) | `''` then `'rest'` |
| #299 | `'x\x1b'`, then `'[2Ky'` (split right after ESC) | `'x'` then `'y'` |
| #299 | `'\x07bell\ttab'` (BEL outside an OSC, tab) | `'\x07bell\ttab'` |
| #299 | `'end\x1b[1'`, then `flush()` | `'end'` then `''` |
| #341 | `'motd\x1b]0;oops\r\n\x1b[0mpassword: '` (a stray OSC in a banner, cancelled by the next ESC) | `'motdpassword: '` |
| #341 | `'a\x1b]0;x\x18b'` (CAN) | `'ab'` |
| #341 | `'a\x1b]0;x\x1ab'` (SUB) | `'ab'` |
| #341 | `'a\x1b]0;x\x1bPdcs\x1b\\b'` (another string's ESC cancels the first; the DCS then ends at ST) | `'ab'` |
| #341 | `'a\x1b]0;'` + 5000 × `'z'` + `'\nnext line'` in one piece | `'anext line'` (no `z`; the line end is dropped with the string) |
| #341 | `'a\x1b]0;'` + 3000 × `'z'`, then 3000 × `'z'` + `'\nafter'` | `'a'` then `'after'` |
| #341 | `'a\x1b]0;'` + 5000 × `'z'`, then `'zz\nok'` (the cap reached with no line end in the first piece) | `'a'` then `'ok'` |
| #341 | `'a\x1b]0;'` + 3000 × `'x'`, then 2000 × `'y'` + `'\x07z'` | `'a'` then `'z'` (the terminator arrived before the cap was applied) |

### 3.2 `recording-terminal.test.ts`

| Cite | Given | Expected |
|---|---|---|
| F-2308 3.2 | `open(inv, 'install', false)` | `opened[0]` has that invocation, name `install`, `revealedAtOpen` false |
| #299 | `write('\x1b[0mhi\n')` | the session's output listener got `'hi\n'` |
| F-2308 BR-6 | `send('pw\r')` twice | `sent` is `['pw\r', 'pw\r']` |
| F-2308 BR-2 | `reveal()` | `revealCount` 1 |
| F-2308 7.E7 | `end(undefined)` with no write before | `onEnd` got `{code: undefined, reason: 'process', hadOutput: false}` |
| F-2308 | `write('x')`, `end(0)` | `onEnd` got `hadOutput: true`, `code: 0` |
| F-2308 | `write` after `end` | no output delivered |
| F-2308 | `onEnd` registered after the end | the listener is called at once with the same end |
| F-2308 | `end` twice | `onEnd` fired once |
| F-2308 | `dispose()` on an open terminal | `disposed` true and `onEnd` got `reason: 'extension'` |
| F-2308 | `dispose()` twice | `onEnd` fired once |

### 3.3 `login-terminal.test.ts` (the adapter, over a fake `editor`)

The fake `editor.window` keeps the listeners of `onDidWriteTerminalData` and `onDidCloseTerminal`, records
`createTerminal`'s options, and returns a fake terminal that records `sendText`, `show` and `dispose`.
`editor.TerminalExitReason` is `{Unknown: 0, Shutdown: 1, Process: 2, User: 3, Extension: 4}`.

| Cite | Given | Expected |
|---|---|---|
| F-2308 §16 | `open(inv, 'install', false)` | `createTerminal` options: `{name: 'install', shellPath: inv.program, shellArgs: inv.arguments, cwd: '/home/a', env: inv.environment, hideFromUser: true}` |
| F-2308 BR-2 | `open(…, true)` | `hideFromUser: false`, and `show(false)` called once |
| F-2308 BR-4 | `open(…, false)` | `show` not called |
| #299 | a data event for this terminal `'\x1b[0mok\r\n'` | output `'ok\r\n'` |
| F-2308 | a data event for **another** terminal | no output |
| #299 | a data event that strips to `''` (`'\x1b[0m'`) | no output delivered |
| F-2308 | a close event for this terminal, `exitStatus {code: 0, reason: 2}` after output | `onEnd` got `{code: 0, reason: 'process', hadOutput: true}` |
| F-2308 7.E7 | a close event with `exitStatus {code: undefined, reason: 0}`, no output | `{code: undefined, reason: 'unknown', hadOutput: false}` |
| F-2308 | each reason 1, 3, 4 | `'shutdown'`, `'user'`, `'extension'` (one `it` each) |
| F-2308 | a close event with no `exitStatus` | `{code: undefined, reason: 'unknown', hadOutput: false}` |
| F-2308 | a close event for another terminal | no `onEnd` |
| F-2308 | after the close, a data event for this terminal | no output (the listeners were disposed) |
| F-2308 BR-6 | `send('pw\r')` | `sendText('pw\r', false)` |
| F-2308 BR-2 | `reveal()` | `show(false)` |
| F-2308 | `dispose()` twice | the terminal's `dispose` called once |

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's and remote-ssh's 100/100/100 ratchets.

## 5. Gates and review

PR title `lib-ssh, remote-ssh: the login terminal port, its fake and its editor adapter (card ssh-18, terminal mode T1)`.

## 6. Open rows

None.
