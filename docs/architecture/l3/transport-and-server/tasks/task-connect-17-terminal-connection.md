# Task card connect-17: the connection in terminal mode (terminal mode T5, second part)

Why: athena's terminal-mode brief (T5; rulings on #299, brief 3d82e01). With the shared connection off
(`remote.SSH.useLocalServer` false, or socket mode on), each window runs its own `ssh` in an `install` terminal: no
helper, no lease (F-2102 BR-10). Card connect-15's interim fails such a connect in `validate`; this card replaces it
with the real thing: a second connection step that opens the install terminal, logs in through it (card connect-16
shows the questions), hands over at `Authenticated to`, and gives the server steps a channel over that terminal (card
ssh-21). The shared step is untouched; the wiring picks one by mode. Reviewing coder: `remote-coding-worker-1`.

Depends on #352 (ssh-22), #351 (ssh-21), connect-16, and #345 (E6c-2, the wiring). Start after all are on main.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/pipeline/terminal-connection-step.ts` | new: `openTerminalConnectionStep` (section 2.1) |
| `packages/remote-ssh/src/pipeline/server-steps.ts` | connect-15's check in `validate` goes (section 2.3) |
| `packages/remote-ssh/src/pipeline/wiring.ts` | `openConnection` by mode (section 2.2) |
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | the named id `trustRefused` (section 2.4) |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | its key |
| `packages/remote-ssh/test/unit/terminal-connection-step.test.ts` | new |
| `packages/remote-ssh/test/unit/server-steps.test.ts`, `wiring.test.ts`, `failure-strings.test.ts`, `strings.test.ts` | rows changed and added (section 3) |

## 2. Contract

### 2.1 `openTerminalConnectionStep`

```ts
export interface TerminalConnectionDependencies {
  terminals: LoginTerminals;
  /** The install connection's request (card ssh-19's install run: remote program `sh`, `-T`, and with dynamic forwarding
   *  on our `-D` port; with it off, `clearUserForwards`) for this connect. */
  installRequest(input: ConnectInput, terms: ConnectionTerms, socksPort: number | undefined): SshRequest;
  /** Whether the window tunnel takes the SOCKS path, so the install ssh holds the `-D`. */
  dynamicForwarding(): boolean;
  /** A free loopback port for the `-D`, bound and released (the shared client's `freePort`). */
  freePort(): Promise<number>;
  scheduler: Scheduler;
  newMarker(): string;
  /** The channel over the install terminal's runner (a `SharedSessionChannel` with card ssh-21's runner). */
  channelFor(runner: SessionRunner, terms: ConnectionTerms): HostChannel;
  /** Shows the login's questions (card connect-16) for this connect. */
  attachQuestions(login: TerminalLogin, input: ConnectInput): {onQuestion(text: string): void; dispose(): void};
  /** `remote.SSH.showLoginTerminal`, read once per attempt (F-2308 BR-3). */
  revealLoginTerminals(): boolean;
  /** The effective connect timeout in milliseconds (the T2 reader's unreachable bound). */
  connectTimeoutMilliseconds(): number;
  logger: Logger;
}

export function openTerminalConnectionStep(
  dependencies: TerminalConnectionDependencies,
): ConnectSteps['openConnection'];
```

Per connect:
1. `socksPort = dynamicForwarding() ? await freePort() : undefined`.
2. Open the terminal: `terminals.open(buildInvocation(installRequest(input, terms, socksPort)), 'install',
   revealLoginTerminals())` (F-2308 BR-9: one per attempt, never reused; F-2704 BR-1: `sh`, no pty).
