# Area B contracts: lib-identifiers, lib-standdown, lib-authority, lib-companion

Status: deliverable 2 by `remote-architect-worker-2`, 2026-10-06, against `c4-l2-containers.md` (b007348). The first
draft (PR #10) covered lib-authority and lib-companion. This version adds lib-identifiers and lib-standdown, and what
area B needs from `lib-log`. Components are named as in `components.md`. A
contract here is a set of named operations with inputs, outputs and failure states, with no code. Types are
described, not declared. A coding worker turns each table into TypeScript under ADR-0003 and may not change a contract
without the lead (AGENTS.md).

Common rules for both libraries:

- No process is started, no file is read or written, and no network is used. Everything crosses into the editor
  through narrow adapters (ADR-0002 rule 7), so the logic runs under plain Mocha.
- No product name appears (ADR-0006). The URI scheme comes from `lib-product`'s profile (R-32).
- No telemetry (R-28). No UI of the library's own beyond what a row below names.
- Every operation that waits on something outside the library takes a cancellation and has a stated time limit or
  states that it has none.

## 1. lib-identifiers

The tables are per package and generated from its manifest (ADR draft "Identifier tables"). The library holds only the
behaviour over a table, because a library never imports an extension (layout rule 4).

### 1.1 The table (data contract, produced by the generator)

| Kind | Entry | Source |
|---|---|---|
| commands | descriptive name, id, whether the palette lists it, the R-46 policy (`silent` or `infoLine`) | `contributes.commands`, `menus.commandPalette`, the package's spec (F-2006 BR-9, F-5002, F-0107) |
| settings | name, key, scope, legacy twin key and the winning side if any | `contributes.configuration`, F-0102 BR-4 |
| contextKeys | name, key, `extensionSet` or `core` | the identity decision's list |
| views, authorities, languages | name, id | `contributes.views`, `activationEvents`, `contributes.languages` |
| internalCommands | id, `served` or `called`, kind `query`, `change` or `push` | the companion and internal list (F-5902 §5) |
| runtimeCommands | id, purpose | reference command ids a spec names that the extension registers at runtime only: never contributed, no palette entry, no activation event (a keybinding in a window where the extension never ran gets core's "not found", R-46). The check verifies the namespace and that the id is not contributed; the generator emits them into the table, so code registers the generated id, never a literal (ruled 2026-10-12, #253 Q4; first entry `opensshremotes.showDetails`, F-2304 BR-12) |
| invented | id, kind, spec, date | the ledger (R-27) |

### 1.2 Operations

| Operation | Input | Output | Failure |
|---|---|---|---|
| `registerCommands` | the table's commands, a handler per name | one disposable | `MissingHandler {name}` at startup. It is a programming error that fails the unit test which loads every package's table. Never seen by a user |
| (each guarded handler) | the command's arguments and the window context (`remoteName`, connection state, the precondition the spec names) | the handler's result | out of context: does nothing and, for `infoLine` commands, shows "'{0}' is not possible in the current context." ({0} = the title) once per invocation (R-46). Internal ids never show anything (F-3906 rule 11, F-5902) |
| `readSetting` | the table's setting name | the effective value after legacy precedence | none. A missing value yields the declared default |
| `setContextKey` | the table's context-key name, a value | none | `NotExtensionSet {name}` (a programming error) |
| `checkStringTables` (build tool) | a package folder | pass, or the list of keys missing or extra per locale | fails the build |

## 2. lib-standdown

The warning helper takes the message text and the target extension id from the package (remote-ssh: F-2001 3.4 and
AC-29: non-modal, source "Remote - SSH", one button "Show Other Extension" opening the Extensions view filtered by
the other extension's `@id`, once per activation that stands down, no placeholders; the text mentions reloading the
window because of R-78). The mechanism is shared; the strings are each package's (recorded 2026-10-08).


| Operation | Input | Output | Failure |
|---|---|---|---|
| `standDownIfReferencePresent` | the reference id (from the package's identity decision), the standing-down key (optional: a package that gates nothing passes none, and no context key is set; ssh-edit, pending its F-4901 revision), the warning text and button label (the package's own strings: F-0101, F-3901, F-5001, F-8901) | `standing` or `serving` | none. The lookup is the stable `extensions.getExtension(id)` in the extension's own host. It sees the reference only while core runs it, and a disabled reference is invisible [oss], as R-54 requires (F-5901 step 1) |

Effects, in this order:

1. The lookup, before anything is registered.
2. `standing`: set the key to true, show one warning whose button opens the Extensions view on the reference id, and
   return. The caller registers nothing and returns from activation.
3. `serving`: set the key to false, clearing any value an earlier host run left in the window, and return. The caller
   goes on.

No check runs mid-session, family-wide (R-78). R-77 adds Remote Explorer and ssh-edit to the packages that call the
guard. Unit
tests cover present, absent, a stale key, and exactly one warning per standing activation.

## 3. lib-authority

### 3.1 Authority codecs

One codec module per authority family. The transport never parses an authority string (lead's ruling, 2026-10-06).

| Operation | Input | Output | Failure |
|---|---|---|---|
| `decode` | the authority string after core split it at the first `+` (family, payload) | `DecodedTarget`: `family`, `target` (the family's own shape, below), `rawHostString` (the payload exactly as written) | `MalformedAuthority {family, payload, reason}`. The resolver host maps it to NotAvailable, not handled. Malformed forms wait for F-2501 Q1 |
| `encode` | `family` and `target` | the authority string, in the form the family's spec fixes (F-2301 BR-4 for `ssh-remote`, F-0501 for containers) | `UnencodableTarget` (a programming error; never reaches a user) |
| `label` | `DecodedTarget` | the picker's text for a target, `user@host:port` (corrected 2026-10-12: the window's host label, which feeds `workspaceSuffix` and the indicator, is each extension's own pure function, for remote-ssh `hostLabel` per F-2502 BR-3; #171, `brief-remote-ssh-window-surfaces.md`) | none |

Target shapes:

| Family | Target | Spec |
|---|---|---|
| `ssh-remote` | `{alias}` or `{hostName, user?, port?}`, and `rawHostString`. Decodes the three forms of F-2008 BR-5: `<alias>`, a bare host name (`[a-z0-9.:-]` only, no user, no port; resolved like a typed host), and the lower-case hex of a compact JSON object `{hostName, user?, port?}` with a numeric port. Windows client user-name forms are provisional (lab) | F-2501, F-2008 BR-5, F-2301 BR-3/BR-4, F-2303 BR-2 |
| `dev-container`, `attached-container`, `k8s-container`, `apple-container` (F-0605), `exec` (F-0501; a formatter but no resolver) | the decoded payload of F-0501, plus an optional outer hop (`@ssh-remote+…`, `@wsl+…`, `@tunnel+…`) that is itself a `DecodedTarget` | F-0501, F-0502, F-1302 |
| `tunnel` | `{tunnelName, distro?}` | F-8103, F-5902 §5 |
| `wsl` | `{distro, outer?}`, the outer hop a `DecodedTarget` (`wsl+<d>@ssh-remote+<h>`). An empty distro means the default distro and is passed through, with no case folding: matching and the registered spelling are area D's | F-6201 BR-2, Q2 (a); F-6701 |

Rule: `decode(encode(target))` returns `target`, and `encode(decode(authority))` returns `authority` for every form a
spec fixes. A property test per family checks both directions.

### 3.2 Resolver host

| Operation | Input | Output | Failure |
|---|---|---|---|
| `registerResolver` | `family`, `connector` (area A's `connect`, `cancel`, `revealDetails`, phase events, `transportLost` and `transportClosed` events), the family's codec, the extension's failure presenter, `cancellable` (false for `ssh-remote`, F-2304 BR-2) | a disposable | `GuardStandingDown`: nothing is registered (`lib-standdown` ran first and said "standing"). `ProposalMissing`: `resolvers` is not granted; nothing is registered. The gate (3.4) has already run at activation, before registration, and told the user; the host returns `proposalMissing` and probes nothing itself (the caller's `Readiness` reuses the activation's probe; ruled 2026-10-12, #253) |
| on each core resolve (internal) | the authority and core's attempt number | core's resolved authority: `Connected.address`, `connectionToken`, `extensionHostEnv`, plus `environmentTunnels`, `tunnelFactory` and `tunnelFeatures` (F-8202) handed to core unchanged. `isTrusted` is passed to core only when `Connected.trusted` is true and the family allows it: the container families do (F-0106 BR-13: attach, pod and volume-clone windows); `ssh-remote` never does (F-2001 BR-12); `wsl` and `tunnel` do not | from `Failed`, first match wins: (1) `retryable` (A decides from the kind and `isReconnection`; the host never interprets kinds): `TemporarilyNotAvailable`; (2) `isReconnection`: plain `NotAvailable`, no presenter, core shows its own "Cannot reconnect" (F-2601 BR-9, F-2603 AC-20, F-0502); (2a) `silent`: plain `NotAvailable`, not handled, no presenter (F-0502: a stopped or removed container); (3) `userAlreadyNotified`: `NotAvailable(handled)`; (4) otherwise the host awaits the presenter's outcome before it answers core: `handled` gives `NotAvailable(handled)`, `reload` reloads the window, `closeRemote` leaves the remote |
| `currentConnection` | none | `none` or `{decodedTarget, state: resolving | connected | failed | transportLost | transportClosed}` for this window (`none` also when `ProposalMissing` left the window without a resolver), the transport states taken from A's events | none. This is what companion queries answer from, for example `getActiveSshRemote` and F-8201 BR-3 |
| `lastResolve` | none | `none` (no resolve has ended yet), `succeeded` or `failed`: the outcome of the last resolve whose result the host applied. Only an applied success or failure changes it, so it stays `succeeded` through `transportLost` and while a reconnection's resolve runs (ruled 2026-10-13, #637) | none. It feeds the `getActiveSshRemote` marker: "connected" exactly when it is `succeeded` (F-5902 §5 "has not succeeded", AC-27 "the row stays marked") |
| `onFirstResolveSettled` | listener | fires once per extension-host session when the first resolve attempt ends, success or failure | none. It feeds the `setActiveFolders` push (F-3906 rule 7) |

**`ProposalMissing` holds back the resolver alone, never the extension's commands** (ruled 2026-10-13, #540 and
#571's manual check; F-3903 §5 rule 4, "The extension's own commands after a failed probe"). Once the stand-down guard
says `serving`, the extension registers every command of its manifest, whatever the gate found. That includes the
connect commands, Kill Local Connection Server, Clear All Session Hints, the host and file pickers, Open Web UI and the
details command. A connect command still opens its `ssh-remote` window, whose own activation fails its probe and shows
the setup notification. A command that needs this window's connection answers from `currentConnection`, which is `none`
here, as in a local window. The gate decides only what needs a proposal: the resolver and its runtime label formatter
(`resolvers`), the tunnel factory (`tunnels`) and the terminal listener (`terminalDataWriteEvent`). A command missing
because the probe failed is a defect: the user sees core's "command not found" and nothing that points to the setup.

**Tunnels for `ssh-remote` are core's own** (ruled 2026-10-13, #617, from the user's "Forward a Port" failure on #613; corrected the same day with daedalus's fact that our result is a plain resolved authority, not a managed one). For `ssh-remote` the resolver result carries **neither** `tunnelFactory` **nor** `tunnelFeatures`. Our result is the address form (host, port, connection token), and core, given no factory, uses its own default tunnel over its connection to the VS Code Server, so the server opens each forward on the host, as F-2507 6.3 step 4 observes. Core reads `tunnelFeatures` only together with a factory ([oss] `src/vs/workbench/api/common/extHostTunnelService.ts`, `setTunnelFactory`), so without one its defaults hold: no privacy options, no elevation, protocol switching on ([oss] `src/vs/platform/tunnel/common/tunnel.ts`, `AbstractTunnelService`). That is F-2507 BR-9 and AC-19 exactly. A family whose spec ever asks for a factory (F-8202) gives it in core's function shape `(tunnelOptions, tunnelCreationOptions) => Thenable<Tunnel | undefined>`, never an object, with `tunnelFeatures` in core's shape `{elevation, public, privacyOptions, protocol}`, never cast. Core allows a visibility change whenever `privacyOptions` is non-empty (`canChangePrivacy`). This replaces the earlier "`tunnelFactory` and `tunnelFeatures` handed to core unchanged" for `ssh-remote`, and lib-forwarding's W3 `factoryFor` is withdrawn.

**A connected window enables core's Ports view** (ruled 2026-10-13, #615, from the user's run on #613). Core registers the Ports view in a remote window only when the context key `forwardedPortsViewEnabled` is true, and its other path, an `onTunnel` activation event, is skipped in a remote window until a tunnel opens ([oss] `src/vs/workbench/contrib/remote/browser/remoteExplorer.ts`, `enableForwardedPortsFeatures`; the key is `forwardedPortsFeaturesEnabled` in `src/vs/workbench/services/remote/common/tunnelModel.ts`). So once a window's first resolve has settled with the connection up (the label's moment and condition), the extension sets that key with the stable `setContext` command, as core's own test resolver does ([oss] `extensions/vscode-test-resolver`). The rule is the family's: every family's remote window does it, remote-ssh first. The key is core's name, not one of ours (D-14), and it enables no feature beyond the specs (R-60): F-2501 AC-35 and F-2507's ACs act in that view. A failed `setContext` is logged at `warn` and changes nothing else. Nothing sets it back, because core drops a window's keys with the window.

Phases: the host subscribes to the connector's phase events and renders core progress with the extension's titles
(F-2304). "(details)" calls `connector.revealDetails`. Area A owns the phases and their names (agreed with worker-1).
**Which phases carry "(details)"** (ruled 2026-10-12, #379): the link is decided **by phase, not by position**. It goes
with `initializing` (STR:S082, F-2304 3.4) and, in terminal mode, with `settingUpTunnel` (F-2308 6.1 step 4, 6.2 step 1,
with S132's tooltip); never with `waitingForOtherWindow` (F-2102 5.2 step 3: S157, "no details link") or any later
phase. The earlier rule, "the link on the first phase", only held while `initializing` was always first. A waiting
window's first phase is now S157, and its later `initializing` after the takeover must carry the link (F-2102 5.3 step
4). So the connector's phase events say which carry it (a `details` flag set by area A), and the host's progress
renders the link on every phase that has it, whatever its position.

**When the progress opens** (ruled 2026-10-14, connect-78, #866): the host opens the notification lazily, at the first
of:
1. a phase that is not `quiet`;
2. 1500 ms after the resolve started (F-2304 BR-11: visible "within about 1.5 s of the resolve starting").

A `quiet` phase sets the text the notification shows without opening it. Once open, the notification stays open, and
every phase updates it, quiet or not, until the connect settles. A connect that settles first shows none, which is
F-2304 §6.1 and F-2501 §6.3 step 2: a reload that reuses the connection.

**A connector reports a phase that is not quiet before it shows any prompt.** So a prompt never shows without its
notification (F-2304 BR-11, "no later than the first prompt").

Area A decides which of its phases are quiet: for `ssh-remote`, the pipeline's first `initializing` and every
`settingUpTunnel`. A family that never sends a quiet phase opens the notification at its first phase, as before.
The host's timer is the editor port's `startTimer`.

Cancellation: core's resolve carries no cancellation. Progress offers Cancel only when the resolver registered as
`cancellable` (never for `ssh-remote`, F-2304 BR-2). Otherwise the host calls `connector.cancel` only when the window
tears down (the extension host deactivates, "Close Remote Connection", the window closes). Area A then ends prompts and
processes, and a running host-side download is not stopped (F-2304 BR-8).

Failure presenter (per extension, B): it renders by `Failed.kind` and returns an outcome (`handled`, `reload`,
`closeRemote`). Remote-SSH's and remote-containers' presenters show their dialog without waiting and return `handled`
at once, because their buttons act later (F-2601). The WSL presenter keeps the resolve open until the user picks
(F-6208 BR-4): Retry gives `reload`, Close WSL Window gives `closeRemote`, Ignore gives `handled`. WSL kinds
`distroUnknown` and `proxyFailed` show STR:S053 and STR:S022 from `reason` (area D's contract). The kinds `noServerSource` and
`invalidServerTemplate` show remote-ssh F-3902 rule 8's dialog ("Open Setting" or "Cancel"; its text has no reference counterpart, so the wording is the product's own under ADR-0008, ruled 2026-10-09: `noServerSource` — "{2} knows no download location for the server of {0}. Set {1} to a URL template for this editor's server builds."; `invalidServerTemplate` — "The value of {1} is not a usable server download URL template: {3}."; {0} the client's `applicationName`, {1} `remote.SSH.serverDownloadUrlTemplate`, {2} the extension's display name, {3} the problem; never the name of another product; the two strings get ids of their own in the package's string table), and remote-containers
shows F-1402's no-default dialog in its place. `licenceDeclined` shows F-2601's dialog with STR:S027 (F-3902 rule 11).
Every other kind shows F-2601's dialog (remote-ssh) or F-0502 7.E4's (remote-containers), with `reason` and `hints`.
An empty `reason` (kinds `unknown` and `brokenPipe`) shows STR:S030. A `reason` is one of three forms (ruled 2026-10-12, #253 Q6): `{id}` (a string of the table with no placeholders), `{text}` (text the failing step wrote, shown as is), or `ReasonString {id, values}` whose `values` are each a `ReasonValue`: a `string`, a literal inserted as is (a port, a host, a setting name), or a nested `ReasonString` resolved the same way, at any depth. Whether a value is an id is decided by its type, never by looking a string up, so a literal that happens to equal an id is never translated. The pipeline carries only ids and literals (R-29); the presenter resolves the whole tree through the string table. F-2104's tunnel failure is `{id: 'S067', values: [{id: 'S089', values: []}]}` (7.E3 b, 7.E5) or `{id: 'S067', values: [{id: 'S073', values: [{id: 'S095', values: ['<range start>', '<range end>']}]}]}` (7.E1, 7.E11). `FilledString` (hints and mitigations) keeps its flat `string` values; it is a different type. `channelClosed` arrives with the reason
"Connection closed." (F-2604 7.E1). The closed list of kinds is area A's (`l3/transport-and-server/contracts.md`, R1
rules), and the presenter has one branch per kind it treats specially, with a default for the rest. A kind added
there needs no change here unless its spec names its own dialog.

Platform pick (B provides to area A's R4, F-2206 and F-2603 7.E3): `pickRemotePlatform(hostLabel)` returns
`linux`, `windows`, `macOS` or `cancelled`. It shows F-2206's picker only, writes nothing and decides nothing: when to
ask and whether to store the answer are R4's. It lives in `ssh.connect-flows`. Windows-specific wording is provisional
(lab) under D-60.
`lib-product` returns values and never shows UI, so area A's `userAlreadyNotified` is true only after the
pre-connection script's own dialog (F-2108). (Area A's review, accepted by the lead 2026-10-06.)

Not in this contract: `resolveExecServer` for nested authorities (F-1302). It waits for the containers room's answer
(lead, 2026-10-06).

For `ssh-remote` the connector's transport events come from the connection lease (ruled 2026-10-12, card connect-13):
lib-ssh's `transportLost` (the session to the host ended while the connection server lives; every window hears it)
is `transportLost`, after which core resolves again; lib-helper's `helperGone` (the connection server itself ended,
nothing of the lease comes back) is `transportClosed`, which the tracker accepts from `connected` or `transportLost`.
The pipeline's `Connection` exposes them through `onTransport`, since its lease is otherwise hidden after `connect`.
The window tunnel's own end is the third source (ruled on #299, 2026-10-12, daedalus's finding; on main since #302):
when the tunnel ends after `open` without being asked to (W2's `onClosed`: the local listener failed, or on the
second-login and socket paths the tunnel `ssh` exited), `onTransport` reports it as `transportLost`. From the window's
side a dead tunnel is a lost transport, whatever the ssh session's state, and core's reconnection makes a fresh
connection and a fresh tunnel (F-2505 BR-1). A `close()` the window asked for never fires `onClosed` (W2), so window
teardown never starts a spurious reconnection. `transportClosed` stays the helper's end alone.

The host's ports are part of the package's public surface (ruled 2026-10-09, #192): `ResolverEditor`, `ProgressPort` with `ProgressRequest` (title, `cancellable`, `onCancel`, details), `Connector` (`connect`, `cancel`, `revealDetails`, `onPhase`, `onTransportLost`, `onTransportClosed`), `FailurePresenter`, `Readiness` (`guard`, `resolversGranted`), and the results `Registration` (`registered` with a `ResolverHandle`, `standing`, `proposalMissing`); the extensions write the adapters and the test fakes use the same types.

lib-authority declares the connector contract types `Connected` and `Failed` (ruled 2026-10-08; `Failed.kind` is a
string at this level, narrowed by each extension's pipeline); the extensions import them, never define their own.

Connect input passed to A (and to area D's WSL connect): `{target, rawHostString, attempt, isReconnection, windowId,
windowWorkspace}`. `windowWorkspace` is the window's folder or workspace URI, or none, read in the local extension host
at resolve time. Area D uses it for the `code .` environment rendezvous (F-6303 6.1). The `Connected` and `Failed`
shapes are area A's contract and are cited here, not restated.

Requirements: `extensionKind` `["ui"]` for every resolver extension, because core looks resolvers up among local
extensions only [oss]. `onResolveRemoteAuthority:<family>` is declared in the manifest. The `resolvers` proposal is
needed (F-1403).

### 3.3 Window opener

| Operation | Input | Output | Failure |
|---|---|---|---|
| `openRemote` | `authority`, `path?`, `pathKind: folder | workspace` (as told, never guessed; F-5902 §5, F-8201 BR-2), `target: current | new` | resolves when core accepted the request | `OpenRejected {reason}`. Nothing opens and the opener shows nothing. The caller decides whether anything is shown (F-5902 "A call fails at run time") |
| `openLocal` | `path?`, `pathKind`, `target` | as above | as above. Used by reopen-locally flows (F-0406) |
| `reload`, `closeRemote` | none | none | none |

Semantics fixed by the specs: "current" reloads the calling window, even on the same target. "new" opens exactly
one new window and never reuses one (F-5103, F-8201 BR-12). A target with no path opens no folder. Built on core's
stable `vscode.openFolder` (`forceNewWindow`, `forceReuseWindow`, `forceLocalWindow` for a local window) and `vscode.newWindow` (`remoteAuthority`; `null` for a local window, since an absent value means the current window's authority) [oss] (ruled 2026-10-08, #96).

### 3.4 Proposed-API gate (family-wide; lead's decision 2026-10-06)

| Operation | Input | Output | Failure |
|---|---|---|---|
| `probe` | the proposals this extension declares | per proposal `granted | missing | unprobeable`. Probes (F-1403): `resolvers` through `env.appCommit` exactly (F-3903 rule 4, confirmed by the spec owner on remote-oss/remote-ssh#88, 2026-10-12; it replaces the earlier "any side-effect-free gated member" reading), `tunnels` through `workspace.tunnels`, `contribViewsRemote` through the generated `<viewId>.focus` command in `getCommands(true)`, `terminalDataWriteEvent` through `window.onDidWriteTerminalData` (F-3903 rule 4; a partial grant registers what it allows). `contribRemoteHelp` is unprobeable | none |
| `requestSetup` | the missing proposals, the calling extension id | at most one setup notification per window for the whole family, unless the dismissal flag of F-1403 §6 is set. The primary action opens core's runtime-arguments editor (`workbench.action.configureRuntimeArguments`) and offers the `enable-proposed-api` entry with every installed family id that has a missing proposal. Then a restart offer | `Declined`: sets F-1403 §6's dismissal flag; when the prompt comes back follows F-1403 §6 |
| (no success cache) | | Every activation probes again; nothing is cached on success (F-1403 §6, lead 2026-10-06) | |

Family-wide coordination: each extension runs its own gate, but only one notification may show. F-1403 allows this
one family-wide flow (containers room, through the lead). The claim (ruled 2026-10-08, replacing the context key,
which an extension can set but never read): the family's UI extensions share one local extension host per window,
where `vscode.commands.registerCommand` is synchronous and throws for an id that is already registered. The port
`WindowClaim.claim(extensionId)` does, in order: (1) `registerCommand(CLAIM_COMMAND, () => extensionId)`; success
means this extension holds the window (`{holder: extensionId}`), and the registration is kept in the extension's
subscriptions so deactivation releases it; (2) when the registration throws, `executeCommand(CLAIM_COMMAND)` gives the
holder's id (`{holder}`); (3) when that call fails too (the holder deactivated between the two steps), step 1 once
more; a second failure is `{holder: undefined}` and the caller decides as if claimed by another (silent). The result
feeds card authority-03's `windowClaimedBy`. On a `notify` decision the runner applies F-1403 §6 first: an extension whose own id this install's argv.json already lists (edited through a sibling's notification; restart pending) shows only the restart notification, never a second setup notification (the condition is the own id in `argvEnabled`, not an empty `argvEntries`; corrected 2026-10-08, #177). Properties: activation in one extension host is single-threaded and the
registration synchronous, so two extensions activating together cannot both hold the window; an extension host
restart (the only way a family extension deactivates while the window lives) clears every claim, and the next
activations claim anew, which is the wanted behaviour (the notification may show once more after a restart, as after
a reload). `CLAIM_COMMAND` is `remote-oss.gate.claim`: a family-internal id outside every reference namespace, so it is not an
R-27 invented id but an `internal` entry `{id, role: 'called', kind: 'query'}` in the `identifiers.json` of every
package that runs the gate (registered at runtime by each at activation, never contributed, never in a menu, no
`onCommand:` event: the call is only made when a holder is already active), and harmless to any caller (it returns an
extension id). Nothing else of the gate is shared between extensions; the dismissal flag stays per extension in its
global state.

## 4. lib-companion

The one implementation of the F-5902 §5 contract. `docs/companion-interface.md` in this package is the single copy of
the interface document (lead, 2026-10-06; F-3906 RR-5).

### 4.1 Envelope

Every argument and every result is a plain-data object carrying `interfaceVersion {major, minor}` (the field name is
fixed by the interface document). Within a major version, fields are only added.

| Operation | Input | Output | Failure |
|---|---|---|---|
| `call` (caller side) | command id, argument | the result, or `Unavailable {cause: notRegistered | rejected | timeout | foreignPayload | unknownMajor}` | never throws. The caller measures the 10 s limit per call (F-5902 rules). No retry; the next build or Refresh tries again |
| `serve` (server side) | command id, handler, the kind of the id (`query | change | push`) | registers the command (never contributed, never in a menu) | an argument without the envelope or with an unknown major version never reaches the handler. Queries return an empty result, changes and pushes return nothing, and nothing is shown or written (F-5902 "Foreign callers and payloads"). On the first unknown-major payload of a session, the optional `onVersionMismatch` hook fires once. The SSH and tunnels companions log one line there, and the explorer passes no hook |
| `fireAndForget` | command id, argument | none | swallows every rejection with no UI and no log (F-3906 rule 7) |

### 4.2 Companion detection

| Operation | Input | Output | Failure |
|---|---|---|---|
| `isPresent` | family companion id (`remote-oss.remote-ssh`, `remote-oss.remote-server`, `remote-oss.remote-wsl`) | `present | absent`, across extension hosts with `extensionsAny` and same-host only without it | none. Without the grant, a companion in another host reads as absent, silently (F-5902 "Extension hosts and detection") |
| `onPresenceChanged` | listener | fires when a companion is enabled or installed. Disabling keeps the group until reload (F-5101 BR-8) | none |

Microsoft ids and community forks never count (R-21, R-22). Detection uses ids only and never calls a command to find
out.

### 4.3 Per-companion endpoint sets

These hold the ids of F-5902 §5. The payload fields belong to the interface document. The table says only who
serves which id.

| Set | Served by | Ids | Called by |
|---|---|---|---|
| Explorer inbox | remote-explorer | `remote-internal.setActiveFolders` (push, wake only), `remote-internal.sshHostsChanged` `[adaptation]` (push) | `setActiveFolders`: remote-ssh and remote-server; `sshHostsChanged`: remote-ssh only |
| SSH endpoints | remote-ssh | `getActiveSshRemote`, `getConfiguredHostnames`, `getSshFoldersHistory` (queries), `deleteSshFolderFromHistory`, `openRemoteSshTarget` (changes), all `remote-internal.` | remote-explorer |
| Tunnels endpoints | remote-server | `remote-tunnels.internal.` `isAuthenticated`, `getTunnelsList`, `getActiveRemote`, `getFoldersHistory` (queries), `connectToRemote`, `deleteFolderFromHistory`, `unregisterTunnel` (changes), plus `remote-tunnels.isConnectedToRemote` and `remote-tunnels.connectNewWindowToTunnel` (F-8201's own) | remote-explorer |

### 4.4 Test fixture

A recording fake of each endpoint set (an R-26-class test build). It records each call's id and interface version and
the push's outcome field, can be told to reject, never answer, or answer with a foreign or newer-major payload, and
lives in the package's test fixtures. It is never bundled into a VSIX (lead, 2026-10-06; testing ADR). It serves
F-5902 AC-5, AC-9, AC-15, AC-16, AC-18 to AC-22, AC-29, AC-30, AC-32 and AC-34, and F-3906 C-6, C-10, C-11, C-13 and
C-14.

## 5. What area B needs from lib-log (owned by the lead)

1. **A logger passed in, never global.** Every library operation that may log takes the package's logger as a
   parameter, so a package without a log sends nothing. Remote Explorer and ssh-edit have no output channel by spec
   (F-5901 §6, F-4002 AC-14).
2. **A channel only where the spec has one**, created lazily under the package's own name: remote-ssh (F-2003),
   containers (F-0104), server and wsl per their specs.
3. **A once-per-session line** for the companion version mismatch (F-5902 "Version mismatch", F-3906 rule 9, C-14):
   `logOncePerSession(key, line)`, reset with the extension host.
4. **A redaction rule that libraries cannot bypass**: no prompt answers, tokens, payload contents, or authority
   strings beyond what the spec's log lines show (L2 `lib-log`; R-28).
5. **Levels** that follow each package's log-level setting (F-2003 for ssh). lib-authority logs resolve attempts and
   their outcome kind at the level the package's log spec names, and nothing else.

## 6. Open points against the specs

- Label formatters (container view): `authority.codecs.label` gives the host part, and each package declares its
  `resourceLabelFormatters` in its manifest. The runtime suffix cache of F-0501 stays in remote-containers (area C).
- The workspace-trust gate moved to area C (F-0106).
- Setup-flow caching follows F-1403 §6 (lead, 2026-10-06).

- **Companion interface 1.0, explorer side settled** by F-5902 §5 as republished (remote-explorer#14, reviewed
  2026-10-06):
  - `setActiveFolders` has two callers. remote-ssh pushes once per extension-host session in windows with a folder or
    workspace, local or SSH (RR-1), and never in an empty window (RR-4). remote-server pushes in tunnel windows with a
    folder. Nobody pushes in empty or `.code-workspace`-only windows. The push only wakes Remote Explorer.
  - The SSH host key in every SSH payload is the authority's host part as written (RR-2).
  - A `remote.SSH.configFile` change reaches the view through the explorer's own configuration listener, with no
    signal (RR-3).
  - The tunnel folder history is delivered in first-recorded order, and the view sorts by its setting. The
    `folder-active` mark comes from `getActiveRemote`.
  - `docs/companion-interface.md`: the explorer room's copy is authoritative in the spec repos. In the monorepo,
    `lib-companion` holds the one copy (RR-5).
  - `extensionsAny` is always requested (Option B), with the stable same-host lookup as the silent fallback.
  - Still open: the F-3906 side, which lands when remote-ssh#83 is edited. The interface document is frozen at
    1.0 then.
- F-8201 Q1 is decided as "three quirks fixed": `currentConnection` answers from the window's own connection in every
  tunnel window, and the history is read from storage on every query.
- Provisional (lab), held under D-60: the `ssh-remote` codec's handling of Windows client user names (F-2301 Q2) and
  any Windows-only encoding; the WSL row of a Windows tunnel machine (F-5202 Q2 class); the F-2304 retry counter
  (STR:S026). Each keeps the spec's provisional default until the lab run.
