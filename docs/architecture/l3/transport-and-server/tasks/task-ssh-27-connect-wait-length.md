# Task card ssh-27: one length for the connect wait, used by the wait and by the prompt reader's bound

Why: athena's finding on #385, ruled in the terminal-mode brief (f53f7a4). The terminal connection step (T5, card
connect-17) gives the `PromptReader` `waitSettings.connectTimeoutSeconds * 1000` as its unreachable-question bound. For
a host's `ConnectTimeout 0`, and for the setting's 0, that is a **0 ms** bound: after the handshake marker, any partial
line that is not a recognised question fails the connect at once. **Ruled:** the bound is the length of the connect
wait (F-2105 BR-3, BR-4): the timeout plus 2 s, and a host's 0 waits the 600 s ceiling with no margin. One function
gives that length; `ConnectWait` and every reader use it. **Merges before `extension.ts` wires terminal mode** (#140
E6c-3a). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/process/connect-wait.ts` | new export `connectWaitMilliseconds`; `ConnectWait`'s constructor uses it (section 2) |
| `packages/lib-ssh/src/index.ts` | export `connectWaitMilliseconds` beside `ConnectWait` |
| `packages/lib-ssh/test/unit/connect-wait.test.ts` | the rows of section 3 |
| `packages/remote-ssh/src/pipeline/terminal-connection-step.ts` | the reader's bound is `connectWaitMilliseconds(waitSettings)` |
| `packages/remote-ssh/test/unit/terminal-connection-step.test.ts` | the rows of section 3 |

Nothing else. `ConnectWait`'s behaviour is unchanged (its existing rows pass as they are).

## 2. Contract

```ts
/**
 * The length of the connect wait: a host's own `ConnectTimeout 0` waits the ceiling with no margin; any other timeout,
 * the setting's 0 included, waits that many seconds plus the 2 s margin.
 */
export function connectWaitMilliseconds(settings: ConnectWaitSettings): number;
```

It is exactly today's expression in `ConnectWait`'s constructor, moved out:
`settings.connectTimeoutSeconds === 0 && settings.fromHost ? settings.unboundedWaitSeconds * 1000 :
settings.connectTimeoutSeconds * 1000 + GRACE_MILLISECONDS`. The constructor becomes
`this.durationMilliseconds = connectWaitMilliseconds(settings);`.

In `terminal-connection-step.ts`, the second argument of `new PromptReader(...)` becomes
`connectWaitMilliseconds(waitSettings)` (imported from `lib-ssh`). If `MILLISECONDS_PER_SECOND` then has no other use
in the file, remove it.

## 3. Test table

One assertion per `it`; the cite starts the name.

`connect-wait.test.ts`:

| Cite | Given | Expected |
|---|---|---|
| F-2105 BR-4, AC-8 | `{connectTimeoutSeconds: 0, fromHost: true, unboundedWaitSeconds: 600}` | `600000` |
| F-2105 BR-4, AC-9 | `{connectTimeoutSeconds: 0, fromHost: false, unboundedWaitSeconds: 600}` | `2000` |
| F-2105 BR-1 | `{connectTimeoutSeconds: 7, fromHost: true, unboundedWaitSeconds: 600}` | `9000` |
| F-2105 BR-3 | `{connectTimeoutSeconds: 15, fromHost: false, unboundedWaitSeconds: 600}` | `17000` |

`terminal-connection-step.test.ts`:

| Cite | Given | Expected |
|---|---|---|
| athena on #385 | the existing helper `unreachable()` (timeout 10 s): it now advances the clock by **12 000** ms, the wait's length | the existing two rows that use it pass (`timeout`, and the terminal disposed) |
| athena on #385 | timeout 10 s, the handshake line, an unrecognised question, then the clock advanced by 11 999 ms | the step has not settled (no outcome yet) |
| athena on #385 | the fixture's `connectWait` answers `{connectTimeoutSeconds: 0, fromHost: false, unboundedWaitSeconds: 600}`; the handshake line, then `Some unknown question? `, then the clock advanced by 1 ms | the step has not settled (before the fix it failed at once as `timeout`) |
| athena on #385 | the same with `fromHost: true` (a host's 0), then the clock advanced by 600 000 ms | fails `{kind: 'timeout'}` |

To make the last three rows, give the existing `fixture(...)` a `fromHost` option beside `timeoutSeconds` (default
`false`), used in its `connectWait`. "Not settled" is checked by racing the step's promise against
`settled()` (the file's existing helper) and seeing that the step's side lost.

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's and remote-ssh's 100/100/100 ratchets.

## 5. Gates and review

PR title `lib-ssh, remote-ssh: one length for the connect wait, also the prompt reader's bound (card ssh-27)`.

## 6. Open rows

None. Ruled by athena (terminal-mode brief, f53f7a4).
