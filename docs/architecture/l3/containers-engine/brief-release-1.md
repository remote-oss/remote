# Brief: Remote - Containers, release 1

Status: ruled by athena (architect), 2026-10-14, at the user's direction (through hermes) to start containers work
alongside the 0.2 gate, not instead of it. Sources:
- the published spec issues of `remote-oss/remote-containers`, the 25 P0 rows read in full;
- the area C dossier (`dossier.md`, this folder);
- the transport and windows contracts;
- ADR-0002 to ADR-0008;
- the register (`remote-oss/remote-development`, `decisions.md`).

D-87 (the user, 2026-10-14) settled the open items: authoring and ports go to increment 2, the recorded gate is F-0201
and F-0409, and containers uses only capacity the 0.2 gate frees, with no release number or date yet. The spec
questions are on the design issue, remote-oss/remote#737.

## 1. The job

**Release 1 is the smallest whole job: open a local folder that already has a `devcontainer.json` (an `image` or a
Dockerfile) in a dev container on the local Docker engine, with the server installed in the container and the window
connected; open it again and the same container is reused; rebuild it on request; and get a clear dialog when
something fails.** It is Linux client and local engine first, like 0.2.

## 2. The cut

### In

| Feature | What release 1 builds | What it leaves for later |
|---|---|---|
| F-0101 manifest, activation | activation, `extensionKind ui`, the family proposed-API setup (BR-9) and the stand-down guard (BR-10) | the attach, k8s and Apple families' events and commands; macOS (AC-17b) |
| F-0201 engine checks | `dockerPath` exists, answers, API ≥ 1.35, reaches the engine; the pre-flight dialogs before and after the reload | Compose, Podman (AC-4), SSH and remote engines, Windows/WSL, attach, volumes |
| F-0301 discovery and selection | candidates, the picker, the validation dialogs, the hand-over | Compose files, authoring entries, WSL rows |
| F-0401 Reopen in Container | the command and its availability rules | the authoring wizard on a folder without a config (AC-8), the recovery container (AC-14), remote engines |
| F-0403 Open Folder in Container | Flow B (§5.1, the folder has a config) | Flow A (the wizard), attach, OS legs |
| F-0405 Rebuild | the four commands; the old container removed first (BR-17) | Compose (AC-21), attach, remote engines, "Use Template" |
| F-0408 orchestration and progress | S283 → S087 → S085 and the phases in between | volumes, Compose, remote engines, OS legs |
| F-0409 discovery and reuse | label matching, running/exited/none, fail to F-0410 otherwise | Compose, the shutdown halves, Windows path matching (Q-1) |
| F-0410 failure handling | the modal failure dialog (S018, S019, S034, S420) with Retry, Edit and More Actions... | the recovery container (reachable only from Clone in Volume), remote engines |
| F-0411 workspace mount | the git-root mount at `/workspaces/<basename>`, `workspaceMount`/`workspaceFolder` | Compose, OS legs, remote engines |
| F-0412 image and Dockerfile | `image` and `build`/`dockerFile`, the `vsc-<name>-<hash>` tag (BR-3), build wins (BR-16) | OS legs, remote engines |
| F-0415 lifecycle commands | `initializeCommand` and the five in-container hooks, the markers, `waitFor` | attach, volumes, shutdown, personalization |
| F-0501 authorities | the `dev-container` family and its payload (BR-2a), the label formatter | the other four families |
| F-0502 resolver and connection | resolve, reload, reconnect, reuse of the running server, the give-up rules | the shutdown monitor (BR-10), attach, Compose |
| F-0503 server install | client download and cache, copy into the container, the `vscode` volume's server cache, the requirements check, the start, the licence step (R-68) | attach's no-volume path (6.4), Compose, OS legs |
| F-0504 title, indicator, labels | the identity texts and the indicator menu entries release 1 handles | entries of later features |
| F-0505 extensions in the container | the merged install list, installed by the server on its first start | attach, k8s, OS legs |
| F-1401, F-1402, F-1403, F-1406 | the identity, server source, proposed-API and identifier decisions as accepted | F-1406 Q-1 (the CLI launcher, F-1201) |

Two features outside the P0 list are in, because core ACs of the P0 features assert them:
- **F-0416, the UID image.** The pinned dev container CLI produces the `-uid` image as part of `up`. The CLI bridge owns
  it, so its coverage has an owner. F-0401 AC-15, F-0403 AC-11/26, F-0405 AC-5/7/8, F-0412 AC-3/7/43 and F-0501
  AC-21 depend on it.
- **F-0419, the server-cache half of the `vscode` volume.** F-0503's main path (5.0 steps 4–5, BR-1 to BR-4) installs
  into `/vscode/vscode-server/bin/<platform>/<commit>` with a symlink from `~/.vscode-server/bin/<commit>`. F-0201 AC-1
  asserts the volume, and F-0419 is one of the three recorded containers suites. The extension-cache half goes to
  increment 2.

