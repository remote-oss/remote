# Task card ssh-22: login questions read from the terminal (terminal mode T2)

Why: athena's terminal-mode brief (`brief-terminal-mode.md`, T2; rulings on #299, brief a800435). In terminal mode
`ssh` asks its questions in the login terminal, not through askpass. With `remote.SSH.showLoginTerminal` off, the
questions the extension recognises become inputs (F-2308 BR-4), and everything else stays in the hidden terminal (BR-5).
This card is the pure reader that turns the terminal's plain-text output (card ssh-18) into "a question is waiting:
this one", plus the bound for a question nobody can reach. It shows nothing itself; T5 wires it to the editor's inputs.
Reviewing coder: `remote-coding-worker-1`.

Depends on #341 (ssh-18, merged: the plain-text output). Start after it is on main.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/terminal/prompt-reader.ts` | new: `PromptReader` and `isTerminalPrompt` (section 2) |
| `packages/lib-ssh/src/diagnostics/setup-report.ts` | a second marker `'handshake'` (section 2.4) |
| `packages/lib-ssh/src/index.ts` | export `PromptReader`, its types, `isTerminalPrompt`, `PARTIAL_LINE_PAUSE_MILLISECONDS` |
| `packages/lib-ssh/test/unit/prompt-reader.test.ts` | new |
| `packages/lib-ssh/test/unit/setup-report.test.ts` | rows for the new marker |

Nothing else. `classifyPrompt` is unchanged: the reader decides *whether* a text is a terminal prompt and passes the
text on; `classifyPrompt` still decides the surface.

## 2. Contract

### 2.1 Which texts are prompts in terminal mode

```ts
/** Whether the text of a question is one terminal mode recognises (F-2308 BR-4; F-2305 BR-2; F-2307 AC-23). */
export function isTerminalPrompt(text: string): boolean;
```

