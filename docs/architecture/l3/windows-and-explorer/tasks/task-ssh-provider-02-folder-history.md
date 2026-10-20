# Task card ssh-provider-02: remote-ssh's folder history store and the two history ids

Issue: #1088. Release 0.3, Remote Explorer increment 2 (#745). Size: M. Builder: `task:claude`. **It can start now**
(athena, brief §6 as amended by #1086): it touches only remote-ssh and leaves slice 1's ids as they are.
Design: `docs/architecture/l3/windows-and-explorer/brief-explorer-increment-2.md` §2 rulings 1, 2 and 7, §3.1, §3.2
and §4.4's last item. Read it first; this card doesn't repeat its reasons.

Sources: F-2503 (`remote-oss/remote-ssh#61`) BR-1 to BR-15; F-3906 (`#83`) rules 3, 5, 9 and 11; lib-companion's
interface 1.0 (`packages/lib-companion/docs/companion-interface.md`); card ssh-provider-01 (the slice-1 ids).

## 1. The store (brief §3.1)

`packages/remote-ssh/src/companion/folder-history.ts` (new):

```ts
/** The extension's own key in `globalState` for the folder history (brief §3.1). */
export const FOLDER_HISTORY_KEY = 'folder.history.v1';

/** `ExtensionContext.globalState`, narrowed. */
export interface HistoryMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** The stored history, read now: a malformed value is no history, a malformed host or entry is dropped. */
export function storedHistory(memento: HistoryMemento): HostHistory[];

/** Records `entry` at the top of `hostKey`'s list, removing any earlier copy of its path (BR-1, BR-2). */
export function recordOpened(memento: HistoryMemento, hostKey: string, entry: HistoryEntry): Promise<void>;

/** Removes every copy of `path` under `hostKey`, drops the host when it is left empty, and says whether anything went. */
export function removeOpened(memento: HistoryMemento, hostKey: string, path: string): Promise<boolean>;
```

- **The stored value** is `{hosts: [{hostKey, entries: [{path, kind}]}]}`. `HostHistory` and `HistoryEntry` are
  lib-companion's types. The format is ours (BR-10), nothing is migrated, and no other key is read.
- **Every write reads the stored value at that moment** and writes the result (BR-15). Nothing is cached in
  memory between calls.
- **Order:** most recent first, folders and workspaces in one list (BR-1). There's no limit and no pruning (BR-6,
  BR-12). A recorded path that's already in the list moves to the top: never two copies under one key (ruling 1).
