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

## 5. Open Workspace in Container (F-0404, remote-oss/remote-containers#81)

The command composes what §2 decides for Reopen in Container. It adds one check of its own, the folder-list
validation, and no new mechanism.

1. **The command:** `remote-containers.openWorkspace`, "Dev Containers: Open Workspace in Container...", with F-0404
   3.1's manifest `when`. It has no placement of its own. Its second entry point is F-0806's "+" hub row "Open
   Workspace in Container..." (STR:S262, 6.8), which runs the same command.
2. **The order of its steps** (5.0, BR-3, 7.E9), each from one place shared with the other commands:
   1. **The engine gate** first, before any dialog: the same gate Open Folder in Container (F-0403) runs, with its
      platform dialogs (F-0201, F-0202). With no engine, no file browser opens (7.E9).
   2. **The file pick:** core's `window.showOpenDialog`, with one file, no folders, no title, and the filter
      `{[STR:S078]: ['code-workspace']}`.
      - **Its starting folder (BR-9, 6.3):** the window's first folder with a host path. When there's none, or the
        folder lives only in a volume, it's the local home directory. In an SSH window it's the SSH host's path,
        through the window's own remote file system (6.7, on #3245/#3246's route).
      - It never pre-selects a file and never acts on the open workspace implicitly. A cancel ends the command, and
        "Please select a file." (7.E8) is core's.
   3. **Read and validate** the picked file's folder list (BR-3, BR-4, 7.E1–E6), **before** core is asked to open
      anything, so an invalid file leaves the window's title unchanged (6.2 step 1).
      - **The validator already on main** (`open/workspace-folders.ts`, `workspaceProblemOf`) is reused, not
        written again. It's shared with Reopen in Container's workspace route, where it runs after trust (6.6, the
        order F-0401 has); here it runs before trust. It returns the **first** failing entry only (VS-13, BR-11):
        - a path outside the shared root: S185;
        - neither `path` nor `uri`: S406;
        - an absolute path: S407;
        - a URI not on the local file system: S408;
        - no folders: S409;
        - an unreadable or malformed file: S279.
      - **The dialog:** STR:S363 wrapping that message, with "Cancel" and "Continue" (primary).
        - "Cancel" leaves the window as it was.
        - "Continue" goes on with the shared root as the one mount (§2 decision 3). Failed entries stay core's to
          show or drop (6.2 step 3); we add no message. Non-local entries that share one remote authority get core's
          trust dialog once for that authority, never once per entry (AC-19, VS-15). That's core's too.
   4. **Open:** the window reloads into §2 decision 1's payload, `hostPath` being the picked file's folder and the
      window opening the workspace file inside the mount. The configuration is §2 decision 2's workspace-level one.
      - **None found:** the hand-off to F-0801, with decision 2's location rules (6.5).
      - **Several:** decision 2's picker.
      - Core's trust dialog (F-0106's S265 body) and F-0408's progress follow.
3. **What the command doesn't special-case:**
   - **An already-open workspace** (6.3): the only difference is the starting folder.
   - **An untitled calling window** (6.9): the browser opens as usual, and core's save prompt after the pick is
     core's. There's no S415 through this command (AC-14).
   - **For the other commands,** an untitled workspace with **one** on-disk root has a single folder to save into,
     so it gets no S415: Reopen in Container takes the folder route on that root. That's
     `ruling-3255-single-root-untitled`, recorded on card #3255
     (https://github.com/remote-oss/remote/issues/3255#issuecomment-7193362664) and in the family register.
4. **S415 and S408 belong to the other commands, from one helper each:**
   - **S415** ("You need to first save your workspace in a folder containing all its workspace folders.", OK) is shown
     by Reopen in Container (§2 decision 2), Add Dev Container Configuration Files (F-0801) and Open Container
     Configuration File (F-0812) in an untitled workspace (7.E7, VS-19). It's one helper, called by the three.
   - **S408 for a virtual first folder** comes from all five commands, and from F-0811's saved-workspace case
     (7.E10, BR-18). The reference's S279 there is reference data. It's one check in the validator.
5. **6.4 is core's:** File > Open Workspace from inside a container window needs nothing of ours.

**Components:**
- **C4:** the folder-list validator is **on main already** (`open/workspace-folders.ts`) and is reused as it is.
  C4's new work is point 4's two helpers (#3255):
  - the S415 helper, `untitledWorkspaceRefusal`;
  - the window-level check for a virtual first folder (S408), called by Reopen in Container and by F-0801's
    saved-workspace route before its location pick.
- **C6:** the command and its step order. It reuses the engine gate, decision 1's payload and decision 2's
  discovery.

**Rows:**
- **Unit:**
  - the validator's table: each failure, `"."` (6.1), a nested relative path (VS-14), first-failure-only (VS-13), and
    the virtual first folder;
  - the starting-folder rule: first folder, no folder, volume-only and SSH;
  - the step order: gate before dialog, and validation before open.
- **Acceptance:** F-0404's 34 criteria, cut per point by daedalus. 6.7's SSH rows ride #3245/#3246.
