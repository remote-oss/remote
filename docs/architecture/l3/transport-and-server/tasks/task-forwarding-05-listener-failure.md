# Task card forwarding-05: a window tunnel whose listener fails after listening (#228)

Why: `nodeLocalPort().listen` removes its `error` handler once the server listens, so a later `net.Server` error has
no listener and throws in the extension host. The ruling of #253 Q1 (contracts.md §6 W2 and W3, a8ce1e5) makes the
error a closed tunnel: the adapter tells it once, the relay tunnel closes its connections and tells its closed
listeners, and the factory drops the entry. Reviewing coder: `remote-coding-worker-1`; design check `athena`
against the three rules of the ruling.

## 1. File boundary

All under `packages/lib-forwarding/`:

- `src/window-tunnel/ports.ts`: `LocalPort.listen` gains `onFailure`.
- `src/window-tunnel/node-network.ts`: the new exported function `listenOn`; `nodeLocalPort().listen` calls it.
- `src/window-tunnel/relay.ts`: the `open` outcome gains `onClosed`.
- `src/window-tunnel/forwarded.ts`: its `open` outcome gets the `onClosed` that never fires.
- `src/window-tunnel/factory.ts`: the entry leaves the list; `reconnect` reports only listed entries.
- `src/testing/fake-network.ts`: `FakeLocalPort.listen` keeps `onFailure`; the new method `fail`.
- `test/unit/node-network.test.ts`: the three existing `listen` calls pass `() => undefined` as the third argument
  (lines 47, 162 and 163 on main); the new rows.
- `test/unit/window-tunnel.test.ts`, `test/unit/tunnel-factory.test.ts`: the new rows.

Nothing else. `src/index.ts` is unchanged (`listenOn` is imported by the test from
`../../src/window-tunnel/node-network.ts`, not exported from the package). `tests/acceptance/server/port-forwarding.test.ts`
reads only `kind`, `address` and `close` and needs no edit. `coverage.json` is unchanged.

## 2. Contract

### ports.ts

```ts
export interface LocalPort {
  listen(
    port: number,
    onConnection: (connection: Duplex) => void,
    /** Told at most once, for an error after listening, and never after the `Listening` is closed. */
    onFailure: (detail: string) => void,
  ): Promise<Listening>;
  connect(port: number): Promise<Duplex>;
}
```

### node-network.ts

```ts
import {createConnection, createServer, type Server, type Socket} from 'node:net';
import type {Duplex, Listening, LocalPort} from './ports.ts';

/**
 * Listens with `server` on `port` of the loopback. An error before listening rejects; the first error after it is
 * told to `onFailure` and closes the server. Later errors, and errors after `close`, are not told.
 */
export function listenOn(
  server: Server,
  port: number,
  onConnection: (connection: Duplex) => void,
  onFailure: (detail: string) => void,
): Promise<Listening>;
```

Behaviour of `listenOn`, in this order:

1. `server.on('connection', socket => onConnection(socketDuplex(socket)))`.
2. `server.once('error', reject)`; `server.listen(port, LOOPBACK, callback)`.
3. In the callback: `server.off('error', reject)`; a local `let ended = false`; `server.on('error', error => …)`
   which, when `ended` is false, sets `ended = true`, calls `server.close()`, then `onFailure(error.message)`;
   then `resolve({close})` where `close` sets `ended = true` and calls `server.close()`.

`nodeLocalPort().listen` becomes `(port, onConnection, onFailure) => listenOn(createServer(), port, onConnection,
onFailure)`. `connect` and `socketDuplex` are unchanged.

### relay.ts

```ts
export type WindowTunnelOutcome =
  | {
      kind: 'open';
      address: WindowAddress;
      close: () => void;
      /** Registers a listener for the tunnel ending without being asked to, with the reason. */
      onClosed: (listener: (detail: string) => void) => void;
    }
  | {kind: 'tunnelNotReady'}
  | {kind: 'listenFailed'; detail: string};
```

In `openRelayTunnel`:

- New locals before the `listen` call: `const closedListeners: Array<(detail: string) => void> = [];`,
  `let ended: {detail: string} | undefined;`, and a function `closeConnections()` holding the loop that closes every
  connection in `[...active]` (moved out of `close`, which now calls `listening.close()` then `closeConnections()`).
- The third argument of `request.local.listen` is `detail => { ended = {detail}; closeConnections(); for each
  listener of closedListeners.splice(0): listener(detail); }`. No guard: the adapter promises at most once and never
  after close.
- After `succeedsWithin` returns and before the `!ready` check: when `ended !== undefined`, return
  `{kind: 'listenFailed', detail: ended.detail}` (the listener failed during the wait; nothing is left to close).
- The `open` result adds `onClosed: listener => { if ended is undefined, push it onto closedListeners; otherwise
  call listener(ended.detail) at once }`.

### forwarded.ts

The `open` result adds `onClosed: () => undefined`. The second session owns its port; this tunnel has no listener
that can fail.

### factory.ts

- In `forward`, on `open`: `const entry: Entry = {port, close: outcome.close}; entries.push(entry);
  outcome.onClosed(() => { entries.splice(entries.indexOf(entry), 1); });`.
- In `reconnect`, after `probed` is built: `const listed = probed.filter(probe => entries.some(entry => entry.port
  === probe.port));` and `revived` and `failed` are filtered from `listed` instead of `probed`. (An entry whose
  tunnel ended while the probes ran is in neither list.)
- The fileoverview's last sentence and the `TunnelFactory.forward` JSDoc are unchanged.

