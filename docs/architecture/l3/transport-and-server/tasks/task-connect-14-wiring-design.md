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

## Design check (athena, 2026-10-12, #253)

Accepted with these rulings; the contract text is in `contracts.md` §2 (S2) and §7 (R1) and `components.md`'s flow.

0. **The step order is wrong on main, and part E fixes it first.** `runSteps` calls `locateClient` before
   `decideTerms`, so the `-V` check runs before the platform picker. F-2206 AC-2 and F-2101 6.5/AC-28 put the picker
   before any `ssh` process, the check included. The order is: validate, pre-connection script, `decideTerms`,
   `locateClient` (with the lookup), `openConnection`. `connect.test.ts`'s order row changes with it, and a test
   pins that a cancelled pick runs no program.
1. **The lookup inside `locateClient`: yes.** The state must be per connect by construction: the connector takes a
   factory and makes the steps of each connect from it, so the state lives in that connect's closure. A state the
   connector shares between connects, overwritten at each start, is not enough, since a teardown's connect and the
   next one can overlap. The throw on a missing field stays; it only guards against a defect.
   - **The bounds follow the lookup.** The probe's and the tunnel's limits come from
     `stepLimitsFor(effectiveConnectTimeoutSeconds(...))` with the looked-up `ConnectTimeout`, so the pipeline reads
     them after `locateClient`. Today's fixed `options.limits` cannot carry a per-host value.
   - **The query carries the target's `-l` and `-p`** exactly as the connection does. Checked on OpenSSH 10.2p1:
     with `Match user alice` → `ConnectTimeout 7` and `Host h1` → `User bob`, `ConnectTimeout 9`, `ssh -G h1` prints
     `user bob`, `connecttimeout 9`, but `ssh -G -l alice h1` prints `user alice`, `connecttimeout 7`.
     `buildOptionsQuery` gets this change in E6a.
2. **The prompt surface is part E; the platform picker is its own card, and E6c waits for it.**
   - Prompt surface: a login question nobody sees is a wait with no bound. The connection step's `onNotice`
     dependency becomes one that attaches the surface (`attachPromptSurface`) to the acquired connection's notices,
     `answer` and `refuse`, from the acquire until the login ends. Notices alone cannot answer anything.
   - Platform picker: B's `ssh.connect-flows` owns `pickRemotePlatform` (windows-and-explorer contracts §3.2).
     daedalus writes its card now: F-2206 5.2 step 2, AC-2, AC-9.
   - No "cancel" interim. A picker that always answers `undefined` would show F-2206 AC-9's "Connecting was
     canceled." to a user who cancelled nothing.
   - The placeholder "Select the platform of the remote host "{0}"" has no string id in the spec. It becomes our own
     string-table entry (key = the English text, all 15 bundles), as with the #141 brief's ruling 2. "Linux",
     "Windows" and "macOS" are names and stay as they are.
3. **No `invalidSetting`.** The file is ssh's, not one of our settings, and the reference shows ssh's own refusal as
   F-2201 7.E6/AC-26: "Could not establish connection to "<host>"." with no reason, and ssh's complaint in the log.
   - A failed lookup is classified by lib-ssh's `classify` (purpose `connection`, the connect's mode), exactly as
     the connection's own run would be, and its error lines go to the log.
   - A run that exits 0 but whose text does not parse fails as `unknown` with no reason.
   - A lookup past `CLIENT_CHECK_MILLISECONDS` fails as `timeout` with no reason.
   - Follow-up, not this card: `classify` matches only `Permission denied (`. F-2201 7.E8's mode-000 row (AC-35)
     wants the reason "Permission denied." for ssh's "Can't open user config file …: Permission denied". This
     affects the connection's own run as much as the lookup's. It needs a lib-ssh card.

Units: E6a = the order fix, the steps factory, the state and the lookup (with `buildOptionsQuery`'s `-l`/`-p` and
the per-connect bounds); E6b = `requestFor`; E6c = `extension.ts`, the prompt surface's attachment, and the picker
once its card is merged.
