# Task card containers-08: C10, the container connector

Issue: #776. Remote - Containers release 1, slice 1, item (8) (D-87; the user's priority of 2026-10-14). Size: L
(about 3.5 agent-days). Builder: iris.

**Depends on.** The cards and the names this card calls are fixed. Read each card for its exact signatures:

| Card | What this card calls |
|---|---|
| containers-01 (#759) | the activation, `ServedWindow` and `extension.ts` |
| containers-02 (#757) | `execChannelOf`, `execDialer`, `installRelayScript`, `relayScriptPath`, `nodeEngineHost` |
| containers-03 (#758) | `secondCheck`, `executableOf` |
| containers-04 (#763) | `cliBridgeOf`, `nodeCliHost`, `readConfiguration` |
| containers-05 (#765) | `installTree`, `treeComplete`, `CONTAINERS_POLICY`, `archiveKeyOf`, `clientArchiveFolder` |
| containers-06 (#769) | `containerLifecycleOf`, `prepare`, `stopBackground` |
| containers-07 (#766) | `devContainerTargetOf` (the codec only; its command can land before or after this card) |

**Design:**
- containers contracts §2 (the contract this card follows) and §6;
- components C10, boundaries 1, 2 and 6;
- the brief's rulings 1 to 4, 10 and 11;
- the transport contracts §5.0;
- athena on remote-oss/remote-containers#122:
  - Q1: the server source order and the version-keyed archive cache;
  - Q10: the `docker exec` relay design stands.

**Spec:** remote-oss/remote-containers:
- F-0502: 5.0, 6.1, BR-2, BR-3, BR-6 to BR-9, BR-13, BR-21;
- F-0503 (republished 2026-10-14): 5.0, BR-14, BR-17;
- F-0504: S114, S118, BR-1 to BR-3;
- F-0408: S087, BR-2;
- F-0505: the install list. Slice 1 passes none (§3.6).

## 1. What C10 is

**What it is:** the `Connector` (lib-authority `resolver/host.ts`) that lib-authority's resolver host runs for every
`dev-container` resolve of the window. Given the payload, it:
1. checks the engine;
2. has C7 find, start or create the container;
3. has lib-server install and start the server inside it over C11's channel;
4. listens on the host's loopback and relays each connection into the container with `docker exec`;
5. hands core the address and token.

**What it isn't** (boundaries 1 and 2):
- **lib-authority's:** registration, reconnection policy, progress, the presenter call and the window opener.
- **lib-server's:** the probe, the plan, the transfer, the licence gate, the start and the policy record.
- **C7's:** container discovery and creation.

C10 is a `Connector`, the composition of those, and nothing more.

## 2. Files (all new under `packages/remote-containers/`, except §2.1)

| File | What |
|---|---|
| `src/connect/progress-titles.ts` | pure: the S087 start title and each phase's title (§3.3) |
| `src/connect/failures.ts` | pure: every `Failed` this card makes (§3.7) |
| `src/connect/reconnection.ts` | pure: what a reconnection resolve answers (§3.8) |
| `src/connect/window-identity.ts` | pure: the S114/S118 workspace suffix (§3.9) |
| `src/connect/context-engine.ts` | `withContext(engine, name)`: an `EngineHost` that adds `DOCKER_CONTEXT` (§3.2) |
| `src/connect/server-steps.ts` | the lib-server composition over C11's channel (§3.5) |
| `src/connect/host-relay.ts` | the host listener and relay (§3.6) |
| `src/connect/connector.ts` | `containerConnectorOf(dependencies): ContainerConnector` (§3.1–§3.10) |
| `src/connect/slice-presenter.ts` | slice 1's `FailurePresenter` (§3.11) |
| `src/connect/register-connector.ts` | the resolver's registration, the window label and the log command (§4) |
| `src/extension.ts` | the wiring (§4.3) |
| `identifiers.json`, `package.json`, `package.nls.json` | §4.1 and §4.2 |

### 2.1 Outside the package

- **lib-authority**, `resolver/host.ts`: `PhaseName` gains `'startingServer'`. That's one union member, with no
  behaviour change.
- **remote-ssh**, `surfaces/progress-titles.ts`: `PHASE_IDS` gains `startingServer: undefined`. remote-ssh never
  reports that phase, so the entry only keeps the table total. A remote-ssh row asserts it maps to no title, the same
  as its other unused phases.

## 3. The connector

### 3.1 The type and its dependencies

```ts
export interface ContainerConnector extends Connector {
  /** The identity of the connection the window holds, for the label (§3.9); nothing before the first connect. */
  heldIdentity(): {name: string | undefined; context: string | undefined} | undefined;
}
export interface ContainerConnectorDependencies {
  /** The engine for a docker path; real value `nodeEngineHost` (containers-02). */
  engineFor(dockerPath: string): EngineHost;
  /** The CLI bridge for an editor environment; real value `cliBridgeOf(nodeCliHost(paths, environment), …)`. */
  cliFor(environment: Readonly<Record<string, string | undefined>>): CliBridge;
  /** The settings this card reads, at every connect (F-0503 §3.2: read at every connect attempt). */
  settings(): {dockerPath: unknown; serverDownloadBaseUrl: OverrideValue | undefined; serverDownloadFolder: unknown};
  editorEnvironment: Readonly<Record<string, string | undefined>>;
  profile: ProductProfile;                 // lib-product, read once at activation
  licence: {store: AcceptanceStore; modal: LicenceModal};   // lib-server's gate, as remote-ssh's server-steps
  download: DownloadPort;
  files: ClientFilePort;
  localPort: LocalPort;                    // lib-forwarding's nodeLocalPort
  prober: PortProber;                      // lib-forwarding's nodePortProber
  scheduler: Scheduler;
  clock: () => number;
  logger: Logger;
  revealLog(): void;
}
export function containerConnectorOf(dependencies: ContainerConnectorDependencies): ContainerConnector;
```

Every port has a fake in `test/unit/`. No file of §2 imports `vscode`, except `extension.ts`.

### 3.2 `connect(input)`, in order (contracts §2)

`connect` first gives back the connection the window holds, as remote-ssh's `connectorOf` does (`releaseHeld`). It
then runs these steps. **A step that fails returns its `Failed` at once (§3.7), and nothing after it runs.**

1. **Decode** (§3.7 row 1). `input.target` is `{payload, outer?}`.
   - A target with an `outer` hop (a remote engine) fails as `remoteEngine`.
   - `devContainerTargetOf(payload)` giving `malformed`, or a `legacy` target (BR-2c), fails as
     `malformedAuthority` until C4.
2. **Reconnection.** When `input.isReconnection` is true and the window holds a connection, §3.8 decides, and the
   rest of this list doesn't run.
3. **The engine.**
   - `dockerPath` is the setting's value, or `docker` when it's empty or not a string, the same default C2's
     `executableOf` takes.
   - `engine` is `engineFor(file)`, where `file` is `executableOf(dockerPath, undefined)`. The base is always
     `undefined` here: inside the resolve C10 can't know whether the folder is trusted, and an untrusted base must
     never resolve a relative path (F-0201 BR-1). That's §6, row 2, for athena.
   - When the target carries `context` (BR-21: the recorded context is sticky), `engine` becomes
     `withContext(engine, context)`. Every call then gets `DOCKER_CONTEXT=<context>` in its `EngineOptions.environment`,
     merged in front of the caller's own values. That's the docker process's environment only: containers-02 passes a
     container variable only as `-e NAME`, so `DOCKER_CONTEXT` never reaches the container.
   - The CLI gets the same: `cli = cliFor({...editorEnvironment, DOCKER_CONTEXT: context})`, or
     `cliFor(editorEnvironment)` without a context.
4. **The second check.** `onPhase({name: 'initializing'})`, then containers-03's `secondCheck` with `file` and
   `engine`. `failed` → `engineCheckFailed` with its detail.
5. **The container.** C7's `prepare` with `{folder: hostPath, configFile: configFile.fsPath, dockerPath, logLevel:
   'info'}`. Its steps and CLI events go to the log (§3.10). Outcomes:
   - `ready` → go on;
   - `unusable` → `containerUnusable`;
   - `discoveryFailed` → `containerSetupFailed`;
   - a `CliFailure` → `containerSetupFailed`, or `cancelled` for `{kind: 'cancelled'}`.
6. **The identity.** `cli.readConfiguration(target, containerId, onCliEvent, cancellation)`, with the same CLI event
   handler as C7's `up` (containers-04 at bb9525fe gives `readConfiguration` an event callback; its errors arrive as a
   log event and the `configurationFailed` failure). `name` is the result's
   `configuration.name` when that's a string; otherwise `name` is `undefined`. A failure here doesn't fail the
   connect: log one warn line, `the configuration's name could not be read: <kind>` (`configurationFailed`,
   `malformedResult` and the rest of `CliFailure`), and leave `name` `undefined`. That
   value is read fresh at every resolve (F-0504 BR-2, AC-28).
7. **The server** (§3.5). Its failures map through §3.7.
8. **The host listener and relay** (§3.6). Its failures map through §3.7.
9. **The connection.** Hold `{containerId, startedAt, server, relay, identity}`, where `startedAt` is
   `State.StartedAt` read once by `docker inspect --type container --format '{{json .State}}' <id>` on `engine`. Then
   resolve:

```ts
{address: {host: '127.0.0.1', port: <host port>}, connectionToken: <the server's token>,
 extensionHostEnv: {}, environmentTunnels: [], trusted: false}
```

The resolver host gives core no tunnel factory and no tunnel features (contracts §2 step 6; brief ruling 1).

**Cancellation:**
- `cancel()` aborts the running connect's signal. C2's checks, C7's `prepare`, C3, lib-server's steps and the relay's
  probe all take it.
- It calls C7's `stopBackground()`, closes the relay and gives back the held connection.
- A connect that ends after the abort gives back what it made and returns `cancelled` (§3.7), as remote-ssh's
  connector does.

### 3.3 Progress (F-0408 S087 and BR-2; F-0503 S209 and S334)

Slice 1 reports three phases through `onPhase`:

| Moment | Phase | The resolver host's message (`titleOf`), which core shows after `startTitle` and a colon |
|---|---|---|
| step 4, before the second check | `{name: 'initializing'}` | `''` (core shows the start title alone) |
| §3.5, before the transfer, only when the plan is `download` | `{name: 'installing'}` | `Installing server` (S209) |
| §3.5, before the start | `{name: 'startingServer'}` | `Starting server` (S334) |

**The rules:**
- `startTitle` is the same S087 link.
- `details` is never set: S087's whole text is the link (F-0408 3.4), so the "(details)" prefix of lib-authority's
  `phaseMessage` never shows.
- The suffix stays until the next phase replaces it, and is never cleared (BR-2).
- The text after the colon is a separate string of the table, joined with `': '` and translated on its own.
- S087, S209 and S334 join `l10n/bundle.l10n.json` and the 14 locale bundles, in English.

`progress-titles.ts` exports:
- `startTitleOf(translate): string`;
- `phaseTitleOf(phase, translate): string`: only the stage's text, as remote-ssh's does. Any other `PhaseName` gives `''`.
  (Corrected by athena's ruling on the doubled toast, 2026-10-19: this section's "title" column was the message, and
  core had joined the whole title to the start title a second time.)

### 3.4 What the window's log shows (F-0502 BR-1, BR-3, BR-11; F-0408 BR-6)

Lines at `info` on the `ServedWindow.logger`, in this order. They're log lines, not UI, so their wording is ours (R-34).
The rows assert the order and the facts named, not the exact words:
1. `Resolving Remote` (S296), at the start of the connect.
2. **Each C7 step:**
   - `findingContainer`;
   - `startingContainer`, which carries the log step name `Starting container` (S333, F-0408 BR-5);
   - `containerReady`, with `container <id 12> was newly started` or `container <id 12> was already running`
     (BR-11; C7's `created`).
3. **C3's events:** `log` and `progress`, at `debug`, unchanged.
4. **The server:**
   - `Starting VS Code Server` before the start;
   - `server listening on 127.0.0.1:<container port>` after it;
   - `reusing the running server` when lib-server reports `reused` (BR-2).
5. **The relay:** `forwarding local port <host port> to container port <container port>` (BR-3).
6. `Resolving Remote` again, with the connect's duration in ms.

No line holds the connection token, a password or a value of the configuration's `containerEnv` (R-26). The rows check
every logged line against the fixture's secrets.

### 3.5 The server (`server-steps.ts`; F-0503 5.0 steps 3 to 7)

**The channel:**
- `channel = execChannelOf(engine, containerId, remoteUser)` (containers-02).
- `installRelayScript(channel, dataFolder, cancellation)` runs once per connect, after the probe has given
  `dataFolder` (`<home>/<profile.dataFolderName>`).

**The policy:** `CONTAINERS_POLICY` (containers-05), and nothing else. It's `downloadPlacement: clientOnly`,
`cache: kept`, `cleanup: onlyCurrentKeepLeftovers`, `installMode: singleScript` and `prefetch: none`.
Its `allowedExtraStartOptions` is `['useHostProxy']`, so every start passes `--use-host-proxy` (F-0503 BR-18; athena on
remote-oss/remote-containers#122 Q6; containers-05 §3.5). C10 passes the policy and adds no option of its own. A
`connector.test.ts` row checks that the start body it hands lib-server carries `--use-host-proxy`.

**The composition, in order.** It's the same sequence of lib-server calls as remote-ssh's `server-steps.ts`, with no
CLI path and no host-side download:

1. **`probe`** over `channel`, with `ScriptParameters.installTree` set to
   `cacheFolders(profile.product, profile.commit, <probed platform>, volumeMounted).serverTree` when C7 reported
   `volumeMounted`, and `''` otherwise.
   - The platform comes from the probe: `linux-x64`, `linux-arm64` or `alpine-*`.
   - Unsupported hardware is S031 or S359 (F-0503 7.E3), mapped by §3.7.
2. **`resolveServerArchive`** (lib-product) with `OVERRIDE_POLICIES['remote-containers']`. The override is the
   setting `remote.serverDownloadBaseUrl` from any layer (BR-14(c), (d)).
   - The resolution order is lib-product's (BR-14(e); athena Q1): override → `productTemplate` → `builtInTable` →
     `noSource`.
   - `noSource` is `noServerSource` (§3.7), with BR-14(e)'s dialog. Slice 1's presenter shows it (§3.11).
3. **`plan`**, with `installTree` and the layouts:
   - `{kind: 'tree', commit, path: installTree}` when the probe reports `treeComplete`;
   - `{kind: 'bin', …}` when it reports `installed`, as containers-05 orders them.
   - A reuse plan skips steps 4 and 5 (AC-1, AC-12).
4. **`ensureAccepted`**, the licence gate (R-68; BR-14(h)), exactly as remote-ssh's server steps call it, with this
   card's `licence` dependency. A VSCodium server isn't Microsoft-licensed, so the gate passes without asking.
5. **`onPhase({name: 'installing'})`, then `transfer`.**
   - The client download goes to `clientArchiveFolder(cacheRoot, product, archiveKeyOf(resolution.step, profile))`,
     where `cacheRoot` is `remote.serverDownloadFolder` when it's a non-empty string, else the system temporary
     folder's `vscode-remote-containers` folder (F-0503 §3.2: "a folder in the system's temp folder").
   - Then `copyToHost` over `channel`, and the install into the tree.
   - **One more try (F-0503 7.E2; themis on #780).** lib-server has no client-download retry: `transfer/http-download.ts`
     follows redirects and times out stalls, nothing more. So `server-steps.ts` wraps `transfer` itself:
     - when `transfer` fails with `localDownload` (or `verification`, should a later policy name one), log one line
       naming the URL tried, the local cache path, the reason (the failure's detail) and `retrying once`, and call
       `transfer` a second time with the same plan;
     - a second failure is final, and its failure is what the connect returns as `serverFailed` (§3.7 row 9);
     - for a `verification` failure, the attempt's log line also carries S157's text (`Downloading the VS Code Server
       failed. Please try again later.`); S157 is never shown in a dialog;
     - `cancelled`, `copyFailed`, `copyToolMissing`, `channelClosed` and the install's own failures aren't retried.
6. **`onPhase({name: 'startingServer'})`, then `startOrReuse`** over `channel`, with:
   - `bindHost: '127.0.0.1'` and `portRange: ''`. The container port is dynamic: `devPort` (6.5) is increment 1b;
   - `licenceAccepted` from step 4;
   - `graceSeconds: 0`, so the server's own default of 3 hours applies (BR-9);
   - `defaultExtensions: []` (§3.6, F-0505);
   - `fileWatcherPollingMilliseconds: 0`, `socketMode: false`, and `readySeconds` from lib-server's bounds.

   The start body already passes `--telemetry-level off` (`scripts/bootstrap.ts`), so every start is telemetry-off
   (F-0503 BR-17, AC-52; brief ruling 11).
   - `started` → `{port: endpoint.port, connectionToken, processId, reused}`. A socket endpoint can't happen with
     `socketMode: false`, and is a `serverFailed` if it does.
   - Every other outcome → §3.7.

**Duplicate code:** if `pnpm dupes` flags this file against remote-ssh's `server-steps.ts`, stop and report (§6 row 1).
Don't move code into lib-server by guess.

### 3.6 The host listener and relay (`host-relay.ts`; contracts §2 step 5; F-0502 BR-3; athena Q10)

1. **The host port.** `findFreePort(prober, {first: containerPort, last: containerPort})`: the same number when it's
   free on the host. Otherwise `findFreePort(prober, undefined)`, a random free port. Both fail → `relayFailed`.
2. **The tunnel.** `openRelayTunnel({dialer: execDialer(engine, containerId, remoteUser, nodePath, relayPath), local:
   localPort, scheduler, target: {kind: 'port', port: containerPort}, localPort: hostPort, limits})`:
   - `nodePath` is `<installTree or <dataFolder>/bin/<commit>>/node`, the installed server's own `node` (contracts §1);
   - `relayPath` is `relayScriptPath(dataFolder)`;
   - `limits` is lib-forwarding's default `WaitLimits` that remote-ssh's tunnel step uses.
   - `open` → hold its `close` and `onClosed`.
   - `listenFailed` or `tunnelNotReady` → `relayFailed`.
3. **What the readiness probe proves.** The probe works as soon as `docker exec` has started, not when the server
   answers. The server's readiness is lib-server's start, which reports the port only once the server listens. So the
   relay adds no wait of its own.
4. **The listener** is `127.0.0.1` only. The container publishes no port (BR-6), because nothing in this card asks
   Docker to publish one.

**Transport events:**
- **Each relay connection that closes** while the window holds the connection runs `docker inspect` on the container
  (one at a time, coalesced):
  - running with the same `startedAt` → nothing. A closed connection is normal: core reconnects on its own when it
    needs to;
  - paused → `onTransportLost`;
  - not running, missing, or a different `startedAt` (a restart, BR-8, 7.E16) → `onTransportClosed`.
- **`onClosed` of the tunnel** (the listener failed): `onTransportLost`.

**F-0505:** slice 1 passes no extension list (`defaultExtensions: []`). F-0505's merged list
(`customizations.vscode.extensions` and `dev.containers.defaultExtensions`) is increment 1b, with gate row 12.

### 3.7 Failures (`failures.ts`; contracts §2 "Failures")

Every `Failed` has `hints: []`, and `diagnostics` without the token. Kinds are this card's closed list.

| # | Kind | When | `reason` | `retryable` | `silent` | `userAlreadyNotified` |
|---|---|---|---|---|---|---|
| 1 | `malformedAuthority` | §3.2 step 1 | none | false | false | false |
| 2 | `remoteEngine` | an `outer` hop | `{id: 'S034'}` | false | false | false |
| 3 | `engineCheckFailed` | step 4 | `{id: <S339, S104 or S144>}` | false | false | false |
| 4 | `containerUnusable` | step 5, `unusable` | `{id: 'S034'}` | false | false | false |
| 5 | `containerSetupFailed` | step 5, `discoveryFailed` or a `CliFailure` other than `cancelled` | `{id: 'S034'}` | false | false | false |
| 6 | `noServerSource` | §3.5 step 2 | `{id: 'noServerSource', values: [<profile.applicationName>]}` | false | false | false |
| 7 | `unsupportedPlatform` | §3.5 step 1 | `{id: 'S031' or 'S359', values: [<machine name>]}` | false | false | false |
| 8 | `requirementsNotMet` | the start's prerequisites failure | `{text: <the check's own output>}` | false | false | false |
| 9 | `serverFailed` | any other §3.5 failure | `{id: 'S034'}` | false | false | false |
| 10 | `relayFailed` | §3.6 | `{id: 'S034'}` | false | false | false |
| 11 | `cancelled` | the abort | none | false | true | false |
| 12 | `containerGone` | §3.8 | none | false | true | false |
| 13 | `transportLost` | §3.8 | none | true | false | false |

**Row 3:** `userAlreadyNotified` is false, as containers-03 §6 row 1 asks: the second check's failure is shown by the
presenter. athena confirms it on #761.

**Row 6:** `noServerSource` is the reimplementation text of BR-14(e):
`"{0} has no built-in VS Code Server download location for {1}. Set remote.serverDownloadBaseUrl to a URL template for this editor's own server builds."`,
with `{0}` = `remote-oss.remote-containers` and `{1}` = the `applicationName`. It's an own string of the table (not a
reference S-id), kept in `surfaces/own-strings.ts`.

**Row 8:** `requirementsNotMet` uses S346 as the dialog's message in C8. Slice 1's presenter shows S346 with the text
as its detail (§3.11).

### 3.8 Reconnections (`reconnection.ts`; F-0502 BR-7, BR-8, 7.E1, 7.E15, 7.E16)

When core resolves again with `isReconnection` and the window holds a connection, C10 decides from
`docker inspect --type container --format '{{json .State}}' <id>`, plus, only when that gives `running` with the held
`startedAt`, `kill -0 <server processId>` run over the held channel:

| Inspect | The server process | Answer |
|---|---|---|
| no such container | n/a | `containerGone` (row 12): plain "not available", no dialog (BR-8, 7.E3) |
| `Status` neither `running` nor `paused` | n/a | `containerGone` (7.E2) |
| `running` with a different `StartedAt` (a restart) | n/a | `containerGone` (7.E16: final, although it runs again) |
| `paused` | n/a | `transportLost` (row 13): "temporarily not available" (7.E15) |
| `running`, same `StartedAt` | alive (`kill -0` status 0) | the held `Connected` again, with the same port and token. The relay is still listening; core reconnects to the original session (7.E15's unpause) |
| `running`, same `StartedAt` | gone | `transportLost`. The extension never restarts the server by itself; Reload Window does (BR-7, 7.E1) |

**Two rules:**
- A reconnection never runs §3.2 steps 3 to 8.
- A new resolve that isn't a reconnection (a reload) runs the whole list. Then lib-server's `startOrReuse` reuses a
  server that still runs (BR-2, AC-2) or starts a new one on a new port (AC-19).

`reconnectionOutcomeOf(held, state, serverAlive)` is pure. The two queries are in the connector.

### 3.9 The window's identity (`window-identity.ts`; F-0504 BR-1 to BR-3)

`workspaceSuffixOf(identity, translate)`:
- `name` is a non-empty string (spaces count as non-empty, untrimmed; BR-2): S114 `Dev Container: {0}{1}`, with
  `{0}` = `name` verbatim;
- otherwise: S118 `Dev Container{0}`;
- `{1}` (S114) or `{0}` (S118) is ` @ <context>` when the target carries a context (BR-3, AC-31), and `''` otherwise.

S114 and S118 join the string tables. §4.2 registers the suffix.

**This card owns the `dev-container` label formatter.** No other containers card registers it, and containers-09's
gate row 1 (#775: the window title `<folder> [Dev Container: <name>]` and the indicator `Dev Container: <name>`)
depends on it. It's the containers equivalent of remote-ssh's `surfaces/label-formatter.ts`, `registerWindowLabel`,
over lib-authority's `registerAuthorityLabel`:
- the formatter's `authority` is `dev-container+<payload as written>`;
- `label` is `${path}`, with `/` as separator and `tildify: true`;
- `workspaceSuffix` is `workspaceSuffixOf(...)`. Core puts it in the title's brackets and the indicator.

`name` comes from the CLI's second pass, `readConfiguration(target, containerId)` (§3.2 step 6; containers-04, ADR-0009
deviation 4).

### 3.10 The log of C7 and C3

The `onStep` and `onCliEvent` callbacks of §3.2 step 5 write the lines of §3.4. A CLI event of level `error` is logged
at `error`; the rest at `debug`.

### 3.11 Slice 1's presenter (`slice-presenter.ts`)

C8 (F-0410's dialog, with Edit, More Actions... and the S018/S019 classification) is increment 1b. Until then, slice 1
presents every non-silent `Failed` with one modal error dialog:
- `showErrorMessage(<message>, {modal: true, detail}, 'Retry')`;
- the detail is the reason's text, resolved through the string table;
- `message` is S346 for `requirementsNotMet`, and empty otherwise (F-0410: the dialog has no message line).

**`noServerSource`** gets BR-14(e)'s buttons, `Open Setting` and `Cancel`, instead:
- `Open Setting` runs `workbench.action.openSettings` with `remote.serverDownloadBaseUrl`, and resolves `'handled'`;
- `Cancel` and Escape resolve `'handled'`.

**Other outcomes:**
- `Retry` resolves `'reload'`, so lib-authority reloads the window and the connect runs again (F-0410 5.0: "Retry
  repeats the exact same attempt").
- Escape resolves `'handled'`.

C8 replaces this module.

## 4. Registration and wiring

### 4.1 `identifiers.json` and the manifest

- **`runtimeCommands`:** add `{"id": "remote-containers.revealLogTerminal", "purpose": "the \"(show log)\" link of the
  connect progress, which reveals the Dev Containers log"}`. It's registered, not contributed.
  - Slice 1's handler reveals the "Dev Containers" output channel (`ServedWindow.logger`'s channel).
  - F-0104's log terminal comes later and replaces the handler, not the id (D-14).
- **`contributes.configuration`:** two settings, exactly as F-0503 §3.2 states them, except where BR-14 changes them:
  - `remote.serverDownloadBaseUrl`:
    - string, **no `default`** (BR-14(c)), scope `application`;
    - the `pattern` and its `patternErrorMessage` as §3.2;
    - the description from §3.2 copied verbatim into `package.nls.json`;
  - `remote.serverDownloadFolder`:
    - string, no `default`, scope `application`;
    - the description from §3.2, verbatim.
- **The read:** this card's `settings()` reads both, so tooling-31's check is green.
- `dev.containers.dockerPath` is containers-03's, and this card reads it through the same table entry.

### 4.2 `register-connector.ts`

```ts
export function registerContainerResolver(
  host: {resolverEditor: ResolverEditor; labels: LabelFormatterHost; commands: CommandHost; translate: Translate},
  connector: ContainerConnector,
  served: ServedWindow,
): Promise<{registration: Registration['kind']; dispose(): void}>;
```

1. **The resolver.** Call lib-authority's `registerResolver(host.resolverEditor, options, readiness)`.
   - **`options`:**
     - `family: 'dev-container'`;
     - `connector`;
     - `presenter`: §3.11;
     - `cancellable: false` (F-0408 BR-12: S087 has no Cancel);
     - `allowsTrust: false`;
     - `titleOf` and `startTitle` from §3.3.
   - **`readiness`:**
     - `guard: () => Promise.resolve('serving')`, because the activation's guard already ran;
     - `resolversGranted: () => Promise.resolve(!served.missing.includes('resolvers'))`. This is brief ruling 9: a
       missing `resolvers` holds back the resolver, and C6's command then answers with the setup notice.
2. **The label.** Once the first resolve settles with the connection up, register
   `registerAuthorityLabel(host.labels, decodedTarget, workspaceSuffixOf(connector.heldIdentity(), translate))`.
   - It mirrors remote-ssh's `registerWindowLabel`: it registers once and is removed with the window.
   - A later resolve (a reload) re-reads `name` (BR-2).
3. **The log command.** `registerCommands` of the `runtimeCommands` entry, with the handler of §4.1.

### 4.3 `extension.ts`

**`activate` builds the connector:**
- `engineFor`: `file => nodeEngineHost(file)`.
- `cliFor`: `environment => cliBridgeOf(nodeCliHost({node: process.execPath, preload, entry}, environment), files,
  overrideStoreOf(context.globalStorageUri.fsPath), environment, served.logger)`.
- `settings`: `vscode.workspace.getConfiguration()` read through the generated table at each call. The base URL is
  read with lib-product's override reading over all layers (`inspect`), as `OVERRIDE_POLICIES['remote-containers']`
  names.
- `profile`: the one containers-01 read.
- `licence`: lib-server's acceptance store over `context.globalState`, and a modal over `vscode.window`, as remote-ssh
  builds them.
- `download` and `files`: lib-server's `downloadPortOf(fetch)` and `nodeClientFiles`.
- `localPort`, `prober` and `scheduler`: lib-forwarding's and lib-helper's Node adapters.
- `clock`: `Date.now`.
- `logger`: `served.logger`.

**It registers:** on `serving`, call `registerContainerResolver(...)` with
`resolverEditorOf(vscode, {detailsCommand: runtimeCommands.revealLogTerminal})`, and push its `dispose` to
`context.subscriptions`. containers-01's `handlers` factory is unchanged by this card.

## 5. Rows

All unit rows are over fakes. Every spawn site's argv is checked against the fixture's secrets (contracts §6, R-26).

### 5.1 Pure modules

| File | Cite | Given | Expected |
|---|---|---|---|
| `progress-titles.test.ts` | F-0408 3.4 S087 | `startTitleOf(t => t)` | `[Connecting to Dev Container (show log)](command:remote-containers.revealLogTerminal)` |
| | F-0503 AC-2 (our half) | `phaseTitleOf({name: 'installing'})`, then `startingServer` | `Installing server`, then `Starting server` |
| | F-0408 BR-2 | every other `PhaseName` | `''` |
| `window-identity.test.ts` | F-0504 AC-1, AC-3 (our half: the suffix) | `name` `Proj`; no `name`; `""` | `Dev Container: Proj`; `Dev Container`; `Dev Container` |
| | F-0504 AC-29, AC-30, AC-22 | `name` `"   "`; `weird ] name [test` | `Dev Container:    ` (spaces kept); the name verbatim |
| | F-0504 AC-31 | `name` `Ctx Test`, context `f0504ctx`; no name and the same context | `Dev Container: Ctx Test @ f0504ctx`; `Dev Container @ f0504ctx` |
| `failures.test.ts` | contracts §2 | each row of §3.7 | the kind, reason and three flags exactly as the table |
| `reconnection.test.ts` | F-0502 BR-7, BR-8 | each row of §3.8's table | the answer of the table |

### 5.2 The connector (`connector.test.ts`)

Each row has a fake engine (scripted per argv), a fake CLI, a fake lifecycle, a recording channel, and fakes of
lib-server's steps. The lib-server steps are called through `server-steps.ts`, faked at its boundary; `server-steps`
has rows of its own (§5.3).

| Cite | Given | Expected |
|---|---|---|
| contracts §2 step 1 | a malformed payload; a `legacy` target; an `outer` hop | rows 1, 1 and 2 of §3.7; no engine call |
| contracts §2 step 2 | `secondCheck` failing with S104 | row 3 with `{id: 'S104'}`; `prepare` never called |
| contracts §2 step 3 | `prepare` answering `unusable`, `discoveryFailed`, `buildFailed` and `cancelled` | rows 4, 5, 5 and 11 |
| contracts §2 steps 4–6 | everything succeeds | `Connected` with the host port and token, `trusted: false`, empty `extensionHostEnv` and `environmentTunnels`; phases in order `initializing`, `installing`, `startingServer` |
| F-0503 AC-1 | the plan reuses the tree | no `installing` phase, no transfer |
| F-0502 BR-21 | a target with context `ctx1` | every engine call's environment has `DOCKER_CONTEXT=ctx1`; `cliFor` got it too; no argv holds `DOCKER_CONTEXT` |
| F-0502 BR-3 | the container port 41000 free on the host | host port 41000 |
| F-0502 BR-3, AC-42 (our half) | 41000 taken | another free port; the log line names both |
| F-0504 BR-2 | `readConfiguration` failing | `Connected` all the same; one warn line; `heldIdentity().name` `undefined` |
| contracts §2 cancel | `cancel()` during `prepare`; during the start | `cancelled` (row 11); `stopBackground` called; the relay is never opened, or is closed |
| F-0502 BR-8 | held connection; a relay connection closes; inspect says `exited` | `onTransportClosed` fires once |
| F-0502 7.E15 | the same with `paused` | `onTransportLost` fires once |
| F-0502 BR-7 | the same with `running`, same `StartedAt` | neither fires |
| F-0502 7.E1 | a reconnection resolve; running; `kill -0` status 1 | `transportLost`; no `prepare`, no start |
| F-0502 7.E15 | a reconnection resolve; running; `kill -0` status 0 | the held `Connected`, the same port and token |
| R-26 | a server token `tok-s3cret` and `containerEnv` `PASS=pw` | no logged line, no engine argv and no diagnostic holds either |
| contracts §6 no shell | a dockerPath `/opt/my docker/dk 'q'` | `engineFor` got exactly that file |

### 5.3 `server-steps.test.ts`

| Cite | Given | Expected |
|---|---|---|
| F-1402, F-0503 BR-14(e) (athena Q1) | resolution steps `override`, `productTemplate`, `builtInTable` | the plan's source is the resolved address in each case; `noSource` gives row 6 |
| F-0503 AC-38 (containers-05's key) | a `builtInTable` resolution | the client archive folder is `clientArchiveFolder(root, product, archiveKeyOf('builtInTable', profile))` |
| F-0503 §3.2 | `remote.serverDownloadFolder` `/cache`; unset | the cache root is `/cache`; the temporary folder's `vscode-remote-containers` |
| F-0503 BR-17, AC-52 | the start | the start runs lib-server's start body, whose arguments hold `--telemetry-level off` (asserted on the recorded script) |
| contracts §5.2 | `volumeMounted` true | `installTree` is `cacheFolders(product, commit, platform, true).serverTree`; false: `''` |
| F-0503 7.E3 | the probe reports an unsupported machine `armv7l` on Alpine; on glibc | row 7 with S031; with S359 |
| F-0503 7.E1 | the start reports prerequisites missing, with output text | row 8 with that text |
| F-0503 7.E2 | `transfer` fails `localDownload` once, then succeeds | two `transfer` calls; the connect proceeds; the log has one line with the URL, the cache path, the reason and `retrying once` |
| F-0503 7.E2 | `transfer` fails `localDownload` twice | two calls; the connect fails as `serverFailed` (§3.7 row 9), with the second failure's detail; one retry line |
| F-0503 7.E2 | `transfer` fails `verification`, then succeeds | the retry line also carries S157's text |
| F-0503 7.E2 | `transfer` fails `cancelled`; then `copyFailed`; then `channelClosed` | one `transfer` call each; no retry line |

### 5.4 `register-connector.test.ts`

- **The resolver options:** `registerResolver` is called with `family: 'dev-container'`, `cancellable: false` and
  `allowsTrust: false`.
- **A missing `resolvers` proposal:** with `served.missing` `['resolvers']`, the readiness answers false, so the
  registration is `proposalMissing`, and the log command is still registered.
- **The label:** after the first resolve settles connected, the label is registered once, with
  `workspaceSuffixOf(...)`.
- **The log command:** `remote-containers.revealLogTerminal` reveals the channel.

### 5.5 What's not here

The acceptance gate row 1 (Reopen connects; title and indicator) is containers-09's, and so are rows 8, 9 and 10.

## 6. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

To `unit`, if the file is on main when this card merges; otherwise the PR lists them:
- F-0503 AC-52 (§5.3);
- F-0504 AC-29, AC-30, AC-22 (the suffix; their rendering is core's, noted in the PR).

The other ACs these rows touch stay `todo`, because they need the acceptance rows of containers-09 or the
increment-1b cards:
- F-0502 AC-1 to AC-7, AC-19, AC-39, AC-40, AC-42;
- F-0503 AC-1, AC-2, AC-38;
- F-0504 AC-1, AC-3, AC-31.

Cite them in the rows all the same.

## 7. Gates and review

**Gates:** typecheck, lint, format:check, dupes, dead, check-layout, check-string-tables, check-identifiers,
check-consumed (once #741 has merged), check-coverage, check-licences and coverage. The changed files must be at
100 %.

**PR:** the title is `remote-containers: the container connector (card containers-08, #776)`. Request review from
athena only; hermes assigns the peer.

## 8. Open rows (stop and report on #776)

1. `pnpm dupes` flags `server-steps.ts` against remote-ssh's server steps. Report the blocks. Moving the composition
   into lib-server is athena's call.
2. **For athena:** the second check runs with `base: undefined` (§3.2 step 3). A relative `dev.containers.dockerPath`
   therefore resolves as a bare name on `PATH`, never against the folder, inside the resolve.
3. lib-server's start body doesn't pass `--telemetry-level off` on the reuse path. Report what it passes there.
4. A reconnection's `kill -0` can't run because the held channel's container user lacks `kill`, a missing shell
   builtin. Report it, and don't add a fallback by guess.
