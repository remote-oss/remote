# Task card connect-21: "Waiting for other windows to connect" is a stage of the progress

Why: #253 Q12 (athena, 2026-10-12; contracts §R1). F-2102 places STR:S157, "Waiting for other windows to connect", as the
connect progress's **phase text** ("Setting up SSH Host {0}: Waiting for other windows to connect", no "details" link;
5.2 step 3, 5.3 step 4). Today the prompt surface shows it through `PromptEditor.showWaiting`, which has no editor
adapter, and lib-authority's closed phase list has no such stage. **Ruled:** it becomes a progress phase,
`waitingForOtherWindow`; the connection step reports it on the lease's notice; `showWaiting` leaves the port. When the
login then falls to this window (the owner gave up, 5.3 step 4), the phase goes back to `initializing`, for which
lib-ssh's client gains a `loginOwned` notice. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-authority/src/resolver/host.ts` | `PhaseName` gains `'waitingForOtherWindow'` |
| `packages/lib-ssh/src/connection-server/client.ts` | `ConnectionNotice` gains `{type: 'loginOwned'}`, emitted as 2.2 says |
| `packages/remote-ssh/src/pipeline/connect.ts` | `PhaseEvent` gains `{kind: 'waitingForOtherWindow'}` |
| `packages/remote-ssh/src/pipeline/connection-step.ts` | an `onPhase` dependency; the two notices mapped (2.3) |
| `packages/remote-ssh/src/pipeline/wiring.ts` | passes the connect's phase listener to the connection step (2.4) |
| `packages/remote-ssh/src/surfaces/progress-titles.ts` | `PHASE_IDS.waitingForOtherWindow: 'S157'` |
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | S157 in `FailureStringId` and `FAILURE_TEMPLATES` |
| `packages/remote-ssh/src/surfaces/prompt-surface.ts` | `showWaiting` and the waiting branch go (2.5) |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | S157's key |
| tests of each | rows (section 3) |

## 2. Contract

### 2.1 The phase

`PhaseName` (lib-authority) and `PhaseEvent` (remote-ssh) gain `waitingForOtherWindow`. `PHASE_IDS` maps it to **S157**
(`Waiting for other windows to connect`, F-2102 3.x). The progress shows its "(details)" link only on its first message
(`vscode-resolver.ts`, `phaseMessage(text, first, …)`), so this phase, which follows `initializing`, has none, as F-2102
says. No change there.

### 2.2 `loginOwned` (lib-ssh)

`ConnectionNotice` gains `{type: 'loginOwned'}`. The client emits it **once**, when the helper answers `accepted` to a
connect request made **after** this window was told `waitingForOtherWindow` (the `ownerChanged` path of `LoginWait`:
`request()` is called again, and its `accepted` makes this window the owner). A window that is the owner from its first
request emits nothing (it was never told to wait).

### 2.3 The connection step

`ConnectionStepDependencies` gains `/** Reports a stage of the connect to the progress. */ onPhase: (event:
PhaseEvent) => void;`. While the step waits for the login (from the acquire until `connect` resolves), it listens to the
connection's notices:
- `waitingForOtherWindow` → `onPhase({kind: 'waitingForOtherWindow'})`;
- `loginOwned` → `onPhase({kind: 'initializing'})` (5.3 step 4: "(details) Initializing VS Code Server").

The listener is removed when the login ends (as the login surface is). The mirrored prompt (connect-14's prompt surface)
is unchanged and shows at the same time (5.2 step 3: the phase and the mirrored input together).

### 2.4 The wiring

The connection step needs the connect's own phase listener, which today only `connect` receives
(`connector.ts`: `connect(input, dependencies.stepsFor(), {…, onPhase: event => {phases.tell(phaseOf(event));}})`).
So:
- `ConnectorDependencies.stepsFor` becomes `stepsFor(onPhase: (event: PhaseEvent) => void): ConnectSteps`;
- `connectorOf` builds the listener once per connect (`const onPhase = (event: PhaseEvent) => {
  phases.tell(phaseOf(event)); }`) and passes the same function to `stepsFor(onPhase)` and to `connect`'s options;
- `stepsOf(ports, onPhase)` (wiring.ts) takes it as a second argument and gives it to the connection step.
The connector's and the wiring's existing tests pass a listener; their rows are otherwise unchanged.

### 2.5 The prompt surface

`PromptEditor.showWaiting` and the surface's `waitingForOtherWindow` case and its `stopWaiting` go: the waiting text is
the progress's now. `prompt-strings.ts`'s `WAITING_TEMPLATE` goes if nothing else uses it.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| F-2102 5.2 step 3 | the connection step, the lease emits `waitingForOtherWindow` during the login | `onPhase` got `{kind: 'waitingForOtherWindow'}` |
| F-2102 5.3 step 4 | then `loginOwned` | `onPhase` got `{kind: 'initializing'}` after it |
| contracts | a notice after the login ended | `onPhase` got nothing more |
| F-2102 | `phaseTitleOf({name: 'waitingForOtherWindow'})` | `{id: 'S157', values: []}` |
| F-2102 | `FAILURE_TEMPLATES.S157` | `Waiting for other windows to connect` |
| #253 Q12 | lib-ssh's client: refused (`alreadyConnecting`), then `ownerChanged` naming it, then `accepted` | notices `waitingForOtherWindow`, then `loginOwned`, once |
| #253 Q12 | lib-ssh's client: `accepted` on the first request | no `loginOwned` |
| #253 Q12 | the prompt surface hears `waitingForOtherWindow` | it shows nothing (no `showWaiting` on its editor port) |
| contracts | the connector, a connect whose lease waits | the connector's phase listeners heard `{name: 'waitingForOtherWindow'}` |
| string tables | the default bundle | has S157's key |

## 4. Rule for the worker

As card log-01; coverage at the three packages' ratchets.

## 5. Gates and review

PR title `lib-authority, lib-ssh, remote-ssh: "Waiting for other windows to connect" is a stage of the progress (card
connect-21)`.

## 6. Open rows

None. Ruled on #253 Q12.
