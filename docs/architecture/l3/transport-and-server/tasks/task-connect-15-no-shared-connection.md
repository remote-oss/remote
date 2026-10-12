# Task card connect-15: a connect without the shared connection fails before anything runs (interim)

Why: daedalus found on #299 that nothing in the connect reads `remote.SSH.useLocalServer` or socket mode. With the
setting off the connect takes a lease on the shared helper anyway and, with dynamic forwarding on, even succeeds
through it, ignoring the setting (F-2102 BR-10; contracts §S9: "`acquire` is not used when `useLocalServer` is off or
socket mode is on"). The connection without the helper (terminal mode, S8) is a 0.2 blocker still to be designed.
athena ruled the interim on #299 (contracts main 97d69d0): fail such a connect in R1's validate step. Reviewing
coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/pipeline/server-steps.ts` | `ServerStepDependencies.connectionSettings`, and the check in `validate` (section 2) |
| `packages/remote-ssh/test/unit/server-steps.test.ts` | the fixture gains `connectionSettings`; rows added (section 3) |

Nothing else. The tunnel step keeps its own interim (a direct caller of it is still guarded). The wiring (E6c,
daedalus) passes the real settings.

## 2. Contract

`ServerStepDependencies` gains, before `useExecServer`:

```ts
/** The settings that choose how the connection is made; read for each connect. */
connectionSettings: () => Pick<TunnelSettings, 'listenOnSocket' | 'useLocalServer'>;
```

`validate` keeps the target check first (card ssh-17) and then, **before** the install-folder check:

```ts
if (!effectiveUseLocalServer(dependencies.connectionSettings())) {
  dependencies.logger.warn('a connection without the shared connection is not built yet');
  return {kind: 'failed', failure: {kind: 'unknown'}};
}
```

with `import {effectiveUseLocalServer, type TunnelSettings} from 'lib-forwarding';` (lib-forwarding's rule: socket
mode turns the shared connection off whatever `useLocalServer` says, F-2104 6.8 step 1).

- Kind `unknown` with **no reason**: the dialog shows F-2601's S030 ("Could not establish connection to …"). The log
  line names the cause (F-2003).
- The pipeline runs `validate` first, so the failure comes before the pre-connection script, the platform question,
  the client check and any lease. No `ssh` runs and nothing waits (R-79).
- Not retried on a first connect (only a reconnection is ever retryable). On a reconnection `unknown` stays
  retryable, and that is wanted (athena, #331; contracts 498cc6e): F-2102 BR-9 reads the setting live, so turning it
  back on during a reconnection lets the next attempt connect. Each attempt with the setting still off fails at once
  and runs nothing, so nothing hangs. The last row of section 3 pins the live read. (The target check stays
  permanent: nothing can change between attempts there.)
- Order inside `validate`: target check, then this check, then the install folder. A bad host is reported even with
  the setting off (it is the user's real error).

## 3. Test table

One assertion per `it`; the cite starts the name. Each row calls
`createServerSteps(dependencies({connectionSettings: () => settings})).validate(INPUT)` (or with the target given).

| Cite | Settings | Expected |
|---|---|---|
| #299, F-2102 BR-10 | `{listenOnSocket: false, useLocalServer: false}` | `{kind: 'failed', failure: {kind: 'unknown'}}` |
| #299, F-2003 | the same | the log has `a connection without the shared connection is not built yet` |
| #299, F-2104 6.8 | `{listenOnSocket: true, useLocalServer: true}` | `{kind: 'failed', failure: {kind: 'unknown'}}` |
| #299, F-2104 6.8 | `{listenOnSocket: true, useLocalServer: false}` | `{kind: 'failed', failure: {kind: 'unknown'}}` |
| F-2102 | `{listenOnSocket: false, useLocalServer: true}` (the defaults) | `{kind: 'done', value: undefined}` |
| F-2205 BR-2 | `useLocalServer: false` and the target `{kind: 'plain', text: '-h'}` | the S119 failure, not this one |
| #299 | `useLocalServer: false` and an invalid install folder (as in today's row) | this failure, not the folder's |
| #299 | the settings function | read at each `validate` call: false then true across two calls gives fail then done |

No row in `connect.test.ts`: the pipeline's "a target that does not validate fails first, before anything is
opened" row already pins that a failed `validate` runs no later step.

The rows were checked on a prototype over main (2026-10-12): the four settings cases, the log line, and the target
check coming first; the existing server-steps rows pass with the fixture's added line.

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: a connect without the shared connection fails before anything runs (card connect-15, #299)`.

## 6. Open rows

None.
