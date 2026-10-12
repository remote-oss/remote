# Task card ssh-23: the tunnel session in its terminal, gated by the success line (terminal mode T7, core)

Why: athena's terminal-mode brief (`brief-terminal-mode.md`, W2; the gate ruled on #299). The secondSsh and socket
paths open the window's port through a **second** `ssh` in an `SSH Tunnel` terminal (F-2104 6.2 step 4, 6.8 step 4),
run with card ssh-19's tunnel invocation. With our local port taken, that `ssh` doesn't fail: it warns, prints its
success line and keeps running, and a readiness probe would then reach whoever holds the port. **Ruled:** the
success line is a **gate**. `ssh` sets up its local forwards before it sends the remote command (structural; athena,
10 of 10 runs through a pty), so a forward-failure line for our port always comes **before** the success line. This
card is the session that runs the tunnel `ssh` in its terminal and reports, at the gate, whether our forward was set
up. The 10 s readiness wait and the probe that follow it, and the tunnel step's two branches, are card T7b, after T5
fixes how a terminal's questions reach the editor. Reviewing coder: `remote-coding-worker-1`.

Depends on #341 (ssh-18) and #340 (ssh-19), both merged.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/terminal/tunnel-session.ts` | new: `openTunnelSession` (section 2) |
| `packages/lib-ssh/src/index.ts` | export `openTunnelSession`, its types, `TUNNEL_SUCCESS_LINE` |
| `packages/lib-ssh/test/unit/tunnel-session.test.ts` | new |

Nothing else. lib-forwarding stays free of lib-ssh (contracts §6: "the `ssh -N -L` second-session adapter stays
lib-ssh's").

## 2. Contract

```ts
import type {Invocation} from '../arguments/invocation.ts';
import type {LoginTerminals} from './login-terminal.ts';

/** The tunnel run's own line, the remote command's output (F-2308 BR-10). */
export const TUNNEL_SUCCESS_LINE = 'Connected to SSH Host - Please do not close this terminal';

/** How the tunnel session got past its gate, or why it didn't. */
export type TunnelGate =
  | {kind: 'forwarded'}
  | {kind: 'forwardFailed'; line: string}
  | {kind: 'ended'};

/** A tunnel `ssh` running in its terminal. */
export interface TunnelSession {
  /** Settles once: at the success line (forwarded or forwardFailed), or when the terminal ends first (ended). */
  gate: Promise<TunnelGate>;
  /** Each plain-text piece of the terminal's output, for the login's question reader (T2) and the log. */
  onOutput(listener: (text: string) => void): void;
  /** Calls `listener` once when the terminal ends, also after the gate. */
  onEnd(listener: () => void): void;
  /** Writes to the terminal (an answer to a login question). */
  send(text: string): void;
  /** Ends the tunnel: closes its terminal. Safe to call more than once. */
  stop(): void;
}

/** Starts `invocation` (card ssh-19's tunnel run) in an `SSH Tunnel` terminal for the window's `localPort`. */
export function openTunnelSession(
  terminals: LoginTerminals,
  invocation: Invocation,
  localPort: number,
  reveal: boolean,
): TunnelSession;
```

Rules:
- It opens `terminals.open(invocation, 'SSH Tunnel', reveal)` (F-2308 3.2, F-2104 6.2 step 4).
- The terminal's output (already plain text, card ssh-18) goes through one `LineSplitter`; each complete line is
  checked, in order, until the gate settles:
  - a **forward-failure line for our port** is remembered (the first one only): a line that equals
    `Could not request local forwarding.`, or one whose text after its last `cannot listen to port: ` is exactly our
    port number (`18111`, not `181110`: a whole-number match, so another forward's failure doesn't count). Other
    lines, `bind [127.0.0.1]:<port>: Address already in use` included, are not remembered;
  - the line `TUNNEL_SUCCESS_LINE` settles the gate: `forwardFailed` with the first remembered failure line if there
    is one, else `forwarded`.
- The terminal ending before the success line settles the gate `ended` (the tunnel login failed or was cancelled,
  F-2104 7.E10, or `ssh` exited through the user's own `ExitOnForwardFailure`, 7.E7).
- **No bound of its own.** Before the gate the tunnel's login may ask questions (F-2104 6.2 step 4), which follow T2's
  rules: a shown question waits without limit (F-2306 BR-7), and an unreachable one is ended by T2's reader. The 10 s
  readiness wait starts **at** the success line and belongs to T7b (ruled on #299).
- After the gate, lines are no longer checked; output still reaches `onOutput`, and `onEnd` still fires.
- `stop()` disposes the terminal once. A `stop` before the gate settles it `ended` (through the terminal's end).

## 3. Test table

One assertion per `it`; the cite starts the name. Terminals are `RecordingTerminals` (`lib-ssh/testing/recording-terminal`);
a test writes the tunnel `ssh`'s output with `write` and ends it with `end`. `localPort` is 18111.

| Cite | Given | Expected |
|---|---|---|
| F-2104 6.2 step 4 | `openTunnelSession(terminals, inv, 18111, false)` | one terminal opened, named `SSH Tunnel`, with `inv`, not revealed |
| F-2308 BR-2 | the same with `reveal` true | `revealedAtOpen` true |
| F-2308 BR-10 | write `debug1: …\n` lines, then `TUNNEL_SUCCESS_LINE + '\n'` | the gate is `{kind: 'forwarded'}` |
| #299 (measured, OpenSSH 10.2) | write `bind [127.0.0.1]:18111: Address already in use\nchannel_setup_fwd_listener_tcpip: cannot listen to port: 18111\nCould not request local forwarding.\n` then the success line | the gate is `forwardFailed` with `line` `'channel_setup_fwd_listener_tcpip: cannot listen to port: 18111'` (the first remembered) |
| #299 | only `Could not request local forwarding.\n`, then the success line | `forwardFailed`, `line` `'Could not request local forwarding.'` |
| #299 | `cannot listen to port: 18112\n` (another port), then the success line | `forwarded` |
| #299 | `cannot listen to port: 181110\n` (a longer number ending in ours), then the success line | `forwarded` (the whole number must be ours) |
| #299 | the success line arrives split (`Connected to SSH Ho`, `st - Please do not close this terminal\n`) | `forwarded` |
| F-2104 7.E10 | the terminal ends before any success line | the gate is `{kind: 'ended'}` |
| #299 | the success line, then the terminal ends | the gate stays `forwarded`; `onEnd` fires once |
| #299 | a failure line **after** the success line | the gate stays `forwarded` (lines are checked only until the gate) |
| F-2104 6.2 step 4 | write `"alex@dev's password: "` (no line end) and wait | the gate is still pending (no bound of its own) |
| T2 | the same | `onOutput` got `"alex@dev's password: "` |
| F-2308 BR-6 | `send('pw\r')` | the terminal's `sent` is `['pw\r']` |
| contracts | `stop()` before the gate | the terminal is disposed, and the gate is `ended` |
| contracts | `stop()` twice | disposed once |

Every gate row was checked on a prototype of the line rules, including the real busy-port output captured from
OpenSSH 10.2 (2026-10-12).

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: the tunnel session, gated by its success line (card ssh-23, terminal mode T7)`.

## 6. Open rows

None. The gate and its order are ruled on #299; the 10 s wait and the probe are T7b's.
