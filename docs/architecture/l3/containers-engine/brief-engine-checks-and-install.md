# Brief: Docker checks, Install Docker and host requirements

Owner: athena (architect). Plan: #1807's release-2 families. Specs, all `spec:reviewed`:
- remote-oss/remote-containers#49 (F-0202 Daemon availability and automatic start);
- #26 (F-0203 Install Docker);
- #75 (F-0206 Host requirements and GPU).

The WSL families (F-0204, F-0207, F-1301) have their own brief, because they need lib-wsl's runner and channel first.

Decisions: ADR-0009, ADR-0013 (the platform is data), R-31 (help and download URLs are ours or the tool's own
docs), R-60, R-79 (bounded waits), D-105 (macOS and Windows lines are built now and tested on a host later),
`brief-foundations.md` (settings), `brief-logs-and-configuration-file.md` (the log terminal).

## 1. What a survey found (2026-11-04)

| Family | Built, needs a row | A gap of ours | Elsewhere | Unsure |
|---|---|---|---|---|
| F-0202 | 33 | 22 | 6 (WSL, F-0404, F-0702, F-0703, F-0806, F-0808, F-1302) | 1 |
| F-0203 | 5 | 32 | 3 (moved to F-0201) | 0 |
| F-0206 | 7 | 38 | 0 | 6 (the CLI's GPU behaviour) |

- **F-0202:** the Linux check and its dialogs are built (`engine/preflight.ts`). What's missing is the macOS and
  Windows automatic start, S332, and two conflicts.
- **F-0203 and F-0206** aren't built at all.

## 2. Daemon availability (F-0202; C2, C6, C10)

### 2.1 The automatic start of Docker Desktop (BR-9, BR-12, BR-13; 6.2)

C2's check becomes a check-and-start step, used by both the fresh-open check (`firstCheck`) and the resolve-time
check (`secondCheck`):

1. **The check** runs as today. The exit status decides (BR-11).
2. **Whether to start:** a failed check starts Docker Desktop only when all of these hold:
   - the host platform has start data (macOS and Windows; Linux has none);
   - Docker Desktop is installed at its standard location;
   - the CLI's error text contains "failed to connect to the docker API" or "Cannot connect to the Docker daemon",
     case-insensitively (BR-12).

   Otherwise the failure goes to its dialog at once, as today.
3. **The start:**
   - **Already running** (its process is listed): it isn't started again, and the step goes straight to the six
     re-checks (BR-13, decision Q3). The same goes for a second trigger.
   - **Not running:** it's started detached and in the background (macOS without taking focus). If the program can't
     be started, the re-checks run anyway (6.2 step 2).
   - Its processes are never stopped by us (BR-5, AC-44).
4. **The re-checks:** about every 5 seconds, with a bound chosen by one pure function (R-79):
   - **Six re-checks:** on macOS, and on Windows when Docker Desktop was already running.
   - **Until it answers, or 5 minutes after the start:** on Windows when we started it (decision Q2 as amended).
   - A re-check that succeeds goes straight on. The last failure goes to the check's own dialog: S143 + S226 for the
     fresh-open check, S144 for the resolve-time one.
5. **Cancel** (§2.2) ends the re-checks at once. The open is abandoned, and nothing connects after it (6.2 step 7).

**The platform data** (ADR-0013) is one table in C2, with a unit row per platform:
- the standard install location;
- the start command (macOS: the application in the background; Windows: the installed executable);
- the process-listing command and the process name;
- the two error texts;
- the re-check schedule.

The start's program, its arguments and its paths come only from this table. Nothing comes from `dockerPath` or a
workspace setting, and the program is spawned with an argument list and no shell.

The card takes the locations and names from Docker's public documentation. Rows on a real macOS or Windows host are
`deferred` with `host: macOS` or `host: windows` (ADR-0013), and the unit rows over the table and the schedule run
now.

`dev.containers.optimisticallyLaunchDocker` is contributed with its key, default and description, and it's read
nowhere (BR-3; 3.2's rule). The spec requires that, so it isn't a switch beyond the spec (R-60).

### 2.2 The progress before the reload: S332, then S283 (BR-8; AC-17, AC-31 to AC-34)

- **Today:** `open/pre-reload.ts` shows S283 after 500 ms over the engine check and the configuration reading
  together. That breaks AC-33 (no notification for a 1.8-second failing check) and gives the check the wrong text.
- **The rule:**
  - **The steps run in order:** first the availability step (§2.1), then the configuration reading (F-0206 BR-19's
    order).
  - **The availability step** shows S332 "Starting Docker (show log)" once it has run 2 seconds, until it ends. It
    has "Cancel" (primary), and its link runs `remote-containers.revealLogTerminal` (AC-34). Cancel abandons the open
    even when the check had already succeeded (AC-32).
  - **The reading** keeps S283 with its 500 ms.
  - **The resolve-time check** never shows S332. Its wait is inside "Opening Remote..." and F-0408's notification
    (AC-53, AC-59, AC-60).
- One timer module serves both notifications, with the threshold as an argument.

### 2.3 `(reading-2146-second-trigger)`, F-0202 AC-45 and AC-51 with F-0401 AC-20

- **The conflict:** F-0202 has a second trigger during a running check run its own check, so two failures give two
  dialogs. F-0401 BR-7a absorbs a second invocation "before the first connect finishes". Today `reopen.ts` and
  `open-folder.ts` absorb every second trigger.
- **The reading:** both hold when the guard covers the connect and not the check.
  - **During the availability step,** a second trigger runs its own check and re-checks. It never starts Docker
    Desktop again (BR-13). Its failure shows its own S143 dialog after the first is dismissed (core queues modal
    dialogs).
  - **Past the check,** only one invocation goes on. The first to pass its check proceeds, and a later one is absorbed,
    so AC-20 still gets one connect and one container.
- **The question** goes to metis with this PR.

### 2.4 The rebuild intent against Retry (AC-39)

- **The bug:** `connector.ts` takes the rebuild intent (`takenRebuild`) after `secondCheck`, at both call sites. A
  failed check keeps the intent, so a Retry within its lifetime rebuilds.
- **The fix:** the intent is taken before the resolve-time check. A failure drops it, so Retry reconnects to the
  existing container without rebuilding.
- **The row:** a rebuild with the daemon down, then Retry, gives the same container id.

## 3. Install Docker (F-0203; C2 and C1)

- **The command:** `remote-containers.installDocker`, with no `when` clause (BR-3). It's independent per invocation,
  with no lock and nothing remembered (BR-7, BR-8), and folder-free (BR-6).
- **By platform** (one table, ADR-0013):
  - **Linux:** it opens `ENGINE_LINKS.install`, Docker's engine install page, in the browser with nothing else. That
    replaces the reference's `aka.ms` link (BR-10, R-31).
  - **Windows and macOS:**
    1. **Download:** the installer for the host's CPU architecture is downloaded from Docker's official download
       location (BR-9; the four URLs are data from Docker's docs), with S155 and no Cancel (BR-1).
       - It's HTTPS only. A redirect off Docker's download host, or to `http:`, fails the download.
       - It's written under a temporary name and renamed to our own fixed file name only when complete, with the size
         the response announced. A partial file is never launched.
       - An existing file is never reused unchecked. Each run downloads again (BR-8).
    2. **Where:** into the extension's `globalStorageUri`. That's a folder only the user can write, so nothing can
       swap the file between the download and the launch. A temporary folder isn't used. The file is left in place
       (BR-5).
       - The trust in the file rests on the OS's own signature check at launch, which nothing of ours weakens.
       - The installer and `hdiutil` are spawned with an argument list and no shell.
    3. **The launch:**
       - **Windows:** the installer runs, S340 shows, and its exit code adds S141 (0) or S137 (any other). The wait
         has no bound of its own (decision Q8). Nothing blocks on it but that report, so it isn't a wait R-79 bounds.
       - **macOS:** the disk image is mounted and opened, and S340 shows. Nothing follows (BR-4).
    4. **A failed download** offers the manual download link, which is Docker's own install page for that platform
       (R-31). A stalled download fails under R-79's bound.
- **The reinstall gate** (Windows, BR-11): when the configured Docker CLI resolves (C2's `executable.ts`), it asks
  "Docker Desktop is already installed. Would you like to reinstall?" before downloading. macOS has no gate.
- **The welcome link** (AC-9, AC-22): F-0901's welcome text gets "installing Docker" as the
  `command:remote-containers.installDocker` link, shown under `remote-containers:needsDockerStartOrInstall`. Today
  it's plain text. F-0201's missing-CLI dialog keeps S061 and S221 (AC-15, AC-36, built).
- **The strings** are F-0203's own atoms (S061, S137 to S141, S155, S156, S205, S221, S288, S340), and the card maps
  each from §3.4.
- **Moved lines:** AC-14, AC-19 and AC-20 say "moved to F-0201" but are still `todo`. They leave the coverage file,
  as D-86's removed stubs did.

## 4. Host requirements and GPU (F-0206; C6, C3, C2)

### 4.1 The check

- **Where it runs** (BR-15, BR-17, BR-19): a pre-reload step in C6. It runs for the entry points of BR-15 only, as a
  table:
  - **Which:** Reopen from a local or SSH window; the two "Rebuild and Reopen" commands; Open Folder and Open
    Workspace in Container, also from a connected window (6.11a).
  - **When:** after the configuration choice, in two stages (below).
  - **Never** for in-window rebuilds, clone, attach, row actions or recent entries.
- **Stage 1, before trust,** for Open Folder and Open Workspace only (BR-17). Nothing of the workspace runs:
  - **What it reads:**
    - the configuration file's own `hostRequirements`, parsed from its text by our pure function (BR-11a's forms,
      the same as the CLI's `wQ`);
    - for an existing container, its label, through C2's own `docker inspect` (BR-18);
    - the daemon's figures.
  - **The result:** if these are unmet, the dialog shows now, before the trust dialog.
  - **Not here:** no CLI run, and so no Feature fetch, no registry lookup and no Compose parse (F-0106; F-0201
    AC-55). A row shows that nothing builds, pulls or runs a lifecycle command before trust.
- **Stage 2, after trust,** for every entry point of BR-15. It's the only stage for Reopen and the rebuild commands.
  - **What it reads:** the CLI's merged requirements (below).
  - **The result:** if they're unmet and this open hasn't shown the dialog yet, the dialog shows now.
- **`(ruling-2146-trust-first)`, BR-13 with BR-17:**
  - **The case:** for Open Folder and Open Workspace, a requirement that only the image's label records shows its
    dialog after the trust dialog, not before it.
  - **Why:** the merged read fetches the Features and the image label that an untrusted configuration names.
  - **The paperwork:** a Deviations entry in `release-1-notes.md`, and the question goes to metis.
- **The merged requirements** come from the CLI's own merge (BR-13), not ours. C3's
  `read-configuration --include-merged-configuration` gives `mergedConfiguration.hostRequirements`:
  - the larger `cpus` and `memory` win;
  - `memory` is parsed exactly as BR-11a (digits with a lowercase `kb`/`mb`/`gb`/`tb`, or bytes; anything else
    counts as absent);
  - the `gpu` merge is the CLI's.

  Measured on 0.89.0 (`Kj`, `wQ`).
  - **An existing container** (BR-18): the read takes `--container-id` of the folder's container (C7's label match),
    so its label's requirements are used.
  - **An image that isn't local** (AC-37): the CLI reads its label from the registry without pulling, so the dialog
    comes before any pull.
- **The daemon's figures:** C2's `docker info --format '{{json .}}'` gives `NCPU`, `MemTotal` and whether `Runtimes`
  lists `nvidia` (BR-1, BR-2).
- **One pure function** turns the two into "met" or the dialog's two lines (BR-1 to BR-3, BR-11, BR-12, BR-14).
  Rows cover GiB with one decimal and the `gb` suffix, fractional `cpus` as written, `storage` listed but never
  compared, and the order CPUs, RAM, disk, GPU.
- **The dialog:** S244 + S140, modal. The buttons are "Continue" (primary) and "Cancel", in the platform's order.
  Escape is Cancel. "Continue" goes on unchanged, with no limits applied (BR-4). "Cancel" leaves the calling window
  as it was (6.2, 6.11a). Nothing is remembered (BR-10).
- **`(reading-2146-requirements-lookup)`:** the spec doesn't say what happens when the merged read fails (for
  example, an offline registry for a non-local image).
  - **The reading:** the check falls back to stage 1's reading of the file's own `hostRequirements` (and the existing
    container's label), with a log line. The open then goes on, and the connect fails or succeeds as it would.
  - **The question** goes to metis.

### 4.2 `dev.containers.gpuAvailability` (BR-5 to BR-8, BR-16)

- **The setting** is contributed as F-0206 §3.2 gives it: machine scope, with `all`, `detect` and `none` and their
  enum descriptions, default `detect`. It's read through `readSetting` and passed to the CLI as
  `--gpu-availability` on `up`, which creates the container.
- **The CLI's own work:** the GPU request, the not-found warning and the device request. So AC-7, AC-8, AC-20,
  AC-24 and AC-28 become rows once the flag passes.
- **An invalid value** fails in the CLI before any container is created (BR-16), and its failure goes to F-0410's
  dialog.

### 4.3 Fixtures (the memory rule)

- **The requirement rows** use values no runner meets (for example `cpus: 4096`), so no special daemon is needed.
- **AC-37** (an image that isn't local) needs a registry. It pushes one small image with a `hostRequirements` label
  into the harness's existing run registry, the one the templates launches use (`tools/acceptance-templates.ts`), so
  no second registry starts. If the card needs a launch without that registry, proteus measures it first.
- **Hosted runners:** all of these run on the GitHub-hosted runners with Docker. Nothing here needs privileged
  containers, dind or kind.

## 5. The cut and the cards

| Lines | Where |
|---|---|
| F-0202's built lines (33), F-0203's (5), F-0206's (7, and the 6 GPU lines once §4.2 lands) | rows and tags (card 4) |
| F-0202 AC-23 to AC-25, AC-31 to AC-34, AC-39, AC-42, AC-44 to AC-47, AC-49 to AC-53, AC-56, AC-57, AC-59, AC-60; AC-7 | card 1 (the macOS and Windows lines as `host:` rows) |
| F-0203 (32 gaps) | card 2 (the Windows and macOS lines as `host:` rows) |
| F-0206 (38 gaps) | card 3 |
| F-0202 AC-28, AC-29, AC-30, AC-55 (WSL) | the WSL brief |
| F-0202 AC-36, AC-37, AC-63; F-0203 AC-14, AC-19, AC-20 | their features' cards; the moved lines leave the coverage file |

**Suggested cards** (daedalus):
1. **Docker Desktop start and the pre-reload progress:**
   - §2.1's step and its platform table;
   - §2.2's S332 and S283 split;
   - §2.3's guard;
   - §2.4's fix;
   - the `optimisticallyLaunchDocker` contribution.
2. **Install Docker:** §3, with the welcome link.
3. **Host requirements and `gpuAvailability`:** §4, with its two stages, the deviation entry and AC-37's image in the
   run registry.
4. **Rows and tags.**

**Spec questions for metis** (with this brief's PR):
- `reading-2146-second-trigger`;
- `reading-2146-requirements-lookup`;
- `ruling-2146-trust-first`.
