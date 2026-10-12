# Task card connect-16: the login terminal's questions shown to the user (terminal mode T5, first part)

Why: athena's terminal-mode brief (T5, `brief-terminal-mode.md`; 0.2 blocker #299). In terminal mode `ssh` asks its
login questions in the login terminal. Card ssh-22's `PromptReader` (#352) reads them and reports each recognised one
with `onQuestion(text)`. Something must **show an input for every reported question**. The reader trusts its owner
to do so, and a recognised question nobody shows would wait without a bound (athena on #352). That owner then sends
the answer back to the terminal. This card is that owner. It shows each question with the **same surfaces as shared
mode** (F-2305's pick, F-2306's masked input), through the existing `PromptEditor`. The terminal branch of the connect
that uses it is card connect-17 (T5, second part). Reviewing coder: `remote-coding-worker-1`.

Depends on #352 (ssh-22, PromptReader) and #341 (ssh-18, the terminal session). Start after both are on main.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/surfaces/prompt-surface.ts` | the question-to-answer part of `show` moves out, unchanged, into an exported `askQuestion` (section 2.1) |
| `packages/remote-ssh/src/surfaces/terminal-questions.ts` | new: `attachTerminalQuestions` (section 2.2) |
| `packages/remote-ssh/test/unit/terminal-questions.test.ts` | new |
| `packages/remote-ssh/test/unit/prompt-surface.test.ts` | rows for `askQuestion` only if its coverage needs them (the existing rows already drive it) |

Nothing else. `attachPromptSurface`'s behaviour is unchanged; only its inner `askUser`/`classifyPrompt` call moves into
`askQuestion`, which it then calls (no duplicated code, ADR-0003).

## 2. Contract

### 2.1 `askQuestion` (extracted from `attachPromptSurface`)

```ts
/**
 * Shows one question as the classifier chooses (a pick for a host key, a masked input otherwise) and gives the user's
 * answer, or nothing when it was dismissed, the signal ended it, or the editor could not show it.
 */
export function askQuestion(
  editor: PromptEditor,
  text: string,
  displayHost: string,
  cancellation: AbortSignal,
): Promise<string | undefined>;
```

It is today's `classifyPrompt(text, displayHost)` followed by `askUser(surface, cancellation)`, with the `try/catch`
that turns an editor failure into `undefined`. `attachPromptSurface`'s `show` calls it and keeps the rest (the open map,
`settle`). Every existing `prompt-surface.test.ts` row passes unchanged.

### 2.2 `attachTerminalQuestions`

```ts
import type {LoginTerminalSession, PromptReader} from 'lib-ssh';

/** The terminal and the reader one login's questions come from. */
export interface TerminalLogin {
  terminal: Pick<LoginTerminalSession, 'send'>;
  reader: Pick<PromptReader, 'inputOpened' | 'inputClosed'>;
}

/** Shows each question the reader reports and answers the terminal; the returned handle takes an open input down. */
export function attachTerminalQuestions(
  login: TerminalLogin,
  editor: PromptEditor,
  displayHost: string,
): {
  /** Give this as the reader's `onQuestion`. */
  onQuestion(text: string): void;
  dispose(): void;
};
```

For each `onQuestion(text)`:
1. **`reader.inputOpened()` first, always** (athena on #352: every reported question gets an input; the reader holds
   further output from now on, F-2308 BR-6).
2. `askQuestion(editor, text, displayHost, signal)` with a fresh `AbortController`'s signal.
3. With an answer: `terminal.send(answer + '\r')` (the brief: "the answer goes back with `send(text + '\r')`"). For a
   pick, the answer is the item's `'yes'` or `'no'`, the words `ssh`'s host-key question takes (checked through a real
   pty against OpenSSH 10.2: `yes\r` at `Are you sure you want to continue connecting (yes/no/[fingerprint])?` is
   accepted and the session continues).
4. Dismissed (`undefined`): nothing is sent. The question stays in the terminal (F-2308 BR-5; the user can reveal it
   through "details" and answer there).
5. **`reader.inputClosed()` last, always**, also after a dismissal or an editor failure, so the held output is read.

- One input at a time: a question reported while an input is open is shown after it (queued, in order). The reader
  holds output while an input is open, so this only happens if the reader is driven out of order; the queue keeps
  every question shown once.
- `dispose()` aborts the open input (its `inputClosed` still runs) and drops the queue; `onQuestion` after it does
  nothing. Nothing is sent after `dispose`.
- Never logs or stores an answer or its length (contracts §S7, "Never: store or log an answer").

## 3. Test table

One assertion per `it`; the cite starts the name. The editor is the recording fake of `prompt-surface.test.ts`
(answers scripted per call); the terminal records `send`; the reader records `inputOpened`/`inputClosed` in one log
with the sends, so order can be checked.

| Cite | Given | Expected |
|---|---|---|
| F-2306 BR-2 | `onQuestion("alex@dev's password: ")`, the editor answers `secret` | the masked input's placeholder is S066 for `alex@dev` (as in shared mode) |
| F-2308 BR-6 | the same | the log is `['inputOpened', "send secret\r", 'inputClosed']` |
| F-2305 BR-2 | `onQuestion` with the 4-line first-contact block, the editor picks yes | a pick was shown, and `'yes\r'` was sent |
| F-2305 BR-2 | the same, the editor picks no | `'no\r'` was sent |
| F-2308 BR-5 | the editor dismisses (`undefined`) | nothing sent; the log is `['inputOpened', 'inputClosed']` |
| athena on #352 | the editor throws | nothing sent; `inputClosed` was called |
| athena on #352 | two questions reported back to back | two inputs shown, one after the other; the log has two `inputOpened`/`inputClosed` pairs, never two opens in a row |
| contracts | `dispose()` while an input is open | the editor's signal was aborted; `inputClosed` called; nothing sent |
| contracts | `onQuestion` after `dispose()` | no input shown |
| contracts §S7 | any answer | no log line contains the answer |
| refactor | every existing `prompt-surface.test.ts` row | passes unchanged |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet; jscpd green (the shared part lives in `askQuestion`).

## 5. Gates and review

PR title `remote-ssh: the login terminal's questions shown to the user (card connect-16, terminal mode T5)`.

## 6. Open rows

None.
