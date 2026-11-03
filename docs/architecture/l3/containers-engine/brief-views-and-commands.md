# Brief: container views and commands (Switch Container, Dev Volumes, Clean Up)

Owner: athena (architect). Plan: #1807 group 14. Specs, all `spec:reviewed`:
- remote-oss/remote-containers#82 (F-0407 Switch Container);
- remote-oss/remote-containers#99 (F-0904 Dev Volumes view);
- remote-oss/remote-containers#100 (F-0905 Clean Up Dev Containers and Dev Volumes);
- the view lines of #76 (F-0901), #80 (F-0902), #94 (F-0903) and #72 (F-0906) that 0.4 left, and their single lines in
  F-0201, F-0405, F-0409, F-0415, F-0417 and F-0419.

Decisions: D-105, R-27, R-31, R-46, R-60, ADR-0010, ADR-0013, `brief-volumes.md` (C13), `brief-attach.md` (C12),
`brief-multi-root.md`. F-0406 (Reopen Folder Locally/in WSL/over SSH/in a tunnel) is group 15's. F-1302 (dev containers
on SSH hosts and tunnels) is group 16's.

## 1. Switch Container (F-0407, C6)

- **The command:** `remote-containers.switchContainer`, Palette only, with the `when` clause
  `remoteName =~ /^dev-container$/` (BR-1).
- **Discovery** is C4's, over the window's folder:
  - the payload's host folder for a bind mount, also in a no-folder window (BR-11);
  - the volume's `/workspaces/<folder>` through `workspace.fs` for a volume payload (BR-10);
  - the shared root for a shared-root multi-root workspace (6.6).
  - The three standard locations only (BR-2).
- **The picker** is C4's, with F-0301's order (BR-3, the same order as the initial picker):
  - title S299 and placeholder S303 (AC-19);
  - the `name` as label, else the containing folder (BR-4);
  - the relative path as description, with " (Current)" (S001) appended on the connected configuration;
  - the first item focused (AC-11);
  - an "Open File" button that opens the file and changes nothing else (AC-26).
- **Outcomes:**
  - **No change:** "(Current)", Escape or Cancel change nothing (BR-5), except in the no-folder window, where every
    pick reconnects (6.8).
  - **Another configuration:** C6 reloads the *same* window with the payload's `configFile` changed, through C6's
    existing pre-reload phase (S283 with Cancel, 6.9). C7 then reuses or creates per F-0409 (BR-8).
  - **The left configuration's container:** its own `shutdownAction` applies on every switch (BR-7, AC-18, decided
    Q3). That's C9's ordinary leave of the old connection, as Reopen Locally uses it.
  - **A multi-root window** reconnects as a plain folder on the shared root (AC-15).
- **S240** (modal info: "Cancel" | "Open Folder in Container..." (primary), which goes to F-0403's folder dialog) shows:
  - with one configuration, whatever the workspace origin (AC-6, AC-22, decided Q4);
  - in a recovery container window (AC-7);
  - in a DISCONNECTED window, where discovery doesn't run (AC-23). C6 asks lib-authority's resolver host whether this
    window's resolve ended in `Failed` without a recovery container.
- **Invoked in a local window** (7.E8, R-46):
  - zero or one configuration gives S240 (AC-28);
  - two or more go to C6's Reopen in Container flow, with its picker and trust step. That's safe (AC-29) and reuses
    a flow that exists.
- **Nothing is stored** (BR-9).
- **Single lines:**
  - F-0409 AC-41 (an existing exited container of B is reused);
  - F-0415 AC-40 (the six commands, then two on switching back);
  - F-0417 AC-55 (the stop, about 10 s later);
  - F-0419 AC-28 (one `vscode` volume for both users).

## 2. Dev Volumes (F-0904, C15)

- **The view** `devVolumes` in `views.remote`:
  - `when: !hideConnectCommands`, group `details@2`;
  - the welcome entry WELCOME:devVolumes#4 under the key `remote-containers:noDevVolumes`;
  - the three title buttons in F-0904 §3.3's order;
  - the four row-menu entries.
  - Its registration is asserted with F-0906 AC-2, AC-3, AC-4, AC-18 and AC-22.
- **The model** is pure: (volumes, containers, now) → rows, in `explorer/volumes-model.ts`:
  - **Inclusion:** every volume but `vscode` and names of exactly 64 hex digits (BR-1).
  - **Kind:** `uniqueDevVolume` only for `vsch.local.repository.unique` exactly `true` (BR-2).
  - **Label:** `<owner>/<repo>` only for a unique volume whose repository value is one of BR-3's GitHub shapes, through
    one pure recognizer shared with Clean Up (BR-19): `github.com` or `www.github.com` in any case, over `https`,
    `http`, `ssh` or the scp form, with `.git`, a trailing `/` or extra segments. The look-alike host is the reading
    of §5.
  - **Description:** "#<pullRequestId>", else the branch, else none.
  - **Order:** newest first, with ties by raw name (BR-6).
  - **The tooltip:** BR-4's five lines.
    - The relative time follows BR-4's own unit table, a pure function with a row per boundary in BR-4. If F-0901's
      `relative-time.ts` gives the same table, it's one function. If not, it takes the table as a parameter, and
      nothing is copied.
    - The `git://` source line ends in ")" as AC-7 states.
    - Label values are text, never markdown: see the reading (§5).
- **Updates** (BR-12): C15's existing event rebuild also takes `docker events` for volumes (C2's spawn, `type=volume`),
  coalesced and only while the view is visible. Refresh rebuilds as well.
