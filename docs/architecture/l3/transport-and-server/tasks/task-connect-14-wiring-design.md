# Card connect-14: the connect's wiring, design (#140 part E, for the pre-code check)

Why: the last piece of #140 part E composes everything built so far into a running resolver. Mapping its inputs
showed it is several units, not one, so this card fixes the design before code. Implementer: `daedalus`. Design check:
`athena`. On top of #302 (the locate and tunnel steps) and bounds-01 (the named defaults).

## What is on main or in review, and what is missing

On main: `connect`, `connectorOf`, `createTermsSteps`, `openConnectionStep`, `createServerSteps`, `registerResolver`,
`resolverEditorOf`, the failure presenter and progress titles, `attachPromptSurface`, the client adapters of #282.
In review: `locateClientStep`, `openTunnelStep` (#302). Named defaults: bounds-01.

Missing, and in this design:

1. **A per-connect state.** The steps of one connect share facts no step signature carries: the `ssh` and `scp`
   programs `locateClient` accepts, and the host's effective options (`ssh -G`). Today a step returns
   `StepResult<undefined>` and the pipeline passes nothing on, by design.
2. **The configuration lookup.** Nothing runs `ssh -G`. `buildOptionsQuery` and `parseEffectiveOptions` exist in
   lib-ssh but aren't composed. Its result feeds four places: `requestFor` (`effective`), the server steps
   (`remoteUser` = `user`), the bounds (`connectTimeout`), and the window's environment tunnels (`localForwards`).
3. **`requestFor`**, the connection step's dependency that builds lib-ssh's `SshRequest` (`purpose: 'connection'`)
   and the helper's start options, as `tests/acceptance/server/shared-session.ts` does for the harness.
4. **The editor side of the login**: the platform picker (`pickRemotePlatform`, contracts §3.2, in
   `ssh.connect-flows`) for `createTermsSteps`, and `attachPromptSurface` fed from the connection step's `onNotice`.
5. **`extension.ts`**: builds the ports once, makes the connector, and registers the resolver behind the Readiness from
   activation, with `opensshremotes.showDetails` through `runtimeCommands`.

## Proposed design

**The state.** `ConnectState` lives for one connect. It is created by the connector at the start of each `connect`, so
two connects (a reconnection) never share it. The steps that need it close over a getter.

```ts
interface ConnectState {
  programs?: ClientPrograms;          // written by locateClient
  effective?: EffectiveOptions;       // written by the lookup, right after a client is accepted
}
```

**The lookup sits inside `locateClient`.** Once a client is accepted, the same step runs `buildOptionsQuery` through
the process port (stdout only, bounded by `CLIENT_CHECK_MILLISECONDS`) and parses it. A parse error or a failed run
fails the step as `invalidSetting` with no reason (the configuration can't be read; a reason text has no STR id yet).
This keeps the pipeline's step list unchanged: F-2202's lookup happens "before the connection", which is exactly where
`locateClient` runs. The alternative is a fourteenth step in `ConnectSteps`, which changes the pipeline's contract.

**`requestFor`** reads the state's `programs` and `effective` and the terms, and builds `{...base, purpose:
'connection'}` with lib-ssh's `RequestBase` and the helper options of the harness, with this run's paths and the
bounds-01 defaults. A missing `programs` or `effective` can't happen after the two steps worked; it throws, and the
pipeline turns a throw into `unknown`.

**Units and PRs**, so each stays reviewable:
- E6a: `ConnectState` plus the lookup inside `locateClientStep` (an amendment to #302's step), with tests.
- E6b: `requestFor`, a pure builder over the state, with tests against the harness's working request.
- E6c: `extension.ts` composition, over the ports, with a composition test using the recording fakes
  (`recordingResolverEditor`, `recordingSetupPorts`).
- Part F: the harness connects end to end.

## Questions for the design check

1. **The lookup inside `locateClient`, or a new step?** I propose inside, to keep `ConnectSteps` unchanged.
2. **The editor side of the login (item 4).** The platform picker and the prompt-surface hookup are UI that #140 needs
   only when the platform is unknown or the login asks something. Our harness host logs in by key with a known
   platform. Do they belong in part E, or in a separate #141-style surfaces card, with part E passing a picker that
   answers `undefined` (cancel) meanwhile?
3. **The lookup's failure kind.** `invalidSetting` with no reason, or a reason id (does F-2202 name the "can't read the
   configuration" text)?
