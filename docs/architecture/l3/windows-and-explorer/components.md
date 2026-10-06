# C4 level 3: area B components (resolvers, windows, Remote Explorer and companions)

Status: version 2 by `remote-architect-worker-2`, 2026-10-06, against `c4-l2-containers.md` (b007348). It includes the lead's
answers of 2026-10-06 and the A/B reconciliation with `l3/transport-and-server/traceability.tsv`. Every
feature id maps to exactly one owning component in `traceability.tsv`. Contracts of the shared libraries are in
`contracts.md`. The two ADR drafts are in `adr-drafts/`. Component names are `<package short name>.<component>` and
are the names the matrix and the coding briefs use.

Rules for every component:

- Code that touches the editor API sits behind an adapter named in the component's row (ADR-0002 rule 7). Everything
  else is plain TypeScript tested under Mocha.
- Identifiers come from the package's generated table (ADR draft "Identifier tables"), never as literals.
- No component of area B starts a process, reads or writes files of its own, or opens a network connection. The
  editor's global state is the only store, and only where a row says so.

## 1. Shared libraries

### lib-identifiers

| Component | Responsibility | Owns | Provides to |
|---|---|---|---|
| `identifiers.tables` | The contract for the generated per-package tables: kinds, naming, the companion and internal id list, the invented-id ledger and the CI check `identifiers`. The generator itself is a tool under `tools/` | F-1406 (proposed move) | every package |
| `identifiers.command-registry` | Registers a package's commands from its table. Every command gets a handler, and each handler runs behind the R-46 out-of-context guard its spec chooses (silent, or the R-46 info line) | none (contributor) | every package with commands |
| `identifiers.settings-reader` | Reads settings through the table with declared legacy pairs and their precedence (F-0102 BR-4) | none (contributor; F-0102 is area C) | containers, ssh, wsl, server |
| `identifiers.context-keys` | Sets only the context keys the table declares as extension-set | none (contributor) | containers, ssh, wsl, explorer, server |
| `identifiers.string-tables` | Key parity of `package.nls*.json` and `l10n/bundle.l10n.*.json` across the 14 locales, as a build check over each package's files. The bundles themselves belong to the package | none (contributor) | every package |

### lib-standdown

