# Task card connect-13: the Connector over the connect pipeline (#140 part D)

Why: `registerResolver` (lib-authority) takes a `Connector` (`connect`, `cancel`, `revealDetails`, `onPhase`,
`onTransportLost`, `onTransportClosed`; `../../windows-and-explorer/contracts.md` §3.2). Remote - SSH's pipeline
(`pipeline/connect.ts`, R1) does the connecting, but nothing turns it into a `Connector`. Part D of the #140 plan.
Implementer: `daedalus`. Reviewers: `themis`; design check `athena`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-ssh/src/pipeline/connect.ts` | `Connection` gains `onTransport` (section 2) |
| `packages/remote-ssh/src/pipeline/connector.ts` | new: `connectorOf` |
| `packages/remote-ssh/test/unit/connect.test.ts` | rows for `onTransport` |
| `packages/remote-ssh/test/unit/connector.test.ts` | new |

Nothing else. The steps are built by part E, which passes them in; this card takes `ConnectSteps` as given, so it
does not wait on part C.

## 2. Contract

### The pipeline's `Connection` reports the transport

```ts
/** What happened to the connection after the connect: lost (it may come back) or closed (it will not). */
export type TransportEvent = 'lost' | 'closed';
export interface Connection {
  connected: Connected;
  release(): void;
  /** Hears the transport events of the lease; the returned function stops it. */
  onTransport(listener: (event: TransportEvent) => void): () => void;
}
```

Built from the lease's `onNotice`: `{type: 'transportLost'}` → `'lost'`, `{type: 'helperGone'}` → `'closed'`; every
other notice is ignored here. Reading of the two contracts (for the design check): transport-and-server §2 says the
end of the session "every window hears as `transportLost`", which core answers by resolving again, so it is
lib-authority's `transportLost`; `helperGone` is the end of the connection server itself, after which nothing of this
lease comes back, which the resolver host's tracker accepts as `transportClosed` from `connected` or `transportLost`
(`connection-state.ts`).

### `connectorOf`

```ts
export interface ConnectorDependencies {
  steps: ConnectSteps;
  /** The options of one connect, except its cancellation and phase listener, which the connector supplies. */
  options: Omit<ConnectOptions, 'cancellation' | 'onPhase'>;
  /** Reveals the connection's log: the "(details)" target (F-2304 BR-12). */
  revealLog(): void;
}
export function connectorOf(dependencies: ConnectorDependencies): Connector;
```

- `connect(input)`: one pipeline `connect` with a fresh `AbortController` and an `onPhase` that sends each
  `PhaseEvent` to the phase listeners as lib-authority's `ConnectPhase` (`{name: event.kind}`, plus `percent` for
  `serverDownloadPercent`). A `Failed` is returned as it is. On a `Connection`: a connection still held from an
  earlier connect is released first; the new one is held, its `onTransport` is followed (`'lost'` to the lost
  listeners, `'closed'` to the closed listeners), and `connection.connected` is returned.
- `cancel()`: aborts the running connect, if any, and releases the held connection, if any, then stops following it.
  It is the teardown of the window (§3.2: the host calls it only then, or on the user's Cancel). A second `cancel` does
  nothing.
- `revealDetails()`: `revealLog()`.
- `onPhase`, `onTransportLost`, `onTransportClosed`: add a listener and return the function that removes it.
- A listener that throws does not stop the others or the connect.

## 3. Test table

One assertion per `it`. The steps are the fakes of `connect.test.ts`.

| Cite | Given | Expected |
|---|---|---|
| R1 | the lease notices `transportLost`, then `helperGone`, after a connect | `onTransport` hears `'lost'`, then `'closed'` |
| R1 | another notice (`waitingForOtherWindow`) | `onTransport` hears nothing |
| R1 | the function `onTransport` returned is called | later notices are not heard |
| §3.2 | a connect that works | `connect` gives the pipeline's `connected` |
| §3.2 | a connect that fails | `connect` gives the `Failed` unchanged |
| F-2304 | the pipeline's phases `initializing`, `serverDownloadPercent 40` | the phase listener hears `{name 'initializing'}`, `{name 'serverDownloadPercent', percent 40}` |
| §3.2 | `cancel` during a connect | the connect's signal is aborted |
| §3.2 | `cancel` after a connect | the held connection's `release` called once |
| §3.2 | `cancel` twice | `release` still once |
| F-2505 | a second connect after the first worked (a reconnection) | the first connection released, the second held |
| §3.2 | `'lost'` from the held connection | the lost listeners called; the closed ones not |
| §3.2 | `'closed'` from the held connection | the closed listeners called |
| §3.2 | an event from a connection released by `cancel` | no listener called |
| F-2304 BR-12 | `revealDetails` | `revealLog` called once |
| §3.2 | a removed phase listener | not called for later phases |
| §3.2 | one phase listener throws | the others still hear the phase, and the connect goes on |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the connector over the connect pipeline (card connect-13, #140 part D)`; Part of #140.

## 6. Open rows

- The mapping `transportLost` → lost, `helperGone` → closed is this card's reading of the two contracts (section 2);
  the design check confirms or corrects it before code.
