# Task card explorer-03a: the Remote Explorer manifest, string tables and identifiers (slice 1)

Issue: #629. Release 0.3 (#43), the explorer's slice 1 (brief `brief-remote-explorer.md`, "Slice 1, the first release,
then increments", athena 2026-10-13, 233e3b7). Why: every slice-1 card after this one needs the package's
contributions in place: the view, the slice-1 commands and their menus. Sources: remote-oss/remote-explorer#17
F-5001, #12 F-5002, #7 F-5901, #8 F-5101, #10 F-5103.

Builder: selene if she's free, otherwise iris. The card leaves nothing to decide. Size: about 1 agent-day. Depends on
nothing beyond main. Pattern: `packages/remote-ssh` (manifest, nls files, `identifiers.json`) and
`packages/remote-ssh-edit` (identity test).

The remote-explorer room publishes no identity inventory (no `tests/conformance/` in remote-oss/remote-explorer), so the
tables of section 2 are the source. Every id, title, `when` clause and value below is copied from the issues named in
each row. Copy them from this card, character for character.

**What slice 1 declares:**
- the view `remoteTargets`;
- the three commands slice 1 registers: `remote-explorer.refresh`, `remote-explorer.connectToRemoteInCurrentWindow`
  and `remote-explorer.connectToRemoteInNewWindow`;
- their palette, title and host-row menu entries.

**What it leaves out:**
- "Open SSH Config File", "New Remote", the folder-row commands and the two settings: increment 2 (F-5102's
  hand-overs, F-5104);
- the tunnel commands and their menu entries: out (D-55).

A later increment's card adds its own commands, menus and settings to this manifest and to this card's test.

## 1. Package and file boundary

Under `packages/remote-explorer`:

| File | Change |
|---|---|
| `package.json` | replaced by section 2.1 to 2.4 |
| `package.nls.json` | new, section 2.5 |
| `package.nls.<locale>.json` | new, 14 files (`cs`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `pl`, `pt-br`, `qps-ploc`, `ru`, `tr`, `zh-cn`, `zh-tw`), each with exactly the keys and English values of `package.nls.json` (as remote-ssh ships them today) |
| `identifiers.json` | replaced by section 2.6 |
| `README.md` | only the "For maintainers" table, section 2.7. The rest stays as on main |
| `test/unit/manifest.test.ts` | new, section 3 |