One more is in, at its minimum:
- **F-0106, trust for the open commands only.** `initializeCommand` runs on the host from repository content, and a
  Dockerfile build runs repository code in the engine. So Reopen, Open Folder and the rebuild commands ask for trust
  before anything runs (F-0106 BR-2's prompt). The rest of F-0106 (attach, pod and volume windows, the revocation
  reload, the per-profile flags) comes with those features.

And one more, moved in from increment 2 by the user (2026-10-14, after their first try of Reopen):
- **F-0402, the reopen notification.** A local window with one folder that has a configuration, and that the user hasn't
  dismissed, shows S186/S426 with "Reopen in Container" and "Don't Show Again...", on containers-11's
  `onStartupFinished` activation. It's the first thing a user meets, and without it a configured folder looks broken.

And the Remote Explorer views, moved in from "Later" by the user (2026-10-15, through hermes; ruled on remote#960):
- **Slice A:** F-0906's registration of `targetsContainers` and F-0901, for what the local engine produces.
- **Slice B:** F-0902's open, start, stop, remove, inspect and log actions, after F-0902's review.
- **Slice C:** F-0903, the Details view.

F-0904 (Dev Volumes), F-0905 (Clean Up) and F-0902's attach and recent-folder actions stay "Later". Component C15
(`components.md`).

### Increment 2

The order is the PM's:
- **Authoring:** F-0801 and F-0802 (P0), and F-0403's Flow A. Until then, a folder without a configuration gets
  F-0301's validation path, not the wizard.
- **Ports:** F-1101 and F-1102 (P0, both still `spec:draft`), after their review. Until then, core's default tunnel
  forwards ports over the connection, as for ssh-remote (contracts §3.2, connect-34).
- **Shutdown:** F-0417 and F-0502 BR-10. Until then, a container keeps running after its last window closes.
  That's a release note, and the spec's three conflicting texts on Reopen Folder Locally are a question to the room.
- **The rest:** the extension-cache half of F-0419; Features (F-0414); Podman;
  `DOCKER_HOST` and contexts from settings (F-0205).

### Later

Compose (F-0413), attach (F-06xx), volumes and Clone in Volume (F-07xx), the Dev Volumes view and Clean Up (F-0904,
F-0905), F-0902's attach and recent-folder actions, personalization and relays (F-10xx), SSH- and tunnel-hosted engines
(F-1302), Windows, WSL and macOS.

### Two P0 deferrals the PM may object to

F-0801/F-0802 (authoring) and F-1101/F-1102 (ports) are P0 rows held to increment 2. Release 1 assumes the folder
already has a `devcontainer.json`, which most repositories that use dev containers do. The ports specs aren't
reviewed yet.

## 3. Design rulings for release 1

1. **Transport (F-0502 steps 7–8, BR-3, BR-6; F-0503 5.0 step 7).**
   - **The server's listener:** the server listens on the container's loopback, `127.0.0.1:<port>`, and no container
     port is published.
   - **The host's listener:** the host listens on `127.0.0.1` on the same port number when it's free, otherwise on
     another free port, and the log names both. The spec observes this listener.
   - **The relay:** each accepted connection is relayed into the container through `docker exec -i <container>`,
     running a small relay script with the node binary that the installed server ships at its root.
   - **The resolver** answers a plain `ResolvedAuthority` (the host address and the connection token). It gives core no
     tunnel factory and no tunnel features (connect-34's reasoning; F-1102 is in increment 2).
   - **The relay script** is the only code of ours that runs in the container besides the install and start scripts
     (dossier Q5, release-1 answer).
2. **The connection token.** The server is started by lib-server's start body, which already passes
   `--connection-token-file` and never the value in argv. Nothing in the containers path may put the token value in a
   `docker exec` argument or environment, where `docker inspect` and `ps` show it (R-26).
3. **The server source (F-1402 rule 4).**
   - **The order:** lib-product's existing resolution, with `remote.serverDownloadBaseUrl` as the override (a), the
     product's `serverDownloadUrlTemplate` (b), then the built-in table matched exactly on `applicationName` (`codium`,
     `codium-insiders`) (c). Otherwise (d) there's no download and Option C's no-default error.
   - **The licence step:** R-68 goes through lib-server's licence gate.
   - **F-1402 wins over F-0503's text:** where F-0503 BR-14 and AC-36 differ (`VSCodium` for `codium`, and no product
     step), F-1402 is the decision, and the text is a spec question.
