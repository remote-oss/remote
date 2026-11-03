# Brief: the recovery container (C8)

Owner: athena (architect). Plan: #1807 group 7, after group 13 (`brief-volumes.md`). Spec: remote-oss/remote-containers#28
(F-0410, `spec:reviewed`), its recovery half.

With it come the recovery lines of F-0401, F-0501, F-0504, F-0801 and F-0903, F-0303's 6.6 (AC-18), F-0413 AC-12, 48,
52 and 62, and the recovery button `brief-volumes.md` §3.7 left out. Decisions: D-105, R-27, R-31, R-60, ADR-0009,
ADR-0010. F-0410's setup-failure dialog itself is built (C8, release 1).

## 1. When it's offered (C8; BR-2 to BR-5)

- **Only for a Clone in Volume.** Only a connect whose window is a volume workspace (brief-volumes §2.4) and whose setup
  failed gets the four-button dialog: "Close Remote" | S159 "Edit devcontainer.json in Recovery Container" |
  "More Actions..." | "Retry" (primary). That covers S034, and S018's four-button shape (7.E1).
  - A volume clone has no folder to fall back to (BR-2, BR-3). Every other window keeps S158 and S160 to S162, as
    built.
- **The More Actions pick** gets S159 as its second item. That makes 5 items, or 6 with "Rebuild Container" when a
  container object exists (BR-4, AC-16c).
- **Escape and "More Actions..."** are the only ways that disconnect the window (BR-5).
- **In SSH windows and WSL:** the same offer (AC-24, AC-26), on platform-01 and group 16.

## 2. What it is (C8, C7; BR-7)

- **The image is the bootstrap image,** never the project's own: our `alpine:3.20` definition of brief-volumes §3.2,
  built if absent. A `dev.containers.bootstrapImage` is used as is, with `bootstrapImagePull` (F-0704).
  - It has `git`, and a `docker` CLI with no daemon or socket (AC-16a).
  - No Microsoft registry.
- **Its configuration is a synthetic file of ours on the host:**
  `<temp>/vsch-<user>/recovery-volume/<extension version>/.devcontainer.json`.
  - **Its own folder,** not F-0705's `inspect-volume`. F-0705 Q3 prefers the two kept apart, so their labels never
    collide.
  - **What it says:**
    - `image`: the bootstrap image;
    - `workspaceMount`: the volume at `/workspaces`;
    - `workspaceFolder`: `/workspaces/<folder>`;
    - `remoteUser`: root;
    - `overrideCommand`: true;
    - no Features, so no registry fetch. 6.7 step 6's stale-Feature failure can't happen.
  - **Written on every start,** so an edit never sticks.
- **The labels:** `vsch.local.volume` = the volume name, and `devcontainer.config_file` = the synthetic path. These are
  F-0410's names, reused verbatim (F-1406, D-14).
- **Reuse (BR-7):**
  - a container matching both labels is reused, started again if stopped, never recreated;
  - the image isn't part of the match;
  - a non-matching container is left stopped and untouched;
  - this feature never removes a recovery container (§9).
- **Created through the host's CLI** (C3, as built), not inside the bootstrap: the configuration is on the host, so
  `up --config <synthetic> --id-label vsch.local.volume=<volume>` runs where the release-1 bridge runs, with the
  volume mount from the file.
- **Every engine program** resolves `dockerPath` through `engineBaseOf` (F-0201 AC-55).

## 3. The window (C6, C10, lib-authority's labels)

- **The payload** is brief-volumes §2.4's volume payload with one member of ours, `"recovery": true`.
  - The member name is internal, not a setting, command or context key, so R-27's namespace rule doesn't apply.
  - A reload keeps it, and BR-10 holds: the window re-attaches to or restarts the same container, and never clones or
    builds.
- **The label formatter** (F-0504) gives the title `devcontainer.json - <repo> [Recovery Container] - <editor>`, and
  the indicator "Recovery Container" with the hover "Editing on Recovery Container". These are our strings in the table
  (no STR ids, R-27), checked by `check-string-tables`.
- **What opens:**
  - the repository's `.devcontainer/devcontainer.json` (or the root file) from the volume, as a preview;
  - and, in a second, unfocused group, the attempt's log, which the log terminal of release 1 already writes (6.1
    step 3).
- **Trust:** a volume window, so C5's forced trust (F-0106 BR-13).
- **The S372 notification:**
  - "Reopen in Container" (primary) | "Don't Show Again". It doesn't hide by itself;
  - the "Don't Show Again" flag is a `globalState` key of ours holding the set of volumes it was chosen for. It survives
    a reload (BR-6);
  - `remote-containers.showRecoveryContainerNotificationReset` (Palette only, no `when`) clears the key from any window
    (AC-17, AC-18).
- **C20 in a recovery window** watches the window's own configuration, the synthetic file, as F-0303 6.6 says, not the
  repository's (F-0303 AC-18).

## 4. The fix loop and leaving (C6, C7, C9)

- **"Reopen in Container"** (the notification's button, or the Palette) reloads the same window into the plain volume
  payload, without `recovery`.
  - Clone in Volume's resolve finds the folder non-empty, so it doesn't clone (brief-volumes §3.3, F-0702 BR-9). It
    builds the real container from the edited, uncommitted working tree (AC-19, AC-30).
  - The progress keeps S074's ": Cloning Repository" suffix (6.1 step 5).
- **On success:** the window ends `<repo> [Dev Container: <name>]`. The recovery window's connection ended at the
  reload, so C9's obligation stops the recovery container (`Exited (0)`, AC-30), and nothing removes it.
- **On another failure:** the four-button dialog again, and S159 re-attaches to the same recovery container under
  BR-7's reuse.
- **Stopped from outside:** core's "Cannot reconnect. Please reload the window.", and the indicator reads
  "Disconnected from Recovery Container". A reload starts the same container (AC-32).
- **Out of this brief:** "Continue Working in New Local Clone" and the other entries of the recovery window's remote
  menu that F-0410 lists but doesn't describe. Their own features own them; R-60 applies until then.

## 5. Contracts and components

- **`contracts.md` §3:** the volume payload's `recovery` member.
- **C8** gains the recovery container: the four-button offer for volume windows, the synthetic configuration, reuse,
  and the S372 notification with its flag and reset command.
- **C7** gains the recovery resolve path: `up` with the synthetic configuration, and no clone or build.
- **The strings:** S159, S372, and our three label strings.
- **The manifest:** the reset command.
- **No new dependency.**

## 6. The cut and the card

| Lines | Where |
|---|---|
| F-0410's recovery lines (AC-14, 7b, 15, 16, 16a to 16c, 17, 18, 19, 28 to 32), F-0303 AC-18, F-0413 AC-12, 48, 52, 62, and the recovery lines of F-0401, F-0501, F-0504, F-0801, F-0903 | this brief, now |
| AC-24, AC-25 (SSH) | group 16 |
| AC-26 (WSL) | platform-01 |
| 6.7 step 6's stale-Feature case | not reachable (no Features in our synthetic file), a reading on the card |

**One card** (daedalus), after group 13's core lands: §1 to §4, with the rows above. It starts once brief-volumes'
core card merges, since every row needs a volume window.

**Measure before asserting**, as containers-41's method says. The likely stop is the CLI's `up` with a configuration
outside any workspace folder: if it refuses, the synthetic file's folder becomes `--workspace-folder` itself.
