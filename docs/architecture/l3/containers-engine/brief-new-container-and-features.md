# Brief: New Dev Container, Configure Container Features and Try a Sample

Owner: athena (architect). Plan: #1807 group 6, wave 2. Specs:
- remote-oss/remote-containers#67 (F-0806 New Dev Container);
- remote-oss/remote-containers#96 (F-0807 Configure Container Features);
- remote-oss/remote-containers#97 (F-0808 Try a Dev Container Sample).

All three are `spec:reviewed` and seeded in `coverage-containers-r2.tsv`. With them come F-0804's and F-0805's lines that
were cut to these commands. Decisions: D-100, D-105, R-27, R-31, R-60, ADR-0005, ADR-0009.
`brief-increment-2-authoring.md` is the base: C14 (authoring) already runs the wizard with its template, options (F-0803),
features (F-0804) and optional-files (F-0805) stages.

## 1. The shape, and the order

- **F-0807 adds a second flow to C14 and can be built now.** It edits an existing configuration's `features` with the
  existing F-0804 and F-0803 stages.
- **F-0806 and F-0808 end in a container whose workspace is a Docker volume:**
  - F-0806 fills a named volume from a template (F-0702's naming and validation);
  - F-0808 clones a sample repository into a volume (F-0701's Clone in Volume, F-0704's bootstrap image).

  That machinery is plan group 13's (C13 volumes, the volume-workspace payload). This brief designs only what is these
  two commands' own (§3, §4). Their cards start after group 13's volume core lands.
- **The order this sets:** group 13's brief comes next, before group 7. Its volume core unblocks F-0806 and F-0808 here.
  It also unblocks group 7: the recovery container is reached from Clone in Volume (`brief-release-1.md`, F-0410). And
  it unblocks the F-0413 Clone-in-Volume lines cut today.

## 2. F-0807, Configure Container Features (C14 + C4 + C20)

1. **The command.**
   - **Where it's offered:** `remote-containers.configureContainerFeatures` in the windows F-0807 3.1 names:
     - a local window that isn't fully virtual;
     - `dev-container`, `wsl`, `ssh-remote` and `tunnel` windows;
     - in the remote indicator, only in `dev-container` windows.
   - **How it runs:** in the UI extension host, reaching the configuration through `workspace.fs`, so a remote
     window's file is edited where it lives.
   - **Trust:** Restricted Mode doesn't block it (BR-6).
2. **Which file it edits (C4).**
   - **The file forms:**
     - F-0301's discovery, extended to the forms F-0807 counts: `.devcontainer/devcontainer.json`, one subfolder level
       (BR-20), the root `.devcontainer.json` (BR-14, never converted), and the user-data file (BR-16);
     - a file mirrored from a `repositoryConfigurationPaths` root (BR-21), whose lines wait for plan group 9's store.
   - **Several files:** F-0301's selector (S303) runs, with the dotfile and a mirrored file listed first. Escape writes
     nothing (BR-10).
   - **No file:** the S236 modal, whose S025 hands off to F-0801's wizard (C14's existing `runWizard`). The command
     itself never creates a file (POST-3).
   - **A configuration on a virtual root** is never read or written (BR-19). Discovery ignores virtual roots, as
     F-0301 §6.6 does, where the reference ends silently. A configuration on a disk root then opens the pick, and a
     configuration only on a virtual root gives S236 (§16, 7.E1).
