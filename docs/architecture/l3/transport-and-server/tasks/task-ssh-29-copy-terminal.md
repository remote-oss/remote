# Task card ssh-29: the window's `scp` runs in a hidden login terminal (#253 Q11 b)

Why: #253 Q11, ruled option (b) (contracts §S10). F-2405 BR-8: "The copy is a hidden terminal task; therefore VS Code
core's workspace-trust gate for terminal processes applies", and AC-9 asserts the trust dialog for it. Today
`SshHostChannel.copyToHost` runs `scp` as a plain process, which never meets that gate. #140's interim gives it an
empty askpass environment, so a password host's copy fails at once as `copyFailed`. That interim skips AC-9 and is a
**0.2 release blocker** under #299. This card builds the ruled copy: `scp` in a hidden S8 login terminal. Its output
goes through T2's prompt reader and its questions through connect-16's owner, as the install terminal's do.
Reviewing coder: `remote-coding-worker-1`.

Depends on ssh-27 (#390, `connectWaitMilliseconds`) and ssh-28 (#391, `scp -v` and `ConnectTimeout`). **Start after
both are merged.**

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/terminal/login-terminal.ts` | `LoginTerminalName` gains `'Copy VS Code Server'`; `TerminalLogin` moves here (section 2.3) |
| `packages/lib-ssh/src/terminal/terminal-copy.ts` | new: `terminalCopierOf` (section 2.1) |
| `packages/lib-ssh/src/process/host-channel.ts` | `SshHostChannelOptions.copier?`; `copyToHost` uses it when set (section 2.2) |
| `packages/lib-ssh/src/index.ts` | export `terminalCopierOf`, `type Copier`, `type TerminalCopierOptions`, `type TerminalLogin` |
| `packages/remote-ssh/src/surfaces/terminal-questions.ts` | imports `TerminalLogin` from `lib-ssh` instead of defining it |
| `packages/remote-ssh/src/pipeline/terminal-connection-step.ts` | imports `TerminalLogin` from `lib-ssh` instead of its private copy |
| `packages/remote-ssh/test/unit/terminal-questions.test.ts` | imports `TerminalLogin` from `lib-ssh` |
| `packages/lib-ssh/test/unit/terminal-copy.test.ts` | new: the rows of section 3.1 |
| `packages/lib-ssh/test/unit/host-channel.test.ts` | the rows of section 3.2 |

Nothing else in remote-ssh: #140 E6c-3a (daedalus) wires the copier into the direct channel, in place of the empty
askpass interim.

## 2. Contract

### 2.1 `terminalCopierOf`

```ts
/** Copies one file to the host. */
export type Copier = (request: CopyRequest) => Promise<CopyOutcome>;

export interface TerminalCopierOptions {
  terminals: LoginTerminals;
  scheduler: Scheduler;
  /** The `scp` invocation of a copy (the channel builds it from its run base, card ssh-28's arguments). */
  invocationFor(copy: {localFile: string; remotePath: string}): Invocation;
  /** The connect wait's settings for this connect. */
  connectWait(): ConnectWaitSettings;
  /** Shows the copy login's questions and answers them in the terminal (connect-16's owner, for this connect's host). */
  attachQuestions(login: TerminalLogin): {onQuestion(text: string): void; dispose(): void};
  /** `remote.SSH.showLoginTerminal`, read once per copy (F-2308 BR-3); false keeps the terminal hidden (F-2405 AC-10). */
  revealLoginTerminals(): boolean;
}

export function terminalCopierOf(options: TerminalCopierOptions): Copier;
```

`TerminalLogin` is the `{terminal, reader}` pair the install terminal's owner already takes (connect-16; section 2.3).
Per copy:

1. `cancellation` already aborted: `failFrom('cancelled', 'cancelled before the copy')`, and no terminal is opened.
2. Open `terminals.open(invocationFor({localFile, remotePath}), 'Copy VS Code Server', revealLoginTerminals())`.
3. Build the same three parts as the install terminal (T5, `terminal-connection-step.ts`), over this terminal:
   - a `ConnectWait(connectWait(), scheduler, onTimeout)`, started at once and stopped at the first output, as T5's is;
   - a `PromptReader(scheduler, connectWaitMilliseconds(connectWait()), {onQuestion, onUnreachable})`;
   - `attachQuestions({terminal, reader})`, whose `onQuestion` the reader's `onQuestion` calls.

   The terminal's output goes to the reader (`terminal.onOutput(text => reader.push(text))`) and into a
   `LineSplitter` that keeps the last 20 lines, for a failure's detail.
4. It settles once, on the first of:

| Event | Outcome |
|---|---|
| the terminal ends with code `0` | `{kind: 'copied'}` |
| the terminal ends with code `255` | `failFrom('channelClosed', 'scp could not keep the connection: <last lines>')` |
| the terminal ends with any other code | `failFrom('copyFailed', 'scp failed: <last lines>')` |
| the terminal ends with no code, no output, and a reason other than `user` | `failFrom('cancelled', 'the terminal did not start: the workspace was not trusted')` (F-2405 7.E7: "Cancel" in the trust dialog; the same rule as T5's `trustRefused`) |
| the terminal ends with no code in any other case (closed by the user, shut down) | `failFrom('cancelled', 'the copy terminal was closed')` |
| the connect wait runs out, or the reader reports an unreachable question | `failFrom('timeout', 'the copy login did not finish')`, and the terminal is disposed |
| `cancellation` aborts | `failFrom('cancelled', 'cancelled by the caller')`, and the terminal is disposed |

   `<last lines>` is the kept lines joined with `\n`, after `splitter.flush()`. The codes and kinds are those of
   today's process copy, so both copies fail alike.
5. On settling, in every case: stop the wait and the reader, dispose the questions, remove the abort listener; on a
   code `0` the terminal has already ended, and otherwise it is disposed (`dispose` is safe after the end).

### 2.2 `SshHostChannel`

`SshHostChannelOptions` gains `copier?: Copier`. `copyToHost` keeps its first check (cancelled before the copy). Then,
when `copier` is set, it returns `copier(request)`; otherwise it runs the process copy exactly as today. Nothing else in
the channel changes.

### 2.3 `TerminalLogin` moves to lib-ssh

It is defined twice in remote-ssh today (exported from `surfaces/terminal-questions.ts`, and privately again in
`pipeline/terminal-connection-step.ts`), and lib-ssh's copier now needs it too. It moves, unchanged, to
`login-terminal.ts`:

```ts
/** The terminal and the reader one login's questions come from. */
export interface TerminalLogin {
  terminal: Pick<LoginTerminalSession, 'send'>;
  reader: Pick<PromptReader, 'inputOpened' | 'inputClosed'>;
}
```

(`PromptReader` is imported as a type from `./prompt-reader.ts`.) Both remote-ssh files import it from `lib-ssh`; the
private copy goes.

## 3. Test table

One assertion per `it`; the cite starts the name. `RecordingTerminals` for the terminals, `FakeClock` for the
scheduler, a fixed invocation `{program: '/x/scp', arguments: ['-v', '--', 'a', 'h:b'], environment: {}}`, a
`connectWait` of 10 s from the setting (`{connectTimeoutSeconds: 10, fromHost: false, unboundedWaitSeconds: 600}`),
and an `attachQuestions` fake that records the questions.

### 3.1 `terminal-copy.test.ts`

| Cite | Given | Expected |
|---|---|---|
| F-2405 BR-8 | a copy | one terminal opened, named `Copy VS Code Server`, with the invocation `invocationFor` gave for the request |
| F-2405 AC-10 | `revealLoginTerminals` false | the terminal was not revealed |
| F-2308 BR-3 | `revealLoginTerminals` true | it was revealed at open |
| F-2405 5.0 step 7 | the terminal ends with code 0 | `{kind: 'copied'}` |
| F-2405 7.E7 | the terminal ends with code 1 after printing `scp: /x: Permission denied` | `copyFailed`, and the detail contains that line |
| F-2603 | the terminal ends with code 255 after `Host key verification failed.` | `channelClosed`, and the detail contains that line |
| F-2405 AC-9 | the terminal ends with no code, no output, reason `process` (trust refused) | `cancelled`, detail `the terminal did not start: the workspace was not trusted` |
| F-2405 7.E7 | the terminal ends with no code, reason `user` | `cancelled`, detail `the copy terminal was closed` |
| #253 Q11 | the terminal prints `alex@dev's password: ` and pauses 100 ms | `attachQuestions`' `onQuestion` got it |
| F-2105 BR-3 | no output for 12 000 ms (the wait's length) | `timeout`, and the terminal was disposed |
| F-2105 BR-3 | no output for 11 999 ms | not settled |
| F-2308 BR-5 | the handshake line, then `Some unknown question? `, then 12 000 ms | `timeout` |
| F-2308 BR-5 | the handshake line, then the same question, then 11 999 ms | not settled |
| contracts | `cancellation` aborts while the copy runs | `cancelled`, and the terminal was disposed |
| contracts | `cancellation` already aborted | `cancelled`, and no terminal was opened |
| contracts | the terminal ends with code 0, then later code 1 is reported again | settles once, `copied` |
| connect-16 | any outcome | the questions were disposed once |

### 3.2 `host-channel.test.ts`

| Cite | Given | Expected |
|---|---|---|
| #253 Q11 | a channel with a `copier` that answers `copied`, then `copyToHost` | `copied`, the copier was called once with the request, and no process was spawned |
| #253 Q11 | a channel with a `copier`, and the cancellation already aborted | `cancelled`, and the copier was not called |
| S10 | a channel without `copier` | the existing process-copy rows pass unchanged |

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet. Mirror T5's structure in `terminal-connection-step.ts`
(the `finished` flag, `takeDown`, `fail`) rather than inventing a new one; jscpd must stay at 0 clones, so share a
helper with T5 if a block repeats.

## 5. Gates and review

PR title `lib-ssh: the window's scp runs in a hidden login terminal (card ssh-29, #253 Q11)`.

## 6. Open rows

None. Ruled on #253 Q11 (contracts §S10) and Q13 (§S2). The terminal's name is ours: F-2405 BR-8 says the copy task's
name "is not visible to the user and is free".
