# Task card containers-73: the machine-settings writer, and the port attributes in it (F-1101 BR-23, BR-24; F-0506's component)

Containers increment 2, ports. Size: M. Builder: `task:claude`. Design: athena's ports rulings on #1204, ruling 4.
Main has no machine-settings write (F-0506 isn't in release 1), so this card builds **the writer as F-0506's
component**. For now it writes only `remote.portsAttributes` and `remote.otherPortsAttributes`, with BR-23/24's merge
order built in. F-0506 later adds its keys through the same writer, with no second write. It doesn't use
`registerPortAttributesProvider`. Spec: remote-oss/remote-containers#42 (F-1101) BR-3, BR-10, BR-12, BR-23, BR-24.
**Depends on containers-72 (#1232)**, for the `dashed` keys and the shared launch.

## 1. The writer (`src/settings/machine-settings.ts`, new)

```ts
/** The settings this extension writes into the container's machine settings, by key; F-0506 adds keys later. */
export type MachineSettings = Readonly<Record<string, unknown>>;
/** The file's new text: `current` (JSONC or empty) with each key of `settings` set, other keys and comments kept. */
export function machineSettingsText(current: string, settings: MachineSettings): string;
```

- Use `jsonc-parser`'s `modify` and `applyEdits` if the package already depends on it (check how
  `config/configuration-text.ts` reads JSONC). If it doesn't, comment here before adding a dependency.
- **The file:** `<home>/<server data folder>/data/Machine/settings.json` in the container. That's
  `serverDataFolderNameOrDefault(profile)` under the remote user's home, as `connect/server-steps.ts` builds
  `dataFolder`.
- **When:** written over the exec channel before the server starts, in the server steps, beside the relay script's
  install (`installRelayScript`): read the file (missing means empty), compute the text, and write it only when it
  changed.
- A failure logs one line, and the connect goes on.

## 2. The port attributes (`src/ports/port-attributes.ts`)

```ts
export function portAttributeSettings(merged: unknown): MachineSettings;
```

It reads from the merged configuration the connect has (`mergedConfiguration`): the top-level `portsAttributes` and
`otherPortsAttributes`, and `remote.portsAttributes` / `remote.otherPortsAttributes` from every
`customizations.vscode.settings` entry, in the merged order.
- **`remote.portsAttributes`:** start from the top-level `portsAttributes`, leaving out keys that start with `-`
  (7.E6). Then, for each customizations value in order, **each port key it names replaces the entry for that key
  whole** (BR-24: the top-level entry's other sub-properties are dropped). Keys that only one side names are kept.
- **`remote.otherPortsAttributes`:** the last customizations value, **whole**, if any. Otherwise the top-level value
  (BR-24).
- A key with no value on either side is left out of the result. With nothing at all, the result is `{}`, and the
  writer then sets nothing.
- Core merges these machine settings over the user's own `remote.portsAttributes` key by key (BR-23). That's core's
  layering, so nothing is needed here.

## 3. Rows

**Unit:**
- `machine-settings.test.ts`: an empty file, a file with other keys and comments kept, a key replaced, no change
  meaning no write.
- `port-attributes.test.ts`: every rule of §2, named after AC-33, AC-34 and AC-35, plus the dashed key.

**Acceptance** (`tests/acceptance/containers-ports/attributes.test.ts`):

| AC | Case |
|---|---|
| 2 | `{"3000": {"label": "Application", "onAutoForward": "notify"}}` on a declared port: the row reads `Application (3000)` from the connect; a listener changes its icon, tooltip and Running Process, not its label |
| 3 | `otherPortsAttributes {"label": "Other", "onAutoForward": "silent"}`: an undeclared listener is `Other (<port>)`, with no notification |
| 10 | a range key `"40500-40599"`: a port inside it takes that label |
| 17 | exact `"40610"` and range `"40605-40615"`: the exact one wins |
| 21 | two overlapping ranges in either order: the lower start wins. The regex half: the key that matches core's displayed command line |
| 28 | `onAutoForward: "ignore"` with no `forwardPorts` entry: no row for 40 s |
| 33 | the container user's machine settings file holds both keys |
| 34 | against user settings `FromUser`/`UserOnly`/`UserOther`: the rows read `FromDC`, `UserOnly`, `DCOther` |
| 35 | top-level versus `customizations.vscode.settings`: `FromCust`, `CustOnly`, `DCOnly`, and `CustOther` for others |
| 39 | a regex key written with the displayed spaces doesn't match; the one that matches the real argv does |
| 12 | a changed attribute, then a reload without rebuild: no effect; Rebuild: in effect |

AC-7, AC-9, AC-14 and AC-15 (requireLocalPort, elevateIfNeeded, the core-decided reactions, protocol on Open in
Browser): add their rows here too. They pass through core once the settings are written. A row that fails for core's
reasons stays `todo` with a comment.

**Coverage:** each criterion becomes `acceptance` when its row passes.

## 4. Done when

- The unit tests pass, with both new files at 100 %.
- The `containers-ports` and `containers` launches pass. Paste the summary line.
- All gates pass. PR title: `remote-containers: the machine-settings writer, and the port attributes in it (card
  containers-73, #1233)`. Request athena only.
