# Brief: Attach to a running container (C12)

Owner: athena (architect). Plan: #1807 group 11. Specs:
- remote-oss/remote-containers#64 (F-0601 Attach to Running Container) and #85 (F-0602 Attached container configuration
  files), both `spec:draft`. As for F-0106 in group 1, their published text is the design input (D-62: specs change
  only on pull). A spec question goes to metis (D-79).
- #80 (F-0902 Container and folder actions), #76 (F-0901 Dev Containers view), #94 (F-0903 Details), #72 (F-0906 Remote
  Explorer), and #46 (F-0106 trust, `spec:draft`).
- The single attach lines of F-0201, F-0205, F-0403, F-0405, F-0409, F-0415, F-0417, F-0419, F-0501, F-0502, F-0503 and
  F-0505.

Decisions: D-14, D-105, F-1406, R-26, R-27, R-31, R-60, R-79, ADR-0005, ADR-0009, ADR-0010, ADR-0013, and the effective
engine of `contracts.md` §2. Kubernetes (F-0604) is group 12. The Apple family (F-0605) is #1992's `host: macOS` lines.

## 1. What exists, and what this adds

- **Already built:**
  - lib-authority's `containerCodec('attached-container', …)`, its resolver host and label formatter
    (`labels/formatter.ts`);
  - C10's connect tail: lib-server over C11, the env probe, the first-connect machine settings and extension list,
    the relay;
  - C8's failure presenter and recovery picker;
  - C15's two views and the dev-container row actions;
  - C9's shutdown helper;
  - C3's argument builders;
  - the manifest's `remoteName` lists that already name `attached-container`.
- **This adds C12 attach** (`src/attach/`):
  - the command and its picker;
  - the attached-container payload;
  - the container step that C10 runs for that family;
  - the attach configuration files (F-0602);
  - the folder history of attached containers;
  - C15's attach rows, C5's attach-family warning and C9's non-owning connection.

## 2. The command (F-0601 5.0, PRE-1, 7.E1, 7.E5, 7.E7)

- **The manifest:**
  - `remote-containers.attachToRunningContainer`, with F-0601 BR-1's `when` in the Palette;
  - in the remote indicator at `remote_30_dev-container_2_actions@2`;
  - F-0906 AC-5, AC-9 and AC-19's item lists follow from the menus and are asserted on them.
- **The order of the run:**
  1. C5's attach warning (§7.1).
  2. The picker opens at once, empty and busy, through `createQuickPick`:
     - no title, and placeholder S316;
     - C2's pre-flight checks then run, with F-0201's and F-0202's dialogs over it (PRE-1 (c), (d); 7.E7);
     - "Ignore" fills the picker, and every other button closes it.
     - With core's default `closeOnFocusLost`, only the dialog shows, as PRE-1 says.
  3. The listing: `docker ps` through C2, keeping only status exactly `running`, so a paused container is out (BR-2).
     - **Gone in between:** a container that `docker inspect` no longer finds drops out (7.E5).
     - **Nothing left:** S365 as a modal with "OK", and the picker closes (7.E1).
     - S237 shows nowhere (BR-9).
  4. The items:
     - the label is `/<name>`;
     - the description is `<image> <64-hex id>`, and the filter never matches it (`matchOnDescription` off; BR-10);
     - no detail, no icon, first item focused;
     - a snapshot that never refreshes (BR-4).
     - **The order:** a case-insensitive `Intl.Collator` comparison with `numeric` off, as F-0901's rows use. A unit
       row holds BR-3's seven names in their observed order.
  5. **A pick:**
     - read the applicable attach file (§5) for its `workspaceFolder`;
     - register the window's label formatter (§3);
     - open a *new* window through lib-authority's opener, on the folder when the file names an absolute one, and
       folderless otherwise.
     - The issuing window stays as it is (POST-2, BR-5). From an attached window the command opens a further window.

## 3. The payload and the window's label (BR-8, F-0205)

