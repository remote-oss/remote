# Task card forwarding-04: which tunnel path a window connect uses (pure decisions)

Brief: slice 2 (build-order, #41). Specs: F-2104 (`remote-oss/remote-ssh#22`), F-2410 (`#55`). Reviewing coder:
`remote-coding-worker-1`. Depends on card forwarding-01 (the package) being on main; it is.

## 1. Package and file boundary

Create `packages/lib-forwarding/src/tunnel-path/select.ts` and the test `packages/lib-forwarding/test/unit/tunnel-path.test.ts`;
add the exports of section 2 to `src/index.ts` (exports only). Neither new file exists on main. Pure: no process, no
`node:*` import. Nothing else changes.

## 2. Contract

```ts
export interface TunnelSettings {
  listenOnSocket: boolean;          // remote.SSH.remoteServerListenOnSocket
  useLocalServer: boolean;          // remote.SSH.useLocalServer
  enableDynamicForwarding: boolean; // remote.SSH.enableDynamicForwarding
}
export type TunnelPath = 'socket' | 'socks' | 'secondSsh';
export type ForwardingHolder = 'localConnectionServer' | 'installConnection' | 'tunnelSsh';

export function effectiveUseLocalServer(settings: Pick<TunnelSettings, 'listenOnSocket' | 'useLocalServer'>): boolean;
// false whenever listenOnSocket is true, otherwise useLocalServer
export function selectTunnelPath(settings: TunnelSettings): TunnelPath;
// 'socket' when listenOnSocket; else 'secondSsh' only when useLocalServer is false AND enableDynamicForwarding is false; else 'socks'
export function loginsPerConnect(path: TunnelPath, reusesRunningServer: boolean): number;
// socks: 1, or 0 when reusesRunningServer; secondSsh: 2; socket: 2 (reuse does not change either)
export function userForwardingHolder(path: TunnelPath, useLocalServer: boolean): ForwardingHolder;
// secondSsh: tunnelSsh; socket: tunnelSsh (ruled 2026-10-10: the socket path's tunnel ssh is its second login, like the second-ssh path; F-2104 BR-11 names no holder, so this is the family's rule pending the room's answer); socks with useLocalServer: localConnectionServer; socks without: installConnection
export function tunnelDestination(path: TunnelPath, endpoint: { port: number; socketPath: string }): string;
// socket: endpoint.socketPath; otherwise `127.0.0.1:${port}`
```

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-2410.BR-2 | listenOnSocket true, useLocalServer true | `effectiveUseLocalServer` false |
| F-2410.BR-2 | listenOnSocket false, useLocalServer true / false | true / false |
| F-2410.BR-1 | listenOnSocket false (any other settings) | `selectTunnelPath` never returns `socket` |
| F-2104.BR-1 | listenOnSocket true, useLocalServer true, dynamic true | `socket` |
| F-2104.BR-1 | listenOnSocket true, useLocalServer false, dynamic false | `socket` (the other two settings are ignored) |
| F-2104.BR-1 | socket off, useLocalServer true, dynamic false | `socks` |
| F-2104.BR-1 | socket off, useLocalServer false, dynamic true | `socks` |
| F-2104.BR-1 | socket off, useLocalServer false, dynamic false | `secondSsh` |
| F-2104.BR-2 | `socks`, reuse false / true | 1 / 0 |
| F-2104.BR-2 | `secondSsh`, reuse false / true; `socket`, reuse false / true | 2 / 2; 2 / 2 |
| F-2104.BR-11 | `userForwardingHolder('socks', true)` / `('socks', false)` | `localConnectionServer` / `installConnection` |
| F-2104.BR-11 | `userForwardingHolder('secondSsh', false)` | `tunnelSsh` |
| F-2104.BR-13 | `tunnelDestination('socks', {port: 41234, socketPath: '/tmp/code-x'})` and `'secondSsh'` | `127.0.0.1:41234` both |
| F-2410.BR-4 | `tunnelDestination('socket', {port: 41234, socketPath: '/tmp/code-x'})` | `/tmp/code-x` |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-forwarding: tunnel path selection (card forwarding-04)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

1. Ruled 2026-10-10 (#244): `userForwardingHolder('socket', …)` is `tunnelSsh`; the signature takes every `TunnelPath`
   and one row covers it; the spec question remote-oss/remote-ssh#22 (issuecomment-6086394267, filed 2026-10-10) confirms the holder.
2. Ruled 2026-10-10 (#244): stays unimplemented. F-2104 BR-11 states the removal for `installConnection` only; OpenSSH's
   `ClearAllForwardings` clears command-line forwardings too, so the local connection server's own `-D` would go as
   well, and the family adds no option to prevent it (S2). What the reference does there is a spec question on F-2104
   (the PM files it); the answer decides whether a rule is needed at all.
