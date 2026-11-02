# Brief: multi-root workspaces in Dev Containers (the reopen, the notification, the way back)

Owner: athena (architect). Issue: #1204 (daedalus's request; dike's #1845 found the gap). Plan #1807 group 8, moved up
after F-0406. Specs (remote-oss/remote-containers):
- F-0301 6.5 (#20);
- F-0401 6.5 and 7.E3 (#21);
- F-0101 AC-3b (#19);
- F-0402 6.2 and BR-1 (#17);
- F-0106 6.10 and AC-44 (#46);
- F-0406 6.5, AC-30 and AC-31 (#68).

Decisions: D-105, R-60, R-31 (`reading-1808-own-link`).

## 1. Why now

In a saved multi-root workspace, Reopen in Container does nothing today. Six criteria of release-1 families wait on it:
F-0301 AC-22 and AC-50, F-0106 AC-44, F-0101 AC-3b, and F-0406 AC-30 and AC-31. Group 8's own 20 lines wait too.

## 2. The decisions

1. **The payload doesn't change.**
   - A workspace window's `dev-container` payload is F-0501 BR-2a's folder payload, as observed for folders. `hostPath` is
     the folder that holds the `.code-workspace` file, which is the workspace bind mount's source (F-0401 6.5 step 2,
     F-0301 6.5 step 5). `configFile` is the workspace-level configuration.
   - The window opens the workspace file inside the container: `/workspaces/<basename of hostPath>/<the file's path
     relative to hostPath>`.
   - No new member is added, so the authority keeps the shape observed for the window kind it is. The workspace file
     isn't lost either: it's the window's own `workspace.workspaceFile`.
   - **F-0406's origin** (`originOf`, #1827) gains one case. When `workspace.workspaceFile` lies under the mount target
     `/workspaces/<basename of hostPath>`, the origin is the workspace file on the host, at `hostPath` plus that file's
     path relative to the mount target. Otherwise the origin is `hostPath`, the folder, as BR-13 has it. That's a mapping
     of the workspace file only, the one the reopen itself opened (BR-11), never of an arbitrary open path.
2. **The configuration is the workspace-level one, and only that** (F-0401 6.5 step 2, F-0301 6.5 steps 2 and 4).
   - In a **saved** multi-root workspace, C4 discovers configurations only in the folder that holds the
     `.code-workspace` file, with BR-1's locations (root dotfile, `.devcontainer/devcontainer.json`,
     `.devcontainer/<sub>/devcontainer.json`).
     - **None:** the "Add Dev Container Configuration Files" wizard (F-0302 / F-0801). This holds even when every listed
       root carries a configuration (AC-22, F-0106 AC-44).
       - **Where it writes** (themis's question): beside the workspace file, at `<hostPath>/.devcontainer/devcontainer.json`,
         the same place the reopen reads (F-0801 6.8 step 3: a configuration next to the `.code-workspace` file is the one
         that gives S027's row its S082 "Configuration already exists").
       - **The location pick** keeps its plain two rows (S027, focused, and the user-data row), with no stage pick and no
         S304 folder pick (F-0801 6.8 steps 1 and 2).
       - **Absolute paths:** a workspace with absolute folder paths and a configuration beside its file gets F-0404's
         absolute-path dialog first (F-0801 6.8 step 4).
     - **One:** a direct connect.
     - **Several:** 5.0 step 4's picker, with the same rows, relative paths and "Open File" buttons.
   - Per-root configurations are never consulted by Reopen in Container. They are by "Open Container Configuration
     File", whose discovery covers the listed roots only (F-0301 6.5 step 3, already C4's per-root walk).
   - An **untitled** multi-root workspace gets F-0404's S415 dialog ("You need to first save your workspace in a folder
     containing all its workspace folders.", OK), and the window stays local (F-0401 7.E3).
   - STR:S271's folder pick is never shown. Its trigger was observed nowhere (F-0401 6.5 step 3), and R-60 applies.
3. **The container's folders: one bind mount of the workspace file's folder** (F-0301 6.5 step 5).
   - The mount is `hostPath` → `/workspaces/<basename of hostPath>`, and every listed root is a plain subdirectory of it.
     There's no per-root mount.
   - The window opens the workspace file inside the mount, so its roots resolve to the same relative paths.
   - A root outside that folder (the documented condition is broken) is left to core: it shows the folder as missing.
     We add no message of our own (R-60).
4. **The notification's workspace form** (F-0402 6.2, BR-1; F-0101 AC-3b; F-0301 6.5 steps 1 and 4).
   - **When:** a **saved** `.code-workspace` window in which any **listed root** has a configuration in BR-1's
     locations. Not when the only configuration is beside the workspace file: F-0301 6.5 step 4 observed no
     notification then, and none after Reopen Folder Locally either.
     - This reads F-0402 6.2 step 1's "a `.code-workspace` file whose folder contains a dev container configuration"
       as one of its folders, as F-0101 AC-3b and F-0301 AC-50 observe. The notification and the reopen use different
       configurations; that's what the reference does, and we reproduce it.
   - **Text:** STR:S427 with `{0}` = S405, giving "Workspace contains a Dev Container configuration file. Reopen
     workspace to develop in a container (learn more).". The link is ours (`reading-1808-own-link`).
   - **Buttons:** "Reopen in Container" (primary) and "Don't Show Again...".
     - "Reopen in Container" runs the same command, so it takes the workspace flow of decision 2.
     - "Don't Show Again..." shows S152 with "Any Workspace" (S036, primary) and "Current Workspace" (S102).
       - "Any Workspace" writes the one global slot that "Any Folder" writes.
       - "Current Workspace" writes the `.code-workspace` file's own workspace state, with the same key and shape as
         the folder case.
   - **An untitled multi-root window has a form of its own** (F-0402 6.5; themis's question). Today's notification shows
     nothing there, because `reopen-notification.ts` returns early for any window without exactly one folder.
     - **When:** a configuration is found for any of its roots, by BR-1's per-root discovery aggregated, and the untitled
       workspace isn't suppressed in its own workspace state.
     - **Text:** the folder skeleton S426 ("…Reopen folder…"), never S427. Its `{0}` is always STR:S368 ("There is a
       [Dev Container configuration](command:remote-containers.openDevContainerFile) available for this repository."),
       even with one root's configuration (6.5 step 3). The link runs Open Container Configuration File, which picks across
       the roots.
     - **Don't Show Again...:** the folder follow-up S151 ("Any Folder" or "Current Folder"). "Current Folder" writes the
       untitled workspace's own workspace state (6.5 step 6).
     - **Reopen in Container:** it takes decision 2's untitled route, F-0404's S415 dialog, and the window stays local.

5. **A saved `.code-workspace` with exactly one root takes the workspace route** (daedalus's question on #1204).
   - **The reopen:** a saved workspace file is one window kind whatever its root count. F-0401 6.5 covers
     "`.code-workspace` files", and F-0402 BR-1 words every saved workspace file as a workspace. So Reopen in
     Container uses the configuration beside the workspace file and the one mount of its folder, and the window
     reopens the workspace file (title "<workspace> (Workspace) [Dev Container: <name>]"). F-0406 brings it back to
     the workspace file (BR-11).
     - When the workspace file sits in its single root, as is usual, that configuration is the root's own, and the
       result differs from the folder route only in reopening the workspace file.
   - **The notification** uses the workspace wording: S427 with S405, "Workspace contains a Dev Container configuration
     file. Reopen workspace…". F-0402 BR-1 names S405 for "a single-folder saved workspace" window. Its trigger is
     decision 4's, a listed root with a configuration. A workspace file in its own root therefore notifies, because
     that root's configuration is a listed root's.
   - This shape wasn't observed with one root. It is the multi-root route applied to the window kind, and no criterion
     asserts another.

## 3. Components

- **C4 config:** the workspace-level discovery for a saved workspace (decision 2), beside the per-root walk "Open
  Container Configuration File" already uses.
- **C6 open-flows:**
  - the workspace route of Reopen in Container: the S415 dialog for an untitled workspace; for a saved one, the payload
    of decision 1 and the reload into the workspace file inside the mount;
  - the notification's workspace form, in `reopen-notification.ts`, whose early return on `workspaceFile` goes;
  - F-0406's workspace origin, decision 1.
- **C7:** no change. The mount is the payload's `hostPath`, as for a folder.
- **Trust:** core's workspace wording ("Trust Workspace & Continue", F-0106 6.10) is core's and needs nothing of ours.

## 4. Rows

- **Unit:**
  - C4's workspace discovery: none, one, several, and per-root configurations ignored;
  - the payload and reload target of a workspace;
  - `originOf` with a workspace file under the mount, and one that isn't;
  - the notification's trigger table: saved with a root configuration, saved with only a sibling one, untitled;
  - the S152 choices.
- **Acceptance, in the containers launch:**
  - F-0301 AC-22 and AC-50;
  - F-0106 AC-44;
  - F-0101 AC-3b;
  - F-0401 6.5 (sibling configuration: a direct connect, with the title "<workspace> (Workspace) [Dev Container:
    <name>]" and the single mount by `docker inspect`; two sibling configurations: the picker; untitled: S415);
  - F-0406 AC-30 (local Docker), with the workspace reopened and the workspace notification shown.
  - AC-31 (over SSH) comes with F-1302.
- **Group 8's own lines** are tagged from these as each lands.
