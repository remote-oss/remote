# Area B dossier: resolvers, windows, Remote Explorer and companions

Status: dossier (deliverable 1) by `remote-architect-worker-2`, 2026-10-06, for `remote-architect`. Boundaries are
preliminary until the container view (C4 L2) is stable. Inputs: the spec issues cited below, the binding rulings, ADRs
0002 to 0006, and VS Code OSS cited `[oss]`. The A/B interface in section 2 is agreed with
`remote-architect-worker-1` and carries the lead's rulings of 2026-10-06.

Principle of the cut: area B owns everything the editor shows of a connection and of the family's targets. That covers
resolver registration, authority codecs, window open/reload/close, indicator entries, label formatters, failure
dialogs, the Remote Explorer, identifiers and the stand-down guard. Area A owns everything that touches the remote
side. B never starts a process. A shows only its own authentication prompts, through a narrow UI adapter.

## 1. Component candidates

Libraries (bundled, never published; names are the layout's working names):

| Component | Package | Responsibility | Features owned |
|---|---|---|---|
| Identifier tables | `lib-identifiers` | One table per extension of the D-14 identifiers and the R-27 invented ones. Typed constants for code, checked against the manifest. | F-5901, F-4901, F-9901, F-1401, F-1406, F-3901 |
| Command registration | `lib-identifiers` | Registers commands with the R-46 out-of-context guard. Reads settings with legacy-key precedence. | F-5002, F-2006, F-0107, F-0102 |
| Stand-down guard | `lib-standdown` | R-54 check before any registration. Shows the one warning and sets the menu-gating context key. | (shared; each package's activation feature cites it) |
| Proposed-API gate | `lib-authority` | F-1403's probe, the one setup notification, the argv.json route and the per-product cache, for every family extension. | F-1403, F-3903 |
| Authority codecs | `lib-authority` | Encode and decode one authority family each (`ssh-remote`, `dev-container`, `attached-container`, `k8s-container`, `wsl`, `tunnel`). Defines the decoded target type A consumes. | F-0501 (codec part) |
| Resolver host | `lib-authority` | Wraps `registerRemoteAuthorityResolver`. Calls A's `connect` once per core attempt. Maps `Failed` to resolver error kinds. Renders phases, progress and cancel. | (shared) |
| Window opener | `lib-authority` | Opens a target in the current or a new window, as folder, workspace or empty. Also reload and close-remote. | (shared) |
| Companion protocol | `lib-companion` | The F-5902 §5 contract: versioned plain-data payloads, the 10 s caller timeout, the foreign-payload rule, and companion detection across hosts (`extensionsAny`, stable fallback). | F-5902, F-3906 |

Extension components (inside each package; B part only):

| Component | Package | Responsibility | Features owned |
|---|---|---|---|
| Remotes view | remote-explorer | `remoteTargets` tree: groups, build order of calls, refresh, empty states, settings | F-5101, F-5104 |
| SSH group | remote-explorer | Host rows and hand-overs through the companion | F-5102 |
| Connect actions | remote-explorer | Current/new window actions through companion commands | F-5103 |
| Tunnels group | remote-explorer | Sign-in rows, machines, WSL row through `remote-tunnels.internal.*` | F-5201, F-5202 |
| Explorer package | remote-explorer | Manifest, activation, l10n, R-54 with key `remote-explorer.serving` | F-5001, F-5301 |
| SSH connect flows | remote-ssh | Host picker, `user@host` input and validation, current and new window, new window on the active host | F-2301, F-2302, F-2303, F-2205 |
| SSH resolver front | remote-ssh | The `ssh-remote` resolver on the resolver host, phases UI | F-2501, F-2304 |
| SSH window surfaces | remote-ssh | Indicator entries, resource labels, opening folders, workspaces and links, reconnection UI | F-2502, F-2504, F-2505 (UI part) |
| SSH failure UI | remote-ssh | F-2601 dialog, F-2602 picker, rendered from A's `Failed` | F-2601, F-2602 |
| SSH companion endpoints | remote-ssh | Serves the five `remote-internal.*` ids, folder history store, `setActiveFolders` push, `sshHostsChanged` signal | F-2503, F-2203 (UI part), F-2204 (UI part) |
| SSH package | remote-ssh | Activation, help rows, pack membership | F-2001, F-2004, F-2005, F-2007, F-3904 |
| ssh_config language | remote-ssh-edit | Language, grammar and language configuration (declarative) | F-4001, F-4101, F-4102 |
| ssh_config completion | remote-ssh-edit | Keyword list, snippet, position gate, nothing else (R-60) | F-4201, F-4202, F-4203, F-4204, F-4902 |
| ssh-edit package | remote-ssh-edit | Activation, kind, trust, identity, l10n | F-4002, F-4003 |
| Pack manifest | remote-extensionpack | Code-less manifest, member table, README (R-62) | F-9001, F-9002, F-9101, F-9102, F-9103 |
| Containers package | remote-containers | Manifest, activation, R-54, proposed-API setup trigger | F-0101 |
| Containers resolver front | remote-containers | Container authorities on the resolver host, setup-failure dialogs | F-0502 (UI part) |
| Containers window surfaces | remote-containers | Labels, title, 17 indicator entries, reopen elsewhere, help rows, view registration | F-0501, F-0504, F-0406, F-0105, F-0906 |
| Dependencies policy | remote-containers | Partner ids, packs (R-21, R-22) | F-1404 |

Not area B, from the issues read: F-0109, F-0402, F-0901 to F-0905 (view contents; F-0906 registers them) go to the
containers engine. The A side gets the phase work of F-2304, the classification in F-2601, the server and transport
behind F-0502, and the file parsing and writing in F-2203 and F-2204. remote-ssh's E21, E22 (except F-2203, F-2204,
F-2205), E24, F-2506 to F-2509, F-2603 to F-2606, E27, F-3902, F-3905, F-3907 and F-3908 go to A or the lead by
title. F-2002 (localization) and F-2003 (log) go to the lead's `lib-log` and l10n decision. F-2008 is a boundary note.
Its authority-form part joins F-2501 and its server part goes to A.

Misplaced or unread, flagged: the WSL Targets view (`targetsWsl`), the WSL resolver and the tunnels companion
(remote-server F-8201) are B-shaped but outside my reading list. I suggest B for their view and resolver fronts.

## 2. Interfaces crossing the boundary

B provides:

- `registerResolver(authorityFamily, connector)`. Runs the guard first, then registers. Each core attempt calls
  `connector.connect`. A `Connected` result goes to core as a resolved authority. A `Failed` result maps to
  NotAvailable (handled when `userAlreadyNotified`, else B shows F-2601's dialog) or to TemporarilyNotAvailable when
  `retryable`.
- `openRemoteWindow(authority, path?, pathKind: folder | workspace, target: current | new)`, `reloadWindow`,
  `closeRemote`. Failure: nothing opens and no UI of B's own (F-5902 "A call fails at run time").
- Authority codecs: `decode(authority) -> {family, target, rawHostString}`, `encode(target) -> authority`.
  Failure: malformed authority, reported as NotAvailable (open question 6).
- Companion endpoints (F-5902 §5, served by the explorer): `remote-internal.setActiveFolders` and
  `remote-internal.sshHostsChanged` `[adaptation]`. The explorer calls the provider ids. All payloads are versioned,
  answered within 10 s, and silent on failure.
- Identifier tables and `guard.standDownIfReferencePresent(referenceId, gatingKey) -> standing | serving`.

B needs from A (agreed with worker-1; rulings of the lead):

- `connect({target, rawHostString, attempt, isReconnection, windowId}, cancellation)`. It returns
  `Connected {address: tcp | managed socket factory, connectionToken, extensionHostEnv, remotePlatform, serverCommit,
  environmentTunnels, tunnelFactory}` or `Failed {kind, retryable, userAlreadyNotified, reason, hints {message, status,
  mitigations[], resources[]}, diagnostics {channel, lines}}`. Kinds: unreachable, authentication, hostKeyRejected,
  serverPrerequisite, unsupportedPlatform, serverInstall, serverStart, noServerSource, invalidServerTemplate,
  licenceDeclined, invalidSetting, preconnectFailed, lockTimeout, retriesExhausted, forwardingDisabled, timeout,
  cancelled.
- Phase events on a connection (initializing, downloading, installing, settingUpTunnel, waitingForForwarding, and
  so on, with timestamps), plus `cancel(connection)` and `revealDetails(connection)`.
- `transportLost` and `transportClosed` events. Core-side reconnection state stays with B.
- Operations: `listConfiguredHosts`, `configFilesInEffect`, `addHostFromCommandLine`,
  `killLocalConnectionServer(hostString)`, `killServer(target)`, `uninstallServer(target)`.
- The product profile (`lib-product`). B reads `urlProtocol` only (R-32) and never reads `product.json` itself.
- Authentication prompts are A's, through A's UI adapter. B never renders them.

## 3. External dependencies

- **Proposed API** (enabled only by F-1403's route: `enabledApiProposals` plus argv.json `enable-proposed-api` per
  id; the Option E petition is the user's call):

| Proposal | Needed by | Spec |
|---|---|---|
| `resolvers` | containers, ssh, wsl, server (resolver fronts; also `registerResourceLabelFormatter`) | F-0502, F-3903, F-1403 |
| `contribViewsRemote` | explorer, containers, wsl | F-5901, F-0906 |
| `extensionsAny` | explorer (companion detection across hosts; stable fallback silent) | F-5902 |
| `contribRemoteHelp` | containers, ssh (`remoteHelp` rows; no probe, rides on the `resolvers` grant) | F-0105, F-2004 |
| `tunnels` | containers, ssh (A side, forwarded ports) | F-1102, F-3903 |
| `terminalDataWriteEvent` | ssh (A side, login terminal) | F-3903 |

- **Stable API**: `window.createTreeView`, `commands.registerCommand`/`executeCommand`, `setContext`,
  `extensions.getExtension`/`onDidChange`, `authentication.onDidChangeSessions`, `workspace.onDidChangeConfiguration`,
  `languages.registerCompletionItemProvider`, `l10n`, and the built-in `vscode.openFolder` and `vscode.newWindow`
  commands.
- **Processes**: none in B. **Files**: none written by B except the editor's own global state (SSH folder history,
  F-2503 BR-10; proposed-API cache, F-1403). No file watching (R-66).

## 4. The identifier picture

| Extension | Settings | Commands | Views | Context keys | Other fixed ids | Invented (R-27) |
|---|---|---|---|---|---|---|
| remote-explorer | 2 | 13 + 1 internal served | 1 | 8 `viewItem` values | 34 menu items | `remote-internal.sshHostsChanged`, `remote-explorer.serving` |
| remote-ssh | 35 | 17 + 5 internal served | 0 | 0 | 8 menu items, authority `ssh-remote` | R-54 gating key (proposed `opensshremotes.active`), `remote.SSH.serverDownloadUrlTemplate` |
| remote-ssh-edit | 0 | 0 | 0 | 0 | language `ssh_config`, 3 file patterns, 4 scopes, 96 items | none |
| remote-extensionpack | 0 | 0 | 0 | 0 | pack id, 4 members in order | none |
| remote-containers | 43 | 71 | 3 | 13 | 5 authorities, 5 formatters, 6 menus, 5 welcome | gating key, unnamed (F-0101) |

Where the tables live: the package manifest stays the single source of every contributed identifier (D-14 is about
manifests). Each package's identifier table in `lib-identifiers` is generated from its manifest, so code never
spells an id twice. The invented ids carry their `[adaptation]` tag and spec in a ledger next to the table. CI
fails when the table, the manifest and the ledger disagree (ADR draft "Identifier tables").

## 5. Open questions, batched for the lead

1. **Stand-down gating vs lazy activation** (F-1406 §5, F-5901 step 6, F-2006 Q1). Menu and palette entries are
   gated by a key that only running code sets. An extension that activates lazily therefore shows no palette entries
   in a fresh window. F-2006 AC-1, AC-2 and AC-12 then fail. This needs one family answer, for example a gating key
   that only hides entries when the reference id is installed, or a startup activation. ADR candidate.
2. **R-27 lint has no input on the clean side.** The rule checks names against the pinned reference manifest, which
   we may not read. I propose that each room publishes its identity decision's identifier inventory as the list.
3. **One proposed-API setup flow for the family** (F-1403 is written for containers). Every family extension must
   be listed in argv.json separately. Can one notification add all installed family ids, or must each extension ask?
4. **F-3906's revision requests RR-1 to RR-5 to F-5902 §5 are open.** They cover the push in local folder windows
   and none in empty SSH windows, the host key as the authority host part, the configFile refresh, and the location
   of `docs/companion-interface.md`. In the monorepo, `lib-companion` would hold the one copy.
5. **WSL row model**: one "WSL" row per tunnel machine (F-5202 §3.3) contradicts one row per distro (F-5104 6.12,
   F-5002 3.1). This is open in remote-explorer#11, #12 and #15.
6. **Malformed `ssh-remote` authorities and IPv6 literals** (F-2501 Q1), and authority byte-compatibility with the
   reference (F-2301 Q3). The codec's contract depends on both.
7. **`extensionsAny`**: F-5101 §16's first clause, F-5301 PRE-1 and F-5902 §6 still disagree. I design to F-5902
   (always requested, silent stable fallback).
8. **Coexistence with the reference's companions** (F-2007 Q2: two Remotes views, two `ssh_config` languages). Do
   we extend R-54 to the companions or document the case?
9. **remote-ssh-edit**: F-4102 and F-4204 disagree on who owns auto-indent and folding. F-4201 and F-4202 state
   core's `quickSuggestions` default differently. F-4003 sets the display name by D-41 in one place and by the
   identity card in another. F-4002 says activation events are "empty" in one place and "absent" in another.
10. **Pack**: F-9001's engine floor needs a per-release owner. F-9103 needs a family decision on which members ship
    a `browser` entry. F-9101 and F-9102 are stale against F-9901's publishing rule. F-9102 Q3 asks about README
    wording.
11. **`engines.vscode` floor** (ADR-0002, still open). B needs it for the resolver and tree APIs it may use.
12. **Provenance pointers**: some specs carry provenance pointers (remote-explorer#10 §5.0, remote-ssh-edit#10
    §12, remote-ssh#63 and #68). Please ask the rooms to move them below the wall. remote-ssh#81 (F-3904) cites
    an issue in a dirty-room repository by id. My reader did not follow it; the room should check it.
14. **F-3901's R-27 ledger** (remote-ssh#78) does not list `remote-internal.sshHostsChanged`, although F-2203 and
    F-3906 call it. F-3906 §6 says the ledger records it as a called id.
13. **F-2304 Q2**: should a "waiting for port forwarding" state that never ends time out, or reproduce the hang?
    This is A's classification and B's UI.

## 6. The conformance picture

Coverage today (suites under `tests/conformance/` in each spec repo):

| Repo | Area B features with cases | Cases |
|---|---|---|
| remote-ssh-edit | F-4001 64, F-4002 72, F-4003 29, F-4101 99, F-4102 164, F-4201 115, F-4202 104, F-4203 97 (F-4204 none) | 744 |
| remote-containers | none of F-0101, F-0102, F-0105, F-0107, F-0406, F-0501, F-0502, F-0504, F-0906 | 0 of 416 |
| remote-explorer, remote-ssh, remote-extensionpack | no suite yet | 0 |

How the runner tests (case YAML `suite/<F>/<F>-AC<n>-<k>.yaml`, naming `feature`, `issue`, `ac`): it starts a stock
editor with a fresh profile and drives it as a user through the debugging port. It reads only what the screen
shows: palette titles, quick picks, dialogs, notifications, the indicator text, tree rows found by label, tokens
and suggest lists. No test hooks, exported APIs or test-only commands are used. What this means for the design:

- **Exact strings are the contract.** Command titles and categories (the indicator menu groups entries under the
  category), resource label formatters (`workspaceSuffix` drives the indicator and the `${remoteName}` window title),
  row labels, descriptions and icons. The identifier and string tables are the conformance surface.
- **Tree rows must have stable, unique labels per view.** The runner addresses rows by label text.
- **Activation and extension kind are tested** through core's Installed view (activation-time hover, local vs
  remote section). The lazy-activation question (open question 1) is therefore testable.
- **Blocking gap: the runner never enables proposed API.** Its editor fixture has no argv.json
  `enable-proposed-api` entry and no flag. Every case that needs our resolver (`resolvers`) or our views
  (`contribViewsRemote`) cannot pass for a `remote-oss.*` id. The profile must enable our ids, which is F-1403's own
  route. This goes to the runner's owner (R-73).
- **The F-5902 and F-3906 harness assertions need test builds** of the companions (R-26-class fakes that record
  internal calls). The runner has no such fixture yet. I propose that `lib-companion` ships a recording fake as a test
  fixture, built from the same contract, never shipped in a VSIX.
- Companion packages in the cases (`ENCODE_COMPANIONS`) must be ours. The schema bans the Microsoft ids.
- One recorded containers case expects an Install separator item that only genuine VS Code shows
  (remote-containers F-0507). That is a profile question, not a design one.

The first conformance target for area B can only be remote-ssh-edit, the only suite that covers it today. Its 744
cases test declarative contributions and one completion provider. The window, resolver and explorer surfaces wait for
the suites of remote-ssh and remote-explorer and for the proposed-API fix above.
