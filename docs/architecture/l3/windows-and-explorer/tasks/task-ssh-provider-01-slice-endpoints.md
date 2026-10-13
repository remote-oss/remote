# Task card ssh-provider-01: remote-ssh serves the explorer's slice-1 ids

Issue: #635. Release 0.3 (#43), explorer slice 1, item S6 (athena's slice-1 ruling, `brief-remote-explorer.md` at
233e3b7). Why: Remote Explorer's slice 1 lists the SSH hosts, marks the window's own host and connects from a row.
The three calls it makes are answered by remote-ssh (remote-oss/remote-ssh#61 F-2503, reviewed; #83 F-3906 rules 1, 2,
4, 6, 9 and 11; remote-oss/remote-explorer#14 F-5902 §5, the interface's single text; companion-05's
`packages/lib-companion/docs/companion-interface.md` 1.0). Builder: hestia. Size: about 2 agent-days.

**Depends on:**
- companion-04 (#625): `createProtocol`, `commandBus`, `systemTimers`, `Protocol`, `Registration`, `VersionMismatch`;
- companion-05 (#627): `SSH_ENDPOINTS`.

If either isn't on main, stop (section 6, row 1).

**Scope** (athena, 2026-10-13):
- **Served:** exactly three ids, `remote-internal.getConfiguredHostnames`, `remote-internal.getActiveSshRemote` and
  `remote-internal.openRemoteSshTarget`.
- **Not registered:** `remote-internal.getSshFoldersHistory` and `remote-internal.deleteSshFolderFromHistory`, not even
  as stubs. They're increment 2. Their `onCommand:` events stay in the manifest, as they are on main. A call to either
  activates the extension and then rejects with core's "command … not found". The explorer of slice 1 never calls
  them, and F-5902 §5 treats such a rejection as "companion unavailable".
- **Not in this card:** the `setActiveFolders` push and the `sshHostsChanged` signal (increment 2), and the catalogue.
  The explorer's coverage card S8 tags F-2503's criteria, using section 3.2's map.
- **Hosts:** build and test for Linux SSH hosts only. The criteria that need the Windows or macOS path form wait on
  F-2503 Q4.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-authority/src/resolver/connection-state.ts` | add `LastResolve` and `ConnectionTracker.lastResolve()` (section 2.0) |
| `packages/lib-authority/src/resolver/host.ts` | add `lastResolve()` to `ResolverHandle` and its implementation (section 2.0) |
| `packages/lib-authority/src/index.ts` | export `type LastResolve` next to `type ConnectionState` |
| `packages/lib-authority/test/unit/connection-state.test.ts`, `resolver-host.test.ts` | add section 3's lib-authority rows |
| `packages/remote-ssh/src/companion/slice-endpoints.ts` | new: `SliceEndpointPorts`, `serveSliceEndpoints`, `mismatchLine`, `hostListLine` |
| `packages/remote-ssh/test/unit/slice-endpoints.test.ts` | new |
| `packages/remote-ssh/src/register-connect.ts` | add `activeConnection()` to `ConnectRegistration` (section 2) |
| `packages/remote-ssh/test/unit/register-connect.test.ts` | add the three `activeConnection` rows of section 3 |
| `packages/remote-ssh/src/extension.ts` | the wiring of section 2.3 |
| `packages/remote-ssh/package.json` | add `"lib-companion": "workspace:*"` to `dependencies`, in alphabetical order (after `lib-authority`) |
| `packages/remote-ssh/tsconfig.json` | add `{"path": "../lib-companion"}` to `references`, after `../lib-authority` |
| `packages/remote-ssh/README.md` | append to the "Allowed imports" cell: `; \`lib-authority\`, \`lib-companion\`, \`lib-log\` and \`lib-ssh\` in \`src/companion/\`; \`lib-companion\` in \`src/extension.ts\`` |
| `tests/acceptance/suite-local/companion-endpoints.test.ts` | new: the two smoke rows of section 3.1 |
| `pnpm-lock.yaml` | whatever `pnpm install` writes for the new workspace dependency, and nothing else |

Nothing else may change. In particular:
- `identifiers.json` stays as it is (its `internal` rows already list the five ids with `role: served`);
- the manifest stays as it is (its five `onCommand:` events are on main);
- `connect-commands.ts`, `connect-editor.ts` and `lib-ssh` stay as they are.

## 2. Contract

### 2.0 lib-authority: the last settled resolve (athena on #637)

F-5902's row answers "none" only in an SSH window whose connection "has not succeeded", and F-5902 AC-27 keeps the
row marked across a drop and reconnect. lib-authority's tracker knows the current state but not whether the last
settled resolve succeeded: after a drop the state goes `transportLost`, then `resolving` for core's reconnect, which
looks the same as a first resolve. So the tracker keeps one more value, and the resolver handle exposes it. This is the
"connection state of the resolver host" that contracts §3.2 says companion queries answer from. athena records the
addition in §3.2; the builder doesn't edit the contracts.

```ts
// connection-state.ts
/** How the last resolve that settled ended: none settled yet, success, or failure. */
export type LastResolve = 'none' | 'succeeded' | 'failed';

export class ConnectionTracker {
  // ... as on main, plus:
  /** How the last settled resolve of this window ended; `none` until one settles. */
  lastResolve(): LastResolve;
}

// host.ts
export interface ResolverHandle {
  // ... as on main, plus:
  /** How the last settled resolve of this window ended, from the tracker. */
  lastResolve(): LastResolve;
}
```

**Rules.**
- The tracker starts at `none`.
- An applied `resolveSucceeded` sets `succeeded`, and an applied `resolveFailed` sets `failed`.
- Nothing else changes it: `resolveStarted`, `transportLost`, `transportClosed`, and every event the tracker ignores
  (one that doesn't follow the current state).
- `current()`, `apply()`'s result and the listeners stay exactly as on main.

### 2.1 `register-connect.ts`

```ts
import type {LastResolve} from 'lib-authority';

export interface ConnectRegistration {
  registration: Registration['kind'];
  currentAlias(): string;
  /**
   * The window's connection: the authority's host part as written, and how its last settled resolve ended; nothing
   * before the first resolve starts or without a resolver.
   */
  activeConnection(): {hostKey: string; lastResolve: LastResolve} | undefined;
  dispose(): void;
}
```

`activeConnection` is `{hostKey: current.decodedTarget.rawHostString, lastResolve: resolver.lastResolve()}` for
`current = resolver?.currentConnection()`, and `undefined` when there's no resolver or no connection. `rawHostString` is the authority's payload as written: the
alias, the lower-case hexadecimal form of a typed `user@host`, or a typed bare host as typed (lib-authority's codec,
F-2503 BR-4, F-3906 RR-2). Nothing else of `registerConnect` changes.

### 2.2 `companion/slice-endpoints.ts`

```ts
import {type LastResolve, type OpenerHost, openRemote} from 'lib-authority';
import {
  type Protocol,
  readEnvelope,
  readOpenRequest,
  type Registration,
  SSH_ENDPOINTS,
  type VersionMismatch,
  writeActiveRemote,
  writeEnvelope,
  writeHostnames,
} from 'lib-companion';
import type {Logger} from 'lib-log';
import type {HostListResult} from 'lib-ssh';

/** What the three endpoints take from the editor and the window. */
export interface SliceEndpointPorts {
  /** The hosts of the files in effect, read at each call: the host pick's own reading. */
  listHosts(): HostListResult;
  /** The window's connection, as `ConnectRegistration.activeConnection` gives it. */
  activeConnection(): {hostKey: string; lastResolve: LastResolve} | undefined;
  /** The editor's commands, for lib-authority's window opener. */
  opener: OpenerHost;
  /** The Remote - SSH log. */
  logger: Logger;
}

/** Registers the three endpoints through `protocol`; the result disposes all three. */
export function serveSliceEndpoints(protocol: Protocol, ports: SliceEndpointPorts): Registration;

/** The one log line of a version mismatch. */
export function mismatchLine(mismatch: VersionMismatch): string;

/** The log line of a host list that couldn't be read. */
export function hostListLine(file: string, reason: string): string;
```

**Rules.**

1. **Registration.** `serveSliceEndpoints` calls `protocol.serve` three times, in this order:

   | `commandId` | `kind` | `read` | `empty` |
   |---|---|---|---|
   | `SSH_ENDPOINTS.getConfiguredHostnames.commandId` | `query` | `readEnvelope` | `() => writeHostnames({hostnames: []})` |
   | `SSH_ENDPOINTS.getActiveSshRemote.commandId` | `query` | `readEnvelope` | `() => writeActiveRemote({connected: false})` |
   | `SSH_ENDPOINTS.openRemoteSshTarget.commandId` | `change` | `readOpenRequest` | (none) |

   It returns one `Registration` whose `dispose` disposes the three registrations, in the same order. A second
   `dispose` does nothing more. A foreign or unknown-major argument never reaches a handler (companion-04's server
   wrapper). This covers F-3906 rule 11 too: a call with no argument shows nothing, rejects nothing and opens nothing.
2. **`getConfiguredHostnames`** (F-3906 rule 2, F-2202). Each call runs `ports.listHosts()` once. There's no cache.
   - `{hosts}`: the handler returns `writeHostnames({hostnames: hosts.map(entry => entry.name)})`, in the list's
     order, exactly as the host pick lists them (same reading, same order);
   - `{parseError: {file, reason}}`: the handler writes `ports.logger.warn(hostListLine(file, reason))` once, then
     throws `` new Error(`${file}: ${reason}`) ``, the same message as the host pick's. The call rejects, so the view
     shows the "SSH" group with no hosts (F-5902 "A call fails at run time"). remote-ssh shows nothing. The level is
     `warn`, the level the package already writes a configuration problem at (`pipeline/locate-step.ts`, `ssh -G`'s
     parse problem). Rejecting is approved by athena on #637.
3. **`getActiveSshRemote`** (F-3906 rule 4, F-2503 BR-9, F-5902 §5's row and AC-27; athena on #637). The handler
   calls `ports.activeConnection()` and nothing else: no host list, no connection attempt, no UI.
   - When the connection is there and its `lastResolve` is `succeeded`, it returns
     `writeActiveRemote({connected: true, hostKey})`, with `hostKey` exactly as given (case kept, a hex form kept).
     That holds from the session's first successful resolve onward: through `transportLost`, through the reconnect's
     `resolving` and its success, and through `transportClosed`, until a resolve fails.
   - Otherwise it returns `writeActiveRemote({connected: false})`. That covers no connection (a local, container or
     tunnel window, or no resolver), `lastResolve` `none` (before the first success), and `failed` (after a failed
     resolve, until a later one succeeds).

   The answer is synchronous (no promise).
4. **`openRemoteSshTarget`** (F-3906 rule 6, F-2503 6.2–6.4, interface document 1.0 "OpenRequest"). For a request
   `{hostKey, path?, kind?, window}`:
   - `hostKey === ''` → the handler throws `new Error('the host key is empty')`, and nothing opens;
   - `path` present and `kind` absent → the handler throws `new Error('a path needs its kind')`, and nothing opens
     (malformed; athena on #628);
   - otherwise it awaits
     `openRemote(ports.opener, 'ssh-remote+' + hostKey, path !== undefined && kind !== undefined ? {path, pathKind: kind, target: window} : {pathKind: 'folder', target: window})`.
     The host key isn't decoded or re-encoded: it is the authority's payload as written (RR-2). A `kind` without a
     `path` is ignored, and the host opens with no folder.
   - `{kind: 'opened'}` → it returns `writeEnvelope()`;
   - `{kind: 'rejected', reason}` → it throws `new Error(reason)`.

   It writes no history entry and no log line (F-2503 BR-13). An empty `hostKey` is malformed (athena on #637), like a
   path without its kind.
5. **`hostListLine`** returns exactly `` `The Remotes view gets no hosts: ${file}: ${reason}` ``.
6. **`mismatchLine`** returns exactly:
   `` `${commandId}: the other extension uses interface version ${receivedMajor}, and Remote - SSH uses version ${ownMajor}. Update Remote - SSH and Remote Explorer to matching versions.` ``
   This is ours: F-2003 BR-15 and F-3906 rule 9 fix only what the line names. It isn't translated, like every other
   log line.

### 2.3 Wiring in `extension.ts`

- **Host list.** Move the `listHosts(...)` closure that `registerConnectOf` passes to `connectCommandEditorOf` into
  one module function, `configuredHosts(host)`. Both the connect editor and the endpoints use it, so there's one
  reading.
- **Where it registers.** After `registerConnectOf` returns, still in the serving path: under the R-54 stand-down
  nothing of this runs (F-3906 rule 1, F-3901). `activate` creates the protocol:

  ```ts
  const companion = createProtocol({
    bus: commandBus(vscode),
    timers: systemTimers,
    onVersionMismatch: mismatch => {
      result.logger.warn(mismatchLine(mismatch));
    },
  });
  const endpoints = serveSliceEndpoints(companion, {
    listHosts: () => configuredHosts(host),
    activeConnection: () => connect.activeConnection(),
    opener: openerHostOf(vscode),
    logger: result.logger,
  });
  context.subscriptions.push({dispose: () => { endpoints.dispose(); }});
  ```

  One protocol per activation, which is one extension-host session, so the mismatch line is written at most once per
  session and once more after a reload (F-3906 C-14). The endpoints are registered whatever the `resolvers` grant:
  without a resolver, `activeConnection` is `undefined`.
- `openerHostOf` is `connect/connect-editor.ts`'s export, reused unchanged.

## 3. Test table

**Fakes:**
- **The protocol:** companion-04's `createProtocol` over companion-05's `createRecordingFake()` (as the bus) and a
  `Timers` whose `setTimer` returns `undefined` and whose `clearTimer` does nothing. Calls go through
  `fake.registered(id)?.(argument)`.
- **The ports:**
  - `listHosts` returns what the row says and counts its calls;
  - `activeConnection` returns what the row says;
  - `logger` is lib-log's `createLogger` over `lib-log/testing/memory-sink`'s `MemorySink`, at level `trace`;
  - `opener` is an `OpenerHost` whose `executeCommand` records `(command, ...parameters)` and resolves, or rejects
    with `new Error('refused')` where the row says, and whose `addressOf` returns its parts unchanged.

`V1` is `writeEnvelope()`. `HOSTS`, `ACTIVE` and `OPEN` are the three `commandId`s.

| Cite | Given | Expected |
|---|---|---|
| F-3906.5 rule 1 | `serveSliceEndpoints` | `fake.registered` is a function for `HOSTS`, `ACTIVE` and `OPEN`, and `undefined` for `remote-internal.getSshFoldersHistory` and `remote-internal.deleteSshFolderFromHistory`; after `dispose()`, `undefined` for all five; a second `dispose()` throws nothing |
| F-3906.5 rule 2 | `listHosts` gives `{hosts: [{name: 'zeta', file: '/c'}, {name: 'Alpha', file: '/c'}, {name: 'two words', file: '/i'}]}`; `HOSTS` called with `V1` | `{interfaceVersion: {major: 1, minor: 0}, hostnames: ['zeta', 'Alpha', 'two words']}`, deep-equal; `listHosts` was called once |
| F-3906.5 rule 2 | `HOSTS` called twice, the list changed between the two calls | the second answer has the new list; `listHosts` was called twice (no cache) |
| F-5902.5.failure | `listHosts` gives `{parseError: {file: '/c', reason: 'bad line 3'}}` | the callback throws an `Error` whose message is `/c: bad line 3`; the sink holds exactly one line, at `warn`, with the text `The Remotes view gets no hosts: /c: bad line 3` |
| F-5902.5.foreign | (each) `HOSTS`, `ACTIVE` called with `undefined` and with `{interfaceVersion: {major: 2, minor: 0}}` | deep-equal to `writeHostnames({hostnames: []})` and `writeActiveRemote({connected: false})`; `listHosts` and `activeConnection` weren't called |
| F-2503.BR-9 | `activeConnection` gives `{hostKey: 'Build-Box', lastResolve: 'succeeded'}` | `ACTIVE` answers `{interfaceVersion: {major: 1, minor: 0}, connected: true, hostKey: 'Build-Box'}`, synchronously (not a promise) |
| F-2503.BR-4 | `activeConnection` gives `{hostKey: '7b22686f73744e616d65223a2231302e302e302e35222c2275736572223a226c6162227d', lastResolve: 'succeeded'}` | `connected: true` with that `hostKey` unchanged |
| F-2503.BR-9 | (each) `activeConnection` gives `undefined` (a local window); `{hostKey: 'harness', lastResolve: 'none'}` (before the first success); `{hostKey: 'harness', lastResolve: 'failed'}` (after a failed resolve) | `{interfaceVersion: {major: 1, minor: 0}, connected: false}` with no `hostKey` property; `listHosts` wasn't called |
| F-3906.5 rule 6 | `OPEN` with `{...V1, hostKey: 'harness', window: 'new'}`, then with `window: 'current'` | resolves to `V1`, deep-equal; the opener saw `vscode.newWindow` with `{remoteAuthority: 'ssh-remote+harness', reuseWindow: false}`, then with `reuseWindow: true` |
| F-3906.5 rule 6 | `OPEN` with `{...V1, hostKey: '7b22…7d' (the row above's key), window: 'new'}` | the opener saw `remoteAuthority` `'ssh-remote+'` plus that key, unchanged |
| F-3906.5 rule 6 | (each) `OPEN` with `path: '/home/harness/f1', kind: 'folder'`; with `path: '/home/harness/w.code-workspace', kind: 'workspace'`; `window: 'new'` | the opener saw `vscode.openFolder` with the address `{scheme: 'vscode-remote', authority: 'ssh-remote+harness', path: <the path>}` and `{forceNewWindow: true, forceReuseWindow: false}` |
| F-5902.5.contract | `OPEN` with `{...V1, hostKey: 'harness', kind: 'folder', window: 'current'}` (a kind without a path) | `vscode.newWindow` with `reuseWindow: true`; resolves to `V1` |
| F-5902.5.contract | `OPEN` with `{...V1, hostKey: 'harness', path: '/p', window: 'new'}` (no `kind`) | rejects with `a path needs its kind`; the opener saw nothing |
| F-5902.5.contract | `OPEN` with `{...V1, hostKey: '', window: 'new'}` | rejects with `the host key is empty`; the opener saw nothing |
| F-5902.5.failure | the opener rejects with `refused`; `OPEN` with `{...V1, hostKey: 'harness', window: 'new'}` | rejects with an `Error` whose message is `refused` |
| F-3906.5 rule 9 | `mismatchLine({commandId: 'remote-internal.getConfiguredHostnames', receivedMajor: 2, ownMajor: 1})` | exactly `remote-internal.getConfiguredHostnames: the other extension uses interface version 2, and Remote - SSH uses version 1. Update Remote - SSH and Remote Explorer to matching versions.` |
| F-3906.5 rule 9 | a protocol made with a hook that pushes `mismatchLine(mismatch)` to a list; `HOSTS` then `ACTIVE` called with major 2, then `HOSTS` with no argument | the list holds exactly one line, the `HOSTS` one with 2 and 1 |
| F-2503.BR-13 | every row above except the parse-error row | the sink holds no line, and no handler called `executeCommand` on the fake bus (`fake.calls` is empty) |
| F-5902.AC-27 | lib-authority `connection-state.test.ts`, one tracker driven through: (a) `resolveStarted` attempt 1; (b) `resolveSucceeded`; (c) `transportLost`; (d) `resolveStarted` attempt 2; (e) `resolveSucceeded`; (f) `transportLost`, `resolveStarted` attempt 3, `resolveFailed`; (g) `resolveStarted` attempt 4 | `lastResolve()` after each step: (a) `none` (before the first success); (b) `succeeded` (connected); (c) `succeeded` (during transportLost); (d) `succeeded` (the reconnect's resolve); (e) `succeeded` (after a successful reconnect); (f) `failed` (after a failed resolve); (g) `failed`. A fresh tracker gives `none` |
| F-5902.AC-27 | the same file: after `resolveSucceeded`, `transportClosed`; a fresh tracker given `resolveSucceeded` before any `resolveStarted` (ignored) | `succeeded`; `none` |
| contracts §3.2 | lib-authority `resolver-host.test.ts`: `handle.lastResolve()` before any resolve, after a resolve that succeeded, and after one that failed | `none`; `succeeded`; `failed` |
| contracts §3.2 | `register-connect.test.ts`: `activeConnection()` before any resolve; after a resolve of `ssh-remote+dev` that succeeded; without the resolvers grant | `undefined`; `{hostKey: 'dev', lastResolve: 'succeeded'}`; `undefined` |

23 rows (an (each) row counts once). The cites are behaviour-rule forms. An `AC-` cite would pass `check-coverage`
today, since it checks only the features of its coverage sets and F-2503 is in none of them yet. But coverage-25c
(#646) tags F-2503 in the explorer set and adds the AC cites the rows prove, so the rule forms keep this card's rows
out of that judgement.

### 3.1 Smoke rows in the VSCodium run (`tests/acceptance/suite-local/companion-endpoints.test.ts`)

These run in the `local` launch, which has remote-ssh installed and `remote.SSH.configFile` set to the run's
`ssh_config` (`HARNESS_SSH_CONFIG` in the test's environment). They prove the wiring, the activation and the manifest
in the real editor. The test names start with `ssh-provider-01:`, not with an AC, so they tag nothing.

| Name | Steps | Assertions |
|---|---|---|
| `ssh-provider-01: the host list answers with the run's ssh_config hosts in file order` | `vscode.commands.executeCommand('remote-internal.getConfiguredHostnames', {interfaceVersion: {major: 1, minor: 0}})` | the answer deep-equals `{interfaceVersion: {major: 1, minor: 0}, hostnames: <expected>}`. `<expected>` is computed from the file: every line whose first word is `Host` (case-insensitive), each further word in order, skipping words that contain `*` or `?` or start with `!`. Its first entry is `harness` |
| `ssh-provider-01: the active remote of a local window is none, at once` | `executeCommand('remote-internal.getActiveSshRemote', {interfaceVersion: {major: 1, minor: 0}})`, timed with `Date.now()` | deep-equals `{interfaceVersion: {major: 1, minor: 0}, connected: false}`, answered within 1000 ms; then the same call with no argument answers the same (the foreign rule) |

openRemoteSshTarget has no smoke row. Opening a window is gate rows 2 and 3, which S8 runs with the explorer.

### 3.2 F-2503 criteria for S8

These are listed for S8's tagging. This card adds no catalogue line.

**In slice 1, through these ids:**
- AC-1 (activation by `getActiveSshRemote` and `openRemoteSshTarget`);
- AC-2 (manifest);
- AC-12 and AC-13 (the marker);
- AC-18 (host-row connect);
- AC-20 (no argument, for the three ids);
- AC-25 and AC-26 (quiet);
- AC-30, its marker half; the "no child row" half is history;
- AC-14 and AC-29, their marker halves.

**Increment 2** (`explorer slice 1: increment 2`): AC-3 to AC-11, AC-15 to AC-17, AC-19, AC-21 to AC-24, AC-27, AC-28,
AC-31 to AC-33, and the history halves of AC-14, AC-29 and AC-30.

**Waiting on Q4:** the Windows/macOS path form, a reason S8 states on the folder-row criteria it defers.

## 4. Rule for the builder

As card log-01; tests first, one `it` per row (per input for an (each) row), the name starting with the cite. Fix
only what fails or is missing; no signature or contract change; no behaviour for section 6. Names of four characters
or more, properties included; no `const` arrow helpers; comments only where the guide requires them, none with a
feature, rule or decision id (ids may appear in test names); table loops in tests, no duplicated code (jscpd flags
five-line clones). Coverage of `slice-endpoints.ts`, `register-connect.ts`, `connection-state.ts` and `host.ts`: 100 % lines, branches
and functions.

**Gates:** `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-coverage`, `pnpm check-licences`, and
`xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium`. Paste the run's summary with the two smoke rows in the
PR.

## 5. Review

PR title `remote-ssh: serve the explorer's slice-1 ids (card ssh-provider-01, #635)`. themis or triton reviews; athena
gives the design check. The description answers R1–R6 and maps each cite to its test name.

## 6. Open rows (stop and report on #635)

1. companion-04 or companion-05 isn't on main. Stop before writing anything.
2. If the `local` launch doesn't install remote-ssh or doesn't set `remote.SSH.configFile` to the run's
   `ssh_config`, report it. Don't change the launch: the smoke rows then wait for S7 (tooling-30).

## 7. Note for increment 2 (athena on #637, not this card's work)

"As told" means a request with `kind: 'folder'` opens a folder even when its path ends in `.code-workspace`, in any
case. `vscode.openFolder` judges by the path's suffix itself ([oss]
`src/vs/workbench/browser/actions/workspaceCommands.ts`, `hasWorkspaceFileExtension`), and lib-authority's opener
passes no kind to core. So the folder-row card of increment 2 checks that case first. If core opens such a folder as a
workspace, the opener needs an explicit folder route for a told folder. Slice 1 never sends a path, so nothing here
depends on it.
