# Task card explorer-05: connect in the current or a new window from a host row

Issue: #641. Release 0.3 (#43), explorer slice 1, item S5 (brief `../brief-remote-explorer.md`, "Slice 1", ruled
233e3b7). Why: "Connect in Current Window..." and "Connect in New Window..." on a host row open that host through the
SSH companion. Sources:
- remote-oss/remote-explorer#10 F-5103 BR-1, BR-2;
- #14 F-5902 §5: the `openRemoteSshTarget` row, "A call fails at run time", AC-21;
- #12 F-5002 §19: out-of-context safety;
- companion-05's interface document: `OpenRequest`, with a bare envelope as the result.

Builder: selene. Size: about 1 agent-day. **Depends on** explorer-04 (#640) merged, which provides `ViewSession`,
`Targets.hostOf`, `CompanionCalls` and the activation's `session`. If it isn't on main, stop (§6 row 1).

The companion does the opening; the explorer only asks. Whether the picking window stays unchanged (new window) or
reloads (current window) is remote-ssh's behaviour (ssh-provider-01) and coverage-25's gate rows 2 and 3.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-explorer/src/view/companion-calls.ts` | `CompanionCalls` gains `open` (§2.1) |
| `packages/remote-explorer/src/view/connect.ts` | new: `connectHandlers` (§2.2) |
| `packages/remote-explorer/src/window-activation.ts` | the handlers gain the two connect commands (§2.3) |
| `packages/remote-explorer/test/unit/companion-calls.test.ts` | the §3 rows on `open` |
| `packages/remote-explorer/test/unit/connect.test.ts` | new |
| `packages/remote-explorer/test/unit/window-activation.test.ts` | the §3 row on the registered command |

Nothing else may change.

## 2. Contract

### 2.1 `companion-calls.ts`: `open`

```ts
import {type Versioned, readEnvelope, writeOpenRequest} from 'lib-companion';

export type WindowTarget = 'current' | 'new';
// CompanionCalls gains:
  open(hostKey: string, target: WindowTarget): Promise<CallOutcome<Versioned>>;
```

`open(hostKey, target)` is `protocol.call(SSH_ENDPOINTS.openRemoteSshTarget.commandId, writeOpenRequest({hostKey,
window: target}), readEnvelope)`. There's no `path` and no `kind`: slice 1 opens a host with no folder, and a request
without a path carries no kind (companion-05's interface document, `OpenRequest`).

### 2.2 `src/view/connect.ts`

```ts
import type {CommandHandler} from 'lib-identifiers';
import type {ViewSession} from './targets.ts';

export interface ConnectHandlers {
  readonly connectToRemoteInCurrentWindow: CommandHandler;
  readonly connectToRemoteInNewWindow: CommandHandler;
}

/** The two connect commands of a host row, over the view's session once it exists. */
export function connectHandlers(session: () => ViewSession | undefined): ConnectHandlers;
```

**Rules.** Each handler has only `execute`, and no `isAvailable`. `execute(argument)` is an `async` function that
returns `undefined` in every case and never rejects:

1. `current = session()`. When it's `undefined` (the view isn't shown, or the explorer stands down), return.
2. `host = current.targets.hostOf(argument)`. When it's `undefined`, return without a call. That covers no argument,
   a string, `{}`, the group row, an old build's row and a look-alike object (F-5002 §19 items 1, 3 and 7; F-5103
   rows only). The command is silent out of context: explorer-03a's `infoLineCommands` is empty.
3. Otherwise `await current.calls.open(host.row.alias, target)`. `target` is `'current'` for
   `connectToRemoteInCurrentWindow` and `'new'` for `connectToRemoteInNewWindow`. The host key is the alias as
   written, case kept (F-5902 §5, RR-2; F-5103 BR-1).
4. Whatever `open` gives (`answered`, or `unavailable` with any cause), return. Nothing is shown, written or
   rebuilt (F-5902 §5, "`openRemoteSshTarget` fails: nothing opens; the view is unchanged"; AC-21).

### 2.3 `window-activation.ts`

The handlers become `{...silentHandlers(commands), refresh: <explorer-04's>, ...connectHandlers(() => session)}`.
Nothing else changes.

## 3. Test table

**Fakes:**
- **The session fake:** `targets.hostOf` answers a chosen node for one chosen value and `undefined` for everything
  else. `calls.open` records `(hostKey, target)` and returns an outcome the row chooses. `calls.activeRemote` and
  `calls.hostnames` throw if called.
- **`HOST`** is a host node with `row.alias` `'F5103-Upper'`.

| Cite | Given | Expected |
|---|---|---|
| F-5103.BR-1 | `connectToRemoteInCurrentWindow.execute(HOST)`, `open` answering `{status: 'answered', value: writeEnvelope()}` | resolves `undefined`; `open` was called once with `('F5103-Upper', 'current')` |
| F-5103.BR-2 | `connectToRemoteInNewWindow.execute(HOST)` | resolves `undefined`; `open` called once with `('F5103-Upper', 'new')` |
| F-5902.AC-21 | (each) both commands with `open` giving `unavailable` with `rejected`, `timeout`, `foreignPayload`, `unknownMajor` and `notRegistered` | resolves `undefined`; nothing else of the session was used |
| F-5002.19.7 | (each) both commands with `undefined`, `'bogus-f5002'`, `{}`, and a value `hostOf` doesn't know | resolves `undefined`; `open` never called |
| F-5002.19.1 | both commands with `session` giving `undefined` | resolves `undefined`; nothing called |
| F-5002.19.3 | `connectHandlers(...)` | exactly the two keys; each handler has `execute` and no `isAvailable` |
| F-5902.5.rules | `companionCallsOf(createProtocol({bus: fake, timers}))` with companion-05's recording fake: `open('Alias', 'new')`, the fake answering `writeEnvelope()` | the fake recorded `remote-internal.openRemoteSshTarget` once; the argument it received deep-equals `{interfaceVersion: {major: 1, minor: 0}, hostKey: 'Alias', window: 'new'}`, with no `path` and no `kind` property; the outcome is `answered` |
| F-5902.AC-21 | the same with the fake rejecting | `unavailable`, `rejected`; nothing thrown |
| F-5103.BR-1 | `activateInWindow` (explorer-04's serving setup, both queries answered with the host `harness`). Take the host node from the tree provider's `getChildren(group)`, and call the registered `remote-explorer.connectToRemoteInCurrentWindow` callback with it | the bus recorded `remote-internal.openRemoteSshTarget` with `hostKey` `harness` and `window` `current` |
| F-5002.19.7 | the same activation, the registered `remote-explorer.connectToRemoteInNewWindow` callback with no argument | resolves `undefined`; no `openRemoteSshTarget` call recorded |

10 rows (an (each) row counts once). Every `it` name starts with its cite.

## 4. Rule for the builder

Tests first. One `it` per row, or per input for an (each) row. Fix only what fails or is missing; no other signature or
contract change; no behaviour for §6. Names of four characters or more, properties included. No `const` arrow helpers.
Comments only where the guide requires them, none with a feature, rule or decision id (ids may appear in test names).
Table loops in tests, no duplicated code. Coverage of the new and changed files: 100 % lines, branches and functions.

Gates: `pnpm identifiers`, `pnpm check-identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`,
`pnpm build`.

## 5. Review

PR title `remote-explorer: connect in the current or a new window from a host row (card explorer-05, #641)`. themis or
triton reviews; athena gives the design check. The description answers R1–R6 and maps each cite to its test name.

## 6. Open rows (stop and report on #641)

1. explorer-04 isn't on main, or its `ViewSession`, `Targets.hostOf` or `CompanionCalls` differ from what §2 uses.
   Report the difference; don't change explorer-04's code beyond §1.
2. Folder rows and their two connect commands (`connectToFolderInCurrentWindow`, `connectToFolderInNewWindow`) are
   increment 2. They stay unregistered here.
3. Keyboard focus on a host row followed by a keybinding of either command reaches `execute` with no argument, so
   nothing happens (F-5002 §6.2 rule 3, BR-3). There's nothing more to build.