True when the text's **last line** (the partial one), with trailing white space removed (`trimEnd()`: ssh ends every
prompt with a space, which the anchored host-key pattern would otherwise miss), is one of:
- a line ending with `'s password:` (F-2306 BR-2 rule 1: ssh's password method and keyboard-interactive `…'s password:`);
- a line ending with `Password:` (BR-2 rule 2);
- a line ending with `Verification code:` (BR-2 rule 3, ssh's `(<user>@<host>) Verification code:`);
- `Are you sure you want to continue connecting (yes/no/[fingerprint])?` or `… (yes/no)?`, the host-key question
  (F-2305 BR-2, both modes, ruled on #299; `classifyPrompt`'s `CONTINUE_QUESTION` pattern);
- a line matching `Enter passphrase for key '<path>':` (F-2307 AC-23, ruled on #299).

Anything else is not a prompt: no input is shown for it (F-2308 6.3, BR-5). `classifyPrompt`'s raw fallback
(rule 5) does not apply. Reuse `classifyPrompt.ts`'s patterns (export the two it holds privately, `CONTINUE_QUESTION`
and `PASSPHRASE_QUESTION`) rather than writing them twice.

### 2.2 The reader

```ts
/** The pause before the pending partial line is matched: a prompt is ssh's last write before it waits. */
export const PARTIAL_LINE_PAUSE_MILLISECONDS = 100;

/** What the reader tells its owner. */
export interface PromptReaderEvents {
  /** A question is waiting: its candidate text (section 2.3), ready for `classifyPrompt`. */
  onQuestion(text: string): void;
  /** No answer can reach a question: the bound of section 2.4 passed. */
  onUnreachable(): void;
}

/** Reads a login terminal's plain-text output and tells when a recognised question waits. */
export class PromptReader {
  constructor(scheduler: Scheduler, timeoutMilliseconds: number, events: PromptReaderEvents);
  /** The next plain-text piece of the terminal's output. */
  push(text: string): void;
  /** The owner showed an input for the last question; output is held until `inputClosed`. */
  inputOpened(): void;
  /** The input was answered or dismissed; held output is read now. */
  inputClosed(): void;
  /** The attempt is over; nothing fires afterwards. */
  stop(): void;
}
```

Rules:
- **Lines.** Output goes through one `LineSplitter`; complete lines are kept in a window of the **last 20** (ruled on
  #299). The partial line (text after the last line end) is kept apart.
- **When the partial line is tried.** After each `push`, a timer of `PARTIAL_LINE_PAUSE_MILLISECONDS` is (re)armed;
  when it fires with a non-empty partial line, the candidate text (2.3) is tried with `isTerminalPrompt`. A match
  calls `onQuestion(candidate)` once for that partial line. A fragment that doesn't match yet is simply tried again
  after the next pause (athena: the pause is an optimisation, not what makes it correct).
- **After a question.** The window of lines is cleared (the next question's text starts fresh), and the same partial
  line is not reported twice.
- **Held output (F-2308 BR-6).** Between `inputOpened` and `inputClosed`, `push` only buffers. `inputClosed` replays
  the buffered text through the same path, in order. No bound on an open input (F-2306 BR-7, ruled on #299).
- **`stop`** cancels every timer; `push`, `inputOpened` and `inputClosed` after it do nothing.

### 2.3 The candidate text

The complete lines since the last recognised question (or since the reader started), capped at the last 20, joined
with `\n`, then `\n` and the partial line. With no complete lines, just the partial line. `classifyPrompt` looks back
from the question line for the fingerprint; the first-contact question is 4 lines and the changed-key block 13
(measured by athena on OpenSSH 10, #299).

### 2.4 The unreachable-question bound (ruled on #299)

- The reader is given `timeoutMilliseconds`: the effective connect timeout (the looked-up `ConnectTimeout`, else the
  setting, F-2105 BR-1), in milliseconds. No new number.
- It counts only **after the handshake** and only **while no input is open**: once the handshake line (below) has
  been read, each `push` re-arms a silence timer of `timeoutMilliseconds`; it fires `onUnreachable` when it runs out
  with a non-empty partial line that is not a recognised prompt (a question nobody can see) and no input open.
  `inputOpened` pauses it, `inputClosed` re-arms it.
- Before the handshake, ssh's own `ConnectTimeout` ends the attempt (F-2308 BR-5), so the reader's bound doesn't run.
- **The handshake line** (ruled on #299: athena measured it with a first-contact password login, the host-key question
  at line 51, NEWKEYS sent at 55, received at 59, `password:` at 70, `Authenticated to` at 71). `setup-report.ts`
  gains a marker `'handshake'`
  for the line `debug1: SSH2_MSG_NEWKEYS received` (OpenSSH's `-v` line at the end of key exchange, measured on 10.2:
  after `Server host key:` and before any password prompt; a first-contact host-key question falls before it).
  `setupMarkerOf` returns `'handshake'` for that exact line (trimmed of a trailing `\r`), `'authenticated'` as
  today, otherwise `undefined`. The reader looks for it in each complete line.

## 3. Test table

One assertion per `it`; the cite starts the name. The scheduler is the fake of `shell-runs.test.ts`; `advance(ms)`
fires due timers. `timeoutMilliseconds` is 15000 unless a row says otherwise.

### 3.1 `isTerminalPrompt`

| Cite | Text | Expected |
|---|---|---|
| F-2306 BR-2 | `"alex@dev's password: "` | true |
| F-2306 BR-2 | `'Password: '` | true |
| F-2306 BR-2 | `'(alex@dev) Verification code: '` | true |
| F-2305 BR-2 | the 4-line first-contact block ending `'Are you sure you want to continue connecting (yes/no/[fingerprint])? '` | true |
| F-2307 AC-23 | `"Enter passphrase for key '/home/a/.ssh/id_ed25519': "` | true |
| F-2308 6.3 | `'Enter your OTP token: '` (any other question) | false |
| F-2308 6.3 | `'Last login: Mon Oct 12 07:00:00 2026'` | false |
| F-2308 6.3 | `"alex@dev's password: "` as an earlier line, with `'$ '` as the last line | false (only the last line counts) |

### 3.2 The reader

| Cite | Given | Expected |
|---|---|---|
| F-2308 BR-4 | push `"alex@dev's password: "`, advance 100 | `onQuestion` once with `"alex@dev's password: "` |
| #299 | push it, advance 99 | no `onQuestion` yet |
| #299 | push `"alex@dev's pa"`, advance 100, push `"ssword: "`, advance 100 | `onQuestion` once, with the whole line |
| F-2305 BR-2 | push the 4-line first-contact block's three complete lines, then the question as the partial line, advance 100 | `onQuestion` with the 4 lines joined by `\n` |
| #299 | push 25 complete lines, then `'Password: '`, advance 100 | the candidate holds the last 20 lines and the partial line (21 lines) |
| #299 | a question, then (after the owner's `inputOpened`/`inputClosed`) `"Password: "` again | the second candidate holds no line from before the first question |
| F-2308 6.3 | push `'Enter your OTP token: '`, advance 100 | no `onQuestion` |
| #299 | the same partial line, advance 100 twice | `onQuestion` once |
| F-2308 BR-6 | `inputOpened`, push `"Password: "`, advance 100 | no `onQuestion` (held) |
| F-2308 BR-6 | then `inputClosed`, advance 100 | `onQuestion` once |
| F-2306 BR-7 | `inputOpened`, then advance 10 × `timeoutMilliseconds` | no `onUnreachable` (an open input has no bound) |
| #299 ruling 1(b) | handshake line read, then push `'Enter your OTP token: '`, advance `timeoutMilliseconds` | `onUnreachable` once |
| #299 ruling 1(b) | the same without the handshake line | no `onUnreachable` (ssh's own timeout applies before it) |
| #299 ruling 1(b) | handshake read, then `'Enter your OTP token: '`, advance `timeoutMilliseconds` − 1, push `'more'` (re-arms), advance `timeoutMilliseconds` − 1 | no `onUnreachable` |
| #299 ruling 1(b) | handshake read, output silent with an **empty** partial line for 2 × `timeoutMilliseconds` | no `onUnreachable` (nothing is waiting) |
| #299 ruling 1(b) | handshake read, `inputOpened`, silent 2 × timeout, `inputClosed`, then push `'Enter your OTP token: '` and advance `timeoutMilliseconds` | `onUnreachable` once (nothing counted while the input was open) |
| contracts | `stop()`, then push `"Password: "`, advance 100 | no `onQuestion` |
| contracts | `stop()` with timers armed | no event fires afterwards |

### 3.3 `setup-report.ts`

| Cite | Line | `setupMarkerOf` |
|---|---|---|
| #299 | `'debug1: SSH2_MSG_NEWKEYS received'` | `'handshake'` |
| #299 | `'debug1: SSH2_MSG_NEWKEYS received\r'` | `'handshake'` |
| #299 | `'debug1: SSH2_MSG_NEWKEYS sent'` | `undefined` |
| F-2308 BR-5 | `'Authenticated to dev ([10.0.0.1]:22) using "publickey".'` | `'authenticated'` (unchanged) |

Every row of 3.2 was checked on a prototype of the reader written from sections 2.2–2.4 (2026-10-12).

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: login questions read from the terminal (card ssh-22, terminal mode T2)`.

## 6. Open rows

None. Every row is ruled on #299 (brief a800435 and the handshake marker after it).
