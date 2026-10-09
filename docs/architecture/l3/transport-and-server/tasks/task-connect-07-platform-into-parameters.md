# Task card connect-07 (slice 3): the decided platform reaches the probe's and install-extensions' parameters

Why: `decideTerms` decides `ConnectionTerms.platform` before any `ssh` runs and feeds the channel, but the probe's
and install-extensions' script parameters are built with `hostOperatingSystem: undefined`
(`server-steps.ts`, `parametersFor({})`), so a host the user named as Windows would still get the POSIX script. In
slice 1 (Linux hosts) nothing observable changes; this card waits for the PowerShell twin (brief-lib-server
server-03) and `ParameterInput.hostOperatingSystem` gaining a `windows` value. Reviewing coder:
`remote-coding-worker-1`.

## 1. File boundary

`packages/remote-ssh/src/pipeline/steps.ts` (two signatures), `src/pipeline/connect.ts` (the two call sites),
`src/pipeline/server-steps.ts`, their tests. Nothing else.

## 2. Contract

```ts
// steps.ts
probe(input: ConnectInput, lease: ConnectionLease, terms: ConnectionTerms, cancellation: AbortSignal): Promise<ProbeOutcome>;
installExtensions(input: ConnectInput, lease: ConnectionLease, terms: ConnectionTerms, cancellation: AbortSignal): Promise<void>;
// server-steps.ts: both build their parameters with `hostOperatingSystem` mapped from `terms.platform` (lib-host's
// `PlatformHint`): the Windows hint → 'windows' (once the type has it), the POSIX hint → 'linux', `unknown` →
// undefined. transfer and start keep the probed host's value, which wins over the setting.
```

## 3. Test table

| Given | Expected |
|---|---|
| terms with the Windows hint, probe | parameters carry `hostOperatingSystem: 'windows'`; the PowerShell interpreter |
| terms with the POSIX hint, probe | `'linux'`; `lock.method` `flock` when the settings ask for it |
| terms `unknown`, probe | `undefined` (today's value) |
| terms with the POSIX hint, installExtensions on a reused server | `'linux'` |
| terms Windows, transfer after a probe that found `linux` | transfer uses `linux` (the probe wins) |
| the existing server-steps rows | unchanged |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `remote-ssh: the decided platform in the probe's parameters (card connect-07)`. Not before the PowerShell
twin and the `windows` value exist.

## 6. Open rows

None.