- **Docker unusable at start:** no data provider is registered, so core's placeholder shows, while the title buttons
  stay (AC-24, BR-11). That's the same rule as `targetsContainers`.
- **The row commands:**
  - **"Remove"** (BR-5):
    - the in-use check first: any container, in any state, mounting it gives S394;
    - otherwise S041, then `docker volume rm` through C2;
    - a volume already gone gives no error (7.E3);
    - a refusal gives S169 and keeps the volume (7.E2).
  - **"Clone Repository in Volume"** (6.2, BR-7), on `devVolume` rows only, is C13's F-0702 flow with this volume
    preselected:
    - the clone warning;
    - the source pick;
    - the folder box;
    - the clone into a new subfolder.
    - It creates no volume.
  - **"Explore in Dev Container"** is C13's `inspectInBasicDevContainer` (brief-volumes §5).
  - **"Inspect"** is F-0902's `inspectDockerResource` on the volume (F-0902 AC-29).
- **Remove Container's chained dialog** (BR-8, S347/S133) joins C15's existing Remove Container. It's offered only when
  all three hold:
  - the container's `vsch.local.repository.volume` label names an existing unique volume;
  - no other container mounts that volume;
  - the volume is unique.
- **Trust:** the view and its commands behave the same in Restricted Mode and with trust off (BR-10).

## 3. Clean Up (F-0905, C15)

- **The commands:** `remote-containers.cleanUpDevContainers` and `remote-containers.pruneVolumes`, in the Palette and
  as the two `$(clear-all)` title buttons. Their `when` clauses use F-0901's existing context keys.
- **The scans** are pure functions over C2's `ps -a`, `volume ls` and inspect output (§16, R-34):
  - **Containers:** only `exited` ones (never `created`, BR-20) with one of the five labels, one row per matching label
    (BR-13).
    - **The label:** the basename of a folder or repository label, or the image reference for a volume label (BR-11),
      with BR-19's GitHub form.
  - **Volumes:** the two labels of 6.1 step 2, with no referencing container in any state (BR-2), never `vscode`
    (BR-3), and once per volume (BR-15).
  - **The order:** both sorted by the displayed label with the default `Intl.Collator` (BR-12). A row holds BR-12's
    `_` < `-` < `.` cases.
- **The pickers:**
  - `canPickMany`, with no pre-checked row, no Back button, and placeholder S315 or S320 (BR-8);
  - one batch `docker rm` or `docker volume rm` per accept, each container removed once (BR-4, AC-18).
- **The dialog sequence** is a small pure state machine in `explorer/clean-up.ts`, with a row per path. It has:
  - BR-5's two completion cases;
  - BR-7's both-empty S366;
  - BR-14's second volume scan and the chained picker;
  - BR-16's abort after the race;
  - BR-17's Escape case (AC-25);
  - BR-6's silence on `pruneVolumes`.