- **The payload** (`contracts.md` §3 gains a third shape): lowercase hex of the UTF-8 JSON
  `{"containerName":"/<name>"}`.
  - **The engine:** the `settings` member follows `containerName` exactly as the dev-container payload's does:
    `context`, then `host`, `certPath` and `tlsVerify`, from C2's effective engine (F-0205 BR-19).
  - **A WSL window:** `cwd` holds the distro's UNC root (BR-8). It's built and unit-tested now (ADR-0013), and proven
    on a Windows host.
  - **The codec:** `attachedPayloadOf` / `attachedTargetOf` are pure, with rows for every member and a malformed form.
  - **The name** is the only identity (no id), so F-1406's Open Recent entries and the storage keys interoperate.
- **The label:** "Container {image} ({name}){suffix}" (S091).
  - **The suffix:** " @ <context>" or " @ <DOCKER_HOST value>" from the payload's engine, and none for the default
    (F-0205 AC-45).
  - **Not found:** the bare "Container".
  - **Where it's registered:** through lib-authority's formatter for the exact authority, with S091's `workspaceSuffix`
    (§16). The issuing window registers it before opening, and the attached window again at its resolve. The 40-character
    cut is core's.

## 4. The connect (C10's attached family, C12's container step)

C10 gains the `attached-container` family. Its connect keeps steps 1, 2 and 4 to 6 of `contracts.md` §2 and replaces C7
with C12's container step. That's the same split the volume path makes for its shared connect tail.

1. **Find the container** with the payload's engine: `docker inspect` by name.
   - **The id record:** if the name doesn't resolve, C12 tries the id it recorded at the last successful attach of this
     payload. That record lives in `globalState` under a key of ours (R-27), keyed by the payload. It's decision
     F-0601 Q1's preferred outcome (AC-61): a renamed container is reattached, and the formatter is registered again
     with the new name.
   - **Neither resolves:** S053 with "Choose Container" (primary) | "Close Remote" | "More Actions..." (7.E3).
2. **The state** (BR-14). An attach never starts a container by itself.
   - **Not `running`** (exited, created or paused): S054 with "Start Container" (primary) | "Close Remote" |
     "More Actions...", and the label's suffix in `{2}` (7.E2, 7.E6, 7.E8).
   - **"Start Container"** starts the container through C2, or unpauses a paused one (decision F-0601 Q, 7.E6), and goes
     on with the same attach.
   - **"Choose Container"** reopens §2's picker in this window, listed again. A pick there opens a new window (BR-5).
   - **The rest** is C8's:
     - "Close Remote";
     - the recovery picker S272, whose first item is "Start Container", "Choose Container" or (7.E4) "Reload Window",
       followed by "Open Recent..." and "Open Documentation". "Open Documentation" opens our own page (R-31).
