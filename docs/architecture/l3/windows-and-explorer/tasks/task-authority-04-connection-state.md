# Task card authority-04: the window's connection state (pure)

Contract: `../contracts.md` §3.2 (`currentConnection`: `none` or `{decodedTarget, state}` with states `resolving`,
`connected`, `failed`, `transportLost`, `transportClosed`, driven by the connector's events; `onFirstResolveSettled`
fires once per extension-host session). Depends on authority-01. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `packages/lib-authority/src/resolver/connection-state.ts`, `src/index.ts` (exports only), test
`test/unit/connection-state.test.ts`. Pure: no `vscode`, no timers.

## 2. Contract

```ts
export type ConnectionState = 'resolving' | 'connected' | 'failed' | 'transportLost' | 'transportClosed';
export type ConnectionEvent =
  | { kind: 'resolveStarted'; target: DecodedTarget; attempt: number }
  | { kind: 'resolveSucceeded' } | { kind: 'resolveFailed' }
  | { kind: 'transportLost' } | { kind: 'transportClosed' };
export interface CurrentConnection { target: DecodedTarget; state: ConnectionState; attempt: number }
export class ConnectionTracker {
  current(): CurrentConnection | undefined;                 // undefined before the first resolveStarted
  apply(event: ConnectionEvent): { changed: boolean; firstResolveSettled: boolean };
  onChange(listener: (current: CurrentConnection | undefined) => void): () => void;
}
```

Transitions (anything not listed is ignored with `changed: false`): `resolveStarted` from any state or from none →
`resolving` with the event's target and attempt; `resolveSucceeded` from `resolving` → `connected`; `resolveFailed`
from `resolving` → `failed`; `transportLost` from `connected` → `transportLost`; `transportClosed` from `connected`
or `transportLost` → `transportClosed`; a later `resolveStarted` (core's reconnection attempt) from `transportLost`,
`transportClosed` or `failed` → `resolving` with the new attempt. `firstResolveSettled` is true exactly once: on the
first `resolveSucceeded` or `resolveFailed` the tracker ever applies. `onChange` fires on every `changed: true`.

## 3. Test table

| Given (sequence) | Expected |
|---|---|
| nothing | `current()` undefined |
| `resolveStarted(t, 1)` | `{t, resolving, 1}`, changed true, firstResolveSettled false |
| then `resolveSucceeded` | `connected`, firstResolveSettled true |
| then `resolveSucceeded` again | changed false, firstResolveSettled false |
| `resolveStarted`, `resolveFailed` | `failed`, firstResolveSettled true |
| `resolveStarted`, `resolveFailed`, `resolveStarted(t, 2)`, `resolveSucceeded` | `connected` attempt 2; the second settle has firstResolveSettled false |
| `connected`, `transportLost` | `transportLost` |
| `connected`, `transportClosed` | `transportClosed` |
| `transportLost`, `transportClosed` | `transportClosed` |
| `transportLost`, `resolveStarted(t, 2)` | `resolving` attempt 2 |
| `transportClosed`, `resolveStarted(t2, 3)` | `resolving` with target t2 |
| `resolving`, `transportLost` | ignored (changed false) |
| `failed`, `transportClosed` | ignored |
| `transportLost` before any resolve | ignored; `current()` still undefined |
| `onChange` over the sequence start, succeed, lost | three calls, with the three states; unsubscribe stops further calls |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-authority: connection state (card authority-04)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows

None expected.