| Component | Responsibility | Owns | Provides to |
|---|---|---|---|
| `standdown.guard` | R-54: the first step of every activation. It detects the reference by id, sets the "standing down" key both ways (ADR draft "Stand-down gating"), shows the one warning with its one button, and returns `standing` or `serving` | none (each package's identity feature owns its R-54 rows) | all except the pack |

### lib-authority

| Component | Responsibility | Owns | Provides to |
|---|---|---|---|
| `authority.codecs` | One codec per authority family: decode, encode, label (the formatter's host part) | F-0501 | resolver fronts, connect flows, explorer |
| `authority.resolver-host` | Registers a resolver over `resolvers`. Calls area A's `connect` once per core attempt. Maps `Failed` to resolver errors (no extension dialog during reconnection). Hands `tunnelFeatures` to core. Renders phases and progress, cancellable only where the spec allows. Follows A's transport events. Exposes the window's connection state and the "first resolve settled" event | F-2304 (proposed move) | ssh, containers, wsl, server |
| `authority.window-opener` | Opens a target in the current or a new window, as folder, workspace or empty; reload; close remote | none (contributor) | every package that opens windows |
| `authority.proposed-api-gate` | Probes, the one family-wide setup notification, the argv.json route, the per-product cache | F-1403, F-3903 (proposed moves) | containers, ssh, wsl, server, explorer |

The workspace-trust gate moved to area C with F-0106 (lead, 2026-10-06).

### lib-companion

| Component | Responsibility | Owns | Provides to |
|---|---|---|---|
| `companion.protocol` | The F-5902 §5 envelope, the caller with its 10 s limit, the server wrapper with the foreign-payload rule, fire-and-forget pushes, the version-mismatch hook, and the one copy of `docs/companion-interface.md` | F-5902 | explorer, ssh, server, wsl |
| `companion.detector` | Companion presence by family id, across hosts with `extensionsAny`, and silently same-host without it | none (contributor) | explorer |
| `companion.endpoints` | The three endpoint sets as typed id lists (explorer inbox, SSH endpoints, tunnels endpoints) | none (contributor) | explorer, ssh, server |
| `companion.recording-fake` | Test fixture only, never in a VSIX: records calls and can reject, stay silent, or answer with a foreign or newer major version | none | tests of explorer, ssh, server |

## 2. Extensions

### remote-explorer (all of it is area B)

| Component | Responsibility | Owns | Uses |
|---|---|---|---|
| `explorer.package` | Manifest, activation (lazy: view or internal command), stand-down with key `remote-explorer.standingDown` (rename of F-5001's `serving`, ADR draft), command catalogue, 14 locales, desktop and web entries | F-5001, F-5002, F-5901 | `standdown.guard`, `identifiers.*` |
| `explorer.targets-view` | `remoteTargets` tree: groups present by companion, build order (pull first, render when all answered or failed), refresh, empty states, both settings | F-5101, F-5301 | `companion.detector`, tree adapter |
| `explorer.ssh-group` | Host rows from `getConfiguredHostnames`; "Open SSH Config File" and "New Remote" hand-overs; rebuild on `sshHostsChanged` and on `remote.SSH.configFile` changes | F-5102 | `companion.protocol` |
| `explorer.connect-actions` | The current-window and new-window actions on host, tunnel and folder rows through the companion's open command; path kind decided by the row | F-5103 | `companion.protocol` |
| `explorer.recent-folders` | Folder rows from the companion's history, sorted and collapsed by the view's settings; "Remove from Recent List" | F-5104 | `companion.protocol` |
| `explorer.tunnels-group` | Sign-in rows, tunnel machines, the WSL row, unregister; rebuild on `authentication.onDidChangeSessions` | F-5201, F-5202 | `companion.protocol`, `companion.detector` |
| `explorer.inbox` | Serves `setActiveFolders` (wake only, nothing stored) and `sshHostsChanged` | none (contributor of F-5902) | `companion.protocol` |

### remote-ssh-edit (all of it is area B)

| Component | Responsibility | Owns | Uses |
|---|---|---|---|
| `sshedit.package` | Manifest identity, `extensionKind` `["ui"]`, untrusted workspaces supported, empty activation events, 14 locales, README and licence | F-4002, F-4003, F-4901 | `identifiers.tables`, `identifiers.string-tables` (no `lib-standdown`, no `lib-log`: R-54 not extended, F-4901 §6) |
| `sshedit.language` | Declarative: language `ssh_config` with aliases and associations, the TextMate grammar, the language configuration file | F-4001, F-4101, F-4102 | none at run time |
| `sshedit.completion` | One completion provider for `ssh_config`: the keyword data list (R-53) with documentation, the tunnel snippet, the position gate, the space trigger. Nothing else is registered (R-60) | F-4201, F-4202, F-4203, F-4204, F-4902 | completion adapter |

### remote-extensionpack (all of it is area B)

| Component | Responsibility | Owns |
|---|---|---|
| `pack.manifest` | Code-less manifest: member ids in order, `extensionKind`, 14 locales, README and listing (R-62) | F-9001, F-9002, F-9101, F-9102, F-9103, F-9901 |

### remote-ssh (B part)

| Component | Responsibility | Owns | Uses |
|---|---|---|---|
| `ssh.package` | Activation contract, stand-down, help and report-issue commands, `remoteHelp`, command catalogue and palette gating, localization, pack membership, packaging; no chat surface | F-2001, F-2002, F-2004, F-2005, F-2006, F-2007, F-2606, F-3901, F-3904, F-3907 | `standdown.guard`, `identifiers.*`, `authority.proposed-api-gate` |
| `ssh.connect-flows` | Host picker, `user@host` input, connect in current or new window, new window on the active host | F-2301, F-2302, F-2303 | `authority.codecs`, `authority.window-opener`, A's `listConfiguredHosts` |
| `ssh.resolver-front` | The `ssh-remote` resolver on the resolver host, with the extension's titles and texts; reconnection attempts, each a fresh `connect` | F-2501, F-2505 | `authority.resolver-host`, A's `connect` |
| `ssh.window-surfaces` | Indicator entries, label formatter, opening folders, workspaces and links on a host; the hidden "Open Web UI" command | F-2502, F-2504, F-2509 | `authority.codecs`, `authority.window-opener` |
| `ssh.failure-ui` | The failure presenter: F-2601's notification and the "More Actions..." picker from A's `Failed.reason` and `hints`; F-3902 rule 8's no-source dialog; STR:S027 for a declined licence; actions call A's operations | F-2601, F-2602 | `authority.resolver-host` |
| `ssh.companion-endpoints` | Serves the five `remote-internal.*` ids, keeps the folder history in global state, pushes `setActiveFolders`, signals `sshHostsChanged` | F-2503, F-3906 | `companion.protocol`, `authority.resolver-host` (state) |
| `ssh.config-flows` | Picker for "Open SSH Configuration File...", the tab-scoped save watch, the change signal; the input box of "Add New SSH Host..." (F-2204 is owned by area A's S4, B contributes) | F-2203 | A's `configFilesInEffect`, `addHostFromCommandLine` |

### remote-server (B part)

| Component | Responsibility | Owns | Uses |
|---|---|---|---|
| `server.package` | Manifest, activation (with the startup activation its spec keeps for the check, constraint 26), stand-down, identifier tables, help, settings and issue commands | F-8001, F-8002, F-8901 | `standdown.guard`, `identifiers.*` |
| `tunnels.explorer-endpoints` | Serves the nine `remote-tunnels.*` ids, the tunnel folder history in global state, connect through the window opener. Data-only for now: the tunnel client behind it is frozen pending the user (area A, ADR-0005) | F-8201 | `companion.protocol`, `authority.window-opener` |
| `tunnels.web-surfaces` | Web only: the Explorer welcome, the `vscode-remote` web opener declaration, "Continue Working in VS Code Desktop" | F-8301, F-8302 | `authority.codecs`, `lib-product` (`urlProtocol`) |

### remote-containers (B part)

| Component | Responsibility | Owns | Uses |
|---|---|---|---|
| `containers.window-identity` | The 17 indicator entries, the extension-set context keys, the identity text that feeds the label formatter | F-0504 | `authority.codecs`, `identifiers.context-keys` |
| `containers.package` (B rows only) | Localization bundles; the debug activation event | F-0103, F-0507 | `identifiers.string-tables` |

Everything else in remote-containers is area C, including its resolver (F-0502, which uses `authority.resolver-host`),
reopen flows (F-0406), view registration (F-0906) and identity feature (F-0101). B appears there as a contributor.

### remote-wsl (B part, provisional until the drafts land)

| Component | Responsibility | Owns |
|---|---|---|
| `wsl.package` | Identity, help commands and `remoteHelp`, stand-down | F-6003, F-7901 |
| `wsl.targets-view` | `targetsWsl` recent folders over core's recently-opened list, connect through the window opener | F-6503 |
| `wsl.resolver-front` | The `wsl` resolver on the resolver host; the engine behind it is area D | F-6201 |
| `wsl.failure-ui` | The failure dialog and recovery actions, rendered from the engine's failure | F-6208 |

## 3. Decisions taken on this view (lead, 2026-10-06)

1. R-54 is not extended to ssh-edit (F-4901 §6 governs): no `lib-standdown`, no `lib-log`.
2. The guard acts at activation only, family-wide; no mid-session re-check, no containers-only hook (F-1406 §6
   revision requested).
3. The workspace-trust gate is area C (F-0106).
4. Catalogue defects fixed on main (b340cb3). Where the catalogue still disagrees, this matrix governs.
5. Moves into B accepted: F-2303, F-2304, F-2501, F-1403, F-3903, F-1406. F-2202 to A. The A/B reconciliation adds
   F-2001, F-2505, F-2509, F-8001, F-8002, F-8301, F-8302, F-6201 and F-6208 to B. It gives F-2204 to A, with
   `ssh.config-flows` as contributor.
6. The proposed-API gate follows F-1403 §6: no success caching, a dismissal flag (F-3903 aligns).
