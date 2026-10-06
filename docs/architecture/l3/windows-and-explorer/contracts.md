# Area B contracts (draft): lib-authority and lib-companion

Status: draft by `remote-architect-worker-2`, 2026-10-06. This is written ahead of the container view at the lead's
request. It covers the two shared libraries of area B. The extension-internal contracts follow in deliverable 2. A
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

## 1. lib-authority

### 1.1 Authority codecs

One codec module per authority family. The transport never parses an authority string (lead's ruling, 2026-10-06).

| Operation | Input | Output | Failure |
|---|---|---|---|
| `decode` | the authority string after core split it at the first `+` (family, payload) | `DecodedTarget`: `family`, `target` (the family's own shape, below), `rawHostString` (the payload exactly as written) | `MalformedAuthority {family, payload, reason}`. The resolver host maps it to NotAvailable, not handled. Malformed forms wait for F-2501 Q1 |
| `encode` | `family` and `target` | the authority string, in the form the family's spec fixes (F-2301 BR-4 for `ssh-remote`, F-0501 for containers) | `UnencodableTarget` (a programming error; never reaches a user) |
| `label` | `DecodedTarget` | the host label used by the resource label formatter and the indicator (`workspaceSuffix`) | none |

Target shapes:

| Family | Target | Spec |
|---|---|---|
| `ssh-remote` | `{alias}` or `{hostName, user?, port?}`, and `rawHostString` | F-2501, F-2301 BR-3/BR-4, F-2303 BR-2 |
| `dev-container`, `attached-container`, `k8s-container` | the decoded payload of F-0501, plus an optional outer hop (`@ssh-remote+…`, `@wsl+…`, `@tunnel+…`) that is itself a `DecodedTarget` | F-0501, F-0502, F-1302 |
| `tunnel` | `{tunnelName, distro?}` | F-8103, F-5902 §5 |
| `wsl` | `{distro}` | remote-wsl drafts (pending) |

Rule: `decode(encode(target))` returns `target`, and `encode(decode(authority))` returns `authority` for every form a
spec fixes. A property test per family checks both directions.

### 1.2 Resolver host

| Operation | Input | Output | Failure |
|---|---|---|---|
| `registerResolver` | `family`, `connector` (area A's `connect`, `cancel`, phase events), the family's codec, the extension's failure presenter | a disposable | `GuardStandingDown`: nothing is registered (`lib-standdown` ran first and said "standing"). `ProposalMissing`: `resolvers` is not granted. The gate (1.4) is told and nothing is registered |
| on each core resolve (internal) | the authority and core's attempt number | core's resolved authority: `Connected.address`, `connectionToken`, `extensionHostEnv`, plus `environmentTunnels` and `tunnelFactory` handed to core unchanged | from `Failed`: `TemporarilyNotAvailable` when `retryable`; else `NotAvailable(handled)` when `userAlreadyNotified`; else the presenter shows the extension's failure dialog (F-2601, F-0502 7.E4) and the result is `NotAvailable(handled)` |
| `currentConnection` | none | `none` or `{decodedTarget, state: resolving | connected | failed | transportLost}` for this window | none. This is what companion queries answer from, for example `getActiveSshRemote` and F-8201 BR-3 |
| `onFirstResolveSettled` | listener | fires once per extension-host session when the first resolve attempt ends, success or failure | none. It feeds the `setActiveFolders` push (F-3906 rule 7) |

Phases: the host subscribes to the connector's phase events and renders core progress with the extension's titles
(F-2304). Cancel from the progress calls `connector.cancel`. "(details)" calls `connector.revealDetails`. Area A
owns the phases and their names (agreed with worker-1).

Connect input passed to A: `{target, rawHostString, attempt, isReconnection, windowId}`. The `Connected` and `Failed`
shapes are area A's contract and are cited here, not restated.

Requirements: `extensionKind` `["ui"]` for every resolver extension, because core looks resolvers up among local
extensions only [oss]. `onResolveRemoteAuthority:<family>` is declared in the manifest. The `resolvers` proposal is
needed (F-1403).

### 1.3 Window opener

| Operation | Input | Output | Failure |
|---|---|---|---|
| `openRemote` | `authority`, `path?`, `pathKind: folder | workspace` (as told, never guessed; F-5902 §5, F-8201 BR-2), `target: current | new` | resolves when core accepted the request | `OpenRejected {reason}`. Nothing opens and the opener shows nothing. The caller decides whether anything is shown (F-5902 "A call fails at run time") |
| `openLocal` | `path?`, `pathKind`, `target` | as above | as above. Used by reopen-locally flows (F-0406) |
| `reload`, `closeRemote` | none | none | none |

Semantics fixed by the specs: "current" reloads the calling window, even on the same target. "new" opens exactly
one new window and never reuses one (F-5103, F-8201 BR-12). A target with no path opens no folder. Built on core's
stable `vscode.openFolder` (`forceNewWindow`, `forceReuseWindow`) and `vscode.newWindow` (`remoteAuthority`) [oss].

### 1.4 Proposed-API gate (family-wide; lead's decision 2026-10-06)

| Operation | Input | Output | Failure |
|---|---|---|---|
| `probe` | the proposals this extension declares | per proposal `granted | missing | unprobeable`. Probes (F-1403): `resolvers` through a side-effect-free gated member, `tunnels` through `workspace.tunnels`, `contribViewsRemote` through the generated `<viewId>.focus` command in `getCommands(true)`. `contribRemoteHelp` is unprobeable | none |
| `requestSetup` | the missing proposals, the calling extension id | at most one setup notification per window for the whole family. The primary action opens core's runtime-arguments editor (`workbench.action.configureRuntimeArguments`) and offers the `enable-proposed-api` entry with every installed family id that has a missing proposal. Then a restart offer | `Declined`: remembered per machine and product (`dataFolderName`), so the next prompt comes only when a gated member is about to be used again (F-1403) |
| `cacheResult` | per extension and proposal | stored per machine and editor product in the editor's global state | none |

Family-wide coordination: each extension runs its own gate, but only one notification may show. The gate claims the
window through a context key that an R-27 ledger entry names. The first extension to claim it shows the notification
for all, and the others stay silent. Whether F-1403's ACs allow this is with the containers room (lead, 2026-10-06).

## 2. lib-companion

The one implementation of the F-5902 §5 contract. `docs/companion-interface.md` in this package is the single copy of
the interface document (lead, 2026-10-06; F-3906 RR-5).

### 2.1 Envelope

Every argument and every result is a plain-data object carrying `interfaceVersion {major, minor}` (the field name is
fixed by the interface document). Within a major version, fields are only added.

| Operation | Input | Output | Failure |
|---|---|---|---|
| `call` (caller side) | command id, argument | the result, or `Unavailable {cause: notRegistered | rejected | timeout | foreignPayload | unknownMajor}` | never throws. The caller measures the 10 s limit per call (F-5902 rules). No retry; the next build or Refresh tries again |
| `serve` (server side) | command id, handler, the kind of the id (`query | change | push`) | registers the command (never contributed, never in a menu) | an argument without the envelope or with an unknown major version never reaches the handler. Queries return an empty result, changes and pushes return nothing, and nothing is shown or written (F-5902 "Foreign callers and payloads"). On the first unknown-major payload of a session, the optional `onVersionMismatch` hook fires once. The SSH and tunnels companions log one line there, and the explorer passes no hook |
| `fireAndForget` | command id, argument | none | swallows every rejection with no UI and no log (F-3906 rule 7) |

### 2.2 Companion detection

| Operation | Input | Output | Failure |
|---|---|---|---|
| `isPresent` | family companion id (`remote-oss.remote-ssh`, `remote-oss.remote-server`, `remote-oss.remote-wsl`) | `present | absent`, across extension hosts with `extensionsAny` and same-host only without it | none. Without the grant, a companion in another host reads as absent, silently (F-5902 "Extension hosts and detection") |
| `onPresenceChanged` | listener | fires when a companion is enabled or installed. Disabling keeps the group until reload (F-5101 BR-8) | none |

Microsoft ids and community forks never count (R-21, R-22). Detection uses ids only and never calls a command to find
out.

### 2.3 Per-companion endpoint sets

These hold the ids of F-5902 §5. The payload fields belong to the interface document. The table says only who
serves which id.

| Set | Served by | Ids | Called by |
|---|---|---|---|
| Explorer inbox | remote-explorer | `remote-internal.setActiveFolders` (push), `remote-internal.sshHostsChanged` `[adaptation]` (push) | remote-ssh |
| SSH endpoints | remote-ssh | `getActiveSshRemote`, `getConfiguredHostnames`, `getSshFoldersHistory` (queries), `deleteSshFolderFromHistory`, `openRemoteSshTarget` (changes), all `remote-internal.` | remote-explorer |
| Tunnels endpoints | remote-server | `remote-tunnels.internal.` `isAuthenticated`, `getTunnelsList`, `getActiveRemote`, `getFoldersHistory` (queries), `connectToRemote`, `deleteFolderFromHistory`, `unregisterTunnel` (changes), plus `remote-tunnels.isConnectedToRemote` and `remote-tunnels.connectNewWindowToTunnel` (F-8201's own) | remote-explorer |

### 2.4 Test fixture

A recording fake of each endpoint set (an R-26-class test build). It records each call's id and interface version and
the push's outcome field, can be told to reject, never answer, or answer with a foreign or newer-major payload, and
lives in the package's test fixtures. It is never bundled into a VSIX (lead, 2026-10-06; testing ADR). It serves
F-5902 AC-5, AC-9, AC-15, AC-16, AC-18 to AC-22, AC-29, AC-30, AC-32 and AC-34, and F-3906 C-6, C-10, C-11, C-13 and
C-14.

## 3. Open points against the specs

- F-8201 BR-8 and §16 have the tunnels companion push `remote-internal.setActiveFolders`, while F-5902 §5 names only
  `remote-oss.remote-ssh` as its caller. The envelope accepts both. The interface document needs one answer (to the
  explorer and server rooms).
- F-8201 BR-7 and Q5: the tunnel folder history comes in first-recorded order, but F-5902 §5 says most-recent-first.
  The contract carries the order as delivered, and the view sorts by its own setting. Only the delivered order is
  open.
- F-8201 Q1 (fix three reference quirks) decides what `currentConnection` must answer in a tunnel window that reuses
  a relay. This draft follows the spec's "fix" choice.
