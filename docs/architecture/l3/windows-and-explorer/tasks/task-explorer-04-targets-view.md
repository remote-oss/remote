# Task card explorer-04: the Remotes view, its "SSH" group, the host rows and the connected marker

Issue: #640. Release 0.3 (#43), explorer slice 1, item S4 (brief `../brief-remote-explorer.md`, "Slice 1", ruled
233e3b7). Why: slice 1's job is "see your SSH hosts in the Remotes view and connect to one". This card shows them.

**Specs:**
- remote-oss/remote-explorer#8 F-5101, the SSH half: BR-2 to BR-9, 6.5, 6.6, 7.E1, 7.E2, 7.E5;
- #9 F-5102's host list: §3.3's "SSH" and host rows, BR-7, BR-8, BR-11, BR-13;
- #10 F-5103 BR-6, the marker;
- #14 F-5902 §5: "Order of a build's calls", "A call fails at run time", "When a companion is absent".

Builder: iris. Size: about 3 agent-days. **Depends on**, all merged:
- companion-04 (#625: `createProtocol`, `commandBus`, `systemTimers`);
- companion-05 (#627: `createDetector`, `extensionLookup`, `SSH_ENDPOINTS`, `SSH_COMPANION_ID`, the recording fake);
- explorer-03a, 03b and 03c (#629–#631: the manifest, `activateExplorer`, `silentHandlers`, `activateInWindow`).

If any of them isn't on main, stop (§6 row 1).

**Slice-1 limits (decided here, from the brief):**
- **No folder rows.** The history call is increment 2, so every host row is a leaf.
- **No `sshHostsChanged` and no `setActiveFolders`.** Both are increment 2.
- **The `remote.SSH.configFile` listener is in slice 1.** It's the explorer's own reaction to a setting (F-5902 §5,
  RR-3; F-5101 6.5, BR-4) and no part of the interface, and the brief puts "F-5101's SSH half" in slice 1.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-explorer/src/view/companion-calls.ts` | new: `CompanionCalls`, `companionCallsOf` |
| `packages/remote-explorer/src/view/targets.ts` | new: the nodes, `TargetItem`, `Targets`, `ViewSession`, `createTargets` |
| `packages/remote-explorer/src/view/tree-adapter.ts` | new: `TreeEditor`, `showTargets`, `configFileChangesOf` |
| `packages/remote-explorer/src/window-activation.ts` | 03c's module: the changes of §2.4 |
| `packages/remote-explorer/test/unit/companion-calls.test.ts`, `targets.test.ts`, `tree-adapter.test.ts` | new |
| `packages/remote-explorer/test/unit/window-activation.test.ts` | 03c's file: its fake editor gains what §2.3 uses; the §3 rows on activation |
| `packages/remote-explorer/l10n/bundle.l10n.json` and the 14 `bundle.l10n.<locale>.json` | each gains the key `connected` with the value `connected` (English in every locale, as 03b's keys) |
| `packages/remote-explorer/test/unit/activation.test.ts` | 03b's F-5001.AC-16 row: 9 keys, not 8 |
| `packages/remote-explorer/package.json` | `dependencies` gains `"lib-companion": "workspace:*"` |
| `packages/remote-explorer/tsconfig.json` | `references` gains `../lib-companion` |
| `packages/remote-explorer/README.md` | "For maintainers": Components adds `explorer.targets-view` (`src/view/`); Allowed imports adds `lib-companion` |
| `pnpm-lock.yaml` | as `pnpm install` writes it |

Nothing else may change. `src/model/ssh-group.ts` and `src/model/connected-marker.ts` (explorer-01, 02) are used as
they are.

## 2. Contract

### 2.1 `src/view/companion-calls.ts`

```ts
import {
  type ActiveRemote, type CallOutcome, type Hostnames, type Protocol,
  readActiveRemote, readHostnames, SSH_ENDPOINTS, writeEnvelope,
} from 'lib-companion';

/** The companion calls of a build of the view. */
export interface CompanionCalls {
  activeRemote(): Promise<CallOutcome<ActiveRemote>>;
  hostnames(): Promise<CallOutcome<Hostnames>>;
}

export function companionCallsOf(protocol: Pick<Protocol, 'call'>): CompanionCalls;
```

`activeRemote()` is `protocol.call(SSH_ENDPOINTS.getActiveSshRemote.commandId, writeEnvelope(), readActiveRemote)`.
`hostnames()` is the same with `getConfiguredHostnames` and `readHostnames`. Each call makes a fresh envelope.

### 2.2 `src/view/targets.ts`

```ts
import type {CompanionDetector, Registration} from 'lib-companion';
import type {HostRow} from '../model/ssh-group.ts';
import type {CompanionCalls} from './companion-calls.ts';

export interface GroupNode { readonly kind: 'sshGroup' }
export interface HostNode { readonly kind: 'sshHost'; readonly row: HostRow; readonly connected: boolean }
export type TargetNode = GroupNode | HostNode;

/** What the tree shows for a node. */
export interface TargetItem {
  id: string;
  label: string;
  tooltip: string;
  description?: string;
  iconId?: string;
  contextValue: string;
  /** true: expanded; undefined: not collapsible. */
  expanded?: true;
}

export interface TargetsOptions {
  calls: CompanionCalls;
  detector: Pick<CompanionDetector, 'isPresent' | 'onPresenceChanged'>;
  /** Subscribes to changes of `remote.SSH.configFile`. */
  configFileChanges(listener: () => void): Registration;
  /** The description of the connected row, in the user's language. */
  connectedText: string;
}

export interface Targets extends Registration {
  /** The roots for `undefined`; a group's hosts once the latest build has settled; `[]` for a host. */
  children(node: TargetNode | undefined): Promise<readonly TargetNode[]>;
  itemOf(node: TargetNode): TargetItem;
  /** The value itself when it is a host node of the current list; otherwise undefined. */
  hostOf(value: unknown): HostNode | undefined;
  /** A full build: the pull, then the host list. Never rejects. */
  rebuild(): Promise<void>;
  /** The host list alone. Never rejects. */
  rebuildHosts(): Promise<void>;
  onDidChange(listener: () => void): Registration;
}

/** What the view's commands use once the view is shown. */
export interface ViewSession {
  readonly targets: Targets;
  readonly calls: CompanionCalls;
}

export function createTargets(options: TargetsOptions): Targets;
```

**Rules.**

**State and nodes:**
1. The state is the last stored pull (`ActivePull | undefined`, explorer-02's type, initially `undefined`) and the
   last stored aliases (initially `[]`).
2. `createTargets` keeps one `GroupNode` object for its life.
3. Each time aliases are stored, it makes new `HostNode` objects, one per row of
   `buildSshRows(distinct(aliases), new Map(), undefined)`. `distinct` keeps the first of equal strings, so two
   `Host` blocks with one alias give one row (F-5103 AC-30; explorer-01's open row 2). `connected` is true exactly
   for the row ids `markedRowIds(rows, pull)` gives.
4. A stored pull alone (rule 9) also makes new host nodes, from the stored aliases.

**Presence:**

5. The group exists while `detector.isPresent(SSH_COMPANION_ID)` is `present`. It's asked at each
   `children(undefined)`: `[group]` or `[]`. The detector keeps a companion that was seen (companion-05 rule 4), so
   the group stays until the extension host restarts (F-5101 BR-8).

**Builds:**

`Targets` keeps two sequence numbers, both starting at 0:
- the **build sequence**, taken by every build;
- the **full-build sequence**, taken by full builds only.

A build takes its numbers synchronously when it starts, before its first call. "Latest" always means the most
recently started build, by these numbers, never the one that answered last. A build's answers that arrive after a later
build has started are dropped for what that later build supersedes (rule 9). Within one build, F-5902's call order
holds (rule 6).

6. **A full build**, `rebuild()`:
   - with the companion absent, it makes no call, stores nothing and fires nothing (F-5101 7.E1; F-5902 §5, "calls none
     of the SSH ids then"), and resolves;
   - otherwise it takes the next build number and the next full-build number, then calls
     `calls.activeRemote()` and, in the same synchronous turn, `calls.hostnames()`. It doesn't await the first before
     making the second (F-5902 §5, "Order of a build's calls").
7. **A host build**, `rebuildHosts()`: absent → as rule 6. Otherwise it takes the next build number, but no full-build
   number, and calls `calls.hostnames()` alone. So a host build supersedes the host list of every build started
   before it, but never the stored active-host answer: it neither stores nor drops a pull.
8. A build settles when all its calls have settled; `call` never rejects (companion-04 rule 3), so there's no error
   path.
9. **When a build settles:**
   - **the aliases:** an `answered` host list is stored, with `value.hostnames`, when its build number is still the
     latest build number taken; otherwise it's dropped. A failed one (`unavailable`, any cause) stores `[]`, under the same condition (F-5902 §5: the "SSH" group
     is shown with no host rows, F-5101 7.E2);
   - **the pull** (full builds only), when its full-build number is still the latest full-build number taken
     (otherwise it's dropped): `answered` stores
     `{connected: value.connected, hostKey: value.hostKey}`, and `unavailable` stores `undefined`, so no row is marked
     (F-5902 §5);
   - **the listeners:** when either was stored, every `onDidChange` listener is called once, after the store.

   Overlapping builds end with the most recently started build's list, each host once (F-5101 BR-6), and the most
   recently started full build's pull. A host build never changes the stored pull, so the marker survives it. An
   older build that answers last changes nothing.
10. `children(group)` first awaits the build with the highest build number, when that build hasn't settled yet. It
   then returns the current host nodes. So the first render after a build shows its whole
   result (F-5103 BR-6, the marker on the first render). `children(<host node>)` is `[]` (no folder rows in slice 1).

**Items (`itemOf`):**

11. | Node | `id` | `label` and `tooltip` | `description` | `iconId` | `contextValue` | `expanded` |
    |---|---|---|---|---|---|---|
    | group | `ssh-group` | `SSH` | absent | absent | `remote-explorer.sshGroup` | `true` |
    | host, not connected | `row.rowId` | `row.alias` | absent | `vm` | `remote-explorer.sshRemoteTarget` | absent |
    | host, connected | `row.rowId` | `row.alias` | `options.connectedText` | `CONNECTED_MARKER.icon` (`vm-active`) | `remote-explorer.sshRemoteTarget` | absent |

    Absent means no own property. The ids stay the same across builds, so core keeps a group the user collapsed
    collapsed through Refresh (F-5102 BR-11, F-5101 BR-5).

**Reactions:**

12. `createTargets` subscribes:
    - `detector.onPresenceChanged`: an event for `SSH_COMPANION_ID` starts `rebuild()` (F-5101 6.6, BR-8);
    - `options.configFileChanges`: each event starts `rebuildHosts()` (F-5101 6.5).

    `dispose` disposes both subscriptions and drops every listener. After it, no event starts a build.
13. **`hostOf(value)`** returns `value` when it is, by identity, one of the current host nodes. For anything else it
    returns `undefined`: an old build's node, the group, a look-alike object, a string, `undefined`.

### 2.3 `src/view/tree-adapter.ts`

```ts
import type * as vscode from 'vscode';
import type {Registration} from 'lib-companion';
import type {Targets} from './targets.ts';

export type TreeEditor = Pick<
  typeof vscode,
  'commands' | 'window' | 'workspace' | 'TreeItem' | 'ThemeIcon' | 'EventEmitter' | 'TreeItemCollapsibleState'
>;

/** Shows the targets in the view when core registered it; otherwise shows nothing and returns undefined. */
export async function showTargets(
  editor: TreeEditor,
  targets: Targets,
  viewId: string,
): Promise<Registration | undefined>;

export function configFileChangesOf(editor: Pick<TreeEditor, 'workspace'>): (listener: () => void) => Registration;
```

**Rules:**

14. **When there's no view:** `showTargets` first reads `editor.commands.getCommands(true)`. Without
    `` `${viewId}.focus` `` in it, core didn't register the view: the proposal isn't granted (F-5101 7.E5), or it's a
    web editor without it. It then returns `undefined` and creates nothing. That avoids core's error notification
    "No view is registered with id: …", which `createTreeView` raises for an unregistered view ([oss]
    `src/vs/workbench/api/browser/mainThreadTreeViews.ts`, `$registerTreeViewDataProvider`). This is the gate's own
    probe (contracts §3.4).
15. **Otherwise** it makes an `EventEmitter<TargetNode | undefined>` and a provider:
    - `onDidChangeTreeData` is the emitter's event;
    - `getChildren(node)` is `targets.children(node)`;
    - `getTreeItem(node)` builds an item from `targets.itemOf(node)`: `new editor.TreeItem(label, state)`, where `state`
      is `Expanded` for `expanded: true` and `None` otherwise; then `id`, `tooltip` and `contextValue`; `description`
      only when present; `iconPath = new editor.ThemeIcon(iconId)` only when present.

    It subscribes `targets.onDidChange(() => emitter.fire(undefined))`, then calls
    `editor.window.createTreeView(viewId, {treeDataProvider, showCollapseAll: true})` (F-5101 §16, "Collapse All").
    It returns a `Registration` whose `dispose` disposes the tree view, the subscription and the emitter, once each.
16. **`configFileChangesOf(editor)`** returns `listener => editor.workspace.onDidChangeConfiguration(event => { if
    (event.affectsConfiguration('remote.SSH.configFile')) { listener(); } })`, the editor's disposable itself.

### 2.4 `src/window-activation.ts` (03c's `activateInWindow`)

`WindowEditor` widens to `TreeEditor`'s members plus `'extensions' | 'l10n'`. The activation becomes:

1. `let session: ViewSession | undefined`.
2. The handlers become `{...silentHandlers(commands), refresh: {execute: () => session?.targets.rebuild()}}`.
   Without a session, Refresh does nothing and resolves `undefined` (F-5002 §19 items 1 and 7).
3. `activateExplorer` runs as before. On `standing` nothing more happens: no protocol, no detector, no tree, no call
   (F-5001 BR-10).
4. On `serving`, in this order:
   - `protocol = createProtocol({bus: commandBus(editor), timers: systemTimers})`, with no `onVersionMismatch`: the
     explorer has no log (F-5901 §6);
   - `calls = companionCallsOf(protocol)`;
   - `detector = createDetector(extensionLookup(editor))`;
   - `targets = createTargets({calls, detector, configFileChanges: configFileChangesOf(editor), connectedText:
     editor.l10n.t('connected')})`;
   - `shown = await showTargets(editor, targets, views.remoteTargets)`.
5. When `shown` is a registration:
   - `session = {targets, calls}`;
   - `void targets.rebuild()`, the first build (F-5101 BR-4, "when the view is first shown after activation");
   - push one disposable to `context.subscriptions` that disposes `shown`, `targets` and `detector`.

   When `shown` is `undefined`: dispose `targets` and `detector` at once, and leave `session` undefined.

## 3. Test table

**Fakes:**
- **`FakeCalls`:** each method returns a promise the test settles, and records its name in a shared `order` list
  when called.
- **The fake detector:** `isPresent` answers from a field. Its `onPresenceChanged` keeps listeners the test can fire.
- **`fakeConfig`:** a `configFileChanges` that keeps the listener.
- `A(x)` is `{status: 'answered', value: x}`, and `U` is `{status: 'unavailable', cause: 'rejected'}`.

The tree-adapter and window-activation rows use a fake editor:
- `getCommands` answers from a list;
- `createTreeView` records its arguments and returns a disposable;
- `TreeItem`, `ThemeIcon` and `EventEmitter` are small classes recording their fields;
- `TreeItemCollapsibleState` is `{None: 0, Collapsed: 1, Expanded: 2}`;
- `onDidChangeConfiguration` keeps its listener;
- `l10n.t` is the identity;
- `extensions` is as companion-05's adapter rows;
- `commands.executeCommand` is a companion-05 recording fake.

| Cite | Given | Expected |
|---|---|---|
| F-5101.BR-2 | detector absent: `children(undefined)`; then present | `[]`; then `[group]`, the same object on a second call |
| F-5102.3.3 | `itemOf(group)` | `{id: 'ssh-group', label: 'SSH', tooltip: 'SSH', contextValue: 'remote-explorer.sshGroup', expanded: true}` and no other own property |
| F-5902.5.order | present; `rebuild()` with both calls pending | `order` is `['activeRemote', 'hostnames']` before either settles; no change event yet. After both settle: one change event |
| F-5902.5.order | `rebuild()`; settle `hostnames` first with `A({hostnames: ['a']})`, the pull still pending | no change event and `children(group)` still pending; after the pull settles, one event and one host |
| F-5102.BR-7 | `hostnames` answers `['zeta', 'Alpha', 'mid']`, the pull answers `{connected: false}` | `children(group)` gives three hosts in that order; `itemOf` of the first is `{id: 'ssh-host:zeta', label: 'zeta', tooltip: 'zeta', iconId: 'vm', contextValue: 'remote-explorer.sshRemoteTarget'}` and no other own property |
| F-5103.AC-30 | `hostnames` answers `['a', 'b', 'a']` | two hosts, `a` then `b` |
| F-5103.BR-6 | the pull answers `{connected: true, hostKey: 'Alpha'}`, with the hosts of the row above and `connectedText` `'connected'` | `Alpha`'s item has `description: 'connected'` and `iconId: 'vm-active'`, and `connected` is true; the other two have no `description` and `iconId: 'vm'` |
| F-5103.AC-28 | (each) the pull answers `{connected: true, hostKey: 'nomatch'}`; `{connected: true, hostKey: 'alpha'}` (case differs); `{connected: false}` | no host is connected |
| F-5902.AC-5 | (each) the pull `U` with the hosts answered; the hosts `U` with the pull answered connected to `a` | hosts listed, none connected; the group present with `children(group)` `[]`; no exception |
| F-5101.BR-6 | `rebuild()` twice; the first build's calls settle after the second's (the first: hosts `['old']`; the second: `['new']`) | `children(group)` is the one host `new`, also after the first settles |
| F-5101.BR-6 | an older build answers last, end to end: `createTargets` over `companionCallsOf(createProtocol({bus: fake, timers}))`, where companion-05's recording fake has, for each of the two queries, a registered callback that returns a promise the test holds. `rebuild()`, then `rebuild()` again. The test releases the second build's answers first (pull connected to `second`, hosts `['second', 'shared']`), awaits that build, then releases the first build's (pull connected to `first`, hosts `['first', 'shared']`) and awaits it | the fake recorded the four calls in the order pull, hosts, pull, hosts. After both builds: `children(group)` is `second`, `shared`, and `second` alone is connected; one change event in all, from the second build |
| F-5101.6.5 | after a full build marking `Alpha` (hosts `['Alpha']`): `fakeConfig` fires, and `hostnames` answers `['Alpha', 'beta']` | `order` gained only `hostnames`; `Alpha` is still connected, and `beta` is listed |
| F-5101.BR-6 | `rebuild()` (pending), then a host build that settles first with `['x']`, then the full build settles with pull connected to `x` and hosts `['y']` | the hosts are `['x']` (the host build is later), and `x` is connected (the full build is the latest full build) |
| F-5101.7.E1 | detector absent: `rebuild()` and `rebuildHosts()` | no call, no change event, both resolve |
| F-5101.6.6 | absent at first; the test makes it present and fires `onPresenceChanged('remote-oss.remote-ssh')` | a full build runs (`order` gains both calls); after it settles, `children(undefined)` is `[group]` with its hosts |
| F-5103.BR-6 | `children(group)` called while a build is pending | resolves only after that build settles, with its hosts |
| F-5002.19 | `hostOf`: (each) a host node of the current list; a host node of the previous build; the group; `{kind: 'sshHost', row: <the same row>, connected: false}`; `'x'`; `undefined` | the node itself; then `undefined` for each of the others |
| F-5101.BR-8 | `dispose()`, then the detector and `fakeConfig` fire | no call |
| F-5902.5.rules | `companionCallsOf(createProtocol({bus: fake, timers}))` with companion-05's recording fake: `activeRemote()` and `hostnames()` answered | the fake recorded `remote-internal.getActiveSshRemote` then `remote-internal.getConfiguredHostnames`, each with `interfaceVersion` `{major: 1, minor: 0}`; the outcomes are `answered` with the read values |
| F-5902.AC-15 | the fake's `silent` for `getConfiguredHostnames`, with companion-04's manual clock advanced 10 000 ms | `hostnames()` gives `{status: 'unavailable', cause: 'timeout'}` |
| F-5902.5.foreign | (each) the fake's `foreign` and `newerMajor` for `getActiveSshRemote` | `unavailable` with `foreignPayload`, then `unknownMajor` |
| F-5101.7.E5 | `showTargets` with `getCommands` lacking `remoteTargets.focus` | `undefined`; `createTreeView` never called |
| F-5101.16 | `showTargets` with it | `createTreeView` called once, with `'remoteTargets'` and an options object whose `showCollapseAll` is `true` |
| F-5102.3.3 | the provider's `getTreeItem` for the group, an unconnected host and a connected host | the group: collapsible state `2`, no `iconPath`, no `description` property; the unconnected host: state `0`, `iconPath` a `ThemeIcon` with id `vm`; the connected host: `iconPath` id `vm-active`, `description` `connected`. Each has `id`, `tooltip` and `contextValue` per rule 11 |
| F-5101.BR-4 | a targets change event | the emitter fired once with `undefined` |
| F-5101.16 | `dispose` of the registration, twice | the tree view, the subscription and the emitter disposed once each |
| F-5101.6.5 | `configFileChangesOf` with an event affecting `remote.SSH.configFile`, then one affecting only `remote.SSH.connectTimeout` | the listener ran once |
| F-5101.BR-9 | `activateInWindow` (serving; the focus command listed; the bus answering both queries) | `createTreeView` once; the bus recorded the two queries once, pull first; `context.subscriptions` gained the activation's entry and one for the view |
| F-5101.BR-7 | the same, then the registered `remote-explorer.refresh` callback with no argument | it resolves `undefined`; the bus recorded the two queries a second time |
| F-5001.BR-10 | `activateInWindow` with the reference present | no `createTreeView`, no `extensions.onDidChange` subscription, no bus call |
| F-5101.7.E5 | serving without the focus command | no `createTreeView`, no bus call; the refresh callback resolves `undefined` and makes no call |
| F-5001.AC-16 | `l10n/` | the 15 bundles hold the same 9 keys, `connected` among them (03b's row, updated) |

32 rows (an (each) row counts once). Every `it` name starts with its cite.

## 4. Rule for the builder

Tests first. One `it` per row, or per input for an (each) row. Fix only what fails or is missing; no other signature or
contract change; no behaviour for §6. Names of four characters or more, properties included. No `const` arrow helpers.
Comments only where the guide requires them, none with a feature, rule or decision id (ids may appear in test names).
Table loops in tests, no duplicated code. Coverage of the new and changed files: 100 % lines, branches and functions.

Gates: `pnpm install`, `pnpm identifiers`, `pnpm check-identifiers`, `pnpm check-string-tables`,
`pnpm check-public-surface`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`, `pnpm build`, then
`pnpm package remote-explorer`.

## 5. Review

PR title `remote-explorer: the Remotes view with the SSH group and the connected marker (card explorer-04, #640)`.
themis or triton reviews; athena gives the design check. The description answers R1–R6 and maps each cite to its test
name. In the PR, proteus is asked for a manual look on the built VSIX with the pinned VSCodium, once ssh-provider-01 is
on main: the hosts are listed, and the marker is in an SSH window.

## 6. Open rows (stop and report on #640)

1. A card of the dependency list isn't on main, or its contract differs from what §2 uses (names, signatures). Report
   the difference. Don't adapt the other card's code.
2. The pinned VSCodium registers `remoteTargets.focus` although the proposal isn't granted, or `createTreeView` shows
   its error anyway. Then rule 14's check is wrong. Stop.
3. The translated "connected" stays English in the 14 locales, as 03b's strings do. A translation is a later string
   card's, not this one's.
4. Keyboard focus after Refresh (F-5102 BR-13) is core's tree behaviour when every item is replaced. Nothing here
   sets focus. It's not tested at unit level.