Nothing else may change. There's no `src/extension.ts`, no `main`, no `browser`, no `l10n` field and no `l10n/`
folder: explorer-03b (#630) and explorer-03c (#631) add them. `src/model/*` and its tests stay as they are.

## 2. Contract

### 2.1 Top-level fields (exact, in this order)

| Field | Value | Source |
|---|---|---|
| `name` | `remote-explorer` | F-5901 identity card |
| `displayName` | `Remote Explorer` (literal, never `%displayName%`: the family's D-41 rule, as remote-ssh and remote-ssh-edit) | F-5901 |
| `description` | `%description%` | F-5901 (the project's own wording) |
| `version` | `0.1.0` | |
| `publisher` | `remote-oss` | D-10 |
| `private` | `true` | as remote-ssh |
| `license` | `MIT` | F-5901 |
| `repository` | `{"type": "git", "url": "https://github.com/remote-oss/remote.git", "directory": "packages/remote-explorer"}` (unchanged from main) | family monorepo |
| `bugs` | `{"url": "https://github.com/remote-oss/remote/issues"}` (unchanged from main) | family monorepo |
| `engines` | `{"vscode": "^1.139.0"}` (the root constant; `pnpm check-layout` enforces it) | ADR-0007 |
| `categories` | `["Other"]` | F-5901 |
| `keywords` | `["remote development", "remote", "explorer"]` (unchanged from main: the approved identity card, D-56) | D-56 |
| `extensionKind` | `["ui"]` | F-5001 3.3, F-5901 |
| `capabilities` | `{"untrustedWorkspaces": {"supported": true}}`; no `virtualWorkspaces` key | F-5001 3.3, BR-7, BR-8 |
| `activationEvents` | exactly `["onCommand:remote-internal.setActiveFolders"]` | F-5001 3.1, BR-1, AC-15; F-5902 AC-1 |
| `enabledApiProposals` | exactly `["contribViewsRemote", "extensionsAny"]` | F-5001 3.3; F-5101 §16 |
| `contributes` | sections 2.2 to 2.4 | |

**More on these fields:**
- **No other top-level field:** no `main`, `browser`, `l10n`, `icon`, `extensionPack`, `extensionDependencies` (F-5101
  AC-42), `api` or `scripts`.
- **The `description` value** in `package.nls.json` is the sentence `package.json` carries on main today:
  `Every remote target in one view: SSH hosts, containers and WSL distros, one click away.`
- **The activation event stays in slice 1** although nothing serves or calls `remote-internal.setActiveFolders` before
  increment 2. F-5001 AC-15 (in slice 1) requires it to be the manifest's only declared event. F-5001 AC-11 (the
  command invoked without an argument) is `deferred`, `explorer slice 1: increment 2`.

### 2.2 `contributes.commands` (3, in this order; no `category`, no `enablement`)

| # | `command` | `title` | English title (`package.nls.json`) | `icon` |
|---|---|---|---|---|
| 0 | `remote-explorer.refresh` | `%commands.refresh.title%` | Refresh | `$(refresh)` |
| 1 | `remote-explorer.connectToRemoteInNewWindow` | `%commands.connectToRemoteInNewWindow.title%` | Connect in New Window... | `$(empty-window)` |
| 2 | `remote-explorer.connectToRemoteInCurrentWindow` | `%commands.connectToRemoteInCurrentWindow.title%` | Connect in Current Window... | `$(arrow-right)` |

Sources: F-5002 3.1 and F-5901 §5 (ids, nls keys, titles, icons); F-5101 3.1 (Refresh); F-5103 3.1 (the two connect
commands). The order is the catalogue's (`commandPalette#4`, `#5`, `#6`). The `...` are three full stops, not an
ellipsis character. No `contributes.keybindings` (F-5002 3.1).

### 2.3 `contributes.views`

```json
"views": {
  "remote": [
    {
      "id": "remoteTargets",
      "name": "%views.remote.title%",
      "group": "targets@1",
      "remoteName": ["tunnel", "ssh-remote"]
    }
  ]
}
```

That's F-5101 3.3: no `when`, `icon`, `contextualTitle`, `visibility` or welcome content. The English name is
`Remotes (Tunnels/SSH)`. `remoteName` keeps `tunnel` under D-55: it's an authority name the family shares (D-14), and it
only matters in a tunnel window. There's no `contributes.configuration`, `viewsWelcome` or `viewsContainers`.

### 2.4 `contributes.menus`

**Gating** (register R-77; F-5901 §5 "Coexistence" step 6; the family's lint rule from card tooling-02):
- Every `view/title` and `view/item/context` entry carries `!remote-explorer.standingDown`.
- Where the spec's clause has two `||` alternatives, **each** alternative ends in ` && !remote-explorer.standingDown`,
  because `&&` binds tighter than `||`.
- The `commandPalette` entries keep `when: "false"` without the key (F-5001 BR-11).

Write `K` below as `!remote-explorer.standingDown`.

**`commandPalette`** (3 entries, F-5002 3.3 BR-1): `{"command": <id>, "when": "false"}` for each command of 2.2, in that
order, with no `group`.

**`view/title`** (1 entry, F-5101 3.1): `{"command": "remote-explorer.refresh", "group": "navigation", "when": "view ==
remoteTargets && K"}`.

**`view/item/context`** (4 entries, in this order; the spec's atoms `MENU:view/item/context#8` to `#11`, F-5103 3.1 and
3.3):

| # | `command` | `group` | `when` |
|---|---|---|---|
| 1 | `remote-explorer.connectToRemoteInCurrentWindow` | `inline@1` | `viewItem == remote-explorer.tunnelRemoteTarget && K \|\| viewItem == remote-explorer.sshRemoteTarget && K` |
| 2 | `remote-explorer.connectToRemoteInCurrentWindow` | `navigation@1` | as #1 |
| 3 | `remote-explorer.connectToRemoteInNewWindow` | `inline@2` | as #1 |
| 4 | `remote-explorer.connectToRemoteInNewWindow` | `navigation@2` | as #1 |

(The `\|\|` in the table is `||` in the file.) No other menu.

The clause keeps its tunnel alternative: F-5103 3.1 gives the four placements one shared clause, "viewItem ==
remote-explorer.tunnelRemoteTarget || viewItem == remote-explorer.sshRemoteTarget", and F-5901 §5 keeps every clause
character for character (D-14). No tree element carries the tunnel context value in slice 1, so that alternative never
matches.

### 2.5 `package.nls.json` (exactly these 5 keys, in this order)

| Key | English value |
|---|---|
| `description` | Every remote target in one view: SSH hosts, containers and WSL distros, one click away. |
| `views.remote.title` | Remotes (Tunnels/SSH) |
| `commands.refresh.title` | Refresh |
| `commands.connectToRemoteInNewWindow.title` | Connect in New Window... |
| `commands.connectToRemoteInCurrentWindow.title` | Connect in Current Window... |

The 14 locale files hold the same 5 keys with the same English values.

### 2.6 `identifiers.json` (exact)

```json
{
  "source": "remote-oss/remote-explorer#7 (F-5901)",
  "standsDownFor": "ms-vscode.remote-explorer",
  "standingDownKey": "remote-explorer.standingDown",
  "namespaces": {
    "commands": ["remote-explorer."],
    "settings": ["remote-explorer."],
    "contextKeys": ["remote-explorer."],
    "internalCommands": ["remote-internal."]
  },
  "contextKeys": [{"id": "remote-explorer.standingDown", "setter": "extension"}],
  "infoLineCommands": [],
  "runtimeCommands": [],
  "internal": [
    {"id": "remote-internal.setActiveFolders", "role": "served", "kind": "push"},
    {"id": "remote-internal.getActiveSshRemote", "role": "called", "kind": "query"},
    {"id": "remote-internal.getConfiguredHostnames", "role": "called", "kind": "query"},
    {"id": "remote-internal.openRemoteSshTarget", "role": "called", "kind": "change"},
    {"id": "remote-oss.gate.claim", "role": "called", "kind": "query"}
  ],
  "invented": [
    {"id": "remote-explorer.standingDown", "kind": "contextKeys", "spec": "F-5001", "date": "2026-10-13"}
  ],
  "settingPairs": [],
  "ungated": [],
  "locales": ["cs", "de", "es", "fr", "it", "ja", "ko", "pl", "pt-br", "qps-ploc", "ru", "tr", "zh-cn", "zh-tw"]
}
```

Notes on these entries:
- **`infoLineCommands` is empty.** All three commands are silent out of context. `refresh` never shows the R-46 line
  (F-5002 §19 item 2). For the two connect commands, §19 item 3 allows silence, and silence needs no runtime string.
- **The internal ids** are slice 1's three called ids (the brief's "interface in slice 1", with the kinds of
  `packages/remote-ssh/identifiers.json`), plus the served push whose activation event 2.1 keeps.
- **`remote-oss.gate.claim`** is there because explorer-03b runs the family's proposed-API setup (`contracts.md` §3.4).
- **`remote-internal.sshHostsChanged`** and the two history ids come with increment 2 (section 6, row 2).

### 2.7 README "For maintainers" table

Replace the four rows after "Maintainers" with these (product voice, no ids):

| Row | Value |
|---|---|
| Features | the package manifest: identity, activation event, the view, and the Refresh and connect commands |
| Components | `explorer.package` (manifest, string tables, identifiers); `src/model/` (the SSH group's rows and the connected marker) |
| Allowed imports | none yet |
| Coverage exclusions | none |

## 3. Test table

`test/unit/manifest.test.ts` reads `package.json`, the nls files and `identifiers.json` from the package folder, as
`packages/remote-ssh-edit/test/unit/identity.test.ts` does. Every expected value is written in the test as a literal
copied from section 2. The tests don't read section 2 at run time.

| Cite | Given | Expected |
|---|---|---|
| F-5901.5.identity | the top-level fields | each value of 2.1, compared one by one; the key set is exactly the 2.1 list |
| F-5001.AC-15 | `activationEvents`, `extensionKind`, `capabilities` | deep-equal to 2.1; no `*`, no `onStartupFinished`; no `virtualWorkspaces` key |
| F-5101.3.3 | `enabledApiProposals` | deep-equal to `["contribViewsRemote", "extensionsAny"]` |
| F-5101.AC-42 | `extensionPack`, `extensionDependencies` | both absent |
| F-5002.3.1 | `contributes.commands` | deep-equal to the 3 entries of 2.2, in order; no entry has `category` or `enablement` |
| F-5002.AC-1 | `menus.commandPalette` | 3 entries, the ids of 2.2 in order, each exactly `{command, when: "false"}` |
| F-5101.3.1 | `menus["view/title"]` | exactly the one entry of 2.4 |
| F-5103.3.1 | `menus["view/item/context"]` | deep-equal to the 4 entries of 2.4, in order (with `K` written out) |
| F-5901.5.gating | (each) every `view/title` and `view/item/context` `when` | split on top-level `\|\|`, every alternative ends with ` && !remote-explorer.standingDown` and names the key once |
| F-5002.BR-2 | `contributes` keys | exactly `commands`, `views`, `menus`; `menus` keys exactly `commandPalette`, `view/title`, `view/item/context` |
| F-5101.3.3 | `contributes.views` | deep-equal to 2.3 |
| F-5001.BR-9 | `package.nls.json` | exactly the 5 keys of 2.5 with their values; every `%key%` in `package.json` is one of them |
| F-5001.AC-16 | (each) the 14 `package.nls.<locale>.json` files | exist; each deep-equal to `package.nls.json` |
| F-5901.5.identifiers | `identifiers.json` | deep-equal to 2.6 |

14 rows (an (each) row counts once). Every `it` name starts with its cite.

These must pass as well, with their output pasted in the PR:
- `pnpm identifiers`. The generated table lists 3 commands (each `palette: false`, `policy: 'silent'`), the context
  key, the view `remoteTargets`, the 5 internal ids and `standDown`.
- `pnpm check-identifiers`.
- `pnpm check-string-tables`.
- `pnpm check-public-surface`.
- `pnpm check-layout`.

## 4. Rule for the builder

Tests first. Each row fails before the manifest is written. Copy every value from section 2, and invent no wording.
Names of four characters or more, properties included. No `const` arrow helpers. Comments only where the guide
requires them, none with a feature, rule or decision id (ids may appear in test names). Table loops in tests, and no
duplicated code (jscpd flags five-line clones).

Gates: `pnpm identifiers`, `pnpm check-identifiers`, `pnpm check-string-tables`, `pnpm check-public-surface`,
`pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`,
`pnpm coverage`, `pnpm check-licences`.

## 5. Review

PR title `remote-explorer: the slice-1 manifest, string tables and identifiers (card explorer-03a, #629)`. themis or
triton reviews; athena gives the design check. The description answers R1–R6 and maps each cite to its test name.

## 6. Open rows (stop and report on #629)

1. **Gate problems.** If `pnpm check-identifiers` or `pnpm dead` reports a problem with section 2.6 as written (for
   example a called internal id that nothing uses yet), stop and paste the message. Don't drop or add an entry.
2. **Increment 2's served change signal.** `remote-internal.sshHostsChanged` is served by the explorer (F-5902 §5),
   but the identifier lint requires an `onCommand:` event for every served id, and F-5001 allows only
   `onCommand:remote-internal.setActiveFolders`. Increment 2's inbox card settles this with athena. It's not in this
   card.
3. **Translations.** F-5001 BR-9 and AC-16 ask for the reference's translations. The family ships English in every
   locale file for now, as remote-ssh does. A later localization card replaces the values. Same keys, so no test
   changes but the values row.
4. **Inventory.** If the remote-explorer room publishes `tests/conformance/identity-inventory.json`, a follow-up card
   adds the fidelity test that remote-ssh has (`tools/inventory-fixture.ts`) and checks section 2 against it.
