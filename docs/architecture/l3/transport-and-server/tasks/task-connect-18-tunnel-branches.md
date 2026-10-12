# Task card connect-18: the window tunnel's secondSsh and socket branches (terminal mode T7, second part)

Why: athena's terminal-mode brief (W2; T7; 0.2 blocker #299). The tunnel step builds only the SOCKS path today, and its
`secondSsh` and `socket` branches fail as "not built yet". This card builds both on card ssh-23's tunnel session (#353):
start the tunnel `ssh` in its `SSH Tunnel` terminal, show its login questions (card connect-16), pass the success-line
gate, then wait **10 s** for the forward and probe it. Reviewing coder: `remote-coding-worker-1`.

Depends on #353 (ssh-23), #352 (ssh-22), connect-16 (the questions' owner), #342 (server-14: `StartedServer.endpoint`),
connect-17 (T5, second part) and connect-19 (the window tunnel's end reported as a lost transport, whose
`TunnelOpening.onClosed` this card fills). **Start after connect-17 and connect-19 are merged.**

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/pipeline/tunnel-step.ts` | the two branches (section 2) in place of the "not built yet" interim |
| `packages/remote-ssh/test/unit/tunnel-step.test.ts` | rows for both branches (section 3); the two interim rows go |

Nothing else. lib-forwarding's `openForwardedTunnel` is used as it is; lib-ssh's tunnel session as it is.

## 2. Contract

`TunnelStepDependencies` gains:

```ts
/** The login terminals of the editor (card ssh-18). */
terminals: LoginTerminals;
/** The tunnel run's invocation for the window's port and the server's endpoint (card ssh-19's tunnel run). */
tunnelInvocation(localPort: number, target: TunnelTarget): Invocation;
/** Shows the tunnel login's questions and answers the terminal (card connect-16), for this connect's alias. */
attachQuestions(login: TerminalLogin): {onQuestion(text: string): void; dispose(): void};
/** `remote.SSH.showLoginTerminal`, read once per attempt (F-2308 BR-3). */
revealLoginTerminals(): boolean;
/** The effective connect timeout in milliseconds, for the tunnel login's unreachable-question bound (#299 ruling 1b). */
connectTimeoutMilliseconds(): number;
```

For `path === 'secondSsh'` or `'socket'`:
1. `chooseLocalPort()`; none free → `NOT_OPENED` (as today; F-2104 BR-9: no `ssh` is started).
2. The target: `secondSsh` → `{kind: 'port', port}` of a port endpoint; `socket` → `{kind: 'socket', path}` of a socket
   endpoint. An endpoint of the other kind is a defect: it throws (the pipeline turns it into `unknown`).
3. `openTunnelSession(terminals, tunnelInvocation(localPort, target), localPort, revealLoginTerminals())`.
4. A `PromptReader` over the session's output (`onOutput` → `reader.push`), with `connectTimeoutMilliseconds()`, wired
   to `attachQuestions({terminal: session, reader})`: every reported question gets an input. The reader and the
   questions are disposed when the gate settles.
5. Await `session.gate` (no bound of its own; ruled on #299):
   - `ended` → fail: `{kind: 'unknown'}` (the tunnel login failed or was cancelled, F-2104 7.E10; F-2601's dialog).
   - `forwardFailed` → stop the session; fail `{kind: 'unknown'}`, and log the failure line (F-2003).
   - `forwarded` → step 6.
6. Tell `onWaiting` (S158, "Waiting for port forwarding to be ready", F-2104 6.2 step 5), then
   `openForwardedTunnel({local, scheduler, localPort, limits: {...limits, readyMilliseconds: 10000}, stopSession:
   session.stop})`. **The 10 s start here, at the success line** (F-2104 BR-10, ruled on #299).
   - `tunnelNotReady` → fail with the reason `{id: 'S067', values: [{id: 'S089', values: []}]}` ("Error establishing
     tunnel (Max wait time exhausted).", F-2104 7.E5; the form of contracts §3.2).
   - `open` → done: the window's address, `extensionHostEnv` and `environmentTunnels` from `environment()`, and
     `close` = the outcome's `close` (which stops the session), acting once as today.
7. **The tunnel `ssh` ending after the step succeeded** is the window tunnel's own end (contracts §W2, #253 Q1; ruled
   on #299: reported as a lost transport, card connect-19). `openForwardedTunnel`'s own `onClosed` never fires (its
   session isn't its to watch), so the branch fills `TunnelOpening.onClosed` (connect-19) itself: each listener is told
   once, with the detail `the tunnel ssh ended`, when `session.onEnd` fires after the step succeeded. A `close()` the
   caller asked for doesn't fire it (§W2). A listener registered after the end hears it at once.

W3 on these paths (the user's forwarded ports) is not in this card: `tunnelFeatures` and `tunnelFactory` are left
out of the opened result, so the editor offers no port forwarding on them until F-2104 Q4 is answered (the brief:
"W3 there reports a port it can't forward instead of guessing").

## 3. Test table

One assertion per `it`; the cite starts the name. Terminals are `RecordingTerminals`; the scheduler is the fake of the
existing tunnel-step tests; `LocalPort` is the existing fake, which accepts a connect to a listening port.

| Cite | Given | Expected |
|---|---|---|
| F-2104 BR-1 | path `secondSsh`, a port endpoint 4321 | one `SSH Tunnel` terminal, with `tunnelInvocation(localPort, {kind: 'port', port: 4321})` |
| F-2410 5.0 | path `socket`, a socket endpoint `/tmp/code-ab` | the invocation's target is `{kind: 'socket', path: '/tmp/code-ab'}` |
| F-2104 BR-9 | no free local port | `NOT_OPENED`, and no terminal opened |
| #299 | path `secondSsh` with a socket endpoint | throws |
| F-2308 BR-3 | `revealLoginTerminals` true | the terminal was revealed at open |
| athena on #352 | the tunnel terminal prints `"alex@dev's password: "` and pauses 100 ms | `attachQuestions`' `onQuestion` got it |
| F-2104 7.E10 | the terminal ends before the success line | fails `{kind: 'unknown'}` |
| #299 | a forward-failure line then the success line | fails `{kind: 'unknown'}`, the session was stopped, and the log names the line |
| F-2104 6.2 step 5 | the success line | `onWaiting` was called once |
| F-2104 BR-10 | the success line, then the port never accepts | after 10 s (fake clock), fails with `{id: 'S067', values: [{id: 'S089', values: []}]}` |
| #299 | the 10 s count | a probe that would succeed 9 s **after the success line** opens the tunnel, even when the login before it took 60 s (the 10 s start at the line) |
| F-2104 6.2 | the success line, then the port accepts | done; the address is `127.0.0.1:<localPort>` |
| contracts | the result's `close` twice | the session was stopped once |
| contracts §W2 | the tunnel terminal ends after success | each `onClosed` listener heard `'the tunnel ssh ended'` once |
| contracts §W2 | `close()`, then the terminal ends | no `onClosed` listener was told |
| contracts §W2 | a listener registered after the end | it is told at once |
| F-2104 Q4 | a successful secondSsh tunnel | the opened result has no `tunnelFactory` |

The rows of the SOCKS path pass unchanged.

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the window tunnel's secondSsh and socket branches (card connect-18, terminal mode T7)`.

## 6. Open rows

None. It starts after connect-17 and connect-19.