3. **Set-up through C3** (BR-13 (a)–(c), F-0415 AC-25, F-0602 BR-16, BR-19).
   - **The command:** C3's new `setUpArguments`:
     - `set-up --container-id <id>`;
     - `--config <the applicable attach file>` when one exists;
     - `--docker-path`, `--log-level`, `--log-format json` and the terminal size;
     - `--skip-non-blocking-commands` and `--include-merged-configuration`;
     - the engine coordinate in its environment, as every C3 run gets it.
   - **What the CLI does itself:**
     - the `/etc/environment` and `/etc/profile` patches as root;
     - the `/var/devcontainer` markers;
     - the label merge with the file last;
     - the folding of the file's top-level `extensions` and `settings` into `customizations.vscode`;
     - `remoteEnv` substitution;
     - the lifecycle markers.
     - `set-up` reads a `--config` of any file name (only `up` checks the name). A unit row pins this against the
       bundled CLI, together with the folding.
   - **A failure** is S033's dialog with "Retry" (primary) | "Close Remote" | "More Actions..." (7.E4, F-0602 7.E5).
     - **Best effort:** a patch that fails is the CLI's best effort and doesn't end the attach (BR-13's order).
4. **The Alpine step** (BR-13 (d)): as root, through C2's exec, read by exit status only (ADR-0010).
   - `ID=alpine` in `/etc/os-release` (a documented format);
   - then `apk info -e libstdc++`;
   - if it's missing, `apk update` and `apk add libstdc++`.
   - A failure is S033.
   - `components.md` boundary 6 gains this step and C3's `set-up` as code of ours that runs in the container.
5. **The remote user and environment:**
   - **The user:** the merged `remoteUser`, else the container's user.
   - **The probe:** the merged `userEnvProbe`, defaulting to `loginInteractiveShell` (F-0602 §3.3), through C10's env
     probe, plus the merged `remoteEnv`.
   - **A user that doesn't exist** is S033 (F-0602 7.E5).
6. **The server:**
   - lib-server installs into that user's home, as for dev containers;
   - the requirements check gives S346 with "Learn More" (primary) | "Close Remote" | "More Actions..." (F-0503
     AC-46 to AC-49), and "Learn More" opens our own page (R-31);
   - a window closed while "Installing server" leaves the partial folder (AC-24).
7. **First attach** (F-0602 BR-4, F-0505 AC-22):
   - **What applies:** C10's first-connect writes, with the merged `customizations.vscode` plus
     `dev.containers.defaultExtensions`. A leading `-` removes an id.
   - **The gate:** per container and remote user, by that user's server data, as for dev containers.
8. **Ports:** the merged `forwardPorts` and `portsAttributes` go to C17 exactly as a dev container's do.
9. **Nothing on the container object:**
   - no label and no mount (BR-7);
   - no `vscode` volume (F-0419 AC-11).
   - C10's mount step is skipped for this family.
10. **Connected** with `trusted: true`. F-0106 BR-13 forces trust for attached windows (AC-37, AC-43); core shows the
    "trusted by nature" lines itself.
11. **The background stage:** `run-user-commands --container-id <id>`, with `--config` as in step 3, after the connect.
    - S085 shows in the status bar while it runs. That's C7's background stage, reused (F-0602 `postAttachCommand`).
    - Its failure is log-only (F-0602 BR-15).
    - If the CLI needs a `--workspace-folder`, it gets the stand-in folder of #1973's Q1.
12. **The preview line** (F-0502 AC-17): `connect/preview-note.ts` gains the Alpine forms for x64 and arm64. The line
    is in the log only.
13. **On success:** C12 writes the id record of step 1.

Dialog buttons in this brief are in logical order, primary first. Core arranges them per platform (F-0601 BR-12), and
rows assert the Linux order, with the Windows order as a unit row on the presenter's input.

A failure keeps `contracts.md` §2's rule:
- a container that stops or is removed while connected answers `silent: true`;
- core's reconnect dialog follows, and a reload goes through steps 1 and 2 again (7.E8; F-0405 AC-22).

## 5. Attach configuration files (F-0602)

- **The store** (pure parts in `attach/config-files.ts`):
  - **The paths:** `<globalStorageUri>/imageConfigs/<key>.json` and `nameConfigs/<name>.json`.
  - **The image key:** the container's `Config.Image`, with no normalization, where `:` becomes `%3a` and `/` becomes
    `%2f` (BR-2).
  - **Which file applies:** the name file if it exists, else the image file, decided at the time of use (BR-1).
  - **A new file** is `{` newline `}`, with CRLF when the client platform is `win32` (BR-3; ADR-0013).
- **Reads** use `jsonc-parser`'s tolerant parse, with every recoverable property applied (7.E2).
  - **`workspaceFolder`** is used literally (BR-18). A value that doesn't start with `/` is ignored, and the window
    opens with no folder (the preferred outcome of decision F-0602 E6).
- **The two commands:**
  - **`openAttachConfigByNameFile`:**
    - the Palette shows it only when `remoteName == attached-container`;
    - S230 as a modal "OK" in any other window, a Kubernetes one included;
    - it creates the name file as `{` newline `}`, never copied from the image file (BR-5);
    - it opens the file as a preview tab.
  - **`openAttachDevContainerFile`:**
    - the picker S065, name files first, then image files, each sorted by the §2 collation (BR-10);
    - S235 as its only item when there are none.
- **Writes** are minimal edits through `jsonc-parser`, keeping comments and other keys (BR-17):
  - **`workspaceFolder`:** each time an attached window activates with a folder, or opens one, it writes that folder
    (BR-7, BR-8).
  - **`settings`:** when the remote machine-settings file is saved (`onDidSaveTextDocument` on that user's
    `Machine/settings.json` in the server data folder that lib-server reports), the whole object is copied in, and keys
    removed there are removed here (BR-12).
  - **What doesn't write:** a forwarded port (BR-8), a closed folder, or a `.code-workspace`.
  - **Mid-session:** a name file created during a session takes effect at once, both as the file opened and as the
    target of writes (decision F-0602 Q-1, preferred).
  - **Label ids** are never copied into the file (decision F-0602 Q-2, preferred).
- **The extension write** (BR-8): see reading 2, §9.
- **The schema:**
  - **Our own:** the property table of F-0602 §3.3, written by us as `resources/attach-config.schema.json`, with
    `settings` referring to core's `vscode://schemas/settings/machine`.
  - **The binding:** our `jsonValidation` entries for
    `%APP_SETTINGS_HOME%/globalStorage/remote-oss.remote-containers/imageConfigs/*.json` and `…/nameConfigs/*.json`.
  - **Nothing copied:** no schema file is vendored, so no licence question arises.
  - **The leading `-`:** the `extensions` pattern rejects it, as §3.3 says, which gives the warning of §11.
- **F-0903 and F-0812's "Open Container Configuration File"** opens the applicable file in an attached window, created
  as `{` newline `}` when absent (F-0903 AC-5, AC-17).

## 6. Folder history and the views (F-0901, F-0902, F-0903, F-0906)

- **The folder history** (F-0901 BR-10, F-0902 AC-21, AC-53):
  - **The store:** `globalState`, under a key of ours, keyed by container name, holding folders in most-recent-first
    order and the last active one. It outlives the container, so a new container with the name shows them.
  - **Who writes it:** the attached window, at activation and on `onDidChangeWorkspaceFolders`.
  - **Who reads it:** C15.
  - **Which folder opens:** the applicable file's `workspaceFolder` (§5; AC-8, AC-18, AC-22, AC-42), not the history.
- **C15's rows:**
  - **Grouping** by F-0901 BR-1's three paths:
    - a plain container is under "Other Containers" (S267);
    - a container with at least one recorded folder moves to "Dev Containers" with its label unchanged (AC-33);
    - the window's own zero-folder attach and the recovery container stay under "Other Containers" (AC-28, AC-46,
      AC-47).
  - **Two or more recorded folders** make a parent row with children (6.5):
    - the active child has `folder-active.svg` and only "Close Workspace";
    - the recent ones have "Open in Container in Current/New Window" and "Remove Recent Folder", which removes the
      entry without asking (F-0902 AC-10).
    - Children are most-recent-first (AC-13) and the parent's collapsed state is kept (AC-58).
  - **The own connection** has no Stop, Start or Remove, and Attach only on a container-shaped row (F-0902 AC-14,
    AC-20, AC-23, AC-30). A rename updates its description with no Refresh (AC-53), through the existing event rebuild.
  - **Attach in Current/New Window** goes through §2's pick step:
    - C5's warning comes first (F-0902 AC-7);
    - an exited container is started first (AC-33), because that's the user's action;
    - Current reloads the same window, with core's save prompt for an untitled workspace (AC-46, AC-48).
  - **The menus** are asserted per state (F-0901 AC-7, AC-41; F-0902 AC-19, AC-26, AC-27).