- **`removeOpened`** uses lib-companion's `removeFolderCopies`. When the host is left with no entries, it drops the
  host (ruling 2: lib-companion keeps it empty; the store doesn't). It writes only when something changed.
- **A host with no entries is never stored**, so `storedHistory` never gives one.

## 2. The recording (brief §3.1, "What is recorded")

`packages/remote-ssh/src/companion/history-recorder.ts` (new):

```ts
/** What the recorder reads of the window: its workspace file and its folders, as `vscode-remote` or other URIs. */
export interface WindowWorkspace {
  workspaceFile(): {scheme: string; authority: string; path: string} | undefined;
  workspaceFolders(): ReadonlyArray<{scheme: string; authority: string; path: string}>;
}

/** The entry this window records, or none (BR-2, BR-3, BR-5). */
export function entryOfWindow(workspace: WindowWorkspace): {hostKey: string; entry: HistoryEntry} | undefined;

/** Records the window's entry once, when the session's first resolve settles and it succeeded. */
export function recordOnFirstResolve(
  resolve: {onFirstResolveSettled(listener: () => void): void; lastResolve(): LastResolve},
  workspace: WindowWorkspace,
  memento: HistoryMemento,
): void;
```

- **`entryOfWindow`:**
  - A workspace file with scheme `vscode-remote` records the file, kind `workspace`. That includes a multi-root
    workspace.
  - Otherwise exactly one workspace folder with scheme `vscode-remote` records the folder, kind `folder`.
  - Anything else records nothing: no folder, a file-only window, a local window, or a folder whose scheme isn't
    `vscode-remote` (BR-5).
  - The path is the URI's `path` with trailing `/` removed, unless the path is `/` itself (BR-3).
  - The key is `hostKeyOfAuthority(authority)` (lib-companion, ruling 7). An authority that gives none (not
    `ssh-remote+…`) records nothing.
- **`recordOnFirstResolve`** registers one `onFirstResolveSettled` listener. When it fires and `lastResolve()` is
  `'succeeded'`, it records the entry. A failed first resolve records nothing (AC-28). It runs once per
  extension-host session, so a reload records again (BR-2).
  - A failed write is swallowed, with no UI and no log line: the history is a convenience, and F-3906 rule 5 keeps
    the extension quiet.
  - The write happens when the resolve settles. That's before anything waits on workspace trust, which is BR-2.
- **The resolver handle:** `register-connect.ts`'s `ConnectRegistration` gains `onFirstResolveSettled(listener)`,
  which passes on to its `resolver` (lib-authority's `onFirstResolveSettled`). When there is no resolver, because
  the proposal is missing, the listener never fires. No lib-authority change.

## 3. The two ids (brief §3.2)

`packages/remote-ssh/src/companion/history-endpoints.ts` (new), in the shape of `slice-endpoints.ts`:

```ts
/** Registers `getSshFoldersHistory` and `deleteSshFolderFromHistory` through `protocol`; the result disposes both. */
export function serveHistoryEndpoints(protocol: Protocol, memento: HistoryMemento): Registration;
```

- **`getSshFoldersHistory`:** a query with `read: readEnvelope`, `handle: () => writeFoldersHistory({hosts:
  storedHistory(memento)})`, and `empty: () => writeFoldersHistory({hosts: []})`. The store's own order, never
  sorted.
- **`deleteSshFolderFromHistory`:** a change with `read: readDeleteRequest`, `handle: async request =>
  writeDeleteResult({changed: await removeOpened(memento, request.hostKey, request.path)})`. It shows nothing and logs
  nothing (rule 5).
- **Foreign, missing or unknown-major arguments** go through `serve` as in slice 1, and the mismatch line is written
  once by the existing `onVersionMismatch`.
- **`extension.ts`:**
  - `serveHistoryEndpoints(companion, context.globalState)` next to `serveSliceEndpoints`, disposed the same way;
  - `recordOnFirstResolve(connect, workspaceOf(vscode), context.globalState)` after the connect registration, where
    `workspaceOf` reads `vscode.workspace.workspaceFile` and `vscode.workspace.workspaceFolders`.
- **`slice-endpoints.ts`'s file comment:** drop "The other commands of the interface are not registered". The
  history ids are served in `history-endpoints.ts`, and the push and the signal come with ssh-provider-03.
- **`tools/unconsumed-allowlist.json`:** remove remote-ssh's `getSshFoldersHistory` and `deleteSshFolderFromHistory`
  entries (#745), since this card consumes them (brief §4.4). `identifiers.json` already lists both as served, and
  the `onCommand:` events stay.

## 4. Rows

Unit rows over fakes (a memory memento `{get, update}` keeping a JSON copy, lib-companion's recording fake for the
protocol, a fake resolve handle):

| File | Cite | Given | Expected |
|---|---|---|---|
| `folder-history.test.ts` | F-2503 BR-1, BR-2, AC-4 | `[f2, f1]` under `host-a`; record `f1` | `[f1, f2]` |
| | BR-1, AC-5 | record a folder then a workspace file | one list, the workspace first, kinds kept |
| | BR-4, AC-8, AC-29 | records under `host-a` and `host-b` | two hosts, each with only its own |
| | BR-6, AC-21 | 122 records on one host | all 122, most recent first |
| | BR-7, AC-31 | remove a host's only entry | the host is gone from the stored value; `true` |
| | BR-7 | remove a path that isn't there | `false`, and no write (the fake counts writes) |
| | BR-15, AC-32 | two recorders on one memento, the second written after the first | both entries survive |
| | BR-10 | the memento holds `42`, `{hosts: 'x'}`, a host with a bad entry | `[]`, `[]`, the host with its good entries |
| `history-recorder.test.ts` | BR-2, AC-3 | a single `vscode-remote://ssh-remote+host-a/home/u/f1` folder, first resolve succeeded | `host-a` gets `{path: '/home/u/f1', kind: 'folder'}` |
| | BR-3, AC-6 | the folder `…/f1/`; the folder `/` | `/home/u/f1`; `/` |
| | BR-2, AC-5 | a workspace file `vscode-remote://ssh-remote+host-a/home/u/w.code-workspace` with two folders | the file, kind `workspace` |
| | BR-5, AC-7, AC-30 | no folder; a local folder; two folders and no workspace file | nothing recorded |
| | AC-28 | first resolve `'failed'` | nothing recorded |
| | BR-2 | the listener fires twice (a fake that calls it twice) | recorded once |
| | rule 5 | the memento's `update` rejects | no throw, no log line |
| `history-endpoints.test.ts` | F-3906 rule 3, AC-3 | the store has two hosts | `getSshFoldersHistory` gives them in the stored order, versioned |
| | rule 5, AC-9 | `deleteSshFolderFromHistory` for a stored path | `{changed: true}`, the store without it; no log line |
| | rule 11, AC-20 | no argument, a foreign one, an unknown major | not acted on, no store change; the mismatch line once for the major |
| `register-connect` rows | — | `onFirstResolveSettled` with and without a resolver | passes the listener on; never fires without one |

The acceptance rows (a real window recording, a second window reading after Refresh, the editor restarted) are the
gate card's (brief §7, rows 1 and 4), through the view that explorer-06 builds.

## 5. Gates and review

All gates, the changed files at 100 %, `pnpm dead` and `check-consumed` clean with the allowlist entries removed.
PR title: `remote-ssh: the folder history store and its two ids (card ssh-provider-02, #1088)`. Request athena only;
hermes assigns the peer.

## 6. Open rows (stop and report on the issue)

1. The `vscode-remote` folder URI's `authority` isn't `ssh-remote+<key>` as `hostKeyOfAuthority` reads it.
2. `onFirstResolveSettled` fires before `lastResolve()` reports the outcome.
