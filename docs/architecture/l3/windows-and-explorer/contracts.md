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

| Operation | Input | Output | Failure |
|---|---|---|---|
| `standDownIfReferencePresent` | the reference id (from the package's identity decision), the standing-down key, the warning text and button label (the package's own strings: F-0101, F-3901, F-5001, F-8901) | `standing` or `serving` | none. The lookup is the stable `extensions.getExtension(id)` in the extension's own host. It sees the reference only while core runs it, and a disabled reference is invisible [oss], as R-54 requires (F-5901 step 1) |

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
| `label` | `DecodedTarget` | the host label used by the resource label formatter and the indicator (`workspaceSuffix`) | none |

Target shapes:

| Family | Target | Spec |
|---|---|---|
| `ssh-remote` | `{alias}` or `{hostName, user?, port?}`, and `rawHostString`. Windows client user-name forms are provisional (lab) | F-2501, F-2301 BR-3/BR-4, F-2303 BR-2 |
| `dev-container`, `attached-container`, `k8s-container` | the decoded payload of F-0501, plus an optional outer hop (`@ssh-remote+…`, `@wsl+…`, `@tunnel+…`) that is itself a `DecodedTarget` | F-0501, F-0502, F-1302 |
| `tunnel` | `{tunnelName, distro?}` | F-8103, F-5902 §5 |
| `wsl` | `{distro}` | remote-wsl drafts (pending) |

Rule: `decode(encode(target))` returns `target`, and `encode(decode(authority))` returns `authority` for every form a
spec fixes. A property test per family checks both directions.

### 3.2 Resolver host

| Operation | Input | Output | Failure |
|---|---|---|---|
| `registerResolver` | `family`, `connector` (area A's `connect`, `cancel`, `revealDetails`, phase events, `transportLost` and `transportClosed` events), the family's codec, the extension's failure presenter, `cancellable` (false for `ssh-remote`, F-2304 BR-2) | a disposable | `GuardStandingDown`: nothing is registered (`lib-standdown` ran first and said "standing"). `ProposalMissing`: `resolvers` is not granted. The gate (3.4) is told and nothing is registered |
| on each core resolve (internal) | the authority and core's attempt number | core's resolved authority: `Connected.address`, `connectionToken`, `extensionHostEnv`, plus `environmentTunnels`, `tunnelFactory` and `tunnelFeatures` (F-8202) handed to core unchanged. The host never sets `isTrusted` (F-2001 BR-12) | from `Failed`, first match wins: (1) `retryable` (A decides from the kind and `isReconnection`; the host never interprets kinds): `TemporarilyNotAvailable`; (2) `isReconnection`: plain `NotAvailable`, no presenter, core shows its own "Cannot reconnect" (F-2601 BR-9, F-2603 AC-20, F-0502); (3) `userAlreadyNotified`: `NotAvailable(handled)`; (4) otherwise the presenter shows the extension's dialog for the kind and the result is `NotAvailable(handled)` |
| `currentConnection` | none | `none` or `{decodedTarget, state: resolving | connected | failed | transportLost | transportClosed}` for this window, the transport states taken from A's events | none. This is what companion queries answer from, for example `getActiveSshRemote` and F-8201 BR-3 |
| `onFirstResolveSettled` | listener | fires once per extension-host session when the first resolve attempt ends, success or failure | none. It feeds the `setActiveFolders` push (F-3906 rule 7) |

Phases: the host subscribes to the connector's phase events and renders core progress with the extension's titles
(F-2304). "(details)" calls `connector.revealDetails`. Area A owns the phases and their names (agreed with worker-1).

Cancellation: core's resolve carries no cancellation. Progress offers Cancel only when the resolver registered as
`cancellable` (never for `ssh-remote`, F-2304 BR-2). Otherwise the host calls `connector.cancel` only when the window
tears down (the extension host deactivates, "Close Remote Connection", the window closes). Area A then ends prompts and
processes, and a running host-side download is not stopped (F-2304 BR-8).

Failure presenter (per extension, B): it renders by `Failed.kind`. The kinds `noServerSource` and
`invalidServerTemplate` show remote-ssh F-3902 rule 8's dialog ("Open Setting" or "Cancel"), and remote-containers
shows F-1402's no-default dialog in its place. `licenceDeclined` shows F-2601's dialog with STR:S027 (F-3902 rule 11).
Every other kind shows F-2601's dialog (remote-ssh) or F-0502 7.E4's (remote-containers), with `reason` and `hints`.
`lib-product` returns values and never shows UI, so area A's `userAlreadyNotified` is true only after the
pre-connection script's own dialog (F-2108). (Area A's review, accepted by the lead 2026-10-06.)

Not in this contract: `resolveExecServer` for nested authorities (F-1302). It waits for the containers room's answer
(lead, 2026-10-06).

Connect input passed to A: `{target, rawHostString, attempt, isReconnection, windowId}`. The `Connected` and `Failed`
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
stable `vscode.openFolder` (`forceNewWindow`, `forceReuseWindow`) and `vscode.newWindow` (`remoteAuthority`) [oss].

### 3.4 Proposed-API gate (family-wide; lead's decision 2026-10-06)

| Operation | Input | Output | Failure |
|---|---|---|---|
| `probe` | the proposals this extension declares | per proposal `granted | missing | unprobeable`. Probes (F-1403): `resolvers` through a side-effect-free gated member, `tunnels` through `workspace.tunnels`, `contribViewsRemote` through the generated `<viewId>.focus` command in `getCommands(true)`, `terminalDataWriteEvent` through `window.onDidWriteTerminalData` (F-3903 rule 4; a partial grant registers what it allows). `contribRemoteHelp` is unprobeable | none |
| `requestSetup` | the missing proposals, the calling extension id | at most one setup notification per window for the whole family, unless the dismissal flag of F-1403 §6 is set. The primary action opens core's runtime-arguments editor (`workbench.action.configureRuntimeArguments`) and offers the `enable-proposed-api` entry with every installed family id that has a missing proposal. Then a restart offer | `Declined`: sets F-1403 §6's dismissal flag; when the prompt comes back follows F-1403 §6 |
| (no success cache) | | Every activation probes again; nothing is cached on success (F-1403 §6, lead 2026-10-06) | |

Family-wide coordination: each extension runs its own gate, but only one notification may show. The gate claims the
window through a context key that an R-27 ledger entry names. The first extension to claim it shows the notification
for all, and the others stay silent. F-1403 allows this one family-wide flow (containers room, through the lead).

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
| Explorer inbox | remote-explorer | `remote-internal.setActiveFolders` (push), `remote-internal.sshHostsChanged` `[adaptation]` (push) | remote-ssh |
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

- F-8201 BR-8 and §16 have the tunnels companion push `remote-internal.setActiveFolders`, while F-5902 §5 names only
  `remote-oss.remote-ssh` as its caller. The envelope accepts both. The interface document needs one answer (to the
  explorer and server rooms).
- F-8201 BR-7 and Q5: the tunnel folder history comes in first-recorded order, but F-5902 §5 says most-recent-first.
  The contract carries the order as delivered, and the view sorts by its own setting. Only the delivered order is
  open.
- F-8201 Q1 is decided as "three quirks fixed": `currentConnection` answers from the window's own connection in every
  tunnel window, and the history is read from storage on every query.
- Provisional (lab), held under D-60: the `ssh-remote` codec's handling of Windows client user names (F-2301 Q2) and
  any Windows-only encoding; the WSL row of a Windows tunnel machine (F-5202 Q2 class); the F-2304 retry counter
  (STR:S026). Each keeps the spec's provisional default until the lab run.
