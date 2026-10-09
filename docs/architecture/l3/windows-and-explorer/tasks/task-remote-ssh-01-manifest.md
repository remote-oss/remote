> Status (2026-10-08, `remote-architect`): DRAFT, not assignable yet. F-3901 gives counts (17 commands, 35 + 1
> settings, 8 menus, 1 authority, 7 activation events, 14 locales) but not the full tables; the data lives across the
> remote-ssh specs. The remote-ssh room publishes its identifier inventory (R-81) as
> `tests/conformance/identity-inventory.json` in remote-oss/remote-ssh: commands (id, title key, category, palette
> flag), settings (key, type, default, scope, description key), menus (id, group, when), context keys, authorities and
> formatters, activation events, remoteHelp URLs, the standing-down key's final name (F-2001). The card then copies
> from that file; the ten open rows below close with it.

# Task card remote-ssh-01: package skeleton and manifest of remote-oss.remote-ssh

Brief: identity decision F-3901 (remote-oss/remote-ssh#78), activation F-2001 (#11), localization F-2002 (#12), settings
and Windows notes F-3908 (#85, adds nothing). Contract: `../contracts.md` §1. Reviewing coder: `remote-coding-worker-1`.
ADR-0007 (engines from the root constant) and ADR-0008 (product voice in every shipped word) apply.
Pattern: `packages/remote-ssh-edit` (manifest, nls, identifiers.json, coverage.json).

## 1. Package and file boundary

Under `packages/remote-ssh`: `package.json` (replace the placeholder), `package.nls.json` and the 14
`package.nls.<locale>.json` files (cs, de, es, fr, it, ja, ko, pl, pt-br, qps-ploc, ru, tr, zh-cn, zh-tw; F-2002 BR-3;
English text in every file for now, same key set), `identifiers.json`, `README.md`, `src/extension.ts`, `coverage.json`,
the existing `tsconfig.json` and `tsconfig.test.json` (keep the pair, add `include` as in `remote-ssh-edit`), manifest
tests under `test/unit/`, and the `packages/remote-ssh` entries in the root `tsconfig.json` references (both the
package and its `tsconfig.test.json`, if not already present). Nothing else. No `l10n` folder and no `l10n` field in
this card (runtime bundles come with the strings that use them).

`README.md`: two paragraphs, product voice only. Paragraph 1: `Work on any machine you can reach over SSH as if the code
were on your own disk.` Paragraph 2: one line, `Part of remote-oss.` plus the family sentence used in the
`remote-ssh-edit` README (copy that sentence; add nothing). No other sections, no coexistence note in this card.

`src/extension.ts`: `export function activate(): void {}` and nothing else (no import of `vscode`, registers nothing),
so `main` resolves. `coverage.json` as in `remote-ssh-edit` (exclude `src/extension.ts` with the same reason).

## 2. Contract

### 2.1 Top-level manifest fields (exact)

| Field | Value |
|---|---|
| `name` | `remote-ssh` |
| `publisher` | `remote-oss` |
| `displayName` | `Remote - SSH` (literal, never `%...%`; D-41) |
| `description` | `%description%`; `package.nls.json` and all 14 locale files: `Work on any machine you can reach over SSH as if the code were on your own disk.` |
| `version` / `private` | `0.1.0` / `true` (as `remote-ssh-edit`) |
| `keywords` | `["remote development", "remote", "ssh"]` |
| `repository` | `{ "type": "git", "url": "https://github.com/remote-oss/remote.git", "directory": "packages/remote-ssh" }` |
| `bugs` | `{ "url": "https://github.com/remote-oss/remote/issues" }` |
| `license` | `MIT` |
| `engines.vscode` | the root constant, `^1.139.0` (ADR-0007; the existing layout check enforces it) |
| `extensionKind` | `["ui"]` |
| `capabilities` | `{ "untrustedWorkspaces": { "supported": true } }`; no `virtualWorkspaces` key |
| `main` | `./dist/extension.js`; no `browser` entry |
| `api` | not declared (the extension exports nothing) |
| `activationEvents` | exactly seven, in this order: `onCommand:remote-internal.getSshFoldersHistory`, `onCommand:remote-internal.deleteSshFolderFromHistory`, `onCommand:remote-internal.getActiveSshRemote`, `onCommand:remote-internal.getConfiguredHostnames`, `onCommand:remote-internal.openRemoteSshTarget`, `onResolveRemoteAuthority:ssh-remote`, `onUri`. No `*`, no `onStartupFinished`, no `onView`, no `onLanguage` (F-2001 §3.3, BR-2, BR-3) |
| `extensionPack` | `["remote-oss.remote-ssh-edit", "remote-oss.remote-explorer"]` |
| `extensionDependencies` | not declared |
| `enabledApiProposals` | exactly four: `resolvers`, `tunnels`, `terminalDataWriteEvent`, `contribRemoteHelp` (declared; the proposed-API gate handles absence) |

### 2.2 `contributes`

Counts below are the issues' counts. Where the issues give the count but not the full list, the card says so and names
the place; the worker takes ids and values only from the issues named there and stops on a mismatch (section 6).

| Group | Content |
|---|---|
| `commands` | 17 entries (F-3901 §2.2, §5). Every entry: `category` `Remote-SSH` (literal), `title` `%commands.<name>.title%` (the nls key names are ours to choose; the resolved English title is the contract; use a plain dot in every key, including the open-window command, F-3901 §5). Ids named in the issues: `opensshremotes.openEmptyWindow` ("Connect to Host..."), `opensshremotes.openEmptyWindowInCurrentWindow` ("Connect Current Window to Host..."), `opensshremotes.openEmptyWindowOnCurrentHost`, `opensshremotes.addNewSshHost`, `opensshremotes.showLog` ("Show Log"), `opensshremotes.showDetails`, `opensshremotes.reportIssue` ("Report Issue...", F-2005 §3.1), `opensshremotes.clearAllSessionHints`, plus a Kill-server command whose title reads "Kill VS Code Server on Host..." (id not given in the issues listed). The issues list 8 ids and 2 more titles; the other ids and titles are in the F-2006 command catalogue (not in this card's sources, section 6 row 1). Only `opensshremotes.clearAllSessionHints` carries `enablement`: `config.remote.SSH.experimental.chat` |
| `configuration` | `title` `Remote - SSH` (literal). 35 reference keys `remote.SSH.*` (F-3901 §2.2, §3, §5; F-3908 §3 confirms the count of 35) plus 1 invented key (below) = 36 declared. The issue lists 35, so none was removed. Keys named in the issues: `allowLocalServerDownload` (deprecated), `configFile`, `connectTimeout`, `defaultExtensions`, `enableAgentForwarding`, `enableDynamicForwarding`, `enableRemoteCommand`, `enableWebAccess` (see section 6 row 5), `experimental.chat`, `experimental.enhancedSessionLogs`, `localServerDownload`, `remotePlatform` (per-host map), `remoteServerListenOnSocket`, `serverInstallPath`, `suppressWindowsSshWarning`, `useLocalServer`, `windowsRemotes` (deprecated). Types, defaults, scopes and description keys (`setting.<name>.description`) of all 35 are in the setting-owning specs, not in the issues of this card's sources (section 6 row 2). No key for the Windows user-privilege question: F-3908 chose no setting |
| `menus` | 8 entries (F-3901 §2.2, §5): `statusBar/remoteIndicator` 2 items, group `remote_20_ssh-remote_1general@1` for `opensshremotes.openEmptyWindow` and `@2` for `opensshremotes.openEmptyWindowInCurrentWindow` (F-2001 §3.3); `commandPalette` 6 items. Each of the 8 `when` clauses is the clause given in the reference data followed by `&& !opensshremotes.standingDown` (stand-down gating ADR draft). The issues say the clauses use the core keys `remoteName`, `remoteConnectionState`, `virtualWorkspace` and `config.remote.SSH.*`, and that the palette list hides commands for contexts; the 6 palette command ids and the 8 clauses themselves are not in the issues (section 6 row 3). No other entry carries the key |
| `resourceLabelFormatters` | 1 entry: scheme `vscode-remote`, authority `ssh-remote+*`, label formatting from the path, separator `/`, home folder shortened to `~` (`tildify` true), `workspaceSuffix` `SSH` (literal, not localized; F-3901 §2.2, F-2002) |
| `remoteHelp` | `remoteName` `ssh-remote`; four roles: get started, feedback, documentation, issues (F-3901 §5). The URLs are ours (R-31) and are not given in the issues (section 6 row 4) |
| `viewsWelcome`, `views`, `keybindings`, `languages`, `chatParticipants` | none. The chat participant stays out of this card (F-3907 decides, section 6 row 6) |
| `authorities` | `ssh-remote` only through the activation event and the label formatter above |

### 2.3 `identifiers.json` (fields of `contracts.md` §1 and `tools/identifier-sources.ts`)

| Field | Value |
|---|---|
| `source` | `remote-oss/remote-ssh#78 (F-3901)` |
| `standsDownFor` | `ms-vscode-remote.remote-ssh` |
| `standingDownKey` | `opensshremotes.standingDown` (F-3901 ledger: "recommended"; F-2001 names it; section 6 row 7) |
| `namespaces` | `commands`: `opensshremotes.`; `settings`: `remote.SSH.`; `contextKeys`: `opensshremotes.`; `internalCommands`: `remote-internal.` |
| `contextKeys` | `[{ "id": "opensshremotes.standingDown", "setter": "extension" }]` (the issue lists no other key of ours; `remoteName`, `remoteConnectionState`, `virtualWorkspace` are core keys and need no row unless the generator asks, then `setter` `core`) |
| `internal` | served by this extension, `role` `served`: `remote-internal.getSshFoldersHistory`, `remote-internal.deleteSshFolderFromHistory`, `remote-internal.getActiveSshRemote`, `remote-internal.getConfiguredHostnames`, `remote-internal.openRemoteSshTarget` (the `kind` of each, query/change/push, is F-5902 §5, section 6 row 8); called: `remote-internal.sshHostsChanged` (served by `remote-oss.remote-explorer`, invented there) |
| `invented` | `remote.SSH.serverDownloadUrlTemplate` (kind `settings`; spec F-2403, declared in F-3902; type string, no default, scope `application`; description key `setting.serverDownloadUrlTemplate.description`); `opensshremotes.standingDown` (kind `contextKeys`; spec F-2001); `remote-internal.sshHostsChanged` (kind `internalCommands`; spec F-2203 calls it, F-3906 interface; declared by remote-explorer, so mark it as called, not as ours, if the generator's ledger rule requires; date of each row: the date of the card's PR) |
| `infoLineCommands` | the commands whose R-46 policy is `infoLine` (F-2006 BR-9; section 6 row 3) |
| `settingPairs`, `ungated` | empty (the issues name no legacy twin pair; `windowsRemotes` is deprecated, not paired) |
| `locales` | the 14 locales above, in that order |

## 3. Test table

| Given | Expected |
|---|---|
| manifest top-level fields | each value of 2.1 compared one by one (`name`, `publisher`, `displayName` literal, `description` `%description%`, `keywords`, `repository`, `bugs`, `license`, `engines.vscode` equals the root constant, `extensionKind`, `capabilities`, `main`) |
| `activationEvents` | deep-equals the seven of 2.1, same order; contains no `*` and no `onStartupFinished` |
| `extensionPack` | deep-equals the two ids; `extensionDependencies` absent |
| `enabledApiProposals` | deep-equals the four, set equality |
| commands | 17 entries; every `category` is `Remote-SSH`; every `title` is a `%key%`; exactly one has `enablement`; its id is `opensshremotes.clearAllSessionHints`; every id begins `opensshremotes.`; no `remote-internal.` id in `contributes.commands` or `menus` |
| settings | 36 keys; 35 begin `remote.SSH.` and are the issue's, plus `remote.SSH.serverDownloadUrlTemplate` (string, no default, scope `application`); every `description` is a `%key%`; configuration `title` literal `Remote - SSH` |
| menus | 8 entries: 2 `statusBar/remoteIndicator` with the groups `remote_20_ssh-remote_1general@1` and `@2`, 6 `commandPalette`; every `when` ends with `&& !opensshremotes.standingDown`; no other contribution mentions the key |
| `resourceLabelFormatters` | one entry; scheme `vscode-remote`, authority `ssh-remote+*`, `separator` `/`, `tildify` true, `workspaceSuffix` `SSH` |
| `remoteHelp` | `remoteName` `ssh-remote`; four URLs, each starting `https://github.com/remote-oss/` and none containing a word of the forbidden list |
| nls parity | every `%key%` of the manifest resolves in `package.nls.json` and in each of the 14 locale files; the 15 files hold the same key set (`pnpm check-string-tables` passes) |
| forbidden words | a test greps `README.md` and every value of the 15 nls files for: reference, Microsoft, ms-vscode, clean-room, reimplement, spec, session, worker, lab, and the patterns `F-[0-9]`, `R-[0-9]`, `D-[0-9]` (none found) |
| README | exactly two paragraphs; the first equals the approved sentence |
| `src/extension.ts` | `activate` exists, returns without registering anything (it imports nothing) |
| `pnpm identifiers` | writes the table for `remote-ssh`; the commands, settings, contextKeys, authorities and invented kinds hold the entries above; `pnpm check-identifiers` passes, including the gated-entry rule (every menu `when` equals the base clause plus `&& !opensshremotes.standingDown`) |
| `pnpm check-layout` | passes (`engines.vscode` equals `^1.139.0`) |

## 4. Rule for the worker

Tests first; each test fails before the manifest is written. Copy every identifier and literal value exactly from the
issues named in the brief (`gh issue view <n> --repo remote-oss/remote-ssh --json title,body`); invent no wording
(titles come from the issues; any title the issues do not give stays an open row, never a guess); no sentence of the
issues is copied into a shipped file. A value missing from the issues stops the card. Full gate list, 100 % coverage,
`coverage:update`. ADR-0003 (no dead code), ADR-0008 (the forbidden-word grep covers everything that ships).

## 5. Gates and review

Run: `pnpm identifiers`, `pnpm check-identifiers`, `pnpm check-string-tables`, `pnpm check-layout`, `pnpm typecheck`,
`pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm coverage`, `pnpm dead`, `pnpm build`, `pnpm check-licences`.
PR title `remote-ssh: package skeleton and manifest (card remote-ssh-01)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

1. **Command list.** The issues name 8 of the 17 ids and 4 titles. The full id and title table is in F-2006 (command
   catalogue), outside this card's sources. Needed from the lead before the worker starts: the 17 ids, the title of each.
2. **Setting schemas.** Type, default, scope and nls key for each of the 35 keys are in the feature specs that own them
   (F-2101, F-2206, F-2403, F-2606 and others), not in F-3901. The issue gives only the count and some keys. Same need.
3. **Menus and the palette list.** The 6 `commandPalette` ids, their base `when` clauses and the 2 indicator clauses are
   not in the issues; the F-2006 catalogue holds them. A `when` that names `config.remote.SSH.enableWebAccess` is kept as
   the issue says (it names a key the manifest does not declare). Clauses that read context keys no code sets yet stay
   as written; the generator does not check them. The `infoLineCommands` list comes from the same place.
4. **Remote help URLs.** The issues say they are ours (R-31) and name the four roles but give no URL. The lead supplies
   them; until then the worker may not invent them.
5. **Typo and undeclared key.** The issues mention `remote.SSH.remotePlatorm` (a misspelling, in one place) next to
   `remote.SSH.remotePlatform`; use only `remotePlatform`. `remote.SSH.enableWebAccess` appears in a `when` clause but is
   not one of the declared 35; the worker confirms the 35 against row 2 and does not add it by guess.
6. **Chat participant.** F-3907 decides whether it exists. `chatParticipants` and the chat strings stay out of this card;
   `remote.SSH.experimental.chat` and `clearAllSessionHints` stay in. If F-3907 removes the setting, the count is 35
   declared and the `enablement` goes with it.
7. **Standing-down key name.** F-3901 only recommends `opensshremotes.standingDown` and leaves the final name to F-2001
   (not yet revised). The card uses the recommendation; a different name from F-2001 changes `identifiers.json`, the
   `when` suffixes and the tests together.
8. **Internal command kinds.** query, change or push for each `remote-internal.*` id is in F-5902 §5, not in the issues.
9. **Proposals.** F-2001 §3.3 lists six proposals including `contribViewsRemote` and `telemetry`; this card uses
   F-3903's four as the brief says (F-3901 says the telemetry proposal is not reproduced). Report if F-3903 differs.
10. **Pack members.** The two ids in `extensionPack` must exist as packages (`remote-ssh-edit` does, `remote-explorer`
    does); no check beyond the string equality here.
