# Brief: dev containers through WSL (F-0207, F-1301, F-0204)

Owner: athena (architect). Plan: #1807's release-2 families; D-94 and D-105 (WSL in scope: specs and design now, built
now, rows on a Windows host once one exists). Specs, all `spec:reviewed`:
- remote-oss/remote-containers#108 (F-0207 Running container commands through WSL);
- #115 (F-1301 Dev containers with WSL);
- #31 (F-0204 Install Docker in WSL);
- F-0202 AC-28, AC-29, AC-30 and AC-55 (WSL's half of the daemon check).

Decisions: ADR-0009 (amended here), ADR-0013, R-28, R-31, R-79, area D's contracts
(`docs/architecture/l3/wsl/contracts.md`: D1 wsl-runner, D2 distro-inventory, D3 path-mapper, D4 wsl-host-channel),
`brief-remote-ssh-engines.md` §3 (the same shape over an exec server), `brief-engine-checks-and-install.md` (#2146),
`brief-reopen-locally.md` (`originOf`, Reopen Folder in WSL), `brief-foundations.md` (the legacy pairs).

## 1. What a survey found (2026-11-04)

| Family | Built, needs a row | A gap of ours | Elsewhere | Unsure |
|---|---|---|---|---|
| F-0207 | 11 | 31 | 10 (the relays F-1003, F-1007, F-1008; F-0812; F-1302) | 1 |
| F-1301 | 5 | 15 | 2 (F-0404; remote-wsl's own notification) | 0 |
| F-0204 | 1 | 23 | 0 | 0 |

- **What exists:** lib-wsl has its pure parsers (status, list, online, install, Windows build, share paths,
  matching).
- **What doesn't:** nothing runs `wsl.exe` yet. D1, D3's process half and D4 aren't built, and C2's `EngineHost` only
  spawns locally.
- **What follows:** this brief puts the containers engine on top of area D's contracts, unchanged except one operand
  (§6).

## 2. The engine host: local, exec server or a distro (C2, C3)

### 2.1 Which host a command uses

One pure function, `engineHostOf(window, folder, settings, platform)`, decides it for every command (BR-18: it's read
per command, and at window open for F-0402's lookup):

1. **A folder on a WSL share** (`\\wsl.localhost\<d>\…` or `\\wsl$\<d>\…`, D3's pure half) uses that distro, whatever
   `executeInWSL` says, even when the configured distro doesn't exist (F-0207 BR-19).
2. **A `wsl+<d>` window** (F-1301 BR-9):
   - **A distro-native folder** uses `<d>`, and the check runs in the distro first.
   - **A folder under `/mnt/<drive>/`** (D3's `isWindowsMountShape`) is handed off to its Windows folder (D3's
     `toWindows`) and treated from then on as a local Windows folder: the local host, checked again, with Windows
     labels.
3. **A local Windows window with `dev.containers.executeInWSL`** on (or its legacy twin, through `readSetting`;
   F-0207 BR-16) uses `executeInWSLDistro` (or its twin). When that's empty, D2 resolves WSL's default distro with no
   prompt (BR-3).
4. **Otherwise** it's the local host. On Linux and macOS the three settings change nothing (BR-4).

The SSH host keeps its exec-server adapter (`brief-remote-ssh-engines.md` §3).

### 2.2 The WSL adapter

C2's `EngineHost` gains its third adapter:
- `run` and `spawn` go through D1's `exec(distro, '~', 'docker', argv, env)`;
- the engine coordinate is the distro's environment, plus the window's settings, as F-0205's rules have it;
- C11's exec channel (`docker exec -i`) and C10's spawns go through it too.

So Reopen, Rebuild, the Dev Containers view, Attach and Clone in Volume all reach the distro's engine (F-0207 BR-15).

### 2.3 The CLI in the distro (ADR-0009, amended here)

This is the same shape as the SSH host (`brief-remote-ssh-engines.md` §3.2), over D4 instead of an exec server:
- **The `node`:** the VS Code server's for the distro's platform, installed with **no start** by lib-server's probe,
  plan and transfer over D4's `HostChannel`. It's idempotent: a server that remote-wsl already put there is found by
  the probe.
- **The program:** the pinned CLI and our preload, copied once per version to
  `<the server's data folder>/remote-oss-containers-cli/<version>/`, and run on that `node` through D1's `exec`.
- **The environment:** the spawn environment is the distro's, so `${localEnv}` and `${localWorkspaceFolder}` resolve
  in the distro (BR-15). ADR-0009's deviations 1 and 3 apply to the names passed in (`WSLENV` additions, D1).
- **The override file** goes in the distro, mode 0600, deleted after the run.

ADR-0009's exception list is amended in this PR. It now names both remote engine hosts, the SSH host
(`brief-remote-ssh-engines.md`) and a WSL distro (this brief), as running the CLI on the editor server's node,
installed with no start.

### 2.4 Paths, labels and the payload

- **Paths:** the configuration and workspace are addressed by their in-distro paths (`/mnt/c/…` for a Windows-side
  folder, through D3's `toDistro`). The workspace itself stays where it is (BR-15).
- **Labels:** C3 passes the id labels explicitly (`--id-label`):
  - **`executeInWSL` with a Windows folder:** `devcontainer.local_folder` is the Windows path, and
    `devcontainer.config_file` is the in-distro path (F-0207 6.7 step 5).
  - **A distro folder,** by either route (a WSL share or a `wsl` window): `devcontainer.local_folder` is the
    `\\wsl.localhost\<d>\…` form (D3: never `wsl$`), and `devcontainer.config_file` is the in-distro path. So both
    routes find the same container (BR-19; F-1301 §9).
  - **The rows:** the card measures which labels the CLI 0.89.0 writes beside our `--id-label`, and pins the pair
    with a row.
  - **The engine's own quirk** of Docker Desktop's bind-mount label path, with a second container on the second
    reopen (BR-15's last sentence), is the engine's and needs no code. It's replicated.
- **The payload** (contracts §3, amended here): a window whose engine host is a distro records it as
  `"wslDistro": "<registered name>"`, the last member of `settings`.
  - **Why:** a reload, a Retry and an Open Recent entry resolve on that distro whatever the settings say then, as the
    Docker context is pinned (F-0501 BR-15; F-0205 BR-19).
  - **The URIs:** for a `wsl` window's folder, `configFile` is the `vscode-remote://wsl+<d>/…` URI. That's what
    `originOf` reads for Reopen Folder in WSL (`brief-reopen-locally.md`).
  - **No nested authority:** the authority isn't nested. remote-containers is a UI extension and spawns `wsl.exe`
    itself, so no exec server is needed.
  - **Old payloads** without the member are local.
  - **Rows:** the codec's rows add the member.
- **`canReopenInWSL`** is set by C10 when the window's payload names a distro or a WSL-share folder. That's what
  `brief-reopen-locally.md` left for F-1301 (F-0207 AC-53, F-1301 AC-3, AC-19).

## 3. Checks and dialogs through WSL

- **The order on Windows with no Docker** (F-0207 BR-6), with `executeInWSL` off:
  1. the Windows-side check fails;
  2. the log names the PATH searched and the Windows build (D2);
  3. D2 checks the WSL status;
  4. F-0201's `notFound` gets its Windows variant, S116 + S132, with "Install". "Install" runs
     `installDockerInWSL` (§5) when WSL is usable, whether or not a distro already has Docker (F-0204 BR-8, BR-10).

  With `executeInWSL` on, none of this runs, and the check runs in the distro.
- **A failed check in the distro:**
  - **With Docker Desktop installed** on Windows: #2146's check-and-start runs with Windows' platform data, and the
    re-checks ask the distro's `docker` (F-1301 BR-11; F-0202 AC-55).
  - **The qualifying texts:** Docker Desktop's WSL-integration advice from its stand-in `docker` is a third text in
    #2146's table (F-0202 BR-12's last point).
  - **The rest** is #2146's: no second start while it runs (BR-13), six re-checks, or 5 minutes after our own start.
- **`(reading-NNNN-wsl-start)`, F-1301 AC-17 with F-0202 BR-13:**
  - **The conflict:** AC-17 has the extension launch Docker Desktop.
  - **The reading:** F-0202 owns the mechanism (F-1301 BR-11 says so). In AC-17's own setting, Docker Desktop
    already runs, so it isn't launched again, the six re-checks run, and the dialog follows after about 30 seconds.
    That's AC-17 without the reference's second start, the start that F-0202 Q3 drops.
  - **The question** goes to metis.
- **S136** (F-1301 7.E1, specified by analogy, D-24): when a WSL-hosted folder opens and `docker info` from the
  Windows side says Docker Desktop (`OperatingSystem`) with an engine that isn't WSL 2 (`OSType` windows, or a
  `KernelVersion` without `WSL2`). Its rows are `host: windows`.
- **S003** (F-1301 BR-3): the advisory for a `/mnt/` folder in a `wsl` window. It's non-blocking, and the flow goes on
  as for a native folder.
- **S162,** "Edit devcontainer.json in WSL" in F-0410's resolve-time dialog for a WSL-hosted window (F-0202 AC-30,
  BR-10's Windows order). Its Edit opens the file through the distro's path.
- **A distro that doesn't exist** (F-0207 BR-17; AC-21, AC-30, AC-42, AC-52):
  - **On Linux** it's ignored.
  - **On Windows with `executeInWSL`:** from the palette, the command fails with a thrown error that names the
    failure, the distro and the folder, and core shows it. From the F-0402 notification and the remote indicator, we
    show the same error ourselves, where the reference was silent (a recorded defect, so this is required
    behaviour).
  - **At window open,** when the folder can't be looked up in the distro, the F-0402 notification isn't shown.

## 4. Settings and gates

- **The settings** (F-0207 §3.2, BR-1, BR-2, BR-5, BR-12), all application scope:
  - `dev.containers.executeInWSL` (default `false`);
  - `dev.containers.executeInWSLDistro` (no `default`, so core gives `""`, with its `markdownDescription`);
  - `dev.containers.forwardWSLServices`.

  Their legacy twins are already among `brief-foundations.md`'s 14 pairs. `extension.ts`'s direct read of
  `executeInWSL` is replaced by `engineHostOf`.
- **`forwardWSLServices`'** effect belongs to the relays (F-1003, F-1007, F-1008; BR-14). Their host end runs in the
  distro through D4, as `brief-personalization.md`'s relay host runs on the host side. The relays' cards carry it.
- **The palette gates** (F-1301 AC-1, AC-2; BR-4, BR-10):
  - `reopenInContainer` and its rebuild siblings gain `remoteName =~ /^(wsl|ssh-remote|tunnel)$/` beside the local
    clause. The `ssh-remote` half is part B's, and `tunnel` is Tunnels'.
  - `openFolder` already has the eight-name family clause (`brief-foundations.md` §4).
  - `openWorkspace` follows with F-0404.
- **`installDockerInWSL`** (F-0204 BR-4): Palette `!hideConnectCommands && isWindows && !remoteName &&
  !virtualWorkspace`. F-0207 AC-7 and AC-8's palette set gains it and `installDocker` (#2146).

## 5. Install Docker in WSL (F-0204; C2 over area D)

- **The checks,** from scratch each time (BR-11): D2's WSL status, version and distro list, with S063, S062 and S222.
- **WSL absent:** D1's `manage install` runs at once, with no confirmation (BR-1, BR-2). The command is the user's
  explicit request to install, and WSL's own installer elevates through the OS's consent prompt (BR-3), which nothing
  of ours bypasses.
- **The distro:** read and validated (S284; WSL version 2, a default user), as F-0204 §5 and §6 give it. A distro that
  fails gets the spec's own dialog.
- **Docker in the distro** (S206): our shipped script installs Docker Engine from Docker's own apt repository, as
  Docker's documentation gives it for Debian and Ubuntu (R-31: the source is Docker's docs).
  - **How it runs:** as root through D1 (§6) with `sh -s`, the script on standard input and no shell in between.
  - **The output** goes to the log, never a secret.
  - **The reinstall question** (6.x) comes first when Docker is already there.
- **The setting:** `dev.containers.executeInWSL` is written `true` in the user settings, and the distro key isn't
  written (S387; POST-5).
- **No telemetry** (BR-9; R-28, F-1405).
- **The strings** are F-0204's own atoms, and the card maps each from §3.4.

## 6. Area D amendments (in this PR)

- **D1 `exec` gains an optional `user` operand** (`-u <user>`), used only by §5's root install. Everything else runs as
  the distro's default user, and the `wsl/contracts.md` row says so.
- **Area D builds first:** D1, D3's process half, D4 and D4f, per `wsl/contracts.md` and its H1 contract suite. These
  are lib-wsl cards that come before this brief's containers cards.

## 7. Rows and hosts

- **Unit rows now:**
  - `engineHostOf`'s table;
  - the payload codec;
  - the label pairs;
  - D3's pure half;
  - D1's argument lists;
  - D4 on the D4f fake (A's H1 suite);
  - the S136 predicate;
  - the gates;
  - the install script as text.
- **Windows rows:** every line that needs `wsl.exe`, Docker Desktop or a `wsl` window is `deferred` with
  `host: windows` (ADR-0013). The rows run once a Windows host exists.
- **`wsl` windows:** lines that need a genuine `wsl` window also wait for remote-wsl's connect (D6). The code paths
  here are built now and reached by unit rows.
- **Fixtures:** none on Linux CI. Nothing here needs dind, kind or privileged containers.

## 8. The cut and the cards

| Lines | Where |
|---|---|
| the built lines (F-0207 11, F-1301 5, F-0204 1) | rows and tags (card 5) |
| F-0207's gaps, F-0202 AC-28 and AC-29 | cards 2 and 3 |
| F-1301's gaps, F-0202 AC-30 and AC-55 | card 3 |
| F-0204 (23) | card 4 |
| F-0207's relay lines (F-1003, F-1007, F-1008), F-0812, F-1302; F-1301's F-0404 line and remote-wsl's notification | their features' cards |

**Suggested cards** (daedalus):
1. **Area D:** D1 with the `user` operand, D3's process half, D4 and D4f (`wsl/contracts.md`).
2. **The engine host:** §2's `engineHostOf`, the WSL adapter, the CLI in the distro, the labels, the payload member,
   `canReopenInWSL`, and §4's settings.
3. **Checks and dialogs:** §3, and §4's gates.
4. **Install Docker in WSL:** §5.
5. **Rows and tags.**

**Spec questions for metis** (with this brief's PR): `reading-NNNN-wsl-start`, and whether S136's `docker info`
predicate matches the dirty side's reading of 7.E1.