### fake-network.ts

- A private `failures = new Map<number, (detail: string) => void>()` beside `listeners`.
- `listen(port, onConnection, onFailure)`: as today, plus `this.failures.set(port, onFailure)`; its `close` also
  deletes the port from `failures`.
- New public method, JSDoc `/** The listener on \`port\` fails after listening, as an adapter tells it: nothing
  listens there any more. */`:

```ts
fail(port: number, detail: string): void {
  const onFailure = this.failures.get(port);
  this.listeners.delete(port);
  this.failures.delete(port);
  onFailure?.(detail);
}
```

## 3. Test table

One `it` per row, one `deepStrictEqual` or `rejects` per `it` (the `tests/one-assertion` lint rule). The cite starts
the test name.

`test/unit/node-network.test.ts`, a new `describe('an error after listening')` inside the existing top-level
`describe`, with one local helper `listeningServer(failures: string[])` that makes `createServer()`, takes
`await freePort()`, calls `listenOn(server, port, () => undefined, detail => { failures.push(detail); })` and returns
`{server, port, listening}`:

| Cite | Given | Expected |
|---|---|---|
| #228 | `server.emit('error', new Error('accept failed'))` after listening | `failures` deep-equals `['accept failed']` |
| #228 | the same error; then `await until(() => !server.listening)` | `nodeLocalPort().connect(port)` rejects |
| #228 | two errors, `'first'` then `'second'` | `failures` deep-equals `['first']` |
| #253 Q1 | `listening.close()`, then an error `'late'` | `failures` deep-equals `[]` |
| #228 | a second `listenOn(createServer(), port, …)` on the port the first holds | rejects |

`test/unit/window-tunnel.test.ts`, a new `describe('a window tunnel whose listener fails after listening')` with a
local helper `opened()` that calls `relay()`, opens it, throws `new Error('the tunnel did not open')` unless the
outcome is `open`, and returns `{fixture, outcome}` with the narrowed type
`Extract<WindowTunnelOutcome, {kind: 'open'}>`:

| Cite | Given | Expected |
|---|---|---|
| #253 Q1 | two `onClosed` listeners pushing `first <detail>` and `second <detail>`; `local.fail(50000, 'accept failed')`, then `local.fail(50000, 'again')` | `['first accept failed', 'second accept failed']` |
| #253 Q1 | a client accepted on 50000, `await settled()`, then `local.fail(50000, 'accept failed')` | `[client?.closed, dialer.connections[1]?.closed, outcome.kind]` deep-equals `[true, true, 'open']` |
| #253 Q1 | `local.fail(50000, 'accept failed')`, then a listener registered | it heard `['accept failed']` at once |
| #253 Q1 | a listener registered, `outcome.close()`, then `local.fail(50000, 'late')` | it heard `[]` |
| #253 Q1 | `relay(['later'])`, `open()` not awaited, `await settled()`, `local.fail(50000, 'accept failed')`, `dialer.openNext()` | the outcome deep-equals `{kind: 'listenFailed', detail: 'accept failed'}` |
| #253 Q1 | `openForwardedTunnel` with `new FakeLocalPort()`, `localPort: 50000`, `LIMITS`, `stopSession: () => undefined`; a listener registered | `[outcome.kind, heard]` deep-equals `['open', []]` |

And a new `describe('the fake loopback')` with one row: `new FakeLocalPort().fail(50000, 'nothing there')` on a port
nothing listens on; `it('a failure on a port nothing listens on tells nobody')` with no assertion beyond not throwing
(the row covers the `?.` of `fail`).

`test/unit/tunnel-factory.test.ts`, a new `describe('a forward whose listener fails after listening')` with a local
helper `oneFailed(): Promise<Fixture>` that forwards `{remotePort: 3000, localPort: 3001}` then `{remotePort: 4000,
localPort: 4001}` on `fixture()` and calls `local.fail(3001, 'accept failed')` (the helper keeps jscpd at zero
clones):

| Cite | Given | Expected |
|---|---|---|
| #253 Q1 | `oneFailed()` | `factory.forwarded()` deep-equals `[{remotePort: 4000, localPort: 4001}]` |
| #253 Q1 | `oneFailed()`, then `reconnect(new FakeDialer())` | `[report, replacement.dialed]` deep-equals `[{revived: [{remotePort: 4000, localPort: 4001}], failed: []}, [{kind: 'port', port: 4000}]]` |
| #253 Q1 | `fixture()`, forward 3000 on 3001; `reconnect(new FakeDialer(['later']))` not awaited; `await settled()`; `local.fail(3001, 'accept failed')`; `replacement.openNext()` | `[await reconnecting, factory.forwarded()]` deep-equals `[{revived: [], failed: []}, []]` |

Every existing row keeps passing unchanged.

## 4. Rule for the worker

As card log-01. Tests first; fix only what fails; no signature beyond section 2; names of four characters or more;
no comment beyond the two JSDoc lines quoted in section 2 and the `listenOn` JSDoc; the ratchet stays (lib-forwarding
is 100/99.66/100 on main; the files of this card must each reach 100 on every metric). Gates: `pnpm identifiers`,
`pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`,
`pnpm coverage`, `pnpm check-licences`. Run `pnpm test:acceptance:server` once and state the result in the PR.

## 5. Gates and review

PR title `lib-forwarding: a listener failure after listening closes the tunnel (card forwarding-05, #228)`; answers
R1–R6.

## 6. Open rows

None. If a row of section 3 cannot pass with the contract of section 2, stop and report the row and the output.
