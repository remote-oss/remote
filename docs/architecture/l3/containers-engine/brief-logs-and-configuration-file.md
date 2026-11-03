# Brief: the log terminal and files, Open Container Configuration File, Test Connection, virtual workspaces

Owner: athena (architect). Plan: #1807 group 15. Specs:
- remote-oss/remote-containers#43 (F-0104 Logging, the log terminal and log files) and #114 (F-1202 Test Connection),
  both `spec:draft` and unseeded. As for F-0601 in group 11, their published text is the design input (D-62).
- #71 (F-0812 Open Container Configuration File), `spec:reviewed`.
- The virtual-workspace lines of F-0301 and F-0801, and group 15's other r1 lines (§6).

Decisions: D-105, R-26, R-27, R-31, R-46, R-60, R-79, ADR-0013, F-1403 Option D. Personalization and relays (F-1001 to
F-1008) are the next brief, together with the two r1 lines that wait on them.

## 1. The log terminal and the log files (F-0104; C1's log)

- **The Output channel goes.** Release 1 showed the Dev Containers log in the Output panel as a stand-in
  (release-1-notes, "show log"). F-0104 contributes no Output channel (§3.3), so this card removes it. Every place that
  revealed it reveals the log terminal instead:
  - the S087/S283 "(show log)" links;
  - S181's "Show Log";
  - F-0410's dialogs;
  - the Show Log buttons.

  remote-ssh's channel (F-2003) is unaffected: lib-log stays the producer, and only the containers' sinks change.
- **The file:** one per extension-host activation (BR-3), `<ExtensionContext.logUri>/remoteContainers-<start>.log`.
  - **The name:** `<start>` is the activation's start in ISO-8601 UTC, with `:` replaced by `-` and the fractional dot
    kept (BR-4).
  - **What it holds:** every log line of the activation from the first, appended as it's written.
  - **Secrets:** lib-log's no-secrets rule applies unchanged (R-26).
- **The terminal** "Dev Containers" is one `window.createTerminal({name, pty})` per window, created on the first
  `revealLogTerminal` and shown with `show()`. No location is passed, so core's `terminal.integrated.defaultLocation`
  decides (BR-1a).
  - **What it shows:** it replays the activation's file from its start, with the elapsed-time prefixes, then streams
    new lines.
  - **Revealing again** focuses the same terminal (BR-1, AC-3).
  - **Closed:** the next reveal creates a new one that replays from the start.
  - **The width** comes from the stable `Terminal.dimensions`. No `terminalDimensions` proposal is used (F-1403
    Option D, §16).
  - **Restricted Mode** is core's: its trust request and launch error come before our terminal, and we add nothing
    (AC-1b, AC-1c; F-0802 AC-14).
- **The level** (BR-7, BR-7a, BR-8): a pure function maps the setting.
  - `info`, `debug` and `trace` are matched case-sensitively.
  - Any other non-empty string gives `info`.
  - Empty, `null` or absent gives `debug`.
  - It's read at each operation, with no reload, and passed to the CLI's `--log-level` as now. Nothing reports an
    ignored value.
- **`shutdownMonitor-<start>.log`** (BR-4, AC-24): C9's helper writes a connection's lines there. The file is in the
  registering window's log folder, with that activation's `<start>`, both passed with the lease. Only dev-container
  activations register, so local and attached windows get none.
- **The commands:**
  - **`remote-containers.openLogFile`:**
    - **Discovery:** it walks the profile's sibling session folders from `logUri`
      (`<logs>/<session>/window<N>/exthost/<our id>/`) for both name forms.
    - **The pick:** S066, newest name timestamp first. Each item's description is the name's timestamp in local time
      and the size with no digit grouping. The filter matches labels only (AC-21, AC-22).
    - **Nothing found:** the one item S239, which opens nothing.
    - **A pick** opens the file as a preview in the `log` language, not read-only (AC-5).
  - **`remote-containers.openLastLogFile`:** the newest `remoteContainers-*.log` that isn't this activation's (BR-6),
    else S242 as a modal.
  - **`remote-containers.revealLogTerminal`:** as above.
  - None has a Palette `when` (§3.1).
