# Task card companion-05: lib-companion's detector, endpoint ids, interface document 1.0 and recording fake

Issue: #627. Release 0.3 (#43). Why: Remote Explorer decides which groups exist from its companions' presence, calls
them by fixed ids, and is tested against a fake companion (remote-oss/remote-explorer#14 F-5902 §5 "The contract",
"Extension hosts and detection", "When a companion is absent", "Joint decision"; `contracts.md` §4.2–4.4). The
interface document is frozen at 1.0 with this card: F-5902 §5 is the interface's single text (athena, 2026-10-13).
Builder: selene. Size: about 2 agent-days. **Depends on companion-04 (#625):** `src/protocol.ts` (`Registration`,
`CommandBus`) and `src/editor-adapter.ts` must be on main. If they aren't, stop (section 6, row 1).

D-55: the tunnels part (`remote-oss.remote-server` and its `remote-tunnels.*` ids) isn't built in this release
(athena's brief, ea2b98b). This card has no tunnels endpoint set and no tunnels companion id. The document says so.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-companion/src/endpoints.ts` | new: the companion ids and the endpoint id sets |
| `packages/lib-companion/src/detector.ts` | new: `ExtensionLookup`, `createDetector` |
| `packages/lib-companion/src/editor-adapter.ts` | add `DetectorEditorApi` and `extensionLookup` (section 2). companion-04's code stays as it is |
| `packages/lib-companion/src/testing/recording-fake.ts` | new: the recording fake, for tests only |
| `packages/lib-companion/vscode-dts/vscode.proposed.extensionsAny.d.ts` | new: a byte-for-byte copy of `packages/lib-authority/vscode-dts/vscode.proposed.extensionsAny.d.ts` (`cmp` reports nothing) |
| `packages/lib-companion/docs/companion-interface.md` | new: the text of section 4, then `pnpm format` |
| `packages/lib-companion/src/index.ts` | add `export * from './endpoints.ts';` and `export * from './detector.ts';` |
| `packages/lib-companion/package.json` | add the export `"./testing/recording-fake": {"types": "./.tsc/src/testing/recording-fake.d.ts", "default": "./src/testing/recording-fake.ts"}` after `"."` (as lib-host's `./testing/recording-channel`) |
| `packages/lib-companion/tsconfig.json` | `"include": ["${configDir}/src", "${configDir}/vscode-dts"]` (as lib-authority) |
| `packages/lib-companion/tsconfig.test.json` | `"include": ["${configDir}/test", "${configDir}/vscode-dts"]` (as lib-authority) |
| `packages/lib-companion/README.md` | see below |
| `packages/lib-companion/test/unit/endpoints.test.ts`, `detector.test.ts`, `recording-fake.test.ts`, `interface-document.test.ts` | new |
| `packages/lib-companion/test/unit/editor-adapter.test.ts` | companion-04's file: add this card's adapter rows |
| `eslint.config.ts` | add the block below, after the `comments/public-surface` block |
| `tools/eslint-config.test.ts` | new: the two lint rows of section 3 |

**README.md changes:**
- after the first paragraph, add: "It also says which family companions are present, across extension hosts where the
  editor allows it, and holds the interface document, `docs/companion-interface.md`. For tests, under `src/testing/`
  (never imported by a bundle): `lib-companion/testing/recording-fake`, a command bus that plays any side of the
  interface, records every call, and can answer, reject, stay silent, or answer with a foreign or newer-major
  payload.";
- the "Entry points" cell becomes `` `lib-companion` (`src/index.ts`), `lib-companion/testing/recording-fake` ``;
- add a row to the maintainers' table: first cell "Editor declarations", second cell "`vscode-dts/` holds the editor's
  declaration file for the `extensionsAny` proposal, copied unchanged from lib-authority's, so that the two-argument
  `extensions.getExtension` compiles. It isn't linted or formatted."

**The lint block** (athena on #628: no product source may import a test double):

```ts
  {
    // Test doubles live under src/testing/ and are imported only by tests, so no bundle can carry one.
    files: ['packages/*/src/**/*.ts'],
    ignores: ['packages/*/src/testing/**', '**/*.test.ts', '**/*.fixture.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)testing/',
              message: 'Test doubles under src/testing/ are for tests only.',
            },
          ],
        },
      ],
    },
  },
```

No source on main imports a `testing/` path outside `src/testing/` and the tests (checked with `grep` on 2026-10-13),
so the block reports nothing on main.

Nothing else may change.

## 2. Contract

```ts
// endpoints.ts
export type EndpointKind = 'query' | 'change' | 'push';
export interface EndpointId { readonly commandId: string; readonly kind: EndpointKind }

export const SSH_COMPANION_ID = 'remote-oss.remote-ssh';
export type CompanionId = typeof SSH_COMPANION_ID;
/** The family companions Remote Explorer looks for, in this order. */
export const FAMILY_COMPANIONS: readonly CompanionId[];        // Object.freeze([SSH_COMPANION_ID])

export const EXPLORER_INBOX: {                                 // served by remote-explorer
  readonly setActiveFolders: EndpointId;                       // 'remote-internal.setActiveFolders', push
  readonly sshHostsChanged: EndpointId;                        // 'remote-internal.sshHostsChanged', push
};
export const SSH_ENDPOINTS: {                                  // served by remote-ssh
  readonly getActiveSshRemote: EndpointId;                     // 'remote-internal.getActiveSshRemote', query
  readonly getConfiguredHostnames: EndpointId;                 // 'remote-internal.getConfiguredHostnames', query
  readonly getSshFoldersHistory: EndpointId;                   // 'remote-internal.getSshFoldersHistory', query
  readonly deleteSshFolderFromHistory: EndpointId;             // 'remote-internal.deleteSshFolderFromHistory', change
  readonly openRemoteSshTarget: EndpointId;                    // 'remote-internal.openRemoteSshTarget', change
};
// Both are frozen objects whose members are frozen too (`Object.isFrozen` true at both levels).

// detector.ts
import type {Registration} from './protocol.ts';
import type {CompanionId} from './endpoints.ts';

/** The editor's view of installed and enabled extensions. */
export interface ExtensionLookup {
  hasExtension(extensionId: string): boolean;
  onDidChange(listener: () => void): Registration;
}
export type Presence = 'present' | 'absent';
export interface CompanionDetector extends Registration {
  isPresent(companionId: CompanionId): Presence;
  onPresenceChanged(listener: (companionId: CompanionId) => void): Registration;
}
export function createDetector(lookup: ExtensionLookup): CompanionDetector;

// editor-adapter.ts (added)
export type DetectorEditorApi = Pick<typeof vscode, 'extensions'>;
export function extensionLookup(editor: DetectorEditorApi): ExtensionLookup;

// testing/recording-fake.ts
import type {CommandBus} from '../protocol.ts';
export interface RecordedCall {
  commandId: string;
  /** The argument's `interfaceVersion` value as received (not copied), or undefined when the argument isn't a plain object. */
  interfaceVersion: unknown;
  /** Present only when the argument is a plain object with an own `outcome` property: that property's value. */
  outcome?: unknown;
}
export type FakeAnswer =
  | {kind: 'answer'; result: unknown}
  | {kind: 'reject'; reason: unknown}
  | {kind: 'silent'}
  | {kind: 'foreign'}
  | {kind: 'newerMajor'};
export interface RecordingFake extends CommandBus {
  /** Every executeCommand call, in order. */
  readonly calls: readonly RecordedCall[];
  /** Sets how an id answers from now on; a later call for the same id replaces it. */
  answerWith(commandId: string, answer: FakeAnswer): void;
  /** The callback currently registered for an id through registerCommand, or undefined. */
  registered(commandId: string): ((...commandArguments: unknown[]) => unknown) | undefined;
}
export function createRecordingFake(): RecordingFake;
```

**Rules.**

**Detector:**
1. `createDetector` subscribes once to `lookup.onDidChange`. Then, for each id of `FAMILY_COMPANIONS` in order, it
   asks `lookup.hasExtension(id)` and keeps every id that answers `true` as **seen**.
2. `isPresent(id)` returns `present` for a seen id without asking the lookup again. Otherwise it asks
   `hasExtension(id)`: `true` makes the id seen and returns `present` (no listener runs), and `false` returns
   `absent`.
3. On each `onDidChange` event, for each id of `FAMILY_COMPANIONS` in order that isn't seen, it asks `hasExtension`.
   An id that answers `true` becomes seen, and every listener registered at that moment is then called with it, in
   registration order. A seen id is never asked again and never fires again. Nothing fires for a companion that goes
   away.
4. A seen id stays present for the detector's life. The extension makes one detector per activation, so a companion
   disabled or uninstalled while the window runs keeps its group until the extension host restarts (F-5101 BR-8,
   AC-25, AC-43). This rule lives here, not in the view.
5. `onPresenceChanged` returns a `Registration` whose `dispose` removes that listener only. A second `dispose` does
   nothing.
6. The detector's own `dispose` disposes the `onDidChange` subscription once, after which no listener is called. A
   second `dispose` does nothing more. Only family ids can be asked (the `CompanionId` type). A Microsoft id or a
   fork's id is never asked and never counts (R-21, R-22).

**Adapter:**
7. `extensionLookup(editor)`:
   - `hasExtension(id)` is `editor.extensions.getExtension(id, true) !== undefined`. The second argument is always
     `true`: without the `extensionsAny` grant, core sets it to `false` itself and looks in the calling extension's
     own host only ([oss] `src/vs/workbench/api/common/extHost.api.impl.ts`, `extensions.getExtension`:
     `if (!isProposedApiEnabled(extension, 'extensionsAny')) { includeFromDifferentExtensionHosts = false; }`. The
     same code is in the pinned VSCodium 1.140.06829's `out/vs/workbench/api/node/extensionHostProcess.js` and
     `worker/extensionHostWorkerMain.js`). That is F-5902's silent same-host fallback, with no probe and no
     message;
   - `onDidChange(listener)` returns `editor.extensions.onDidChange(() => listener())`, the editor's disposable
     itself. Core widens it across hosts only with the grant (same file, `get onDidChange`);
   - the adapter never reads `extensions.allAcrossExtensionHosts`, which throws without the grant (same file,
     `checkProposedApiEnabled`).

**Recording fake:**
8. `executeCommand(commandId, argument)` first appends a `RecordedCall`. Then:
   - when an answer is set for the id:
     - `answer` resolves with `result` itself;
     - `reject` rejects with `reason` itself;
     - `silent` returns a promise that never settles;
     - `foreign` resolves with `{}`;
     - `newerMajor` resolves with `{interfaceVersion: {major: INTERFACE_VERSION.major + 1, minor: 0}}`;
   - otherwise, when a callback is registered for the id, it calls the callback with `argument` alone and resolves
     with its return value (`Promise.resolve` of it). A synchronous throw of the callback rejects with that error;
   - otherwise it rejects with `` new Error(`command '${commandId}' not found`) ``, core's text (see companion-04).
9. `registerCommand(commandId, callback)` stores the callback for the id, replacing an earlier one. It returns a
   `Registration` whose `dispose` removes the id's callback only while it is still this callback.
10. `calls` is the live list of the fake's records: a test reads it after acting.

## 3. Test table

**Fakes:**
- **The fake editor** for the adapter has `extensions.getExtension(id, flag)`, which records `[id, flag]` and returns
  an object for the ids the row lists, otherwise `undefined`. Its `extensions.onDidChange(listener)` records the
  listener and returns a disposable object `D`. Reading `extensions.allAcrossExtensionHosts` throws, and that getter
  counts its reads.
- **The fake lookup** for the detector has a mutable set of present ids. It counts `hasExtension` calls per id, and its
  `onDidChange` stores the listener, returns a registration that counts its disposals, and lets the test fire the
  event.

| Cite | Given | Expected |
|---|---|---|
| F-5902.5.contract | `SSH_ENDPOINTS` and `EXPLORER_INBOX` | exactly the five and the two members of section 2, with those ids and kinds (`deepStrictEqual`); every id starts with `remote-internal.`; `Object.isFrozen` is true for both objects and for every member |
| F-5902.5.contract | `SSH_COMPANION_ID`, `FAMILY_COMPANIONS` | `'remote-oss.remote-ssh'`; `['remote-oss.remote-ssh']`, frozen |
| F-5902.5.detection | the lookup has `remote-oss.remote-ssh` at creation; `isPresent(SSH_COMPANION_ID)` twice | `present` both times; `hasExtension` was asked once in all (at creation) |
| F-5101.AC-12 | the lookup has nothing; `isPresent` | `absent`; asked twice (creation and the call) |
| F-5101.AC-38 | (each) the lookup has `ms-vscode-remote.remote-ssh`; has `ms-vscode-remote.remote-ssh` and `remote-oss.remote-ssh-edit`; has `REMOTE-OSS.remote-ssh` | `isPresent` is `absent`; `hasExtension` was only ever asked for `remote-oss.remote-ssh` |
| F-5101.AC-13 | absent at creation; a listener registered; the companion is added and the event fired | the listener was called once with `'remote-oss.remote-ssh'`; then `isPresent` is `present` without a further `hasExtension` call |
| F-5101.AC-13 | absent at creation; the event fires twice with the companion still absent, then once after it is added, then once more | the listener was called exactly once, after the third event |
| F-5101.AC-25 | present at creation; the companion is removed from the lookup and the event fired; then `isPresent` | no listener call; `present`; no `hasExtension` call after creation |
| F-5101.AC-43 | a detector saw the companion; the companion is removed; a new detector is created over the same lookup (the extension host restarted) | the new detector's `isPresent` is `absent` |
| F-5101.BR-8 | absent at creation; `isPresent` returns `absent`; the companion is added with no event; `isPresent` again; then the event fires | `present` on the second call; the listener isn't called by the event (already seen) |
| F-5902.5.detection | two listeners A and B registered, then A's registration disposed (twice); the companion is added and the event fired | only B was called |
| F-5902.5.detection | the detector disposed twice; then the companion is added and the event fired | the lookup's registration was disposed exactly once; no listener was called |
| F-5902.AC-26 | `extensionLookup(fakeEditor)` with `remote-oss.remote-ssh` present: `hasExtension('remote-oss.remote-ssh')`, `hasExtension('other.id')` | `true`, `false`; `getExtension` received `['remote-oss.remote-ssh', true]` and `['other.id', true]`; `allAcrossExtensionHosts` was never read |
| F-5902.5.detection | `extensionLookup(fakeEditor).onDidChange(listener)`, then the fake editor's recorded listener is called with an argument | the result is `D` itself; `listener` was called once, with no argument |
| F-5902.AC-18 | `createRecordingFake()`; `answerWith(HOSTS, {kind: 'answer', result: R})`; `executeCommand(HOSTS, writeEnvelope())` | resolves with `R` itself; `calls` is `[{commandId: HOSTS, interfaceVersion: {major: 1, minor: 0}}]` with no `outcome` property, and its `interfaceVersion` is the argument's object itself |
| F-5902.AC-19 | `executeCommand('remote-internal.setActiveFolders', writeActiveFoldersPush({outcome: 'connected', hostKey: 'h'}))` with no answer and no callback; then with `undefined`, `'text'` and `{outcome: undefined}` as the argument | the first rejects with `Error` `command 'remote-internal.setActiveFolders' not found`, and records `outcome: 'connected'`; the records of the others are `{commandId, interfaceVersion: undefined}` with no `outcome` (twice), then `{commandId, interfaceVersion: undefined, outcome: undefined}` with the property present |
| F-5902.AC-5 | (each) `answerWith(id, {kind: 'reject', reason: E})`, then `executeCommand` | rejects with `E` itself |
| F-5902.AC-11 | (each) the answers `foreign` and `newerMajor`, read with `readHostnames` | `{}` refused `foreign`; `{interfaceVersion: {major: 2, minor: 0}}` refused `unknownMajor` |
| F-5902.AC-15 | `answerWith(id, {kind: 'silent'})`; race the call against a promise resolved after 20 ms | the 20 ms promise wins |
| F-5902.5.rules | `registerCommand('x', callback)`, where the callback returns `V`; `executeCommand('x', A)`; then a callback that throws `E` | resolves with `V`, and the callback got `A` alone; rejects with `E` |
| F-5902.5.rules | `registerCommand('x', first)`, then `registerCommand('x', second)`; dispose the first registration; then `registered('x')`; dispose the second; `registered('x')` | `second`; `undefined` |
| F-5902.5.rules | a registered callback and `answerWith('x', {kind: 'answer', result: R})` | the answer wins: `R`, and the callback isn't called |
| F-5902.5.rules | `createProtocol({bus: fake, timers})` from companion-04 (the timers aren't advanced): `call` for an unset, unregistered id; for a `newerMajor` id; for a `reject` id | causes `notRegistered`, `unknownMajor`, `rejected` |
| F-5902.AC-6 | `docs/companion-interface.md`, read with `node:fs` from the test's own location | its first line is `# Companion interface 1.0` and matches `INTERFACE_VERSION`; every id of `SSH_ENDPOINTS` and `EXPLORER_INBOX` appears between backticks; `opensshremotes.openConfigFile` and `opensshremotes.addNewSshHost` appear; the text doesn't contain `remote-tunnels.internal.` |
| F-5902.5.contract | the same document | it contains, after joining its lines with single spaces, the sentence "A request with a `path` and no `kind` is malformed: the companion opens nothing and rejects the call, shows nothing and writes nothing." |
| F-5902.5.contract | the same document | it contains, joined the same way, the sentence "A `kind` without a `path` is ignored, and the host opens with no folder." |
| F-5902.5.rules | `tools/eslint-config.test.ts`: `new ESLint({cwd: <repository root>})`, then `calculateConfigForFile` for `packages/lib-companion/src/probe.ts`, `packages/remote-explorer/src/model/probe.ts`, `packages/lib-companion/src/testing/probe.ts`, `packages/lib-companion/test/unit/probe.test.ts` and `packages/lib-companion/src/probe.fixture.ts` | the rule `no-restricted-imports` is `error` for the first two paths, and off or absent for the other three |
| F-5902.5.rules | a core `Linter` (flat config, the default parser) with `no-restricted-imports` set to the options the first path's configuration returned; verify (each) `import {x} from 'lib-companion/testing/recording-fake';`, `import {x} from './testing/recording-fake';`, `import {x} from '../testing/x';`, `import {x} from 'lib-companion';`, `import {x} from './protesting/x';` | one `no-restricted-imports` message each for the first three, with the block's text; none for the last two |

28 rows (an (each) row counts once). `HOSTS` is `'remote-internal.getConfiguredHostnames'`, `R`, `V`, `A` and
`E` are distinct fresh objects, and "the timers" in the protocol row is a `Timers` whose `setTimer` returns
`undefined` and whose `clearTimer` does nothing.

## 4. The interface document

Write `packages/lib-companion/docs/companion-interface.md` with exactly this text, then run `pnpm format` on it. Only
prettier's changes may follow; the words are fixed. The text is F-5902 §5 (remote-oss/remote-explorer#14) put into
the payload shapes of companion-02.

```text
# Companion interface 1.0

The calls between Remote Explorer (`remote-oss.remote-explorer`) and the family extension that serves it,
`remote-oss.remote-ssh`. The text comes from remote-oss/remote-explorer#14 (F-5902 §5), the interface's single text,
and this file is its one copy in this repository. Within version 1, fields are only added, never renamed or retyped.

## The envelope

Every argument and every result is a plain-data object (strings, numbers, booleans, arrays and plain objects) with the
field `interfaceVersion`: an object `{major, minor}` of two non-negative integers. This document is version
`{major: 1, minor: 0}`.

- A receiver ignores fields it doesn't know, and treats a missing optional field as absent.
- A payload is foreign when it isn't a plain object, has no `interfaceVersion`, has one that isn't two non-negative
  integers, lacks a required field, or has a field of the wrong type.
- A payload whose `major` isn't 1 has an unknown major version. Any `minor` is accepted.
- A path is the string the companion records, never an object.
- A query's argument is the envelope alone, `{interfaceVersion}`.

## The calls

| Id | Served by | Called by, and when | Kind | Argument | Result |
|---|---|---|---|---|---|
| `remote-internal.getActiveSshRemote` | remote-ssh | remote-explorer, as the first call of every build of the view | query | envelope | ActiveRemote |
| `remote-internal.getConfiguredHostnames` | remote-ssh | remote-explorer, on every build of the "SSH" group and on every change signal | query | envelope | Hostnames |
| `remote-internal.getSshFoldersHistory` | remote-ssh | remote-explorer, on every build of the folder rows | query | envelope | FoldersHistory |
| `remote-internal.deleteSshFolderFromHistory` | remote-ssh | remote-explorer, on "Remove from Recent List" | change | DeleteRequest | DeleteResult |
| `remote-internal.openRemoteSshTarget` | remote-ssh | remote-explorer, on the connect actions | change | OpenRequest | envelope |
| `remote-internal.setActiveFolders` | remote-explorer | remote-ssh, as "When the active folders are pushed" says | push | ActiveFoldersPush | none |
| `remote-internal.sshHostsChanged` | remote-explorer | remote-ssh, as "The change signal" says | push | envelope | none |

No id is in `contributes.commands` or in any menu. The extension that serves an id declares an `onCommand:` activation
event for it.

## The payloads

### ActiveRemote

| Field | Type | Required | Meaning |
|---|---|---|---|
| `connected` | boolean | yes | whether the window is an SSH window whose connection has succeeded |
| `hostKey` | string | when `connected` is true | the host part of the window's authority as written: the alias for a window opened from a configured host, the encoded form for a typed `user@host` |

"None" is `{connected: false}`: in a local, container, tunnel or virtual window, and in an SSH window whose connection
hasn't succeeded. The companion answers it at once outside SSH windows, with no connection attempt and no UI. A
receiver ignores a `hostKey` sent with `connected: false`.

### Hostnames

| Field | Type | Required | Meaning |
|---|---|---|---|
| `hostnames` | array of strings | yes | the SSH host aliases from the effective SSH configuration, in the companion's order, without HostName, User or Port |

### FoldersHistory

| Field | Type | Required | Meaning |
|---|---|---|---|
| `hosts` | array of HostHistory | yes | one entry per host key |

A HostHistory is `{hostKey, entries}`: the host key as in ActiveRemote, and its entries, most recent first, repeats
kept. An entry is `{path, kind}`, with `kind` `"folder"` or `"workspace"`. Only paths whose connection succeeded are
recorded. The companion always sends this order; the view sorts by `remote-explorer.foldersSortOrder`.

### DeleteRequest and DeleteResult

The request is `{hostKey, path}`, both strings and both required. The companion removes every copy of `path` under
`hostKey`, and none under any other key. The result is `{changed}`, a boolean: whether the history changed.

### OpenRequest

| Field | Type | Required | Meaning |
|---|---|---|---|
| `hostKey` | string | yes | the host key exactly as written, case kept |
| `path` | string | no | one path to open |
| `kind` | `"folder"` or `"workspace"` | no | the kind of `path` |
| `window` | `"current"` or `"new"` | yes | the window to open in |

The view sends `kind` exactly when it sends `path`: `"workspace"` for a path ending in the lower-case
`.code-workspace`, `"folder"` for any other path. The companion opens a `"workspace"` as a workspace and a `"folder"`
as a folder, as told, never by its own test of the path. A request with a `path` and no `kind` is malformed: the
companion opens nothing and rejects the call, shows nothing and writes nothing. A `kind` without a `path` is ignored,
and the host opens with no folder. The result is the envelope, sent once the companion has started the open.

### ActiveFoldersPush

| Field | Type | Required | Meaning |
|---|---|---|---|
| `outcome` | `"connected"`, `"failed"` or `"none"` | yes | the outcome of the window's first resolve attempt in this extension-host session; `"none"` in a local window |
| `hostKey` | string | no | the window's host key; absent in a local window |
| `folders` | array of strings | no | the window's workspace folder paths |

The push only wakes Remote Explorer. Remote Explorer uses nothing of its contents and stores nothing from it.

## Rules for every call

- The caller gives each call 10 seconds, measured by itself from the moment it makes the call. A call that hasn't
  answered by then has failed. No call is left pending.
- A failed call isn't retried. The next Refresh or window start makes one new attempt of each call of a build, and the
  next change signal one new attempt of the host-list call.
- A receiver never rejects a foreign argument or one with an unknown major version, and never acts on one: it writes
  nothing, shows nothing and opens no window. A query returns its empty result (`{connected: false}`,
  `{hostnames: []}` or `{hosts: []}`, each with the envelope), and a change or push returns nothing.
- A caller that gets a foreign result, or one with an unknown major version, treats the companion as unavailable,
  silently.
- Remote Explorer shows nothing and writes nothing for a version mismatch; it has no log channel. remote-ssh writes one
  line in its own log channel the first time in an extension-host session that it receives or gets back a payload with
  an unknown major version, naming the id, the received major version and its own. There's no notification.
- A pushing caller swallows every rejection, with no notification, output or status change.
- Nothing in a payload goes online, and no payload carries telemetry.

## The order of a build's calls

Each full build of the view (first show, window start, Refresh) makes `remote-internal.getActiveSshRemote` its first
call. It doesn't wait for that answer: `remote-internal.getConfiguredHostnames` and
`remote-internal.getSshFoldersHistory` follow at once, and the three run in parallel. The view renders the build when
every call has answered or failed. The "connected" marker comes from `remote-internal.getActiveSshRemote` alone, never
from a push. A change signal starts a partial build that makes only the `remote-internal.getConfiguredHostnames` call.

When a call fails, Remote Explorer writes no setting and shows no notification:

- `remote-internal.getActiveSshRemote`: no row is marked "connected";
- `remote-internal.getConfiguredHostnames`: the "SSH" group is shown, expanded, with no host rows;
- `remote-internal.getSshFoldersHistory`: the host rows are shown as leaves;
- `remote-internal.deleteSshFolderFromHistory`: the row stays where it was;
- `remote-internal.openRemoteSshTarget`: nothing opens, and the view is unchanged.

## When the active folders are pushed

remote-ssh pushes `remote-internal.setActiveFolders` once per extension-host session:

- in an SSH window with a folder or workspace open, after its first resolve attempt ends, whether it succeeded or
  failed;
- in a local window with a folder or workspace open, right after it activates, with outcome `"none"` and no host key.

It never pushes in an empty window, and never on a folder change within the session.

## The change signal

remote-ssh calls `remote-internal.sshHostsChanged` in exactly two cases, each within 1 second:

- the user saves an editor that remote-ssh's own "Open SSH Config File" flow opened, measured from the save completing;
- remote-ssh's "New Remote" flow has written a host entry, measured from the write.

It sends nothing for a save from an editor its flow didn't open, a save of an included file, a change made by another
program, or a save of an unrelated file. Neither side watches files. On the signal, Remote Explorer rebuilds the "SSH"
group's host rows only, not the folder rows. A change of `remote.SSH.configFile` needs no signal: Remote Explorer
reacts to that setting itself. History changes are never signalled.

## Detection

Remote Explorer decides that the "SSH" group exists from `remote-oss.remote-ssh` being installed and enabled, never by
calling a command. It looks across extension hosts with the `extensionsAny` proposal. Without the grant, it looks in its
own extension host only, and a companion in another host counts as absent, silently. Microsoft's ids and community
forks never count. When the companion is absent, Remote Explorer calls none of its ids, internal or public. A companion
that arrives while the window runs is seen within 10 seconds. One that is disabled or uninstalled while the window runs
keeps its group until the extension host restarts. Every call goes through `commands.executeCommand`, and exports are
never used.

## Hand-over commands

Remote Explorer also calls two public commands of remote-ssh, with no argument and no envelope:
`opensshremotes.openConfigFile` ("Open SSH Config File") and `opensshremotes.addNewSshHost` ("New Remote"). It calls
them only when remote-ssh is present. When one fails, remote-ssh's own error is what the user sees, and Remote
Explorer adds nothing and doesn't hand the rejection on to the editor.

## Not in this release

The tunnels part of F-5902 §5 (the family's tunnels companion, `remote-oss.remote-server`, and its `remote-tunnels.*`
ids) isn't built in this release, by decision D-55. It joins this document as an added section, under a new minor
version, when it is built.
```

## 5. Rule for the builder

As card log-01; tests first, one `it` per row (per input for an (each) row), the name starting with the cite. Fix
only what fails or is missing; no signature or contract change; no behaviour for section 6. Names of four characters
or more, properties included; no `const` arrow helpers; comments only where the guide requires them, none with a
feature, rule or decision id (ids may appear in test names); table loops in tests, no duplicated code (jscpd flags
five-line clones). Coverage of `endpoints.ts`, `detector.ts`, `editor-adapter.ts` and `testing/recording-fake.ts`:
100 % lines, branches and functions.
Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`. (A library's `src/index.ts`
exports aren't reported by `pnpm dead`. The recording fake's exports are used by its own tests.)

## 6. Review

PR title `lib-companion: detector, endpoint ids, interface document 1.0 and recording fake (card companion-05, #627)`.
themis or triton reviews; athena gives the design check, including the document's text against F-5902 §5. The
description answers R1–R6 and maps each cite to its test name.

## 7. Open rows (stop and report on #627)

1. companion-04 (#625) isn't on main. Stop before writing anything.
2. `pnpm dead` or `check-layout` reports the `./testing/recording-fake` export or the `vscode-dts` folder. Report the
   exact message, and don't add an ignore entry.
3. The fake's `silent` answer leaves a promise pending for the life of the test process. If mocha doesn't exit, report
   it; don't add `--exit`.
4. A document line that prettier rewraps differently from the text above is fine; a change of words isn't.