- **Errors:**
  - `cleanUpDevContainers` lets a Docker failure propagate to core's command-error dialog (7.E1, 7.E2);
  - `pruneVolumes` swallows its own and logs it (7.E2).
- **No progress UI and nothing stored** (BR-9, BR-10). Compose siblings are never candidates (BR-18, AC-26).
- **F-0901 AC-3, AC-21, AC-56** (the three title actions) are asserted with this card.

## 4. The rest of the views

- **F-0903 AC-7:** a Details section opened from a local window shows only "Attach in New Window" and "Refresh". It
  comes after `brief-attach.md`'s card 1, because it needs C12's command.
- **F-0405 AC-24:** the Details section's "Rebuild Container" acts on the window's own container whatever the section
  shows, as the existing command does. It's a row only.
- **F-0901 AC-18:** a two-sub-folder `.code-workspace` connection is one merged row labelled by the outer folder, with
  the single-folder menu (`brief-multi-root.md`).
- **F-0201 AC-39, AC-40:**
  - **C2's engine-change event** also fires on a `dev.containers.dockerPath` change in a local window. C15 rebuilds
    on it, so the welcome content appears and goes as the setting breaks and heals.
  - **In a connected window**, C15 keeps the program C10 connected with for the window's life. A rebuild re-reads the
    setting at its second check (7.E14).
  - `contracts.md` §2's paragraph on the effective engine gains this.
- **F-0409:**
  - AC-16: Stop or Start on a container already in that state ends quietly; Stop still asks first;
  - AC-17: a sub-folder opened from the parent's connection reuses its container, by the parent's labels;
  - AC-30: the four icons and Docker's status wording.
- **F-0906 AC-22:** in an SSH window, switching the filter to Dev Containers shows the *local* engine's rows. It's
  asserted with our remote-ssh in the harness, with no reload.

## 5. Readings

**`(reading-NNNN-tooltip-text)`, F-0904 BR-4:** the reference renders markdown found in a label value, so emphasis,
inline code, HTML and links all render. No criterion asks for it. Label values are anyone's text (any container or
volume can carry them), so the tooltip escapes them:
- `MarkdownString` with `isTrusted: false` and `supportHtml: false`;
- every value through `appendText`;
- links only for the source URLs that BR-4 names, which we build ourselves.

AC-7's lines, the ")" included, are unchanged.

**`(reading-NNNN-github-host)`, F-0904 BR-3:** the reference also gives `https://github.com.example.org/<owner>/<repo>`
the friendly label. No criterion asserts it, and the recognizer that C13 and the tooltip's GitHub link rely on is
host-exact. So a look-alike host keeps its raw name, like any other host.

## 6. The cut and the cards

**The cut:**

| Lines | Where |
|---|---|
| F-0407 (26), F-0904 (42), F-0905 (33), r2 `todo` | this brief |
| the r1 lines `0.4: F-0904/F-0905/F-0407 later`, `Switch Container`, `the Remote Explorer views`, `F-0902's recent-folder rows`, F-0901 AC-18 | this brief |
| F-0901 AC-14, AC-23, F-0903 AC-21 (SSH and tunnel origins); F-0901 AC-17, AC-26 (F-1302) | group 16 |
| F-0901 AC-29 (a WSL origin) | `host: windows` |
| F-0903 AC-2, AC-31, AC-32 (the Configuration row and toolbar button need F-0812's command) | group 15 |

**Suggested cards** (daedalus), independent of each other except card 4:
1. **Switch Container:** §1. Rows: F-0407's criteria and the four single lines.
2. **Dev Volumes:** §2, after C13's commands exist (the clone, Explore). Rows:
   - unit rows for the model, the GitHub shapes, the time table and the escaping;
   - acceptance rows for F-0904, F-0902 AC-29 and F-0906's five lines.
3. **Clean Up:** §3. Rows:
   - unit rows for the scans, the collation and the state machine;
   - acceptance rows for F-0905 and F-0901 AC-3, AC-21 and AC-56.
4. **The rest:** §4, after `brief-attach.md` card 1 for F-0903 AC-7.