- **F-0104 AC-9b** (Edit devcontainer.json Locally opens the failed attempt's log unfocused beside the file) joins C8's
  existing button.

## 2. Open Container Configuration File (F-0812; C4)

- **The command:** `remote-containers.openDevContainerFile`.
  - **The Palette** offers it in BR-1's three situations.
  - **The remote indicator** lists it first under "Dev Containers" in every window.
  - **The Details view:** a title button in dev-container and attached windows, and the only item on the
    Configuration row's menu.
  - **The icon** is the codicon `$(gear)`. The reference's SVG pair is reference data and isn't copied.
  - This closes F-0903 AC-2, AC-31 and AC-32, left by `brief-views-and-commands.md`.
- **What it opens** (BR-2):
  - **A local, WSL, SSH or tunnel window:** one combined list, in this order:
    - the user-data candidate (F-0801's stored configuration for this folder), described by its absolute path;
    - the mirrored candidates of `repositoryConfigurationPaths`, in the setting's array order (decided Q3;
      `brief-repository-configurations.md`);
    - the folder's own configurations by C4's discovery.

    No entry runs F-0801's wizard (C14), one entry opens directly, and two or more show C4's picker.
  - **A dev-container window:** the payload's `configFile`, with no discovery.
  - **A recovery window:** the cloned repository's `/workspaces/<repo>/.devcontainer/devcontainer.json`, from every
    surface (decided Q1; `brief-recovery-container.md`).
  - **An attached window:** the applicable attach file (`brief-attach.md` §5), created when absent. See reading 1.
- **Workspaces** (BR-8):
  - **A virtual folder with `.devcontainer/devcontainer.json`:** nothing happens (7.E5).
  - **No configuration anywhere:**
    - an untitled workspace gets F-0404's S415;
    - a saved workspace with a virtual folder gets S363 with Cancel | Continue, and Continue leads to the wizard
      (7.E6).
  - **A virtual root `.devcontainer.json`** counts as no configuration.
  - **That file next to a local configuration:** the local one opens (decided Q4, preferred; 7.E8).
  - **An inactive file system provider** reads as a folder without a configuration (decided E7, preferred).
- **What it never does:** create a file except the attach file (BR-3), touch Docker, reload or connect (BR-4), or
  depend on trust (BR-5, AC-65).
- **Opening** is always a preview tab (BR-6). An unreadable file opens in core's cannot-open state with no dialog of
  ours (F-0301 AC-57).

## 3. Test Connection (F-1202; C18 diagnostics)

- **The command:** `remote-containers.testConnection`, in the Palette when `remoteName =~ /^(dev|attached)-container$/`
  (BR-1).
- **Not connected:** run by keybinding outside a connected window, it logs "Not connected." and nothing else (7.E2).
  A Kubernetes window runs the test (6.8) once group 12 exists.
- **The round trips** (BR-3):
  - three through the connection's own exec as the window's resolved user (BR-7), through C11;
  - then three through a host-side POSIX shell spawned by C2's host;
  - each is logged in the block of §5 and §9, at every level (BR-9).
  - **Content, not wording:** the block's content is the contract, and F-0104 BR-9 governs its wording.
- **Runs don't exclude each other** (BR-2). Nothing is stored, and no Docker object is created (BR-4).
- **Failures propagate** to core's command-error surface, with no dialog of ours (BR-5, 7.E1, 7.E3). A client without
  a POSIX shell fails the host phase (BR-8), as platform data (ADR-0013).
- **Ruling `(ruling-2042-test-connection-bound)`, BR-6:**
  - **What changes:** each round trip is bounded at 5 minutes (R-79), not unbounded. At the bound the run logs that
    the round trip didn't answer and ends like 7.E1.
  - **Why AC-19 still passes:** it holds an exec for at least 60 seconds and then releases it, so it passes
    unchanged. Only BR-6's "no timeout" sentence becomes reference data.
  - **The paperwork:** a unit row with a held exec carries the label, and release notes gain the Deviations entry.

## 4. Virtual workspaces (F-0301 AC-27, AC-73; F-0801 AC-25, AC-26, AC-31, AC-34)

- **The manifest:** `!virtualWorkspace` keeps Reopen, the two rebuilds, Add Dev Container Configuration Files and the
  Palette's Open Container Configuration File out of a pure virtual workspace. The remote indicator keeps the
  last (F-0301 AC-27).
- **C4's discovery** never treats a virtual folder as a place to create a container, and it never shows the discovery
  notification for one. Only `.devcontainer/devcontainer.json` in a virtual folder counts as a configuration, for §2's
  silence.
- **F-0404's dialogs** come first:
  - S415 for an unsaved workspace, pure or mixed (F-0801 AC-25, AC-26);
  - S363 with Cancel | Continue for a saved one.
- **After Continue:** the location pick, then C14 continues to the template pick with the **`.code-workspace` file's
  folder** as the write target. Nothing is written in a virtual folder (F-0801 AC-31, preferred; AC-34, also for
  Reopen in Container by its id).
  - **No leftover pick:** a pick that stays open must never write later.
- **Invoked by keybinding** in 6.11's contexts, every command stays safe (F-0301 AC-73, R-46): nothing is created or
  written unless a wizard completes, Escape closes everything, and the window keeps its state.

## 5. Readings and rulings

1. **`(reading-2042-empty-object)`, F-0812 AC-7:**
   - **What it says:** AC-7 calls the new per-image file's initial content `{}`, while F-0602 BR-3, the file format's
     owner, gives the bytes as `{` newline `}`.
   - **The reading:** we write F-0602's bytes. AC-7's row asserts the parsed content, an empty object.
2. **`(ruling-2042-test-connection-bound)`:** §3.

## 6. The cut and the cards

**The cut:**

| Lines | Where |
|---|---|
| F-0104 (34) and F-1202 (19), unseeded | seeded into `coverage-containers-r2.tsv` by card 1, then built here |
| F-0812 (43), r2 `todo` | this brief |
| F-0903 AC-2, AC-31, AC-32 | this brief (§2) |
| r1, the log terminal: F-0301 AC-53, F-0401 AC-12, F-0403 AC-21, F-0408 AC-17, F-0409 AC-42, F-0802 AC-14 | this brief (§1) |
| r1, F-0812: F-0301 AC-19, AC-28, AC-57, AC-65 | this brief (§2) |
| r1, virtual workspaces: F-0301 AC-27, AC-73; F-0801 AC-25, AC-26, AC-31, AC-34 | this brief (§4) |
| r1, Reopen Folder Locally: F-0405 AC-33, F-0502 AC-7 | rows now: the command exists (containers-136) |
| r1, personalization: F-0403 AC-11 (the Wayland bind), F-0415 AC-32 (the git configuration copy) | the personalization brief (next) |
| r1, a tunnel window: F-0801 AC-19 | the Tunnels group |

**Suggested cards** (daedalus):
1. **The log:** §1, with the F-0104 and F-1202 seed. Rows:
   - unit rows for the file name, the level map and the listing order;
   - acceptance rows for F-0104 and the six r1 log lines.
2. **Open Container Configuration File:** §2, after `brief-attach.md`'s card 3 for the attached case. Rows: F-0812, the
   four F-0301 lines and the three F-0903 lines.
3. **Test Connection:** §3. Rows: unit rows with the label and acceptance rows for F-1202.
4. **Virtual workspaces:** §4. Rows: the six lines.

**Amendment to `brief-volumes.md` §6:**
- **The error:** its sentence "with no `contribEditSessions` proposal requested, so core drops them (7.E2)" is wrong.
- **The correction:** the proposal stays declared with the other six (F-0101 BR-8), and one grant covers them all
  (F-0101 BR-9). So F-0707's dormancy rests on its entries' `when` clauses, as in the reference.
- **The record:** #2040 built it that way, and the register records the correction. This brief's PR fixes the
  sentence.