3. **The pick (C14's F-0804 stage, a new entry).**
   - **The picker:** multi-select, with the S183 title action, and items pre-checked from the file's current `features`
     by BR-1's id matching.
   - **The two ways to accept:**
     - S183 writes at once;
     - OK opens S217 once per run. There, S216 writes as S183 does, and S084 runs F-0803's wizard per checked item in
       catalogue order. Escape on S217 goes into the wizard, and a second Escape cancels (BR-12).
   - **No state between runs** (BR-7): the pre-checks always come from the file.
4. **The write: one function in C14,** `editFeatures(text, picks) → text`. It's pure, over `jsonc-parser`'s `modify`
   and `applyEdits` (already a dependency).
   - **What it changes:** only `features`. Each catalogue key is added, or overwritten with `{}` or the wizard's object
     (BR-2), or removed when unchecked (BR-3; an empty `"features": {}` stays). New keys go after existing ones, in
     catalogue order (BR-11).
   - **What it never touches:** non-catalogue and other-version entries (BR-4, BR-17, BR-18). Comments, indentation and
     every other key stay (BR-5). A trailing comment moves after the last appended entry, per BR-5.
   - **No-op:** no `features` key and nothing picked writes nothing (BR-9).
   - **Where it writes:** to disk through `workspace.fs`, regardless of an unsaved editor buffer (BR-13).
   - **Afterwards:** the file opens as a preview at Ln 1, Col 1.
5. **After the write.**
   - **The rebuild prompt** isn't this command's. In a `dev-container` window C20 already watches `devcontainer.json`
     live (`brief-rebuild-prompt.md` §3), so its S083 follows the write by itself. Local and SSH windows have no C20,
     so no prompt (POST-2).
   - **The version check:** the CLI's `outdated` runs on a temporary local copy of the written file, through C3, and
     its result goes to the log only (5.0 step 8). Its failure is one log line.
6. **The catalogue** is F-0804's (BR-8): fetched per run under the editor's proxy settings. A failed fetch gives the
   error 7.E8 names, and no picker.

## 3. F-0806, New Dev Container: its own parts (C14 + C6)

1. **The hub, `remote-containers.newContainer`:** the view's "+" action, never in the Palette (AC-15).
   - **What it shows:** the S309 pick, with the items F-0806 3.1 and 6.3 list, in that order.
   - **Its items:** each item runs its feature's command, and an item whose feature hasn't landed isn't listed (R-60).
   - **When "+" shows:** whenever the engine is reachable (BR-8, through C2's check).
2. **`remote-containers.createDevContainer`:**
   - **Before any screen:** C2's engine check (F-0201), then the catalogue.
   - **The template pick:** C14's F-0802 stage, custom ids included.
   - **The name step, F-0806's own,** which swaps the same quick pick's contents in place (§16):
     - the S120 placeholder;
     - a default of the template id in lowercase, or a custom id's last segment (BR-1);
     - `-2`, `-3` added to the *default* only when a volume of that name exists (BR-2, from C2's volume listing);
     - S099's description mirroring the typed text (BR-3);
     - S029 opening C14's options, features and optional-files stages (6.1). Escape keeps BR-7's exception at Optional
       Files.
   - **Name validation** is F-0702's (S017, S249, S250, S361), from group 13.
3. **The creation:** handed to group 13's volume core.
   - **The steps:** create the named volume, write the applied template into it, then the features (C14 already
     writes them into the configuration), all before the window is repurposed (BR-10).
   - **The reload:** C6 reloads the *same* window (BR-4) into a volume-workspace payload, with the workspace at
     `/workspaces/<name>` (BR-5).
   - **What it never does:** use the name as the container's name, or write to the host.
4. **The strings and ids:** the command ids and context keys are reused verbatim (F-1406, D-14). The strings go into
   the tables with `check-string-tables`.

## 4. F-0808, Try a Sample: its own parts, and one question for the user

1. **The list is a table of ours** in the extension. There's no network fetch (BR-1).
   - **Order:** the eight languages in F-0808's order, with C++ preselected and S305 as the placeholder.
   - **Each row:** the language name, with its repository URL beside it.
2. **The flow:**
   - C2's engine check first (PRE-4);
   - a pick;
   - in Restricted Mode only, our S131 confirmation (BR-10, with S092 and S048, never remembered);
   - then group 13's Clone in Volume with the row's URL.
   - **The rest is F-0701's and F-0409's:** volume reuse by name, the container by labels, restart, no-op, reconnect
     or switch (BR-4, BR-6), and the stop on switch (F-0417).
3. **The repositories (for the user, via hermes): F-0808 BR-2 names Microsoft's sample repositories**
   (`github.com/Microsoft/vscode-remote-try-<lang>`), and R-31 gives us our own URLs.
   - **(a) Our own sample repositories under `remote-oss`,** one per language. They'd be forked from the MIT-licensed
     originals with attribution, or written fresh. That's a public act and a public identity, so it's the user's call.
   - **(b) Keep Microsoft's repositories as the clone source,** as an R-31 exception the user grants: content from
     public MIT repositories, not a Microsoft service.

   I recommend (a). The table is data either way, so the URLs change without code.
   - **The knock-on:** the volume name hashes the URL (F-0701), so AC-12's example hash follows the chosen URL as a
     reading. The display name and the default branch come from whichever repository is cloned.
4. **Out of scope:** the `vscode://…/cloneInVolume?url=…` link (§15).

## 5. Contracts and the component table

- **`contracts.md`, C14's section, gains:**
  - `configureFeatures({window, configuration}) → written | cancelled | failed`;
  - `editFeatures`, the pure edit;
  - the F-0806 name step, as a stage the volume core's caller drives.
- **C4** gains the subfolder, dotfile, user-data and mirrored forms for F-0807 (the mirrored one with group 9).
- **C3** gains `outdated` on the bridge, log only.
- **`components.md`:** F-0806, F-0807 and F-0808 join C14's features (F-0806's and F-0808's creation halves join C13
  with group 13).
- **Trust and the engine program** (F-0201 AC-55, #1934): every engine program these flows run resolves
  `dev.containers.dockerPath` through `engineBaseOf`, so a relative value names a file of the folder only in a trusted
  window. That covers C2's engine check (F-0806's "+", and the name step's volume listing) and C3's `outdated` and
  `templates apply`, whose `--docker-path` is the same program. F-0807 runs in Restricted Mode (BR-6), which makes
  this binding there.
- **No new runtime dependency.**

## 6. The cut and the cards

| Lines | Where |
|---|---|
| F-0807, and the F-0804 lines cut to it | now, card 1 |
| F-0807 BR-21's mirrored-file lines | group 9 (repository configuration folders) |
| F-0806, and the F-0804/F-0805 lines cut to it | after group 13's volume core, card 2 |
| F-0808 | after group 13's volume core and the user's answer in §4.3, card 3 |
| the Windows, WSL and macOS lines of all three | platform-01 (#1966), by the sweep's rule |

**Suggested cards** (daedalus):
1. **F-0807:** C4's file forms, the C14 flow, `editFeatures` with its table of edit cases (BR-1 to BR-5 and BR-9 to
   BR-18), and the `outdated` log line.
2. **F-0806's own parts:** the hub, the name step, and the hand-off to group 13's volume core.
3. **F-0808's own parts:** the table, the confirmation, and the hand-off to Clone in Volume.

**Measure before asserting**, as containers-41's method says. Where the pinned CLI's `templates apply` or `outdated`
differs from a criterion, the row stops and comes to me.
