# Task card containers-01: the Dev Containers package shell (manifest, stand-down, proposed-API setup, log)

Issue: #759. Remote - Containers release 1, slice 1, component C1 package-shell (`components.md` §1;
`brief-release-1.md` rulings 7, 8 and 9; milestone 0.4, as containers-02 (#757)). Why: every later component card
registers through this package's activation. C2 adds its setting, C6 its commands, C10 its resolver. None of them can
start without the package's manifest and its activation order:
- the stand-down guard first;
- then the family's proposed-API setup;
- then the log channel and the registrations.

Sources: remote-oss/remote-containers#19 F-0101 (BR-4, BR-7, BR-8, BR-9, BR-10, 3.4, 7.E4), #107 F-1406 (§5),
#38 F-1401 (§5, D-41 identity card), #39 F-1403 (§6 "Texts").

Builder: hestia. Size: about 2 agent-days. Depends on nothing beyond main. Patterns:
- `packages/remote-explorer`: explorer-03a's manifest test and explorer-03b's activation;
- `packages/remote-ssh/src/activation.ts`: the log channel opened after the guard, the setup's missing proposals logged.

Design check: athena (section 9, row 1).

**What this card declares:** the identity, the one activation event, the capabilities and the seven proposals.
**What it doesn't:** commands, settings, menus, views. Each later card adds its own (section 2.3).

## 1. Package and file boundary

Under `packages/remote-containers`:

| File | Change |
|---|---|
| `package.json` | replaced by section 2.1 |
| `package.nls.json` and the 14 `package.nls.<locale>.json` (`cs`, `de`, `es`, `fr`, `it`, `ja`, `ko`, `pl`, `pt-br`, `qps-ploc`, `ru`, `tr`, `zh-cn`, `zh-tw`) | new, section 2.2; every locale file holds the same keys with the English values |
| `identifiers.json` | new, section 2.4; then `pnpm identifiers` writes `src/identifiers.generated.ts` |
| `src/activation.ts` | new, section 3 |
| `src/extension.ts` | new, section 4 (the desktop entry, coverage-excluded) |
| `l10n/bundle.l10n.json` and the 14 `bundle.l10n.<locale>.json` | new, section 4.2 |
| `test/unit/manifest.test.ts`, `test/unit/activation.test.ts` | new, section 5 |
| `tsconfig.json` | `references` to `../lib-authority`, `../lib-identifiers`, `../lib-log`, `../lib-product` and `../lib-standdown`, as remote-explorer's |
| `.vscodeignore` | new: `**`, `!package.json`, `!package.nls*.json`, `!l10n/**`, `!dist/extension.js`, one per line |
| `coverage.json` | new: `{"exclude": {"src/extension.ts": "loads the editor"}, "ratchet": {"lines": 100, "branches": 100, "functions": 100}}` |
| `README.md` | only the "For maintainers" table, section 2.5 |
| `packages/lib-authority/src/gate/probe.ts` | `ProposalName` gains `'workspaceTrust'`, `'terminalDimensions'` and `'contribEditSessions'` (section 3.3) |
| `packages/lib-authority/test/unit/gate-probe.test.ts` | the section 3.3 row |
| `packages/lib-log/src/sinks/channel-sink.ts` | only if needed, section 3.4 |
| `pnpm-lock.yaml` | as `pnpm install` writes it |

Nothing else may change. remote-ssh and remote-explorer pass unchanged.

## 2. The manifest

### 2.1 `package.json` (exact, in this order)

| Field | Value | Source |
|---|---|---|
| `name` | `remote-containers` | F-1406 §5 (id `remote-oss.remote-containers`) |
| `displayName` | `Dev Containers` (literal, never `%displayName%`: D-41, as the family's other packages) | F-1401 §5, D-41 |
| `description` | `%description%` | D-41: our own words |
| `version` | `0.1.0` | |
| `publisher` | `remote-oss` | D-10 |
| `private` | `true` | as remote-ssh |
| `license` | `MIT` | F-1401 §5 |
| `repository` | `{"type": "git", "url": "https://github.com/remote-oss/remote.git", "directory": "packages/remote-containers"}` (unchanged from main) | F-1401 §5 |
| `bugs` | `{"url": "https://github.com/remote-oss/remote/issues"}` (unchanged) | F-1401 §5 |
| `engines` | `{"vscode": "^1.139.0"}` (the root constant; `pnpm check-layout` enforces it) | ADR-0007 |
| `categories` | `["Other"]` | the maintainers' choice (F-1401 §5) |
| `main` | `./dist/extension.js` | |
| `keywords` | `["remote development", "remote", "containers", "docker", "devcontainer"]` (unchanged from main) | |
| `extensionKind` | `["ui"]` | F-0101 BR-3 |
| `capabilities` | `{"virtualWorkspaces": true, "untrustedWorkspaces": {"supported": "limited", "description": "%capabilities.untrustedWorkspaces.description%"}}` | F-0101 BR-7, 7.E4, 3.3 |
| `activationEvents` | exactly `["onResolveRemoteAuthority:dev-container"]` | brief ruling 8 |
| `enabledApiProposals` | exactly `["resolvers", "tunnels", "workspaceTrust", "terminalDimensions", "contribEditSessions", "contribViewsRemote", "contribRemoteHelp"]`, in this order | F-0101 BR-8; brief ruling 8 ("the seven proposals are all declared") |
| `l10n` | `./l10n` | |
| `dependencies` | `lib-authority`, `lib-identifiers`, `lib-log`, `lib-product`, `lib-standdown`, each `workspace:*` | |

**More on these fields:**
- **No other top-level field:** no `contributes`, `browser`, `icon`, `extensionPack`, `extensionDependencies`, `api`
  or `scripts`. There's no `browser` entry because the package is desktop-only: it drives a local Docker CLI.
- **The activation event:** release 1 declares only `onResolveRemoteAuthority:dev-container`.
  - Each command a later card contributes activates the package through the editor's implicit `onCommand:` event.
    No card adds an `onCommand:` entry by hand.
  - `onStartupFinished` and the `workspaceContains` events serve the reopen notification (F-0402), which is
    increment 2.
  - F-0101 AC-14 counts all eight events. It's `deferred` under ruling 8.
- **The engines value:** F-0101 AC-14's `^1.101.0` is reference data; the family's root constant decides.

### 2.2 `package.nls.json` (exactly these 2 keys, in this order)

| Key | English value |
|---|---|
| `description` | Develop inside a container that carries its own toolchain, so each project brings its environment with it. |
| `capabilities.untrustedWorkspaces.description` | Opening a folder in a container requires workspace trust. |

The description is the sentence `package.json` carries on main today. The capability text is F-0101 7.E4's, and it
names no product.

### 2.3 What the package contributes, and how later cards add theirs

This card contributes no command, setting, menu or view. tooling-31's check fails on a contribution that no
production code consumes, and a command registered with a placeholder handler would do nothing visible in a built
VSIX. So every later card adds its own contribution, in the same PR as the code that consumes it:
- **C2 (containers-03, #758):** `dev.containers.dockerPath`.
- **C6 (Reopen in Container and the rest):** its commands, with their titles and `when` clauses copied from F-0401,
  F-0403 and F-0405, each menu entry gated with `&& !remote-containers:standingDown`.
- **The other cards:** whatever they consume.

Each such card:
- extends this card's manifest test (section 5.1) with its own rows;
- adds `namespaces` entries to `identifiers.json` as its ids need them.

Section 3's activation takes the handlers of whatever the generated `commands` table holds. So a command added to the
manifest and missing from the handlers is a type error, not a silent stub.

### 2.4 `identifiers.json` (exact)

```json
{
  "source": "remote-oss/remote-containers#107 (F-1406)",
  "standsDownFor": "ms-vscode-remote.remote-containers",
  "standingDownKey": "remote-containers:standingDown",
  "namespaces": {
    "commands": ["remote-containers."],
    "settings": ["dev.containers."],
    "contextKeys": ["remote-containers:"],
    "internalCommands": ["remote-oss."]
  },
  "contextKeys": [{"id": "remote-containers:standingDown", "setter": "extension"}],
  "infoLineCommands": [],
  "runtimeCommands": [],
  "internal": [{"id": "remote-oss.gate.claim", "role": "called", "kind": "query"}],
  "invented": [
    {"id": "remote-containers:standingDown", "kind": "contextKeys", "spec": "F-1406", "date": "2026-10-14"}
  ],
  "settingPairs": [],
  "ungated": [],
  "locales": ["cs", "de", "es", "fr", "it", "ja", "ko", "pl", "pt-br", "qps-ploc", "ru", "tr", "zh-cn", "zh-tw"]
}
```

Notes on these entries:
- **The standing-down key** is `remote-containers:standingDown`, with a colon, verbatim from F-1406 §6 (D-14;
  athena's register entry of 2026-10-14 on remote-oss/remote-containers#122 Q9, superseding her earlier dot ruling of 2026-10-14). The
  context-key namespace is `remote-containers:`. It's in the `invented` ledger under F-1406: F-1406 §6 is the R-27 list
  of invented ids and names this key, as remote-explorer's key is listed under F-5001 (athena on #762, after dike
  found that `check-identifiers` requires the entry; `tools/identifier-rules.ts`). If `pnpm check-identifiers` rejects
  a `:` in a context key id or namespace, stop and report on #759: don't change the key.
- **`remote-oss.gate.claim`** is there because the family's proposed-API setup calls it (explorer-03b, `contracts.md`
  §3.4). If `pnpm check-identifiers` requires its namespace in another form, use the form remote-explorer's
  `identifiers.json` passes with, and say so in the PR.
- **The settings namespace** is the current `dev.containers.` alone. The legacy `remote.containers.` twins (F-0102)
  aren't in release 1, and C2 adds only `dev.containers.dockerPath`.

After `pnpm identifiers`, the generated table holds:
- an empty `commands` (and so on for every kind);
- the one context key;
- the one internal id;
- `standDown` `{standsDownFor: 'ms-vscode-remote.remote-containers', contextKey: 'remote-containers:standingDown'}`;
- `enabledApiProposals` (the seven, `as const`).

Paste the generated file's head in the PR. If the generator fails on an empty `commands` table, stop (section 9,
row 2).

### 2.5 README "For maintainers" table

Replace the four rows after "Maintainers" with these (product voice, no ids):

| Row | Value |
|---|---|
| Features | the package manifest and activation: the guard against another enabled Dev Containers extension, the proposed-API setup, and the Dev Containers log |
| Components | `containers.package-shell` (`package.json`, `identifiers.json`, `src/activation.ts`, `src/extension.ts`) |
| Allowed imports | `lib-authority`, `lib-identifiers`, `lib-log`, `lib-product`, `lib-standdown`; `vscode` and `node:` modules in `src/extension.ts` only |
| Coverage exclusions | `src/extension.ts`: it loads the `vscode` module, which exists only in the extension host |

The rest of the README stays as on main.

## 3. The activation (`src/activation.ts`)

### 3.1 Contract

```ts
import type {SetupPorts, SetupRun} from 'lib-authority';
import type {CommandEntry, CommandHandler, CommandHost} from 'lib-identifiers';
import type {EditorLogPort, Logger} from 'lib-log';
import type {StandDownHost} from 'lib-standdown';

/** The part of the package's identifier table that activation uses. */
export interface ContainersTable<Commands extends Readonly<Record<string, CommandEntry>>> {
  readonly commands: Commands;
  readonly standDown: {readonly standsDownFor: string; readonly contextKey: string};
}

/** What the version line of the log names. */
export interface BannerFacts {
  displayName: string;
  extensionVersion: string;
  /** The editor's application name (`env.appName`), its version and its commit. */
  editorName: string;
  editorVersion: string;
  editorCommit: string;
}

/** What a serving window offers the code that registers in it. */
export interface ServedWindow {
  readonly logger: Logger;
  /** The proposals the activation's probe found missing, as the setup's decision names them. */
  readonly missing: readonly string[];
  /** Runs the setup again after a use that needs a proposal failed; it never stores a success it did not probe. */
  setupAgain(): Promise<SetupRun>;
}

export interface ContainersActivationInputs<Commands extends Readonly<Record<string, CommandEntry>>> {
  table: ContainersTable<Commands>;
  /** The coexistence warning and its button, in the user's language. */
  standDownTexts: {warning: string; button: string};
  standDown: StandDownHost;
  commands: CommandHost;
  channels: Pick<EditorLogPort, 'createOutputChannel'>;
  clock: () => number;
  banner: BannerFacts;
  /** The ports of the proposed-API setup, made once the log is open; `logFailure` writes to it. */
  gate(logFailure: (message: string) => void): SetupPorts;
  /** The handler of every command of the table, made once the window serves. */
  handlers(served: ServedWindow): {readonly [Name in keyof Commands]: CommandHandler};
}

export type ContainersActivation =
  | {kind: 'standing'}
  | {kind: 'serving'; served: ServedWindow; setup: SetupRun['interaction']; dispose(): void};

export async function activateContainers<Commands extends Readonly<Record<string, CommandEntry>>>(
  inputs: ContainersActivationInputs<Commands>,
): Promise<ContainersActivation>;
```

### 3.2 Rules, in order

1. **The guard.** `standDownIfPresent(inputs.standDown, {standsDownFor, standingDownKey: contextKey, warning,
   button})` comes first (F-0101 5.0 step 0, BR-10; R-54, R-77, R-78).
   - `standing` resolves `{kind: 'standing'}`. No log channel is created, `gate` isn't called and nothing is registered.
   - The guard sets the context key (`true` when standing, `false` otherwise) and shows the warning. lib-standdown does
     both; this card adds nothing.
2. **The log.** On `serving`:
   - make one logger: lib-log's `createLogger(createChannelSink(inputs.channels, 'Dev Containers'), {minimumLevel: () =>
     'info', clock: inputs.clock})`;
   - write the three lines of F-0101 BR-4 at `info`, in this order:
     1. `` `${displayName} ${extensionVersion} in ${editorName} ${editorVersion} (${editorCommit}).` ``;
     2. `Initializing configuration support...`;
     3. `Internal initialization of dev container support package...`.
   - The channel's name is the display name, `Dev Containers`.
   - The version line names the editor by its own application name, not "VS Code" (BR-4's placeholders are the host's
     values).
   - There's no level setting in release 1. F-0102's `logLevel` isn't in the cut, so the level is `info`.
3. **The setup.** `ports = inputs.gate(message => logger.error(message))`, then `run = await runSetup(ports, true)`.
   - If `gate` or `runSetup` throws, dispose the channel sink and rethrow. Nothing is registered.
   - When `run.decision.missing` isn't empty, log at `info`: `` `Missing proposed APIs: ${missing.join(', ')}` ``, the
     wording remote-ssh logs.
   - The activation doesn't wait for `run.interaction`.
4. **The served window.** `served = {logger, missing: run.decision.missing, setupAgain: () => runSetup(ports, false)}`.
   - `setupAgain` is the probe after a failed use of a gated member (F-0101 BR-9 point 2 a).
   - The later card whose command fails because a proposal is missing calls it. This card calls it nowhere.
5. **The commands.** `registerCommands(inputs.commands, 'serving', table.commands, inputs.handlers(served))`.
   - Commands are registered whatever the setup found: brief ruling 9, "every command stays registered and answers
     with the gate's setup notice".
   - If registration throws, dispose the sink and rethrow.
6. **The result.** Resolve `{kind: 'serving', served, setup: run.interaction, dispose}`. `dispose` disposes the
   registration, then the sink, each exactly once.

Nothing else happens at activation: no Docker call and no notification of ours. F-0101 BR-2: activation is silent. BR-12's
gating Docker call serves the reopen offer, which is increment 2.

### 3.3 lib-authority: the containers proposals

`ProposalName` (`gate/probe.ts`) gains `'workspaceTrust'`, `'terminalDimensions'` and `'contribEditSessions'`, so that
the generated `enabledApiProposals` tuple types as `readonly ProposalName[]` in `familySetupPortsOf`. `probeOne`
already answers `unprobeable` through its `default` branch, so its code doesn't change:
- `workspaceTrust`'s gated member, `requestWorkspaceTrust` with a custom message, can't be called without a side
  effect. So it rides on the `resolvers` probe, as F-0101 BR-9 point 1 and F-1403 §4 say: one enablement route
  grants an extension's whole list.
- The other two have no detection signal (BR-9 point 1).

Brief ruling 9, "a missing `resolvers` or `workspaceTrust` holds back the open path", therefore reads `missing`'s
`resolvers` only. C6 and C10 own that rule.

### 3.4 lib-log, only if needed

If `createChannelSink`'s parameter type requires `createTerminalWriter`, narrow it to
`Pick<EditorLogPort, 'createOutputChannel'>`, since it calls nothing else. lib-log's own rows must pass unchanged.
Otherwise don't touch lib-log.

## 4. The desktop entry (`src/extension.ts`, not unit-tested)

### 4.1 `activate(context)`

```ts
export async function activate(context: vscode.ExtensionContext): Promise<void>
```

1. Read `manifest = context.extension.packageJSON` (`displayName`, `version`). Read `profile = profileOf(await
   readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8'))` once (lib-product).
2. Run `activateContainers` with:

| Input | Value |
|---|---|
| `table` | `{commands, standDown}` from `./identifiers.generated.ts` |
| `standDownTexts` | `vscode.l10n.t` of the two strings of 4.2 |
| `standDown` | `standDownHost(vscode)` |
| `commands` | `identifierHost(vscode, manifest)` |
| `channels` | `vscode.window` |
| `clock` | `Date.now` |
| `banner` | `{displayName: manifest.displayName, extensionVersion: manifest.version, editorName: vscode.env.appName, editorVersion: vscode.version, editorCommit: profile.commit}` |
| `gate` | `logFailure => familySetupPortsOf(vscode, context, {...})` |
| `handlers` | `() => ({})` in this card. Each later card returns its handlers here |

   The `familySetupPortsOf` options are:
   - `displayName` from the manifest;
   - `proposals`: `enabledApiProposals` from the generated table;
   - `viewIds: []` (no remote view in release 1);
   - `templates`: the module's `SETUP_TEXT_TEMPLATES` (4.2);
   - `translate`: `template => vscode.l10n.t(template)`;
   - `dataFolderName`: `() => Promise.resolve(profile.dataFolderName)`;
   - `logFailure`: as passed.
3. On `serving`, push `{dispose: () => { result.dispose(); }}` to `context.subscriptions`.

The setup's `interaction` isn't awaited, as in remote-ssh and remote-explorer.

### 4.2 Strings (`l10n/bundle.l10n.json`, keys equal to the English values; the 14 locale bundles the same, in English)

| Constant in `extension.ts` | English text |
|---|---|
| `STAND_DOWN_WARNING` | Dev Containers stays inactive in this window because another Dev Containers extension is enabled. Both use the same commands, settings and remote connections. Disable one of the two extensions and reload the window. |
| `STAND_DOWN_BUTTON` | Show Dev Containers Extension |
| `SETUP_TEXT_TEMPLATES.setup` | {0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}. |
| `SETUP_TEXT_TEMPLATES.failedAttempt` | The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists 'remote-oss.remote-containers', then restart {1}. |
| `SETUP_TEXT_TEMPLATES.restart` | Quit and start {1} again to apply the changes to argv.json. |
| `SETUP_TEXT_TEMPLATES.configureButton` | Configure Runtime Arguments |
| `SETUP_TEXT_TEMPLATES.notNowButton` | Not Now |
| `SETUP_TEXT_TEMPLATES.quitButton` | Quit {1} |

**The setup texts** are F-1403 §6 "Texts", with this package's id in the failed-attempt text, as remote-explorer's
are.

**The coexistence warning.** F-0101 3.4's text names the other extension's id in parentheses. ADR-0008's
public-surface lint fails on an `ms-vscode…` id in an `l10n` string. So this card uses F-0101 3.4's sentences with the
parenthesis left out, as the explorer's republished F-5001 3.4 does, and the spec's button text unchanged. athena
confirms or asks for a republication (section 9, row 1). The button opens the Extensions view on the other extension
(lib-standdown's `revealExtension`).

## 5. Test table

Every `it` name starts with its cite. An (each) row counts once.

### 5.1 `test/unit/manifest.test.ts` (as remote-explorer's: reads the files from the package folder, expects literals copied from section 2)

| Cite | Given | Expected |
|---|---|---|
| F-0101 AC-4 | the top-level fields | each value of 2.1, compared one by one, and the key set is exactly 2.1's: the identity is `remote-oss` / `remote-containers` / `Dev Containers` with our own description |
| F-0101.BR-7 | `capabilities` | deep-equal to 2.1's (`virtualWorkspaces` true, `untrustedWorkspaces` `limited` with the nls description key) |
| F-0101.BR-3 | `extensionKind` | `["ui"]` |
| F-0101.BR-8 | `enabledApiProposals` | deep-equal to the seven of 2.1, in order |
| containers-01 | `activationEvents` | exactly `["onResolveRemoteAuthority:dev-container"]` (brief ruling 8) |
| containers-01 | `contributes`, `browser`, `icon` | absent (2.1, 2.3) |
| F-1406.5 | `package.nls.json` | exactly the 2 keys of 2.2 with their values; every `%key%` in `package.json` is one of them |
| F-1406.5 | (each) the 14 locale `package.nls.<locale>.json` | exist; each deep-equal to `package.nls.json` |
| F-1406.5 | `identifiers.json` | deep-equal to 2.4 |

### 5.2 `test/unit/activation.test.ts` (fakes of `StandDownHost`, `CommandHost`, the channel port and `SetupPorts`, recording events in order, as remote-ssh's and remote-explorer's activation tests)

The table under test is a fake `{commands: {alpha, beta}, standDown: {standsDownFor: 'ms-vscode-remote.remote-containers',
contextKey: 'remote-containers:standingDown'}}`. The package's generated `commands` is empty, so the generic activation is
tested on a table with entries.

| Cite | Given | Expected |
|---|---|---|
| F-0101.BR-10 | the other extension runs | result `standing`; events exactly `context remote-containers:standingDown=true`, `warning <warning> <button>`; no channel created; `gate` and `handlers` never called; nothing registered |
| F-0101.BR-10 | as above, and the fake warning answers the button | `revealExtension('ms-vscode-remote.remote-containers')` once |
| F-0101.BR-10 | it doesn't run | events in order: `context remote-containers:standingDown=false`, `channel Dev Containers`, the three banner lines, `probe` (the setup), `handlers`, `register alpha`, `register beta` |
| F-0101.BR-4 | banner `{displayName: 'Dev Containers', extensionVersion: '0.1.0', editorName: 'VSCodium', editorVersion: '1.139.0', editorCommit: 'abc'}` | the channel's first three lines end with `Dev Containers 0.1.0 in VSCodium 1.139.0 (abc).`, `Initializing configuration support...` and `Internal initialization of dev container support package...`, in that order, each at `info` |
| F-0101.BR-9 | a setup whose decision is `proceed` with `missing: ['resolvers']` | a log line ending `Missing proposed APIs: resolvers`; `served.missing` is `['resolvers']`; both commands still registered |
| F-0101.BR-9 | a setup with nothing missing | no `Missing proposed APIs` line |
| F-0101.BR-9 | `served.setupAgain()` | the fake ports' `probe` runs a second time, with the setup's activation-time flag `false` (observe it through a port the activation-time flag changes in `runSetup`, or spy the call; say which in the PR) |
| F-0101.BR-9 | `gate` throws, then (separately) the probe rejects | the activation rejects with that error; the channel is disposed; nothing registered |
| F-0101.BR-10 | `registerCommands` throws (the fake host's `register` throws) | the activation rejects with it; the channel is disposed |
| F-0101.BR-2 | a serving activation | `handlers` received a `served` whose `logger` writes to the channel; no `warning` or `information` event was recorded |
| containers-01 | `dispose` of the `serving` result | each registration disposed once, then the channel once |

### 5.3 lib-authority (`gate-probe.test.ts`)

| Cite | Given | Expected |
|---|---|---|
| F-0101.BR-9 | `probeProposals` with `['workspaceTrust', 'terminalDimensions', 'contribEditSessions']` | each `unprobeable`, in that order, and no member of the fake editor read |

These must pass too, with their output in the PR:
- `pnpm identifiers` (paste the generated head);
- `pnpm check-identifiers`, `pnpm check-string-tables`, `pnpm check-public-surface` and `pnpm check-layout`;
- `pnpm build`, then `pnpm package remote-containers`: a VSIX is written, and `vsce ls` lists only the files of the
  `.vscodeignore`.

## 6. Coverage and catalogue

The containers coverage file is being seeded in parallel, as `docs/architecture/catalogue/coverage-containers-r1.tsv`.
- **If it's on main when you open the PR:** change F-0101 AC-4 from `todo` to `unit` there (section 5.1's first row).
- **Otherwise:** list it in the PR, and the seed carries it.

**Rows that wait for later cards:**
- F-0101 AC-15 (the setup flow) and AC-18 (coexistence) need the package to activate in the VSCodium run. With no
  command contributed, nothing activates it before C6. Gate rows 9 and 10 (brief §5) are written in the gate-rows
  card. Section 5.2's rows cite BR-9 and BR-10 for now.
- F-0101 AC-14 is `deferred` (brief ruling 8).

The unit rows cite F-0101 sections and AC-4 only. `check-coverage` checks cites only for slice-1 features, so these
names can't fail it.

## 7. Rule for the builder

- Tests first: each row fails before the code is written.
- Copy every value from sections 2 and 4.2, and invent no wording.
- Names of four characters or more, properties included. No `const` arrow helpers.
- Comments only where the guide requires them, none with a feature, rule or decision id. Ids may appear in test names.
- Table loops in tests, and no duplicated code. jscpd flags five-line clones. If the setup templates of 4.2 trip
  jscpd against remote-explorer's, stop (section 9, row 3).
- Coverage of the changed files is 100 % lines, branches and functions. `extension.ts` is excluded.

**Gates:** `pnpm install`, `pnpm identifiers`, `pnpm check-identifiers`, `pnpm check-string-tables`,
`pnpm check-public-surface`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`, `pnpm check-coverage`, and
`pnpm check-consumed` if tooling-31 is on main. Also `pnpm build` and `pnpm package remote-containers`.

**The acceptance run:** run remote-ssh's, `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium`. The new
`ProposalName` members must change nothing there. Paste its summary.

## 8. Review

PR title `remote-containers: the package shell: manifest, stand-down, proposed-API setup and log (card containers-01,
#759)`. themis or triton reviews; athena gives the design check (section 9, row 1, and 3.3). The description answers
R1–R6 and maps each cite to its test name.

## 9. Open rows (stop and report on #759)

1. **For athena: the coexistence text.** F-0101 3.4's warning names the other extension's id, which ADR-0008's lint
   forbids in shipped strings. This card uses the text without it (4.2), as the explorer's F-5001 3.4 was
   republished. Build with 4.2's text, and athena rules on the PR.
2. **An empty commands table.** If `pnpm identifiers`, `pnpm check-identifiers` or `pnpm dead` fails on a package
   with no commands, settings or views, paste the message and stop. Don't add a placeholder command.
3. **Duplicated setup templates.** If `pnpm dupes` flags 4.2's templates against remote-explorer's or remote-ssh's,
   stop. The fix is a shared template in lib-authority, which changes two other packages and goes to the lead first.
4. **`remote-oss.gate.claim`.** If `check-identifiers` rejects the `internalCommands` namespace `remote-oss.`, use
   the form remote-explorer passes with, and say so in the PR.
