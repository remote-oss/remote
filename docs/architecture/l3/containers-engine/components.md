# C4 level 3: area C components (the containers engine)

- Status: first version for the lead's review (deliverable 2)
- Date: 2026-10-06
- Author: `remote-architect-worker-3`; lead: `remote-architect`
- Built on: `../../c4-l2-containers.md` (400f245, with the remote-side scripts rule of §2), the area C dossier and the
  lead's rulings on it (2026-10-06), `contracts.md` in this folder, the area A contracts (H1, V2–V9, W2–W3, P1–P4)
  and the area B contracts as amended by PR #31 (codecs for `apple-container` and `exec`, per-family `isTrusted`,
  rule 2a for `Failed.silent`)
- Traceability: `traceability.tsv` in this folder, one row per feature this area owns

Area C is the engine side of the `remote-containers` package. There is no library of its own: by the two-consumer
rule the engine stays in the package (container view §1). Component ids are stable and used by the contracts and
the matrix. A component marked **pure** has no editor API, no process and no file access, so its tests are plain
Mocha unit tests (ADR-0002 rule 7); those are the first coding candidates.

## Dependency rules inside area C

- **Two spawn points.** Only C2 spawns an engine program (`docker`, `podman`, `docker compose`, `docker-compose`,
  `kubectl`, `container`, `git`, `gh`) and only C3 spawns the dev container CLI. Every other component asks them.
- **One execution host per attempt.** C2 resolves where an attempt's programs run (the local machine, a WSL distro,
  the window's remote host) once, and every engine and CLI call of that attempt goes there (F-0201 BR-2, F-1301).
- **Engine knowledge stays in C2 and C3.** Flows (C6, C12, C13, C14) and the connector (C10) see typed results and
  typed failures, never stderr text or exit codes.
- **No component touches B's resolver, window or indicator APIs** except through B's contracts (`registerResolver`,
  `openRemote`, `openLocal`, `reload`, `closeRemote`, codecs). The connector C10 is the only resolver-facing piece.
