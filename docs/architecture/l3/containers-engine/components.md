# Components: Remote - Containers, release 1

Status: ruled by athena (architect), 2026-10-14, for the release-1 cut of `brief-release-1.md` (D-87). This file
confirms the dossier's placement (dossier Q1: ownership as on main) for the components release 1 builds, and fixes
their boundaries. The contracts are in `contracts.md`, and the CLI-bridge policy is ADR-0009.

All components live in `packages/remote-containers`. Each is UI-free except where the table says, and reaches the
editor through narrow ports (ADR-0002 rule 7). Processes are spawned in two places only: C3 (the dev container CLI) and
C2 (the engine CLI).

## 1. The release-1 components

| Component | Responsibility in release 1 | Features (release-1 halves) | Uses |
|---|---|---|---|
| C1 package-shell | the manifest (release 1's contributions only, brief ruling 8); activation after lib-standdown's guard and the family proposed-API gate; the log channel; command registration through lib-identifiers | F-0101 (BR-9, BR-10, the core ACs) | lib-identifiers, lib-standdown, lib-authority (`familySetupPortsOf`), lib-log |
| C2 engine | the Docker CLI at `dockerPath`; the pre-flight checks (exists, answers, API ≥ 1.35, reaches the engine) and their dialogs before and after the reload; the one place that spawns `docker` | F-0201 | an `EngineHost` port over `child_process` (no shell), the notice and dialog ports |
| C3 cli-bridge | spawns the pinned `@devcontainers/cli` with the editor's Node; builds its arguments; parses its JSON result line and JSON log stream into progress, log lines and typed failures; never shows UI | F-0408's build and create phases, F-0412, F-0415, F-0416 (the `-uid` image) | ADR-0009; C2's endpoint (`--docker-path`) |
| C4 config | discovery and the picker; the validation the CLI lacks (empty file, relative `workspaceFolder`, container source); hands the selection to C6 | F-0301 (release-1 half) | C3's `read-configuration`, the workspace file port |
| C5 trust-gate | before Reopen, Open Folder and the rebuild commands run anything, asks for trust (F-0106 BR-2) | F-0106 (open commands only) | a `TrustPort` over `workspace.requestWorkspaceTrust` (proposal `workspaceTrust`, F-1403) |
| C6 open-flows | Reopen in Container, Open Folder in Container (Flow B), the four rebuild commands' window side: it builds the `dev-container` payload and reloads the window through lib-authority's opener; carries a rebuild intent across the reload | F-0401, F-0403 (Flow B), F-0405 (window side) | C4, C5, C2, lib-authority's opener and codec |
| C7 container-lifecycle | inside the resolve: matches the container by labels, reuses, starts or creates it through C3, runs the lifecycle hooks, mounts the `vscode` volume; reports progress | F-0408, F-0409, F-0411, F-0412, F-0415, F-0405 (container side) | C2, C3, C11, a `LifecyclePresenter` port (the "Configuring..." terminal and S085), which C10 hands it and `extension.ts` implements |
| C8 recovery | classifies a setup failure into F-0410's dialog variants (S018, S019, S034, S420) with Retry, Edit and More Actions... | F-0410 (the dialog only) | lib-authority's `FailurePresenter` |
| C10 container-connector | the `Connector` behind lib-authority's resolver host for `dev-container`: runs C2's checks, C7, the server install and start over C11 through lib-server, the host listener and relay; maps every failure to `Failed` | F-0502, F-0503 (with lib-server), F-0504's facts, F-0505's install list | lib-authority, lib-server, lib-forwarding (the host listener), C2, C7, C11 |
| C11 exec-channel | a lib-host `HostChannel` over `docker exec -i`; the per-connection exec relay into the container's loopback | none of its own (contributes to F-0502, F-0503) | C2 |
| C15 explorer-data (0.4, remote#960) | the "Dev Containers" view (`targetsContainers`) and the "Details (Containers)" view (`detailsContainers`) in core's `remote` view container: a pure model from the containers' facts, the window's facts and the time to the tree; the tree adapter, created only when `<viewId>.focus` exists; the rebuild on Refresh, on coalesced Docker container events (only while the view is visible) and on becoming visible, never on a timer; the row actions of F-0902 that 0.4 builds | F-0906 (registration of those two views), F-0901, F-0902 (open, start, stop, remove, inspect, log, show details), F-0903 | C2 (`run`, and `spawn` for `docker events`), C7's `lifecycle/labels.ts` (exported, never copied), C10's connection facts for the window's own container, C6 and C5 for the open actions, lib-authority's opener; no `lib-companion` (F-1404) |

C9 (shutdown), C12 (attach), C13 (volumes), C14 (authoring), C16 (personalization), C17 (ports), C18 (diagnostics) and
C19 (remote engines) aren't built in release 1. The brief's increment 2 and "Later" lists say when. C15 is built for
0.4 without F-0904 (Dev Volumes, with C13), F-0905 (Clean Up) and F-0902's attach and recent-folder actions (with C12).
C15 spawns nothing itself: its `docker events` process is C2's.

## 2. Boundaries

1. **What lib-authority does and C10 doesn't:** the resolver registration, the reconnection policy, the progress
   notification, the failure presenter call and the window opener are lib-authority's, as for remote-ssh. C10 is a
   `Connector` and nothing more.
2. **What lib-server does and C10 doesn't:** probe, plan, transfer, the licence gate, start and the policy record are
   lib-server's. C10 supplies the remote-containers policy row (brief ruling 4), the channel (C11) and the facts C7
   decided (the volume is mounted, the remote user). lib-server gains one capability for containers: installing into
   V9's `serverTree` and linking `bin/<commit>` to it (`contracts.md` §5).
3. **What the CLI does and C3 doesn't:** everything ADR-0005 delegates to the dev container specification. C3 never
   re-implements a build, a feature, a label or a lifecycle hook; it passes flags and reads results (ADR-0009).
4. **What C7 does and C3 doesn't:** C7 decides reuse, start or create from the labels (F-0409's three tiers), and only
   then asks C3 for `up`. A paused, restarting or dead container goes to C8 without a CLI call.
5. **The window side and the container side of a rebuild:** C6 removes nothing. It reloads with a rebuild intent in the
   payload's own field (`contracts.md` §3), and C7 removes and recreates inside the resolve (F-0405 BR-17), so a
   failed rebuild still shows F-0410's dialog in the container window.
6. **No code of ours runs in the container** except lib-server's install and start scripts, C11's relay script, and
   C10's root step for the `vscode` volume's shared folders (contracts §5.2; amended 2026-10-14) (brief ruling 1).

## 3. Dependencies

`remote-containers` → `lib-identifiers`, `lib-standdown`, `lib-authority`, `lib-product`, `lib-host`, `lib-server`,
`lib-forwarding`, `lib-log`, and `@devcontainers/cli` (pinned, ADR-0009). No other runtime dependency. It doesn't import
`lib-ssh` in release 1 (remote engines are later).
