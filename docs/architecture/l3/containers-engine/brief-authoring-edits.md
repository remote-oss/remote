# Brief: editing configurations: add an extension, authoring aids, label a port

Owner: athena (architect). Plan: #1807's release-2 families. Specs, all `spec:reviewed`:
- remote-oss/remote-containers#91 (F-0809 Add extension to devcontainer.json);
- #95 (F-0810 devcontainer.json authoring aids);
- #113 (F-1103 Label port and update devcontainer.json).

F-1201 (Install devcontainer CLI) has its own brief. F-0811 (Copilot-assisted configuration) is the user's decision
(§6).

Decisions: D-14, R-26, R-31, R-60, ADR-0003, F-0106 (trust), `brief-attach.md` §5 (C12 owns the attach configuration
files), `brief-logs-and-configuration-file.md` (F-0812's `openDevContainerFile`), `brief-new-container-and-features.md`
(the catalogue and F-0414's diagnostics), #2140 §3 (trust for our diagnostics).

## 1. What a survey found (2026-11-04)

| Family | Built (absence only) | A gap of ours | Elsewhere |
|---|---|---|---|
| F-0809 | 2 | 46 | 3 (WSL; F-0410 recovery; F-0602's named-file command) |
| F-0810 | 3 | 38 (1 unsure) | 2 (`host: windows`) |
| F-1103 | 3 | 19 | 3 (F-0604's fixture; F-0410; F-1302) |

- **What's missing:** none of the three families exists. Nothing in `src` uses `WorkspaceEdit`, `applyEdit` or
  `TextDocument.save`.
- **What's reusable but private:** the JSONC helpers, in `authoring/edit-features.ts`.
- **What only reads:** the attach files (`attach/config-files.ts`).
- **What this means:** most of this brief is four shared seams (§2). The features then sit on top.

## 2. Four shared seams (C14, with C12 for the attach files)

1. **The JSONC writer** (pure, `config/jsonc-edit.ts`):
   - **What moves:** the indentation and line-end detection moves out of `edit-features.ts`.
   - **The operations:** `appendToArray(text, path, value)` and `setProperty(text, path, value)`.
   - **How:** jsonc-parser's `modify` with the file's own formatting. Comments and every untouched key and byte stay,
     and a comma is added where one is needed (F-0809 BR-5).
   - **Users:** `edit-features.ts` moves onto it too, with no behaviour change.
2. **The document-edit seam** `applyConfigurationEdit(file, edits, policy)` is the only code that writes a
   configuration a user may have open:
   - **`buffer`:** the edit goes to the editor model (opened if it isn't) with `workspace.applyEdit` and is never
     saved (F-0809 BR-6, F-0810 BR-11).
   - **`diskUnlessOpen`:**
     - **Open in a tab:** the edit goes to that buffer, which stays unsaved. That's how F-0809 treats an open
       global-storage file or mirror file (BR-4).
     - **Not open:** the file is written on disk, under a temporary name and renamed. This policy is only for our own
       global-storage files and the mirror files.
   - **`diskOrSaveIfClean`** (F-1103's decision Q4):
     - **A dirty tab:** the edit goes to the buffer, which stays unsaved (AC-24).
     - **A clean tab:** the edit goes to the buffer, then `TextDocument.save` runs (AC-25).
     - **No tab:** the document is opened without a tab (`openTextDocument`), edited with `applyEdit` and saved, all
       through the editor. It's never a temporary file and a rename: a rename would replace a symlinked
       `devcontainer.json`, and it would bypass a `vscode-remote` or virtual file system provider.
   - **The result** says when the edit is durable, so a caller's notification can follow it (F-1103 AC-15, AC-25).
3. **The target resolver** (pure over the window's facts, F-0809 BR-7): it gives the file and its policy, checked
   in BR-7's order:
   1. **An attached container:** the applicable attach file.
   2. **The window's own dev container folder:** its configuration file.
   3. **A Recovery Container:** F-0410's session file, on disk.
   4. **Several configurations:** F-0301's picker over them (S303), with any user-data or mirrored candidate among
      them.
   5. **A single user-data or mirrored configuration:** that file.
   6. **A single workspace configuration:** that file.

   **Policies:** workspace-relative files are `buffer`. Global storage and mirror files are `diskUnlessOpen`.

   **Facts:** the resolver reads discovery's facts (`config/discovery.ts`, `candidates.ts`, `stored-candidate.ts`,
   `mirrored-lookup.ts`). It doesn't add a second locator.
4. **The attach-file writer** (C12, which owns the files, `brief-attach.md` §5): `writeAttachConfiguration(target,
   edits)`, where the target is explicit: `{image: <ref>}` or `{name: <container>}`.
   - It writes `imageConfigs/<url-encoded ref>.json` or the per-name file through the JSONC writer, with
     `diskUnlessOpen`.
   - F-0809 passes the applicable file, and F-1103 always passes the image file (§5).

## 3. Add extension to devcontainer.json (F-0809)

- **The command:** `remote-containers.addExtensionToConfig`.
  - It's placed in `extension/context` with `!isBuiltinExtension`, and its Palette `when` is `false` (AC-2, AC-3).
  - It's offered on installed and not-installed rows alike (BR-9; AC-18, AC-22).
  - The argument is the row's extension id.
- **The edit** (BR-1 to BR-5):
  - **Where:** it appends to `customizations.vscode.extensions` if present; else to a top-level `extensions` array;
    else it creates `customizations.vscode.extensions`.
  - **The duplicate check** reads the live buffer when a tab holds the file, else the disk. It reads both arrays and
    matches the id literally, so an opt-out `-<id>` isn't a duplicate (7.E2).
  - **A duplicate** gives S175 and opens nothing. A success gives S174.
- **No trust and no Docker:** it needs no trust and works in a virtual workspace, with no CLI or Docker call (BR-8,
  BR-10).
  - In a virtual workspace, S174's link runs F-0812's command, which refuses there with its own message. The card
    rows that as it is, and it isn't a gap of ours.
- **`(reading-2148-picker-order)`, F-0809 AC-38 and AC-51 with F-0302 §6.3 and §6.4:**
  - **The conflict:** F-0809 lists a user-data or mirrored item first, described by its absolute path. F-0302, the
    owner of the candidate list, orders by absolute path and describes external files `~`-relative, and so does the
    product.
  - **The reading:** the owner's list holds, and so does the shared picker that F-0807 and F-0812 use. AC-38 and
    AC-51 take rows on the target and the write, with the owner's order.
  - **The question** goes to metis.

## 4. Authoring aids (F-0810)

### 4.1 Associations (C1)

- **`contributes.languages`:** `jsonc` for the exact filenames `devcontainer-feature.json` and
  `.devcontainer-internal.json` (BR-1).
- **`contributes.jsonValidation`:** `devcontainer-feature.json` gets the dev container specification project's
  public schema URL that F-0810 §3 names (BR-2 to BR-4). Core fetches it, and only in a trusted workspace (AC-3,
  core's own rule).
  - We bundle or copy nothing, so the user's open schema-licence question (bundling) doesn't apply to it.
  - `.devcontainer-internal.json` gets no schema.

### 4.2 The version lookup and its CodeLenses (C14 over C3)

- **The lookup:** C3's `outdated` over the file.
  - **Other schemes:** for a document that isn't a `file:` one, the lookup runs on a scratch copy, the pattern
    `version-check.ts` already has.
  - **What it gives:** current, wanted and latest per OCI-shaped entry (BR-5).
  - **The lock file:** an existing `devcontainer-lock.json` is read whatever `dev.containers.lockfile` says (BR-8).
  - **Credentials:** the CLI's own Docker configuration and credential helpers (BR-22).
- **The triggers** (BR-15), one pure scheduler with rows:
  - **When:** on open, after a typed edit to a Feature key, and on a revert after such edits. It starts about 0.6
    seconds after a burst's first edit.
  - **When not:** while a lookup runs, nothing more starts. Nothing starts on save, on a CodeLens edit, on an edit
    inside an options object, or on an edit outside `features`.
  - **The log:** each lookup has its log line.
- **The lenses:**
  - **The two version lenses:** S385 when current ≠ latest, and S386 when current ≠ wanted (BR-6, BR-7). Each changes
    only the version substring of the key, in the buffer, through §2's seam with `buffer`, and never saves (BR-11).
  - **No match, no lens:** a lens shows only while the key's text matches the last result.
  - **"Not found...":** an unresolvable entry gets it, with its Remove dialog (BR-17).
  - **Left out:** relative paths, HTTPS tarballs and legacy short ids (BR-16).
  - **Where:** in every location form (BR-18).
- **`(ruling-2148-lookup-trust)`:** registry lookups run only in a trusted workspace.
  - **The spec:** F-0810 PRE-2 needs no trust.
  - **Why:** a lookup asks the registries that the file names, with the user's stored credentials for them (BR-22).
    That would let an untrusted file make the editor contact hosts of its choosing, and core already blocks schema
    downloads in Restricted Mode for the same reason.
  - **In Restricted Mode,** no version lenses appear. The hover, the completions and S294 are unaffected (below).
  - **The paperwork:** a Deviations entry in `release-1-notes.md`, and the question goes to metis.

### 4.3 The hover, the completions and S294

- **The hover and the three completion lists** (Feature ids, option names, option values; BR-9, BR-20, BR-21):
  - **The data:** the public Feature index on `containers.dev`, through `authoring/catalogue.ts`'s fetch. It's a
    fixed host, so it runs in either trust state. It's fetched again each time, with no cache (BR-20).
  - **The order:** values in declared order, booleans `true` then `false`, and names alphabetical without the
    present ones.
- **S294** (BR-10): a diagnostic for an entry in the deprecated namespace.
  - **Where:** it's added to F-0414's existing Features collection, so a file has one Features collection. S294 is
    F-0810's string.
  - **Trust:** it needs no network and shows in either trust state (PRE-4). That fits #2140 §3, whose trust gate is
    for property diagnostics, not this text rule.
  - **Schemes:** F-0414's provider widens from `.devcontainer*` paths and `Uri.file` to every location form and open
    scheme (AC-25, AC-42).
- **`(reading-2148-short-ids)`, F-0810 AC-20 with F-0414:**
  - **The conflict:** AC-20 says legacy short ids get no diagnostic. F-0414, the owner, flags `fish` and `homebrew` as
    legacy Features.
  - **The reading:** F-0414's rule holds. AC-20's row uses `go`, which F-0414 doesn't flag.
  - **The question** goes to metis.

## 5. Label port and update devcontainer.json (F-1103)

- **The command:** `remote-containers.labelPortAndUpdateConfig`.
  - It's placed first in `ports/item/port/inline`, with F-1103 §3's `when` (its window kinds and
    `tunnelType == Forwarded`), and its Palette `when` is `false` (AC-12 to AC-14).
- **The inline editor is core's** (§16): the handler runs core's `remote.tunnel.label` with the row argument.
  - **What comes back:** `{port, label}` for a changed label, or `undefined` for Escape or an unchanged value
    (`[oss] workbench/contrib/remote/browser/tunnelView.ts`, `LabelTunnelAction`). The card pins that return against
    the 1.125 floor with a row.
  - **`undefined`** is the silent no-op of 7.E1 and BR-8. S276 is only for the non-UI entry point that 7.E1 names.
- **The write** (BR-6):
  - **The key:** `portsAttributes.<exact port>.label`, also when a range key covers the port (AC-22).
  - **`(reading-2148-ports-rewrite)`, F-1103 BR-6 and §16 with F-0809 BR-5:** only `portsAttributes`' value is
    rewritten, through the JSONC writer's `setProperty`, in AC-21's key order: number-like keys ascending, then the
    others in their order. Every byte outside it stays. That meets AC-21 and keeps comments, as BR-6 observed, and
    F-0809's minimal edits hold everywhere else. The question goes to metis.
  - **The target:**
    - a dev container: the payload's configuration file, through §2's seam with `diskOrSaveIfClean`;
    - an attached container: **always the image file** (`{image: <ref>}`, BR-4), even when the per-name file
      applies (AC-16).
  - **The notification:** S277 follows only once the write is durable (AC-15, AC-25). Its link runs F-0812's
    `openDevContainerFile`.
  - **The rest:** F-0303's watcher then shows its own notification, which is built. The Ports row shows the label as
    core set it.

## 6. F-0811, Copilot-assisted configuration: the user's decision

- **What the spec says:** F-0811 §16 has a hidden command (Palette `when: false`) that hands the location pick's
  result to `github.copilot.devcontainer.generateDevContainerConfig`, Microsoft's Copilot extension.
- **The problem:** Copilot isn't on Open VSX or VSCodium. The family ruled the same kind of entry out under D-58 (3)
  ("an AI surface we cannot ship"), and F-2606's Copilot entries were settled as not built under F-3907 (D-86).
- **The options,** asked through hermes with this PR:
  1. **Not built,** as F-3907 did. F-0811's absence lines (AC-1, AC-2, AC-9, AC-11) are met, and the rest leave with
     the spec's republication.
  2. **Built as §16 says.** It's harmless without Copilot, because the command is hidden.

  **My recommendation is (1),** for consistency with D-58 (3).

## 7. The cut and the cards

| Lines | Where |
|---|---|
| the absence lines (F-0809 2, F-0810 3, F-1103 3) | rows now, kept true by the `when` clauses (card 6) |
| F-0809 (46) | cards 1 and 2 |
| F-0810 AC-1 to AC-5, AC-12, AC-24, AC-25, AC-42, AC-43 (associations, S294) | card 3 |
| F-0810's lookup, lens, hover and completion lines | card 4 |
| F-1103 (19) | cards 1 and 5 |
| F-0809 AC-30, F-0810 AC-46 and AC-47 (`host: windows`); F-0809 AC-36 and F-1103 AC-18 (F-0410); F-0809 AC-45 (F-0602); F-1103 AC-17 (F-0604), AC-19 (F-1302) | their features' cards |
| F-0811 | §6, the user's decision |

**Suggested cards** (daedalus):
1. **The seams:** §2's JSONC writer, document-edit seam, target resolver and attach-file writer, with
   `edit-features.ts` moved onto the writer.
2. **Add extension:** §3.
3. **Associations and S294:** §4.1 and §4.3's S294.
4. **The lookup, lenses, hover and completions:** §4.2 and §4.3.
5. **Label port:** §5.
6. **Rows** for the absence lines.

**Spec questions for metis** (with this brief's PR):
- `reading-2148-picker-order`;
- `reading-2148-short-ids`;
- `reading-2148-ports-rewrite`;
- `ruling-2148-lookup-trust`.
