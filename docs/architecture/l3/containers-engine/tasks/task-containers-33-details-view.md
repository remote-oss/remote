# Task card containers-33: the Details (Containers) view, slice C

Issue: #968. Milestone 0.4. Size: M–L. Builder: `task:claude`.

**Design:** athena's ruling on #960 (§1, slice C; card 5), `brief-release-1.md` and `components.md` as amended in
#961. **Builds after** containers-30 (#963: the adapter pattern, `heldConnection()`, the stand-down rule) and
containers-31 (#964: the events source).

Sources: F-0903 (remote-oss/remote-containers#94) §3.1, §3.3, §3.4, 5.0, 6.4, 7.E1, 7.E2, 7.E8, BR-1 to BR-3, BR-6,
BR-9, BR-10, BR-12, §16.

**In 0.4:** the view `detailsContainers`, its dynamic title, the read-only tree (Name, Image, Configuration, Mounts),
the key `remote-containers:showDetails`, and the Refresh and Rebuild toolbar icons. The section shows the window's own
container.

**Not in 0.4 (#960):**
- Show Details on another container (`#24`) comes with slice B, with BR-10's single slot;
- the Attach in New Window and Open Container Configuration File icons (`#5`, `#7`), and the Configuration row's
  menu (`#27`);
- Inspect on Image and Volume rows (`#28`), which is slice B's command;
- the origin rows "Workspace" and "Repository" (F-0801, F-0701);
- the mount-performance row (`#29`, F-0708, Windows only);
- X11 (S413), S111 and S269, which are untriggered strings.

## 1. The change (`packages/remote-containers/src/explorer/`)

### 1.1 The model (`details-model.ts`, pure)

```ts
export interface ShownContainer {
  id: string;
  name: string;                 // with Docker's leading '/' (BR-7, S229's row shows it so)
  image: string;                // Config.Image, the creation reference (BR-12, AC-36)
  labels: Readonly<Record<string, string>>;
  mounts: ReadonlyArray<{type: 'volume'; name: string; destination: string} | {type: 'bind'; source: string; destination: string}>;
}
export interface DetailsRow { id: string; label: string; description: string; viewItem: string | undefined; children: readonly DetailsRow[] }
export interface DetailsTree { title: string; sections: readonly DetailsRow[] }
/** The container of `docker inspect`'s one-element array, or undefined (Mounts in the order Docker lists them). */
export function shownContainerOf(stdout: string): ShownContainer | undefined;
export function detailsTreeOf(shown: ShownContainer, translate: Translate): DetailsTree;
```

- **The title (BR-1, BR-12):** the last segment of `devcontainer.local_folder` (containers-29's folder-label rule,
  exported from `labels.ts`), else the last path segment of `vsch.local.repository` without `.git`, else the image
  reference.
- **Attributes (S043):** Name (S229), Image (S202), then Configuration (S080). Configuration is there if and only if
  `devcontainer.config_file` is, with the label's value as written, as a bare path (BR-2, BR-3).
- **Mounts (S228):** every `volume` mount as a "Volume mount" row (S396), with children "Volume" (S393, the name) and
  "Destination" (S109), then every `bind` mount as a "Bind mount" row (S045), with children "Source" (S330) and
  "Destination". Each group keeps Docker's order. Docker doesn't list tmpfs, so it gets no row (AC-34).
- **Empty sections are omitted** (BR-9, AC-10).
- **`viewItem`:** `image` on the Image row, `volume` on each Volume row and `devContainer` on the Configuration row
  (F-0903 §3.3, verbatim: slice B's `#28` and a later `#27` match them). Every other row has none.
- **Ids:** `attributes` and `mounts` for the sections. A row's id is its section plus its position and kind, stable for
  the same inspect data.
- **The strings:** `DETAILS_TEMPLATES` with S043, S045, S080, S109, S110, S202, S228, S229, S330, S393 and S396,
  verbatim from §3.4, in the l10n bundles.

### 1.2 The adapter (`details-view.ts`; wired in `extension.ts`)

- **The focus check**, as containers-30: create the tree view only when `detailsContainers.focus` exists.
- **What it shows:** the held connection's container (`heldConnection()`), read through C2 with
  `docker inspect --type container <id>` on the held engine. Without a held connection it shows nothing and the key
  is false.
- **The key:** `setContext('remote-containers:showDetails', true)` while a connection is held, false otherwise.
  Add it to `identifiers.json` with setter `extension`, verbatim.
- **The title:** `treeView.title` is the model's title. With nothing to show, set it to `undefined`, so core shows
  the registered S110 (6.4, BR-6).
- **When it reads:** when the view becomes visible, when C10 connects or reconnects (6.4, AC-8), on Refresh, and on a
  container event about the shown id while the view is visible. For the last, subscribe to containers-31's events
  source. If that source runs only while the targets view is visible, extend it to run while any subscriber's view
  is visible, and add a row for that (BR-6: the own container follows by itself).
- **One update per read**, as containers-30: the previous tree stays until the new one is ready.
- **Refresh** (`remote-containers.explorerDetailsRefresh`) re-reads by id:
  - if the container is gone: zero rows, the title back to S110, no notification (7.E1, AC-29);
  - outside its context (a keybinding with no section): it reads at most, and never creates, changes or removes
    anything (7.E8, AC-35).

### 1.3 The manifest

- **`views.remote`:** F-0903 §3.3's row verbatim. Id `detailsContainers`, name S110 (nls), group `details@1`, `when`
  `!hideConnectCommands && remote-containers:showDetails`, `remoteName` `["dev-container", "attached-container"]`.
  No stand-down clause on the view (#960 §3).
- **The command** `remote-containers.explorerDetailsRefresh`: title `Refresh`, category `Dev Containers`, icon
  `resources/light|dark/refresh.svg` (containers-30's). `commandPalette` `when: "false"`.
- **`menus["view/title"]`**, group `navigation`, in this order on screen (F-0903 §3.3's toolbar without `#5` and
  `#7`):
  - `#6` `remote-containers.rebuildContainer`, `when` `!hideRebuildCommands && view == detailsContainers &&
    remoteName == dev-container && !remote-containers:standingDown`. Give the command's contribution the icon
    `resources/light|dark/tools.svg`, the package's own art;
  - `#4` Refresh, `when` `view == detailsContainers && !remote-containers:standingDown`.

## 2. Rows

### 2.1 Unit

- `details-model.test.ts`:
  - AC-1's shape: title, Attributes and Mounts for a bind-mounted dev container with the `vscode` volume;
  - BR-1's three title sources;
  - BR-2 and BR-3, and AC-33 (each label on its own);
  - AC-10 (no mounts, no section);
  - AC-34 (an anonymous and a named volume, and no tmpfs row);
  - AC-36 (the image as created);
  - AC-14 (no mount-performance row);
  - `shownContainerOf` over a recorded inspect fixture, and over non-JSON.
- `details-view.test.ts`:
  - no `.focus`, no view;
  - the key and the title with and without a connection;
  - Refresh of a removed container: zero rows and an `undefined` title (AC-29);
  - Refresh with no section: one read at most, nothing else (AC-35);
  - a reconnect reads again (AC-8);
  - an event about the shown id reads again, and one about another id doesn't.
- The manifest test: the view row, the two toolbar entries in order with their `when`s, `commandPalette` `false`, and
  the stand-down clause on the menus but not the view.

### 2.2 Acceptance (the `containers` launch; renderer helpers beside containers-30's)

| # | Rows |
|---|---|
| Gate 19 | in a dev container window (a reopened folder, as gate row 1 makes it), "View: Show Remote Explorer": a section titled with the folder's name shows Attributes with Name (`/<container name>`), Image and Configuration (`<folder>/.devcontainer/devcontainer.json`), and Mounts with the workspace's Bind mount (Source `<folder>`, Destination `/workspaces/<folder name>`) (F-0903 AC-1) |
| AC-30 | the same window, Refresh in the section's toolbar: the title and rows stay, no notification appears, and `docker ps -a` and `docker volume ls` are unchanged (F-0903 AC-30). AC-29 (a removed container) has a unit row only: in 0.4 the section shows the window's own container, which can't be removed while the window stays usable |

## 3. Gates, review and open rows

Run all gates and the containers launch. PR title: `remote-containers: the Details (Containers) view (card
containers-33, #968)`. Request athena only.

**Open rows (stop and report on #968):**
1. Setting `treeView.title` to `undefined` doesn't bring back the registered name.
2. Docker lists a mount type other than `volume` and `bind` for a 0.4 dev container.
