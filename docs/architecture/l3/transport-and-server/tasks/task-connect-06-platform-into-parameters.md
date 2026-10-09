# Task card connect-06: the decided platform reaches the probe's and the install-extensions step's parameters

Why: R4's decision (`ConnectionTerms.platform`, decided before any `ssh` runs) feeds the channel today but not the
script parameters of the probe and of `installExtensions`, which leave `hostOperatingSystem` undefined, so their
lock method and interpreter are the POSIX defaults even when the user chose Windows (#186 second round, 2026-10-09;
harmless in slice 1, wrong for slice 3). Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/remote-ssh/src/pipeline/server-steps.ts`, `src/pipeline/parameters.ts` (the signature below), their tests.
Nothing else.

## 2. Contract

```ts
// parameters.ts
export function parametersFor(input: ParameterInput, hostOperatingSystem: HostOperatingSystem | undefined): ScriptParameters;
// server-steps.ts: `createServerSteps` receives the terms (`ConnectionTerms`) and maps `terms.platform` to the
// probe's and installExtensions' `hostOperatingSystem` (`linux` → 'linux', `macOS` → 'darwin', `windows` → 'windows');
// transfer and start keep taking it from the probed host, as today.
```

## 3. Test table

| Given | Expected |
|---|---|
| terms `windows`, probe | the probe's parameters carry `hostOperatingSystem: 'windows'` and `lock.method: 'link'` |
| terms `linux`, probe | `'linux'` and `lock.method: 'flock'` |
| terms `macOS`, probe | `'darwin'` |
| terms `linux`, installExtensions on a reused server | the step's parameters carry `'linux'` |
| terms `windows`, transfer after a probe that found `linux` | transfer uses the probed `linux` (the probe wins over the setting) |
| the existing server-steps rows | unchanged |

## 4. Rule for the worker

As card log-01; no signature beyond §2 changes.

## 5. Gates and review

PR title `remote-ssh: the decided platform in the probe's parameters (card connect-06)`. Depends on #186 merged.

## 6. Open rows

None.