3. Its output goes, in order, to a `LineSplitter` (for the markers and the failure lines, kept for classification),
   and to a `PromptReader` (card ssh-22) whose `onQuestion` is `attachQuestions({terminal, reader}, input).onQuestion`
   (athena on #352: every reported question gets an input) and whose bound is `connectTimeoutMilliseconds()`.
4. **The handover (ruled on #299):** the first complete line for which `setupMarkerOf` gives `'authenticated'`
   (`Authenticated to … using "…"`, the same marker as shared mode) ends the login. The reader and the questions are
   disposed, and the step answers `done` with the lease of 2.1.5.
5. The lease: `channel` = `channelFor(new TerminalSessionRunner({terminal, scheduler, newMarker}), terms)`;
   `socksPort` = the `-D` port, or `0` without one (only the SOCKS path reads it, and it runs only with dynamic
   forwarding on); `storeSharedRecord` resolves `false` (no persisted data in this mode, F-2410 BR-5);
   `onNotice(listener)` tells `{type: 'transportLost'}` once when the terminal ends **after** the handover (F-2308
   BR-7: its end ends the window's connection), and returns its unsubscribe; `answer`/`refuse` resolve `false` (no
   notices carry questions here); `release()` disposes the terminal, once.
6. **Failures before the handover:**
   - the terminal ends with `{code: undefined, hadOutput: false}` → `{kind: 'cancelled', reason: {id: 'trustRefused'}}`
     (the workspace-trust "Cancel", F-2308 7.E7/AC-24; ruled: permanent, so reconnection doesn't ask trust again);
   - it ends otherwise → classified as `classify(lines, code, 'connection', 'terminal')` (S5; ruled on #299): its kind,
     reason and hints, as shared mode's login failure gives them;
   - the reader's `onUnreachable` → the terminal is disposed and the step fails `{kind: 'timeout'}` (ruling 1b);
   - `cancellation` aborts → the terminal is disposed, `{kind: 'cancelled'}`.
   Every failure disposes the reader, the questions and the terminal.
7. **The connect wait** (timeout + 2 s, F-2105 BR-3) **ends at the terminal's first output** (ruling 4). It is
   started after the platform choice, which the pipeline's order already guarantees (decideTerms runs before this
   step), so this step starts it at the open and stops it at the first non-empty output; past it, `{kind:
   'timeout'}`. Use lib-ssh's `ConnectWait` with `connectTimeoutSeconds` and `fromHost` as the shared helper does.

### 2.2 The wiring by mode

`stepsOf` (wiring.ts) builds `openConnection` as `effectiveUseLocalServer(connectionSettings)` ? today's shared step :
`openTerminalConnectionStep(...)`, decided when the step runs (the setting is read live, F-2102 BR-9). `WiringPorts`
gains the terminal step's ports (`terminals`, `freePort`, `newMarker`, `channelForRunner`, `revealLoginTerminals`).

### 2.3 connect-15's interim goes

`validate`'s `effectiveUseLocalServer` check and its log line are removed; its rows go (section 3). The tunnel step's
own interim stays until card connect-18.

### 2.4 `trustRefused`

`FAILURE_TEMPLATES` gains the named id `trustRefused` with the template `Got bad result from install script` (the
spec's English, F-2308 7.E7, without the final period; no STR id, F-2410 3.4 marks it unmapped; ruled on #299). The
same text is a key in all 15 bundles. `reasonText({id: 'trustRefused'})` then gives it, and the dialog's S031 adds the
host and the full stop.

## 3. Test table

One assertion per `it`; the cite starts the name. Terminals are `RecordingTerminals`; the scheduler is the fake of
`shell-runs.test.ts`; questions are a recording fake of connect-16's handle.

### 3.1 `terminal-connection-step.test.ts`

| Cite | Given | Expected |
|---|---|---|
| F-2308 3.2 | a connect | one terminal named `install`, revealed as `revealLoginTerminals()` says |
| F-2704 BR-1 | its invocation | ends with `--`, the host, `sh`; has `-T` |
| F-2104 6.3 | dynamic forwarding on, `freePort` gives 41000 | the invocation has `-D 127.0.0.1:41000`, and the lease's `socksPort` is 41000 |
| F-2104 6.2 step 1 | dynamic forwarding off | `-o ClearAllForwardings=yes` and no `-D` |
| #299 | the terminal writes `debug1: …\nAuthenticated to dev ([10.0.0.1]:22) using "publickey".\n` | `done`, with a lease |
| athena on #352 | before that, `"alex@dev's password: "` and a 100 ms pause | `attachQuestions`' `onQuestion` got it |
| F-2308 7.E7 | the terminal ends `{code: undefined, hadOutput: false}` before the handover | `{kind: 'cancelled', reason: {id: 'trustRefused'}}` |
| #299 | it ends with code 255 after `ssh: Could not resolve hostname dev: Name or service not known` | the kind and reason `classify` gives for it (`unreachable`, S032) |
| F-2308 BR-5 | after the handshake marker, an unrecognised question and silence for the timeout | `{kind: 'timeout'}`, terminal disposed |
| F-2105 BR-3 | no output at all for the connect wait (timeout + 2 s) | `{kind: 'timeout'}` |
| ruling 4 | the first output arrives, then the login takes longer than the wait | not a timeout (the wait stopped at the first output) |
| contracts | cancellation aborts during the login | `{kind: 'cancelled'}`, terminal disposed |
| F-2410 BR-5 | the lease's `storeSharedRecord` | resolves `false` |
| F-2308 BR-7 | the terminal ends after the handover | the lease's `onNotice` listener heard `{type: 'transportLost'}` once |
| contracts | `release()` twice | the terminal disposed once |
| contract S10 | the lease's channel runs a script | the commands were sent to the terminal (the runner is wired) |

### 3.2 Elsewhere

| File | Rows |
|---|---|
| `server-steps.test.ts` | connect-15's eight rows go; validate passes with `useLocalServer` false |
| `wiring.test.ts` | `useLocalServer` true → the shared step (acquire called); false → the terminal step (a terminal opened); socket mode → the terminal step |
| `failure-strings.test.ts` | the key list gains `trustRefused`; `reasonText({id: 'trustRefused'}, same)` is `'Got bad result from install script'` |
| `strings.test.ts` | the default bundle gains the key |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the connection in terminal mode (card connect-17, terminal mode T5)`.

## 6. Open rows

None. The handover and `trustRefused` are ruled on #299 (brief 3d82e01).