- **Details (C15):**
  - an attached container shows only Name and Image, its own Docker mounts, and no Rebuild (F-0903 AC-4);
  - "Attach in New Window" uses the same step (AC-19, F-0902 AC-32).
- **F-0902 AC-4:** another window's Stop gives core's reconnect dialog, and the plain label "Disconnected from Container
  <image>".

## 7. Trust and shutdown

1. **C5's attach warning** (F-0106 6.8):
   - S042/S251 with "Got It" (primary) | "Learn More" | core's "Cancel", and "Learn More" opens our own page (R-31);
   - an attach-family flag in `globalState`, separate from the clone family that the volume cards add (AC-22);
   - kept per profile and cleared with the profile (AC-10, AC-23; F-0501 AC-11);
   - shown even when workspace trust is off (AC-31);
   - no per-target dialog (AC-25);
   - Cancel or Escape sets nothing (AC-17).
2. **C9:**
   - an attached window registers its connection as *non-owning*: it counts as a live user in another connection's
     check, but its own end stops nothing;
   - the helper is per machine, so this holds across profiles (F-0417 AC-14, AC-44, AC-71).

## 8. The single lines of other features

| Line | Where |
|---|---|
| F-0201 AC-27 | the permission dialog of §2 step 2, before the picker. Its SSH-host half is group 16 |
| F-0403 AC-4, AC-18 | C6 and C14 treat an attached window like a local one for the where-to pick and the folder dialog |
| F-0405 AC-22 | §4 steps 1–2 after another window's rebuild |
| F-0409 AC-14 | a negative row: none of its three strings shows on Attach |
| F-0415 AC-25 | the CLI's markers through §4 steps 3 and 11 |
| F-0419 AC-11, F-0502 AC-17, F-0503 AC-22 to AC-49, F-0505 AC-22 | §4 steps 9, 12, 3 and 6, and 7 |