4. **The server policy row** (transport contracts §5.0) for remote-containers:
   - `downloadPlacement: clientOnly`;
   - `cache: kept` (the host's archive cache, keyed by commit);
   - `verification: none`, as for remote-ssh, until the room names one (F-1402 names none). The unpack and the server's
     own requirements check catch a broken archive;
   - `requirementsCheck: serverBundled`;
   - `installMode: singleScript`;
   - `prefetch: none`;
   - `cleanup: onlyCurrentKeepLeftovers`. The `vscode` volume is shared by every dev container on the engine, so one
     window never removes another commit's server.
5. **The exec channel (C11).** It's a `lib-host` H1 implementation over `docker exec -i`. `copyToHost` streams a tar
   archive into `tar -x` (F-1402 §6), `identity` is the container id, and `platformHint` is `linux`. lib-server
   installs and starts over it unchanged.
6. **The dev container CLI (C3).**
   - **The version:** `@devcontainers/cli` pinned at 0.89.0 (D-52, R-76; ADR-0005), bundled in the VSIX and spawned
     with the editor's own Node.
   - **How we bend it:** a deviation the bridge absorbs goes, in order, through flags, a pre-pass `--override-config`,
     then post-processing of the JSON result; never a fork. That policy is an ADR before the bridge card (AGENTS.md:
     a cross-cutting choice is an ADR before it is code).
   - **Upgrades:** a CLI upgrade is a conformance run, not a dependency bump.
7. **Identity (F-1406, F-1401):**
   - the id is `remote-oss.remote-containers` and the display name "Dev Containers";
   - commands `remote-containers.*`, settings `dev.containers.*` and the context keys are reused verbatim (D-14);
   - the stand-down for `ms-vscode-remote.remote-containers` follows R-54, R-77 and R-78;
   - the standing-down key is ours (R-27).
8. **The manifest contributes only what release 1 handles** (D-86's principle, enforced by tooling-31's check): the
   `dev-container` activation event and `onStartupFinished` (amended 2026-10-14 on #892: F-0410's Edit Locally opens
   the configuration in the new local window, so the extension must be active there), release 1's commands and
   settings, and only the views 0.4 builds (amended 2026-10-15 on #960, replacing "no views"):
   - `targetsContainers` and `detailsContainers` each enter the manifest in the card that registers the view's tree
     data provider. `devVolumes` isn't contributed;
   - welcome and menu entries exist only for registered commands. A welcome link to a command 0.4 doesn't register is
     contributed as its plain words, in every locale;
   - every `viewsWelcome`, `view/title` and `view/item/context` entry carries `&& !remote-containers:standingDown`
     (F-1406 §5). The `views` entries keep the reference's `when` verbatim (F-1406 §3: the reference wins a duplicate
     view id);
   - an AC that needs a view, command or family 0.4 doesn't build is `deferred` with the reason
     `containers 0.4: <F-xxxx or component> later`.

   Every AC that counts the full
   contribution set is `deferred` with the reason "containers release 1: the full contribution set comes with later
   increments":
   - F-0101 AC-1, 2, 6, 13 and 14;
   - F-0504 AC-4, 5 and 6;
   - F-0502 AC-34 and 37;
   - F-0501 AC-17, 19 and 20;
   - F-0405 AC-2 and 3;
   - F-0410 AC-10.

   The seven proposals of F-0101 are all declared: enabling is per extension id, so declaring them costs a user
   nothing.
9. **Proposed APIs (F-1403).** The family gate (lib-authority's `familySetupPortsOf`, as remote-ssh and remote-explorer
   use it) probes at every activation and caches no success (F-1403 §6). A missing `resolvers` or `workspaceTrust` holds
   back the open path: the resolver and the trust prompt. Every command stays registered and answers with the gate's
   setup notice, as for remote-ssh (windows contracts §3.2).
   - **`contribViewsRemote` (amended 2026-10-15 on #960):** the gate's `viewIds` is `[targetsContainers]`, so the view's
     focus command is the probe (F-0906 §16). A missing grant joins the same setup notice. It holds back only C15's
     tree views, which are created only when `<viewId>.focus` exists, so core's "No view is registered" error never
     shows (F-0906 AC-16).
10. **Engine (C2).**
    - The Docker CLI only, through `dockerPath` (and `dockerComposePath` unused in release 1), with the editor's
      environment as it is, including `DOCKER_HOST` and the current context.
    - F-0501's payload carries `settings.context` when a non-default context is current (BR-2a).
    - Every engine command is spawned without a shell (F-0201).
11. **Telemetry is off** for every server start (R-28, R-83; F-0503 BR-17, AC-52). F-0502 AC-15 says otherwise, and
    that's a spec question.

## 4. What must exist before the first card

Area C had a dossier only. Items 1–3 were done on 2026-10-14: `components.md`, `contracts.md` (with the
remote-containers policy cells and lib-server's `installTree` added to the transport contracts) and ADR-0009. Dossier Q3, Q6 and Q10
turned out to be answered by code already on main (`Connected.trusted`, `Failed.silent`, V9's `cacheFolders`).
1. **The component view** for release 1's subset of the dossier's components:
   - C1 package-shell;
   - C2 engine;
   - C3 cli-bridge;
   - C4 config;
   - C5 trust-gate, at the minimum above;
   - C6 open-flows;
   - C7 container-lifecycle;
   - C8 recovery (the dialog only);
   - C10 container-connector;
   - C11 exec-channel.

   It also confirms dossier Q1 (ownership as on main).
2. **The contracts:**
   - C11 as an H1 implementation;
   - C10 behind B's resolver host for `dev-container` (connect, cancel, failures to A's `Failed` shape, dossier Q6);
   - the `dev-container` codec (F-0501 BR-2a);
   - the remote-containers row of the server policy record (ruling 4), filled in transport contracts §5.0;
   - V9's cache folders as a pure function of product, commit, platform and "volume mounted" (dossier Q10).
3. **The ADR** for the CLI-bridge policy (ruling 6).
4. **The catalogue housekeeping:**
   - fix the stale `acCount`s (F-0415 43, F-0503 52, F-1102 29) and F-1403's label (`spec:reviewed`);
   - seed a containers coverage file by the #142 method, with this cut's deferral reasons.

daedalus then cards, in build order: C1 (with the gate and the stand-down), C2, C11, C3, C4, C10 with B's resolver
host, C7, C6, then the coverage rows.

## 5. The release-1 gate

These are rows in the VSCodium run, on a runner with a local Docker engine. Each fails on main today and passes with
release 1:
1. Reopen in Container on a folder whose config names an `image` connects, and the window shows the dev container's
   name in the title and the indicator (F-0401, F-0408, F-0502, F-0503, F-0504).
2. The same with a Dockerfile config: the image is tagged `vsc-<name>-<hash>` (F-0412).
3. Reopening reuses the same container id (F-0409).
4. A stopped container is started with the same id (F-0409).
5. Rebuild Container removes the old container and creates a new id, and `postCreateCommand` runs again (F-0405,
   F-0415).
6. `postCreateCommand` runs once, and `postStartCommand` runs on each start, by their markers (F-0415).
7. A Dockerfile that fails to build shows F-0410's dialog with Retry, Edit and More Actions... (F-0410).
8. A bogus `dockerPath` shows F-0201's pre-flight dialog before any reload (F-0201).
9. With a stand-in carrying the reference id, the extension stands down and registers nothing (F-0101 BR-10).
10. Without the proposals, nothing fails, and the setup notice names the extension (F-0101 BR-9, F-1403).
11. In an untrusted folder, Reopen asks for trust before anything runs on the host (F-0106 BR-2; §2, "One more is in").
12. The extensions listed in the config are installed in the container (F-0505). The card designs this row's source
    (a local VSIX or the run's gallery).

The Remote Explorer rows (0.4, remote#960). Each comes with its slice's card:
13. (A) With the proposals, the Remote Explorer shows "Dev Containers". Row 1's container is a row in the "Dev
    Containers" group, labelled with the folder's name. A plain `docker run` container is under "Other Containers"
    (F-0906, F-0901).
14. (A) A container started, then removed, from the CLI appears in the view and leaves it, without Refresh (F-0901).
15. (A) With no container and a folder open, the view shows WELCOME#2, and its reopen link starts Reopen (F-0901).
16. (A) In the dev container window, its own row is Connected and shows the window's folder (F-0901).
17. (A) Without `contribViewsRemote`, the Remote Explorer has no Dev Containers content and no error shows. The setup
    notice names Dev Containers (F-0906 AC-16, F-0101 BR-9).
18. (B) "Open in Container in New Window" on a dev container's row opens a window connected to the same container id.
    Stop Container asks first, and the row then shows Exited (F-0902). This row gates 0.4 only once F-0902 is reviewed.
19. (C) In the dev container window, "Details (Containers)" is titled with the folder's name and shows the container's
    name, image, configuration file and workspace mount (F-0903).

Slice A also carries a coexistence row: with remote-explorer installed too, the "Switch Remote" dropdown offers both
"Remotes" and "Dev Containers", each shows its own view, and nothing fails.

Besides these rows:
- **Coverage:** `check-coverage` must be green with the containers tags.
- **A manual check:** proteus opens a dev container from the built VSIX.
- **Recorded evidence (D-87, the user, 2026-10-14):** a recorded gate from F-0201 and F-0409 only, 180 of 253
  cases confirmable on x86_64. F-0419 is architecture-sensitive (0 of 69), so its server-cache half is proven by
  rows 1–3 above. The runner enables our proposals since cleanroom-kit #238.
