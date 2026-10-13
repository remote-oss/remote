# Task card companion-04: the call protocol of lib-companion (caller, server wrapper, fire-and-forget)

Issue: #625. Release 0.3 (#43). Why: every call between Remote Explorer and a family companion follows the same rules
(remote-oss/remote-explorer#14 F-5902 §5 "Rules for every row", "Foreign callers and payloads", "A call fails at run
time"; `contracts.md` §4.1). This card builds them once, over a command bus and a clock that the extension passes in.
Builder: selene. Size: about 2 agent-days. Depends on companion-01..03 (merged). No `vscode` import outside the type
import of `src/editor-adapter.ts`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-companion/src/protocol.ts` | new: the ports, the types, `CALL_LIMIT_MILLISECONDS`, `createProtocol` |
| `packages/lib-companion/src/editor-adapter.ts` | new: `commandBus` and `systemTimers` |
| `packages/lib-companion/test/unit/protocol.test.ts` | new |
| `packages/lib-companion/test/unit/editor-adapter.test.ts` | new |
| `packages/lib-companion/src/index.ts` | add `export * from './protocol.ts';` and `export * from './editor-adapter.ts';`, and replace the fileoverview's last sentence "Nothing here touches the editor or a process." with "The call protocol runs over a command bus and a clock that the extension passes in; only the editor adapter knows the editor's API." |
| `packages/lib-companion/README.md` | the "Allowed imports" cell becomes `` `vscode` types in `src/editor-adapter.ts` only (the adapter takes the API as a parameter); no extension, no library `` (as lib-identifiers) |

Nothing else may change. `payloads.ts`, `history.ts` and `host-key.ts` stay as they are.

## 2. Contract

```ts
// protocol.ts
import type {ReadOutcome, Versioned} from './payloads.ts';

/** Something registered that can be undone. */
export interface Registration { dispose(): unknown }

/** The editor's command operations that the protocol needs. */
export interface CommandBus {
  executeCommand(commandId: string, argument: unknown): PromiseLike<unknown>;
  registerCommand(commandId: string, callback: (...commandArguments: unknown[]) => unknown): Registration;
}

/** Runs a callback once after a delay, and cancels it. */
export interface Timers {
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
}

export const CALL_LIMIT_MILLISECONDS = 10_000;

export type UnavailableCause = 'notRegistered' | 'rejected' | 'timeout' | 'foreignPayload' | 'unknownMajor';
export type CallOutcome<Value> =
  | {status: 'answered'; value: Value}
  | {status: 'unavailable'; cause: UnavailableCause};

export interface VersionMismatch { commandId: string; receivedMajor: number; ownMajor: number }

export type Endpoint<Request> =
  | {
      commandId: string;
      kind: 'query';
      read: (payload: unknown) => ReadOutcome<Request>;
      handle: (request: Request) => unknown;
      /** The result a refused argument gets. */
      empty: () => Versioned;
    }
  | {
      commandId: string;
      kind: 'change' | 'push';
      read: (payload: unknown) => ReadOutcome<Request>;
      handle: (request: Request) => unknown;
    };

export interface ProtocolOptions {
  bus: CommandBus;
  timers: Timers;
  onVersionMismatch?: (mismatch: VersionMismatch) => void;
}

export interface Protocol {
  call<Value>(
    commandId: string,
    argument: Versioned,
    read: (payload: unknown) => ReadOutcome<Value>,
  ): Promise<CallOutcome<Value>>;
  serve<Request>(endpoint: Endpoint<Request>): Registration;
  fireAndForget(commandId: string, argument: Versioned): void;
}

export function createProtocol(options: ProtocolOptions): Protocol;

// editor-adapter.ts
import type * as vscode from 'vscode';
export type CompanionEditorApi = Pick<typeof vscode, 'commands'>;
export function commandBus(editor: CompanionEditorApi): CommandBus;
export const systemTimers: Timers;   // over globalThis.setTimeout and globalThis.clearTimeout
```

**Rules.**

**`call`:**
1. It calls `bus.executeCommand(commandId, argument)` once, with exactly these two arguments. It starts one timer of
   `CALL_LIMIT_MILLISECONDS` at the same moment.
2. The first of these three settles the outcome; whatever comes later changes nothing and raises no unhandled
   rejection:
   - the answer: the timer is cleared, then the outcome comes from `read(answer)`:
     - `valid` → `{status: 'answered', value}`;
     - refused `foreign` → cause `foreignPayload`;
     - refused `unknownMajor` → cause `unknownMajor`, plus the mismatch rule (rule 6), with `receivedMajor` the
       answer's `interfaceVersion.major`;
   - a rejection: the timer is cleared. The cause is `notRegistered` when the reason is an `Error` whose `message` is
     exactly `` `command '${commandId}' not found` `` (VS Code core's text, [oss]
     `src/vs/workbench/services/commands/common/commandService.ts`). Every other reason is `rejected`, and so is a
     synchronous throw of `executeCommand`;
   - the timer firing: cause `timeout`.
3. The promise `call` returns never rejects. There's no retry.

**`serve`:**

4. It calls `bus.registerCommand(endpoint.commandId, callback)` and returns the bus's `Registration` itself. The callback
   reads its first argument only, with `endpoint.read`:
   - `valid` → it returns `endpoint.handle(value)`'s return value unchanged (the same object, a promise included);
   - refused → `handle` isn't called. A `query` returns `endpoint.empty()`, and a `change` or `push` returns
     `undefined`. Nothing is thrown, and nothing else happens.

   On refused `unknownMajor`, the mismatch rule applies too, with `receivedMajor` the argument's
   `interfaceVersion.major`.

**`fireAndForget`:**

5. It calls `bus.executeCommand(commandId, argument)` once and returns `undefined`. It swallows a rejection, and a
   synchronous throw too, with no timer and no hook.

**Mismatch:**

6. Each protocol (one per extension-host session: the extension makes one at activation) calls `onVersionMismatch`
   at most once in its life, at the first unknown major it meets, whether in `call` or in `serve`, with
   `ownMajor` = `INTERFACE_VERSION.major`. Without a hook nothing happens. A `foreign` refusal never calls the hook.

**Adapter:**

7. `commandBus(editor)` forwards to `editor.commands.executeCommand(commandId, argument)` and to
   `editor.commands.registerCommand(commandId, callback)`, returning their results unchanged. `systemTimers` calls
   `globalThis.setTimeout(callback, milliseconds)` and `globalThis.clearTimeout(handle)`.

## 3. Test table

**Fakes:**
- **The fake bus** records each `executeCommand` call as its argument list and each registration as its id and
  callback. For each id it answers as the row says: resolve with a value, reject with a reason, never settle (a
  promise kept pending), or throw synchronously.
- **The manual clock** is a `Timers` that keeps pending callbacks with their due time. `advance(milliseconds)` runs
  those that fall due, and `pending()` counts them.

`V1` is `writeEnvelope()`, and `HOSTS` is `` 'remote-internal.getConfiguredHostnames' ``. "No unhandled rejection" means
a `process.on('unhandledRejection')` listener, added for the test and removed after it, saw nothing by the end of a
`setImmediate` turn.

| Cite | Given | Expected |
|---|---|---|
| F-5902.5.rules | `call(HOSTS, V1, readHostnames)`; the bus resolves `writeHostnames({hostnames: ['a', 'b']})` | `{status: 'answered', value: {interfaceVersion: {major: 1, minor: 0}, hostnames: ['a', 'b']}}`; the bus's calls are exactly `[[HOSTS, V1]]`, with `V1` the same object; `pending()` is 0 |
| F-5902.AC-15 | the bus never settles; `advance(9_999)`, then `advance(1)` | still pending after 9 999 ms (checked with a race against a resolved marker); then `{status: 'unavailable', cause: 'timeout'}` |
| F-5902.AC-15 | (each) after the timeout of the previous row, the bus resolves a valid answer; in a second run it rejects with `new Error('late')` | the outcome stays `timeout`; no unhandled rejection |
| F-5902.AC-5 | (each) the bus rejects with `new Error('boom')`; with the string `'boom'`; `executeCommand` throws `new Error('sync')` | `{status: 'unavailable', cause: 'rejected'}`; `pending()` is 0 |
| F-5902.AC-5 | the bus rejects with `` new Error(`command '${HOSTS}' not found`) ``; in a second run with ``new Error("command 'remote-internal.other' not found")`` | cause `notRegistered`; cause `rejected` |
| F-5902.5.foreign | (each) the bus resolves `undefined`; `{hostnames: ['a']}`; `{interfaceVersion: {major: '1', minor: 0}, hostnames: []}` | cause `foreignPayload`; the hook isn't called |
| F-5902.AC-32 | with a recording hook: the bus resolves `{interfaceVersion: {major: 2, minor: 0}, hostnames: ['a']}`, then a second call gets major 3 | both `unknownMajor`; the hook was called exactly once, with `{commandId: HOSTS, receivedMajor: 2, ownMajor: 1}` |
| F-5902.AC-32 | a protocol without a hook gets an answer of major 2 | cause `unknownMajor`, and nothing is thrown |
| F-5902.5.rules | `serve` of a `query` endpoint on `HOSTS` with `readEnvelope`, whose `handle` returns an object `R`; the registered callback is called with `V1`, and once more with `(V1, 'extra')` | `serve` returns the bus's registration object itself; both calls return `R` itself; `handle` was called twice, with `{interfaceVersion: {major: 1, minor: 0}}` |
| F-5902.5.rules | a `change` endpoint whose `handle` returns a promise `P` | the callback returns `P` itself |
| F-5902.AC-11 | (each) the query endpoint's callback with `undefined`, `{}`, `'text'`, `{interfaceVersion: {major: 2, minor: 0}}` | it returns a result deep-equal to `writeHostnames({hostnames: []})` (the endpoint's `empty` is `() => writeHostnames({hostnames: []})`); `handle` isn't called; nothing is thrown |
| F-5902.AC-11 | (each) a `change` endpoint with `readDeleteRequest` and a `push` endpoint with `readActiveFoldersPush`, each given `undefined`, `{hostKey: 'h', path: '/p'}` and `{interfaceVersion: {major: 2, minor: 0}, outcome: 'none'}` | `undefined`; `handle` isn't called |
| F-5902.5.rules | with a recording hook: a served argument of major 2, then one of major 5, then `{}` | the hook was called once, with `{commandId: <the endpoint's id>, receivedMajor: 2, ownMajor: 1}` |
| F-5902.5.rules | one protocol with a hook: a `call` answered with major 2, then a served argument of major 2. A second protocol: the same two | the hook was called once by each protocol |
| F-3906.7 | (each) `fireAndForget('remote-internal.setActiveFolders', V1)`; the bus rejects with `new Error('x')`; the bus throws synchronously | it returns `undefined` and throws nothing; the bus got `[['remote-internal.setActiveFolders', V1]]`; `pending()` is 0; no unhandled rejection |
| F-5902.5.rules | `CALL_LIMIT_MILLISECONDS` | `10000` |
| F-5902.5.rules | `commandBus(fakeEditor)`: `executeCommand('x', V1)`, then `registerCommand('y', callback)` | the fake editor got `('x', V1)` and returned its promise, which `executeCommand` returns itself; it got `('y', callback)` with the same callback, and its disposable is returned itself |
| F-5902.5.rules | `systemTimers.setTimer(callback, 1)`, waited 20 ms; a second timer set, then cleared with its handle, waited 20 ms | the first callback ran once; the second never ran |

18 rows (an (each) row counts once). Every row's `it` name starts with its cite.

## 4. Rule for the builder

As card log-01; tests first, one `it` per row (per input for an (each) row), the name starting with the cite. Fix
only what fails or is missing; no signature or contract change; no behaviour for section 6. Names of four characters
or more, properties included; no `const` arrow helpers; comments only where the guide requires them, none with a
feature, rule or decision id (ids may appear in test names); table loops in tests, no duplicated code (jscpd flags
five-line clones). Coverage of `protocol.ts` and `editor-adapter.ts`: 100 % lines, branches and functions.
Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`. (A library's `src/index.ts`
exports aren't reported by `pnpm dead`; `knip.jsonc` exempts them.)

## 5. Review

PR title `lib-companion: the call protocol (card companion-04, #625)`. themis or triton reviews; athena gives the
design check. The description answers R1–R6 and maps each cite to its test name.

## 6. Open rows (stop and report on #625)

1. A `handle` that throws synchronously, or an `onVersionMismatch` hook that throws: the card catches neither. The
   exception reaches the bus, or the caller of `call`, as it is. Not tested.
2. `read` functions never throw (companion-02's contract). A `read` that throws isn't handled.
3. If VS Code core's not-found text differs in the pinned VSCodium build, the `notRegistered` row still passes, but
   the cause is then only a label. Every cause is handled the same by the callers, so report it and don't change the
   rule.
