# Task card containers-16: the configuration's extensions installed in the container (F-0505)

Issue: #894. Milestone 0.4, increment 1b. Gate row 12 (brief-release-1 §5). Size: S–M. Builder: `task:claude`.

Sources:
- F-0505 (remote-oss/remote-containers#37): 3.2, 5.0, 6.1 to 6.5, 7.E1 to 7.E4, BR-1 to BR-12, §16;
- containers-08 (C10: its §3.2 steps 6 and 7, and §3.5's `defaultExtensions: []`, which this card replaces);
- containers-06 (C7's `created`);
- containers-11 (#892, the `onStartupFinished` activation, for §3.4).

**Build after** containers-08 and containers-11 are on main.

## 1. What release 1 builds, and what it leaves

**Builds:**
- **The effective list** (BR-1, BR-2, BR-3). The sources are:
  - each layer of the merged configuration's `customizations.vscode`, image metadata first and the folder's own
    configuration last;
  - then `dev.containers.defaultExtensions`, or its deprecated fallback (BR-6).
- **The list goes to the server only when C7 created the container** (BR-11). That covers a first open and a rebuild,
  but not a restart or a reload.
- **The setting's contribution** (3.2), and the deprecated one's.
- **BR-12's move** of `dev.containers.defaultExtensionsIfInstalledLocally` into core's
  `remote.defaultExtensionsIfInstalledLocally` at activation.

**Left:**
- the devcontainer.json schema and its Problems entries (AC-16): release 1 contributes no `jsonValidation` (brief
  ruling 8, as F-0412 AC-44);
- the attach, Kubernetes, Compose and clone flows (AC-22, AC-36), which are later families;
- Windows (AC-37);
- the `vscode` volume's extension cache (F-0419's second half, increment 2).

**VS Code core's parts:**
- the installs, the per-id failures and the client's retry (BR-5, BR-13);
- the Extensions view (AC-33);
- the local certificates (BR-14), which come from the server's `--use-host-proxy`. containers-08 already passes it,
  through the containers policy row.

## 2. What was measured (on this card's draft)

1. **The merged configuration carries every source but the setting.** For a folder whose configuration has
   `"extensions": ["top.level@1.0.0"]` and `"customizations": {"vscode": {"extensions": ["a.one", "-b.two",
   "c.three@prerelease"]}}`, `read-configuration --include-merged-configuration` gave
   `mergedConfiguration.customizations` = `{"vscode": [{"extensions": ["a.one", "-b.two", "c.three@prerelease",
   "top.level@1.0.0"]}]}`.
   - `vscode` is an array of layers, one per metadata entry, and the configuration's own is last.
   - The CLI has already moved the top-level `extensions` behind `customizations.vscode.extensions`, which is BR-1's
     (b)-then-(c) order. So the card reads only `customizations.vscode[*].extensions`.
2. **C10 already makes this read.** containers-08 §3.2 step 6 calls `readConfiguration(target, containerId, …)`
   after `up`, for the title. C3 passes `--include-merged-configuration` (containers-04 §3.1), and its
   `ConfigurationResult.mergedConfiguration` is on main (`cli-lines.ts`). Step 6 comes before the server's start
   (step 7), so the list is ready in time, with no second CLI run.
3. **The real server installs from its gallery.** The pinned VSCodium server 1.135.06055 names Open VSX in its
   `product.json` `extensionsGallery`.
   - Run as `codium-server --install-extension dracula-theme.theme-dracula`, it installed v2.25.1 in a few seconds.
   - Run with `--start-server` and `--install-extension`, it logged `Installing extensions...` and installed nothing
     in 120 s, both on this machine and inside a `debian:12` container.
   - So with `--start-server` the install most likely waits for a client connection. In gate row 12 a window
     connects; §6 row 1 is the stop if it still doesn't install.

## 3. The design

### 3.1 The list (`src/extensions/extension-list.ts`, pure)

```ts
/** The `extensions` of each `customizations.vscode` layer, in order; anything that isn't a string is skipped. */
export function configurationEntries(mergedConfiguration: Record<string, unknown> | undefined): string[];
/** BR-6: the new key when the user set it at all, even to [], else the deprecated key, else nothing. */
export function settingEntries(primary: unknown, deprecated: unknown): string[];
/** BR-2 and BR-3: one rule, front to back. */
export function effectiveExtensions(entries: readonly string[]): string[];
```

- **`configurationEntries`:** `mergedConfiguration?.customizations` must be an object; its `vscode` an array. Each
  element that's an object with an `extensions` array gives that array's strings, in order. Everything else gives
  nothing.
- **`settingEntries(primary, deprecated)`:** the two values are each key's user (global) value as
  `inspect(key)?.globalValue` gives it, `undefined` when unset.
  - When `primary !== undefined`, use it, even `[]` (BR-6: "even when the new key is an empty array").
  - Otherwise use `deprecated`.
  - The chosen value must be an array, and only its strings count. A non-array gives `[]`.
- **`effectiveExtensions`:** start with an empty list. For each entry in order:
  - its id is the text before the first `@` (the whole text when there's none), after the leading `-` for a removal;
  - **a removal** (`-…`) drops every entry already in the list with the same id, compared case-sensitively (BR-3),
    and adds nothing;
  - **an addition** drops every entry already in the list with the same id, then appends itself as written, suffix
    included (BR-2, BR-4).
  - Nothing is validated (BR-7): `not-an-id` and unpublished versions pass through, and the server skips them
    (BR-5).

### 3.2 C10 hands it to the server (containers-08's `connector.ts` and `server-steps.ts`)

1. **Step 6 (the identity)** keeps its result's `mergedConfiguration`. When the read fails, containers-08 already
   logs one warn line, and the configuration part of the list is then `[]`.
2. **Before step 7**, when C7's outcome has `created: true`:
   - `list = effectiveExtensions([...configurationEntries(merged), ...settingEntries(settings.defaultExtensions(),
     settings.deprecatedDefaultExtensions())])`;
   - log at info `extensions to install in the new container: <ids, comma-separated>`, or `no extensions to install`
     for an empty list (5.0 step 4);
   - pass it as the start's `defaultExtensions` (containers-08 §3.5). lib-server's start body turns each entry into
     `--install-extension <entry>`, as it does for remote-ssh.
3. **When `created` is false** (a restart, a reload or a reconnection), `defaultExtensions` stays `[]`, there's no log
   line, and no `installExtensions` call is made, so nothing is installed or removed (BR-11, AC-14).
4. **The settings are read at the connect** (6.4 step 8): two functions on C10's `settings` dependency, wired to
   `workspace.getConfiguration().inspect('dev.containers.defaultExtensions')?.globalValue` and the same for
   `remote.containers.defaultExtensions`.
5. **R-26:** extension ids aren't secrets. The list goes in argv and in the log as written.

### 3.3 The contribution (F-0505 3.2, F-1406)

In `package.json` `contributes.configuration`, with the titles and texts reused verbatim (D-14):
- **`dev.containers.defaultExtensions`:**
  - `type: "array"`, `default: []`, `scope: "application"`;
  - `items: {type: "string", pattern: "([a-z0-9A-Z][a-z0-9-A-Z]*)\\.([a-z0-9A-Z][a-z0-9-A-Z]*)", errorMessage:
    "Expected format '${publisher}.${name}'. Example: 'vscode.csharp'."}`. The pattern is unanchored, as 3.2
    observes, so `-id` and `id@prerelease` get no warning;
  - `description`: `Configures the list of extensions to always install while creating a container.`
- **`remote.containers.defaultExtensions`** has F-0102 3.2's shape for a legacy key, and nothing else (no `type`,
  `default`, `items` or description):
  - `scope: "application"`;
  - `deprecationMessage`: `Use 'dev.containers.defaultExtensions' instead.`;
  - `markdownDeprecationMessage`: ``Use `#dev.containers.defaultExtensions#` instead.``

Both go through `package.nls*.json` like the package's other texts. The manifest test checks them.

### 3.4 BR-12's move at activation (`src/extensions/install-if-local.ts`; needs containers-11's `onStartupFinished`)

At activation, after the stand-down guard, in every window:
1. `old = inspect('dev.containers.defaultExtensionsIfInstalledLocally')?.globalValue`. When it's `undefined`, do
   nothing.
2. `existing = inspect('remote.defaultExtensionsIfInstalledLocally')?.globalValue`.
3. `merged = mergeInstallIfLocal(existing, old)`, a pure function:
   - `existing`'s strings first (none when it isn't an array);
   - then `old`'s strings that aren't already in it, case-sensitive and in order.
   - An `old` of `[]` with no `existing` gives `[]` (BR-12: it replaces the product default).
4. `update('remote.defaultExtensionsIfInstalledLocally', merged, ConfigurationTarget.Global)`, then
   `update('dev.containers.defaultExtensionsIfInstalledLocally', undefined, ConfigurationTarget.Global)`.
   - The order matters: the old key is removed only after the new one is written.
   - A failure is logged at warn, and the activation goes on.

The old key isn't contributed (3.2: the reference doesn't declare it either). Reading an undeclared key works through
`inspect`.

## 4. Rows

### 4.1 `extension-list.test.ts` (pure)

| Name | Given | Expected |
|---|---|---|
| `F-0505 BR-1: the layers in order, then the setting` | layers `[{extensions:['img.a']}, {extensions:['cfg.b']}]`, setting `['set.c']` | `['img.a','cfg.b','set.c']` |
| `F-0505 6.1, AC-4: -id removes the image's id` | `['img.a']`, then `['-img.a']` | `[]` |
| `F-0505 6.4 step 3, AC-6: -id in the configuration doesn't remove the setting's later id` | config `['-x.y']`, setting `['x.y']` | `['x.y']` |
| `F-0505 AC-7: -id in the setting removes earlier ones` | config `['x.y']`, setting `['-x.y']` | `[]` |
| `F-0505 7.E3, AC-10: the last occurrence wins, with its suffix` | `['x.y@1','x.y@2']` | `['x.y@2']` |
| `F-0505 AC-17: -X then X@v installs X@v` | image `['x.y']`, config `['-x.y','x.y@3']` | `['x.y@3']` |
| `F-0505 AC-24: X@v then -X installs nothing` | `['x.y@1','-x.y']` | `[]` |
| `F-0505 AC-29: the later source's pin wins, and moves to the end` | `['x.y@4.9.3','z.w','x.y@3.0.1']` | `['z.w','x.y@3.0.1']` |
| `F-0505 BR-3, AC-30: removal is case-sensitive` | image `['dbaeumer.vscode-eslint']`, config `['-DBAEUMER.vscode-eslint']` | `['dbaeumer.vscode-eslint']` |
| `F-0505 BR-3, AC-31: a version on a removal is ignored` | image `['d.e']`, config `['-d.e@3.0.34']` | `[]` |
| `F-0505 BR-3, AC-32: other case is another entry` | image `['d.e']`, config `['D.E@3']` | `['d.e','D.E@3']` |
| `F-0505 AC-18: a removal of an unlisted id does nothing` | `['-q.r','a.b']` | `['a.b']` |
| `F-0505 BR-7, AC-11, AC-12: nothing is validated` | `['not-an-id','a.b@0.0.1']` | both, as written |
| `F-0505 BR-10: no sources give an empty list` | no layers, no setting | `[]` |
| `contracts: anything but string entries and object layers is skipped` | `customizations: {vscode: [1, {extensions: ['a.b', 2]}, 'x']}` | `['a.b']` |
| `contracts: a missing or malformed customizations gives nothing` | `undefined`; `{customizations: []}`; `{customizations: {vscode: {}}}` | `[]` each |
| `F-0505 BR-6, AC-27: the deprecated setting when the new one is unset` | `settingEntries(undefined, ['x.y'])` | `['x.y']` |
| `F-0505 BR-6, AC-28: the new setting wins, even when it's []` | `settingEntries([], ['x.y'])`; `settingEntries(['y.z'], ['x.y'])` | `[]`; `['y.z']` |
| `contracts: a non-array setting gives nothing` | `settingEntries('x.y', undefined)` | `[]` |

### 4.2 `install-if-local.test.ts`

| Name | Expected |
|---|---|
| `F-0505 BR-12, AC-19: the old key moves into the core key` | old `['A']`, core unset: core `['A']` is written, then the old key is removed, in that order |
| `F-0505 BR-12, AC-20: existing ids first, no duplicates` | core `['P','A']`, old `['A','B']`: `['P','A','B']` |
| `F-0505 BR-12: an old [] with no core key writes []` | `[]` |
| `F-0505 BR-12: no old key does nothing` | no `update` |
| `contracts: a failed write is logged and the old key stays` | the first `update` rejects: one warn line; no second `update` |

### 4.3 The connector (containers-08's `connector.test.ts` and `server-steps.test.ts`)

| Name | Expected |
|---|---|
| `F-0505 5.0 step 5: a new container's start carries the effective list` | `created: true`, merged `['a.b']`, setting `['c.d']`: the start's `defaultExtensions` is `['a.b','c.d']`; the info line names both |
| `F-0505 BR-11, AC-14: a reused container installs nothing` | `created: false`: `defaultExtensions` `[]`; no `installExtensions` call; no list line |
| `F-0505 BR-10: an empty list says so` | `created: true`, no sources: `[]` and the line `no extensions to install` |
| `F-0504 BR-2 with F-0505: a failed identity read keeps the setting's ids` | `readConfiguration` fails: `defaultExtensions` is the setting's list |
| `F-0505 6.4 step 8: the settings are read at each connect` | two connects with the setting changed between them use the new value |

### 4.4 The manifest test

`dev.containers.defaultExtensions` with its `type`, `default`, `scope`, `items.pattern`, `errorMessage` and
`description`, and `remote.containers.defaultExtensions` with exactly `scope`, `deprecationMessage` and
`markdownDeprecationMessage`, read from `package.json` and the English nls file.

### 4.5 Gate row 12 (`tests/acceptance/containers/gate.test.ts`, containers-09's launch)

| # | Steps | Assertions |
|---|---|---|
| 12 | Write folder `gate-extensions`, an image configuration (containers-09 §4.1) with `"customizations": {"vscode": {"extensions": ["dracula-theme.theme-dracula", "not-an-id"]}}`. Open its window and `reopenInContainer('gate-extensions')` until connected | **Within 90 s** (BR-8: the window doesn't wait for it), `docker exec <id> ls <the remote user's home>/<the server's data folder>/extensions` lists one folder whose name starts with `dracula-theme.theme-dracula-`. The data folder is the product's `serverDataFolderName` from the run's server `product.json`, read in the test, not written in. The window reached its connected title before the folder existed or at the same time (record both times). No notification of ours is open (BR-5, AC-12's `not-an-id`) |

- The source is the run's own server gallery, Open VSX, over the network. CI runners already reach the network for the
  server archive. `dracula-theme.theme-dracula` is a theme only: no code and a few hundred kB.
- If the runner can't reach Open VSX, the row fails, naming the gallery URL; it isn't skipped.

## 5. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

- **`acceptance`, through row 12:** F-0505 AC-1 (a plain id installs), AC-12 (`not-an-id` beside a valid id), AC-34
  (not blocking) and brief §5 gate row 12.
- **`unit`, through §4.1 to §4.4:** AC-4, AC-6, AC-7, AC-10, AC-14, AC-17, AC-18, AC-19, AC-20, AC-24, AC-25 (through
  the CLI's measured move of the top-level `extensions` and the rule), AC-27, AC-28, AC-29, AC-30, AC-31 and AC-32.
- **`todo`:**
  - AC-2, AC-3 and AC-11: the server's own version and pre-release handling. Proven only by an install from a
    gallery, so a later row card;
  - AC-5, AC-8, AC-9, AC-13 and AC-15: their install halves, by the same later card. Their list halves are proven by
    §4.1's rows, as this list shows.
- **`deferred`, with the brief's reasons:**
  - AC-16: no schema in release 1;
  - AC-22 and AC-36: later families;
  - AC-37: Windows;
  - AC-33, AC-35 and AC-38: core's surfaces and certificates. Mark them `core` with the reason, as the seed does for
    core's halves.
  - AC-21: the shared cache is increment 2.

## 6. Open rows (stop and report on #894)

1. **Gate row 12 installs nothing within 90 s** with the window connected: report the server log's lines after
   `Installing extensions...`, from `<data folder>/data/logs`. That would mean `--start-server` with
   `--install-extension` needs something more than a client (§2 item 3), and the fix belongs with lib-server's start,
   which remote-ssh shares.
2. **The CLI's merged configuration differs from §2 item 1** on the runner, for example the top-level `extensions` not
   moved: report it, and don't add a second read of the raw configuration without athena.

## 7. Gates and review

Run all gates and the VSCodium run. The PR title is `remote-containers: the configuration's extensions are installed
in a new container (card containers-16, #894)`. Request athena only; hermes assigns the peer.
