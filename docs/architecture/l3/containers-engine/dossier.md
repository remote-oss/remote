# Area C dossier: the containers engine

- Status: draft for the lead's review (deliverable 1). Boundaries are preliminary until the lead confirms the
  placement in section 1.
- Date: 2026-10-06
- Author: `remote-architect-worker-3`; lead: `remote-architect`
- Inputs: the published spec issues of `remote-oss/remote-containers` (read in full: F-1402 #41, F-1403 #39, F-1404
  #55, F-0106 #46, F-1302 #103, F-1201 #30, F-0201 #18, F-0202 #49, F-0203 #26, F-0205 #84, F-0206 #75, F-0301–F-0306
  #20 #78 #47 #48 #45 #44, F-0401–F-0419, F-0502 #57, F-0503 #34; the rest from the catalogue rows); the
  remote-containers conformance suite; ADR-0002 to ADR-0007; the binding rulings; the area A and B dossiers,
  contracts and component views; `[devcontainers-cli]` v0.89.0; VS Code OSS.

Feature ids are remote-containers' unless a repo is named. String ids (S-nnn) are the specs' own.

## 1. Component candidates

All components live in the `remote-containers` package (container view: the engine is not a library). Every
component except the UI flows is UI-free and reaches the editor through narrow adapters (ADR-0002 rule 7). Processes
are spawned in two places only: C3 (the dev container CLI) and C2 (the engine CLIs).

| Component | Responsibility | Features owned |
|---|---|---|
| C1 package-shell | Manifest, activation after the stand-down guard and the proposed-API gate, settings catalogue with legacy pairs, log channel and log terminal, help rows, command gating and context keys, shared UI vocabulary, the programmatic command arguments | F-0101 (#19), F-0102 (#88), F-0104 (#43), F-0105 (#104), F-0107 (#51), F-0108 (#50), F-0109 (#90) |
| C2 engine | The engine abstraction: which CLI (`dockerPath`, `dockerComposePath`; Docker, Podman), which endpoint (contexts, `DOCKER_HOST` merge from the four sources, SSH askpass relay for `ssh://` engines), the execution host (local, a WSL distro, the window's remote host), pre-flight checks and their dialogs, daemon start, installers, host requirements; one place that spawns `docker`, `docker compose`, `kubectl`, `container` | F-0201 (#18), F-0202 (#49), F-0203 (#26), F-0205 (#84), F-0206 (#75) |
| C3 cli-bridge | Spawns the bundled `@devcontainers/cli` (pinned) with the editor's Node; builds argument lists from C2's endpoint and C4's choices; parses the one JSON result line and the JSON log stream into progress, log-terminal lines and typed failures; never shows UI. Also the "Install devcontainer CLI" command and its launcher | F-1201 (#30) |
| C4 config | Discovery and the picker, repository and user-data configuration stores, change detection, the wrapper around the CLI's substitution and merge with the deviations of section 4, the `customizations.vscode` merge, the property matrix diagnostics, the shared-root validator | F-0301 (#20), F-0302 (#78), F-0303 (#47), F-0304 (#48), F-0305 (#45), F-0306 (#44) |
| C5 trust-gate | The trust prompts and their order per command, the two per-profile flags, forced trust for attach, pod and volume windows, the reload on revocation | F-0106 (#46) |
| C6 open-flows | Everything in the old window before the reload: Reopen, the notification, Open Folder, Open Workspace, Rebuild (intent carried across the reload), Reopen elsewhere from the recorded origin, Switch Container | F-0401 (#21), F-0402 (#17), F-0403 (#22), F-0404 (#81), F-0405 (#24), F-0406 (#68), F-0407 (#82) |
| C7 container-lifecycle | Inside the resolve: progress and log, container matching by labels (three tiers), reuse, restart, recreate, and `up` with workspace mount, image and Dockerfile, Compose, features, lifecycle commands, users and environment probe, creation options; mounts the `vscode` volume when the setting allows | F-0408 (#27), F-0409 (#23), F-0411 (#33), F-0412 (#29), F-0413 (#73), F-0414 (#59), F-0415 (#32), F-0416 (#63), F-0418 (#61) |
| C8 recovery | Classifies setup failures into the dialog variants, More Actions, Retry, the recovery container for volumes | F-0410 (#28) |
| C9 shutdown-manager | The shutdown obligation per window connection, the cross-window and cross-profile registry, the delayed check, stop or kill per `shutdownAction`, the out-of-tree watchdog for killed windows | F-0417 (#62) |
| C10 container-connector | The connector behind B's resolver host for `dev-container`, `attached-container`, `k8s-container`, `apple-container` and `exec`: runs C2 checks, C7 or attach set-up, area A's server install and start over C11, the window tunnel, and maps every failure to A's `Failed` shape; writes machine settings and MCP servers into the container | F-0502 (#57), F-0506 (#60) |
| C11 exec-channel | The `lib-host` H1 implementations over the engine's exec (`docker exec -i`, `kubectl exec -i`, `container exec`) with copy by streamed archive; the exec dialer for the window tunnel and the relays | none (contributor to F-0503, F-0419, F-0505, F-0502) |
| C12 attach | Attach to running containers, per-image attach configurations, the partner menus, Kubernetes pods, Apple containers | F-0601 (#64), F-0602 (#85), F-0603 (#83), F-0604 (#110), F-0605 (#111) |
| C13 volumes | One clone pipeline with entry points (clone, named volume, pull request, URI handler, samples, continue edit session), the bootstrap container, Explore a Volume | F-0701 (#65), F-0702 (#86), F-0703 (#87), F-0704 (#70), F-0705 (#98), F-0706 (#93), F-0707 (#112), F-0808 (#97) |
| C14 authoring | The add-configuration wizard over `templates apply`, template catalogue, option prompts, feature picker, optional files, New Dev Container, Configure Features, add extension, authoring aids, Copilot entry, the config-file locator | F-0801 (#53), F-0802 (#40), F-0803 (#66), F-0804 (#69), F-0805 (#89), F-0806 (#67), F-0807 (#96), F-0809 (#91), F-0810 (#95), F-0811 (#118), F-0812 (#71) |
| C15 explorer-data | Tree data for `targetsContainers`, `detailsContainers` and the Dev Volumes view, row actions, Clean Up, and the view registration in the Remote Explorer | F-0901 (#76), F-0902 (#80), F-0903 (#94), F-0904 (#99), F-0905 (#100), F-0906 (#72) |
| C16 personalization | Connect-time copies and logins (gitconfig, `gh`, dotfiles) and the session relays (git credentials, ssh-agent, gpg-agent, Docker credentials, X11; Wayland as a mount) | F-1001 (#54), F-1002 (#77), F-1003 (#79), F-1004 (#101), F-1005 (#109), F-1006 (#116), F-1007 (#102), F-1008 (#105) |
| C17 ports | Declared forwards from the merged configuration, Label Port written back to `devcontainer.json` (through C14's locator) | F-1101 (#42), F-1103 (#113) |
| C18 diagnostics | The developer command Test Connection | F-1202 (#114) |
| C19 remote-host placement | Containers on SSH hosts and tunnels: runs C2 and C3 on the window's remote host, keeps the hop in recents | F-1302 (#103), undecided in the catalogue; proposed C, with B for the hop and A for the install |

Placement of the 100 remote-containers rows. The 85 catalogue rows of area C are all placed above, except:
F-0503 (#34), F-0419 (#92) and F-0505 (#37) go to A (lead's routing: A9/V3, V9, V7), with C11 and C7 as
contributors. F-1405 (#56) is a family rule (R-28), not a component; it binds every component. Not C, as the
catalogue says: F-0103, F-0501, F-0504, F-0507 → B; F-1102 → A (lib-forwarding); F-1401, F-1403, F-1404,
F-1406 → B (moved by the lead), F-1402 → A; F-0204, F-0207, F-0708, F-1301 → D, which consumes C2's execution
host.

**Difference from the brief.** The brief lists "window surfaces, resolver front, identity and F-0906 view
registration" as B's. B's component view on main (`windows-and-explorer/components.md`, decisions of 2026-10-06)
keeps only F-0501 (codec), F-0504, F-0103 and F-0507 in B and gives F-0101, F-0502, F-0406 and F-0906 to C with B as
contributor. I followed the component view; question 1.

## 2. Interfaces across the boundary

**C needs from A.**

| Operation | Provider | Use |
|---|---|---|
| `lib-host` H1 shape (`runScript`, `copyToHost`, `identity`, `platformHint`) | A, implemented by C11 | C11 maps `docker exec` failures to the six kinds; `identity` is the container id; `platformHint` is `linux`. `copyToHost` streams a tar archive into `docker exec -i … tar -x` because F-1402 §6 pipes the archive into the container |
| `lib-server` V2 probe, V3 plan, V4 transfer, V6 licence gate, V7 start, V9 cache folders | A | Server install into the container (F-0503, F-0419, F-0505). C passes: volume mounted or not and its mount point `/vscode` (C7 decides at create), the download mode "on the client, always" (F-1402 §6), the per-extension override policy for `remote.serverDownloadBaseUrl` (P3) |
| `lib-forwarding` W2 window tunnel, W3 tunnel factory | A | With C11's exec dialer, so no container port is published; F-0502 step 6 ("same host port if free") is a question for A (question 7) |
| `lib-product` profile | A | Server names and folders in the container, `urlProtocol` for F-1201's URIs, the gallery for F-0505 |
| `Failed` shape and kinds | A | C10 adds container kinds (question 6) |

**C needs from B.** `registerResolver` with C10 as connector for five families; codecs for all five (B's table lists
three; `apple-container` and `exec` are missing, question 2); `openRemote`/`openLocal` (C6, C12, C13, C15);
`isTrusted` set per family, because F-0106 BR-13 forces trust for attach, pod and volume windows while the resolver
host never sets it (question 3); the identifier tables, the settings reader with legacy precedence (F-0102 BR-4), the
extension-set context keys (`canReopen*`, from the authority chain); `lib-standdown` and the proposed-API gate before
C1 registers anything; the failure presenter hook so F-0410's dialog renders C8's classification.

**C provides.** To B: the connector (connect, cancel, revealDetails, phase events, transport events) per family;
the decoded payload for `dev-container` (`{hostPath, localDocker, configFile}`, nested under an outer hop, F-0501,
F-0403 BR-10) built by C6 and encoded by B; the window's container facts for the indicator (F-0504). To the Remote
Explorer: C15's three tree data providers inside the editor's `remote` view container (`contribViewsRemote`); no
`lib-companion` endpoints, because containers serve no companion (F-1404). The trust decision: C5's gate, called by
C6, C12 and C13 before the reload, and the resolve-time trust value for B. To D: C2's execution-host port (where the
engine and the CLI run, path mapping), which D implements for a WSL distro (F-0207, F-1301).

## 3. External dependencies

- **Dev container CLI** `[devcontainers-cli]` 0.89.0, MIT, Node ≥ 20: a spawned program only (no `main`,
  `exports` or types in its package). Used subcommands: `read-configuration` (with `--include-merged-configuration`,
  `--include-features-configuration`, `--container-id`), `up` (`--workspace-folder`, `--config`, `--override-config`,
  `--id-label`, `--remove-existing-container`, `--build-no-cache`, `--expect-existing-container`,
  `--skip-post-create`, `--mount-workspace-git-root=false`, `--gpu-availability`, `--dotfiles-*`, `--docker-path`,
  `--docker-compose-path`, `--log-format json`, `--remote-env`), `set-up` (attach), `run-user-commands`, `build`,
  `templates apply`, `features info`/`resolve-dependencies`, `outdated`, `upgrade`. Result: one JSON line on stdout
  (`outcome`, `containerId`, `remoteUser`, `remoteWorkspaceFolder`, `composeProjectName`, error fields); logs as
  JSON events on stderr; the process outlives its result line for background lifecycle commands
  (`src/spec-node/devContainersSpecCLI.ts`). `stop` and `down` do not exist.
- **Engine CLIs** through C2 only: `docker` or `podman` (`version`, `info`, `ps`, `inspect`, `start`, `stop`, `kill`,
  `rm`, `volume`, `events`, `logs`, `exec`, `run` for bootstrap and recovery containers), `docker compose` then
  `docker-compose`, `kubectl` (F-0604), Apple `container` (F-0605); `git`, `gh`, `gpg`/`gpgconf`, host credential
  helpers for C13 and C16. Spawned without a shell, values verbatim (F-0201).
- **Proposed API**: `resolvers`, `contribViewsRemote`, `contribRemoteHelp`, `tunnels` (through A), and
  `workspaceTrust` for `requestWorkspaceTrust` (F-0301 row, F-0106), which F-1403 does not list (question 4).
  Stable: tree views, quick picks, dialogs, `globalState`, `globalStorageUri`, `workspace.fs`, terminals,
  `registerUriHandler` (F-0706), `languages` diagnostics (F-0414, F-0305).
- **Files**: `.devcontainer/…` discovery set; the user-data store under global storage (F-0302); state flags
  (F-0106, F-0402, F-0303); lockfiles written by the CLI (F-0414); lifecycle markers in the container (F-0415); the
  `vscode` volume layout, a compatibility contract (F-0419); the window registry of C9.

## 4. How ADR-0005 applies: the CLI does / we do

| Group | The CLI does | We do |
|---|---|---|
| Configuration (F-0301–F-0306) | Reads the chosen file, substitution, image-metadata merge, legacy-property folding | Discovery, picker order (dotfile first, against the CLI's order), stores, change detection, validation the CLI lacks (empty file → S181, relative `workspaceFolder`, container source), the `customizations.vscode` merge, `hostRequirements` display |
| Build and create (F-0408–F-0418) | Label lookup, build, features layer, UID image, `docker run`, Compose override files and project name, lifecycle hooks and markers, dotfiles | Pre-flight, three-tier matching incl. legacy labels and paused state, rebuild teardown before the reload, the extra error scans (S343, S004, S356, S412), env probe, the `vscode` volume, progress titles and the log terminal |
| Attach (F-0601–F-0605) | `set-up` of an existing container | Listing, pickers, attach configurations (the CLI's `--config` accepts only `devcontainer.json` names), kubectl and Apple CLI paths |
| Volumes (F-0701–F-0708) | `up` inside the cloned volume | The bootstrap and recovery containers, `git ls-remote`, volume naming |
| Authoring (F-0801–F-0812) | `templates apply`, `features info`, `outdated` | Wizard, pickers, prompts, JSONC edits |
| Recovery, shutdown, explorer, relays, ports, server | nothing | all of it, with A for the server |

Deviations from the specs that the bridge must absorb, each found by the reader against the CLI source: (1) an
empty `${localEnv:VAR:default}` must give the default (F-0304 BR-5a); (2) `${containerEnv}` in `initializeCommand`
is empty, not literal; (3) `localEnv` is the editor's resolved environment, passed as the spawn environment, not the
CLI's own; (4) the window-title `name` needs the second pass even without a container; (5) the workspace mount
needs `--mount-workspace-git-root=false` (F-0301 §6.5, F-0302 BR-14); (6) attach configurations need a route other
than `up --config`.

Policy proposed for the ADR draft: first flags, then a pre-pass that writes an `--override-config`, then post-processing
of the JSON; an upstream change only where none of these reaches; never a fork without an ADR. **Conformance
consequence:** the cases were recorded against a reference that, per F-1201, bundles CLI 0.89.0; pinning the same
version keeps build, label, marker and image-name behaviour identical, and any later CLI upgrade is a conformance
run, not a dependency bump.

## 5. Open questions (batched for the lead; none asked on an issue yet)

1. **Ownership** (brief vs B's component view): F-0101, F-0105, F-0406, F-0502, F-0906 are placed in C as on main.
2. **Codecs** (F-0501 #35, F-0605 #111): B's codec table lacks `apple-container` and `exec`.
3. **Trust at resolve** (F-0106 BR-13 vs remote-ssh F-2001 BR-12): a per-family `isTrusted` in the resolver host.
4. **`workspaceTrust` proposal** (F-0301, F-0106 vs F-1403 #39): add it to the probed list, or use only the stable
   `workspace.isTrusted` and lose the prompt order of F-0106 BR-2.
5. **Remote-side code** (container view §2 says only two bootstrap scripts): the relays of F-1002–F-1005 and F-1008,
   the exec dialer and F-0417's in-container probes need a process in the container for the session. Proposal: relay
   scripts shipped as text, run with the installed server's Node; this needs the lead's ruling on §2.
6. **Failure mapping** (F-0502 #57): "container stopped or removed" is plain NotAvailable, not handled and without the
   extension's dialog; B's rule 4 shows the presenter. A kind or flag `silentNotAvailable` is needed in A's shape.
7. **Port** (F-0502 step 6): the forward "on the same host port if free". With an exec dialer and a managed socket
   factory there is no local port; is the port observable in any case? If not, the managed factory is simpler.
8. **F-1302 #103**: BR-3 runs the CLI and Docker on the remote host from a remote extension host, but resolvers
   must be `extensionKind ["ui"]`. Options: (a) a workspace part of the extension on the remote, (b) the UI part
   drives C2 and C3 over the window's `lib-host` channel (ssh, wsl, tunnel), which needs Node on the host and makes
   `remote-containers` import `lib-ssh`. I recommend (b); the room should confirm that no AC observes the process
   tree. Tunnels have no host channel in A's design yet.
9. **C9 watchdog** (F-0417 AC-43): a helper outside the window's process tree, like A3's detached connection
   server. One "detached helper" pattern for both, in `lib-host` or a new library?
10. **Volume layout ownership** (F-0419 #92 vs A's V9): C decides the mount, A the folder tree; confirm that V9 is
    a pure function of product, commit, platform and "volume mounted".
11. **F-0303 #47**: the Compose service's Dockerfile is not in `read-configuration`'s output; we parse Compose files
    ourselves (a YAML dependency, MIT) or ask the CLI upstream.
12. **F-0301 BR-2 vs F-0402 BR-14** (cited in #78): two orderings for the same picker; to the room.
13. **F-0415 AC-23**: background processes of a lifecycle command die with it, against the CLI's behaviour; to the
    room, as it decides whether we wrap the command.
14. **F-0409 Q-1, F-0406 Q1, F-0301 Q1**: Windows and WSL path questions; they wait for a Windows profile.
15. **F-0205 Q1**: a settings `DOCKER_HOST` applies even under a named context (decided against the reference); the
    bridge passes it as `DOCKER_HOST` and never as `--context`.
16. **Quota note**: two readers fanned out to their own sub-readers (more than six agents in total for this
    dossier); I will cap readers at one level from here on.

## 6. The conformance picture

- **Suite.** 416 published cases over six features: F-0201 73, F-0409 64, F-0419 66, F-0507 52, F-0601 103,
  F-0603 58. Area C owns four of them (298 cases); F-0419 is A's and F-0507 B's. Every other C feature has none:
  the room publishes a feature's cases only when its coverage is complete.
- **What the runner sees.** VS Code 1.139.1 driven through its debugging port on Linux arm64 with a private
  `docker:dind` engine; the screen (titles, quick picks, dialogs, notifications, status bar, tree rows, tabs) and the
  engine's objects (containers with state, labels and mounts; volumes; images). No logs, no process lists, command
  lines redacted. 45 profiles, all docker-ce, local host; no Podman, macOS, Windows, WSL or SSH profile.
- **What a build must expose.** The verbatim titles, dialog texts and button orders (string tables, B); the
  container labels `devcontainer.local_folder`, `devcontainer.config_file`, `devcontainer.metadata`,
  `devcontainer.containerFeatures` and the Compose labels, which the pinned CLI writes; the `vscode` volume; the
  settings `dockerPath`, `dockerComposePath`, `cacheVolume`, `mountWaylandSocket`; the views and row actions of C15;
  status bar items whose id contains the extension id.
- **Blocking, shared with A and B.** The runner enables no proposed API, so every resolver case fails for a
  `remote-oss.*` id (B's dossier). F-0603 also needs the partner extension installed from `ENCODE_VSIX_DIR`.
- **First target proposal.** F-0201 (73 cases): the pre-flight dialogs run before any reload and need only C1, C2
  and B's tables. Then F-0409 and F-0601 end to end, which need A's install over C11 and B's resolver host.