- **Remote-side pieces are scripts shipped as text** and run by a program already in the container (`sh`, the
  installed server's Node), never a binary of ours (container view §2). C11 and C16 own those scripts.
- **UI goes through one port per flow.** Dialog texts, buttons and quick-pick items come from the string tables
  (`lib-identifiers`); pure components return decisions (which dialog, which detail, which buttons) as values.

## Package shell

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| C1a | activation | Manifest; activation after `lib-standdown` and B's proposed-API gate; wiring of every other component | editor |
| C1b | settings-catalogue | The 43 settings through B's settings reader with the F-0102 legacy pairs and precedence; scope rules (application, machine, window) | pure over a settings port |
| C1c | log | The "Dev Containers" log terminal and the per-attempt log files (`remoteContainers-<ts>.log`) on `lib-log`; masks secrets passed by C3 | editor |
| C1d | help-and-vocabulary | Help rows and commands (F-0105), the shared UI vocabulary (F-0108) as string-table entries | data |
| C1e | command-gating | The availability matrix: `when` clauses in the manifest and the extension-set context keys, set from C10's window facts (F-0107) | pure decision plus a context-key port |
| C1f | command-arguments | Validation and decoding of programmatic command arguments, the R-46 out-of-context rule per command (F-0109) | pure |

## Engine (C2)

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| C2a | program-locator | Turns a setting value (`dockerPath`, `dockerComposePath`), a base folder, the trust state and the execution host into a spawn target: literal, no shell, bare name on PATH, relative only in a trusted local folder, `.exe` only on Windows (F-0201 BR-1) | pure |
| C2b | endpoint-merger | Merges the four endpoint variables from `containers.environment`, `docker.environment`, `docker.host`/`certPath`/`tlsVerify` and the process environment; the F-0205 Q1 rule; the endpoint recorded in a container window's authority wins (F-0205 BR-19) | pure |
| C2c | execution-host | The port "where programs run": local, WSL distro (implemented by area D), the window's remote host over `lib-host` (F-1302, C19); spawn, PATH lookup, path mapping between host and folder forms | port; local implementation here |
| C2d | engine-runner | Spawns engine programs on the execution host: bounded **check** calls (timebox, default 60 s, child killed) and unbounded **setup** calls; the `SSH_ASKPASS` relay for `ssh://` endpoints with answers kept per window (F-0205 BR-14) | process |
| C2e | preflight | The first and second checks, the Compose resolution (plugin first), the API-version gate, the `vscode` volume creation; returns a verdict, never UI | process over C2d; classification pure |
| C2f | failure-classifier | Spawn error and stderr → engine failure kinds (missing CLI, permission, daemon down with or without "cannot connect" wording, SSH permission, too many auth failures, dash host, API too old, other) | pure |
| C2g | daemon-starter | Docker Desktop detection and start on macOS and Windows, the re-check schedule (F-0202 Q2, Q3) | process |
| C2h | installers | Install Docker per OS and CPU architecture (F-0203); the hand-off to area D's WSL installer (F-0204) | process plus editor |
| C2i | host-requirements | `docker info` figures against the effective `hostRequirements`; the GPU mode (F-0206) | pure compare; query over C2d |

## Dev container CLI bridge (C3)

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| C3a | argument-builder | Builds the CLI argument list per operation from C2's spawn target and endpoint and the flow's choices; always `--log-format json`, `--mount-workspace-git-root=false`, explicit `--id-label` pairs | pure |
| C3b | override-pass | Writes the `--override-config` file for the deviations the CLI cannot be told by flags (ADR draft "CLI bridge" rule 2) | pure plus a file port |
| C3c | output-parser | The result line and the JSON log events → typed result, progress steps, log-terminal lines, typed failures with the container id when one exists | pure |
| C3d | cli-runner | Spawns the pinned CLI with the editor's Node on the execution host; keeps the process until exit (background lifecycle commands); cancellation kills the process tree | process |
| C3e | launcher-installer | "Install devcontainer CLI": launcher files, PATH candidates, `open` URIs (F-1201) | process plus editor |

## Configuration (C4)

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| C4a | discovery | The three locations, the picker rows and order, tolerant `name` read for labels (F-0301) | pure over a file port |
| C4b | config-stores | Repository configuration folders and the user-data store under global storage (F-0302) | file port |
| C4c | change-detector | The live watch on `devcontainer.json`, the per-activation check of build files, the acknowledgment hash (F-0303) | editor plus pure hashing |
| C4d | reader | Reads one configuration through C3 (`read-configuration`), adds the validations the CLI lacks (empty file, relative `workspaceFolder`, container source), the `customizations.vscode` merge, `hostRequirements` display values (F-0304–F-0306) | pure over C3 |
| C4e | shared-root-validator | The multi-root rules reused by C6, C14 (F-0404) | pure |

## Flows, lifecycle and connection

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| C5 | trust-gate | Prompts in the per-command order, the attach and clone flags, the forced-trust decision per window kind, the reload on revocation (F-0106) | editor plus pure order table |
| C6 | open-flows | Old-window flows before the reload: Reopen, notification, Open Folder, Open Workspace, Rebuild intent, Reopen elsewhere, Switch (F-0401–F-0407); builds the `dev-container` payload for B's codec | editor |
| C7 | container-lifecycle | Inside the resolve: progress, three-tier matching, reuse or restart or recreate, `up` through C3, the `vscode` volume mount, the extension's extra scans and pre-checks, env probe (F-0408, F-0409, F-0411–F-0416, F-0418) | process over C2 and C3 |
| C8 | recovery | Failure classification into dialog variants, More Actions, Retry, the recovery container for volumes (F-0410) | pure decision plus editor |
| C9 | shutdown-manager | Leases per window connection, the cross-window registry, the delayed check, stop or kill; its watchdog runs on `lib-helper` (lead's ruling 9) (F-0417) | process |
| C10 | container-connector | B's connector for `dev-container`, `attached-container`, `k8s-container`, `apple-container`: C2 checks, C7 or attach set-up, A's install and start over C11, the window tunnel, `Failed` mapping; machine settings and MCP servers (F-0502, F-0506) | process |
| C11 | exec-channel | `lib-host` H1 over `docker exec -i`, `kubectl exec -i`, `container exec`; copy by a tar stream; the exec dialer for `lib-forwarding` and for C16's relays | process |
| C12 | attach | Running containers, attach configurations, partner menus, Kubernetes pods, Apple containers (F-0601–F-0605) | editor plus process over C2 |
| C13 | volumes | The clone pipeline and its entry points, the bootstrap container, Explore a Volume (F-0701–F-0707, F-0808) | editor plus process over C2, C3 |
| C14 | authoring | Wizard over `templates apply`, catalogue, prompts, feature picker, optional files, New Dev Container, Configure Features, add extension, authoring aids, Copilot entry, config-file locator (F-0801–F-0807, F-0809–F-0812) | editor plus C3 |
| C15 | explorer-data | Tree data for `targetsContainers`, `detailsContainers`, `devVolumes`; row actions; Clean Up; view registration (F-0901–F-0906) | editor plus process over C2 |
| C16 | personalization | gitconfig copy, `gh` login, dotfiles; the session relays for git credentials, ssh-agent, gpg-agent, Docker credentials, X11; Wayland as a mount (F-1001–F-1008) | process over C11 |
| C17 | ports | Declared forwards from the merged configuration; Label Port written back through C14's locator (F-1101, F-1103) | editor |
| C18 | diagnostics | Test Connection (F-1202) | editor over C11 |
| C19 | remote-host-placement | Containers on SSH hosts: C2c's remote implementation over the window's `lib-host` channel, the CLI provisioned on the host, the hop kept in recents (F-1302; tunnels out of scope until they have a host channel) | process over `lib-ssh` |

## Traceability summary

82 features owned (traceability.tsv): 81 of the catalogue's area C rows and F-1302, with 3,199 acceptance
criteria and 298 published cases. AC counts are the catalogue's; F-0417's issue text has 71 against the catalogue's
67, and the matrix is refreshed when `tools/spec-watch` reports the revision. Contributor rows for other areas' features: F-0503, F-0419, F-0505 (A owns;
C11 and C7 contribute), F-0501, F-0504 (B owns; C6 and C10 contribute), F-0204, F-0207, F-1301, F-0708 (D owns;
C2c is the port they implement). F-1405 binds every component and has no row.

## Build order inside area C (proposal for the lead's build order)

1. **F-0201 brief:** C1b, C2a, C2b, C2d, C2e, C2f and the dialog port; conformance F-0201 (73 cases). No resolver, no
   CLI, no server.
2. C3 (all but C3e) and C4d with recorded CLI outputs as fixtures; no case yet, unit level only.
3. C10, C11, C7 with area A's V-components and B's resolver host: F-0409 (64) and, with C12, F-0601 (103).
4. C15 and C12's partner menus: F-0603 (58).
5. The rest by suite publication order.