## 9. Readings

1. **`(reading-NNNN-compose-child)`, F-0901 AC-38:** the two identical child rows "in this lab's test" are a reference
   defect. We show one child row per recorded folder, and the row asserts each child's 6.5 rules and no duplicate.
2. **`(reading-NNNN-extension-write)`, F-0602 BR-8 and AC-21:**
   - **The problem:** no stable API lets a UI extension see an install into the container's extension host.
     `extensions.onDidChange` covers its own host, and the cross-host list is a proposal.
   - **The reading:** we take the accepted outcome. Installing or uninstalling writes no `extensions` entry, and no file
     is created or changed. AC-21 passes it.
   - **If the API changes:** if a stable route appears, the preferred outcome replaces it on pull.

## 10. Contracts, components, dependencies

- **`contracts.md`:**
  - §2: C10's attached family and its container step (§4).
  - §3: the attached-container payload and the id record.
  - §4: C3's `setUpArguments`.
- **`components.md`:**
  - C12 joins the built components, with F-0601, F-0602 and the attach halves of F-0106, F-0901 to F-0903, F-0906,
    F-0417 and F-0505;
  - boundary 6 gains §4 steps 3 and 4.
- **The shutdown protocol:** a connection's `owning` flag.
- **The manifest:** the three commands, their menus, and the two `jsonValidation` entries. No new runtime dependency.

## 11. The cut and the cards

**The cut:**

| Lines | Where |
|---|---|
| F-0601 (69) and F-0602 (54), unseeded | seeded into `coverage-containers-r2.tsv` by card 1, then built here |
| the 75 r1 lines `C12 attach later`, `later (attach)`, `trust for attach…` | this brief, now |
| F-0601 AC-25 and the SSH case (c) of AC-69 | group 16 (remote engines over SSH); AC-69 completes with it |
| F-0601 AC-28 to AC-31, Q1 (Docker Desktop) | `host: windows`; the payload's `cwd` and the button orders are unit rows now |
| F-0602 AC-11, AC-12 (Kubernetes windows) | group 12 |
| the 26 lines `later (the attach, Kubernetes and Apple families)` | group 12, except the Apple ones of #1992 |

**Suggested cards** (daedalus):
1. **The command and the payload:** §2, §3, §7.1, with the coverage seed. Rows:
   - unit rows for the codec, the collation, the filter and the label;
   - acceptance rows for F-0601 5.0, 7.E1, 7.E5, 7.E7 and PRE-1, F-0106's attach lines, F-0205 AC-45 and F-0906.
2. **The connect:** §4, after card 1. Rows:
   - unit rows for `setUpArguments` against the bundled CLI, the Alpine step's argv and the id record;
   - acceptance rows for F-0601 7.E2 to 7.E8 and BR-13, and for F-0415 AC-25, F-0419 AC-11, F-0502 AC-17, F-0503,
     F-0505 AC-22 and F-0417's three lines.
3. **The configuration files:** §5, after card 2. Rows: F-0602's criteria, and F-0903 AC-5 and AC-17.
4. **The views:** §6, after cards 1 and 2. Rows: F-0901's and F-0902's attach lines, F-0903 AC-4 and AC-19, and F-0403's
   two lines.
