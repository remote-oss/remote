# Task card ssh-14: `ClearAllForwardings yes` is detected before the shared connection is used (adaptation)

Why: F-2104 BR-11 (remote-oss/remote-ssh#22, answered 2026-10-10, S14): with the local connection server on and
`ClearAllForwardings yes` in the host's effective configuration, OpenSSH drops the server's own `-D` with the
user's forwardings; the reference then announces a SOCKS port nobody listens on and the window hangs at "Opening
Remote..." with 7.E4. The family does not reproduce a hang (R-79): the condition is detected from `ssh -G` before any
`ssh` runs and the connect fails at once with a reason that names the option — an `[adaptation]`, ruled 2026-10-10.
Reviewing coder: `remote-coding-worker-2`.

## 1. File boundary

`packages/lib-ssh/src/config/effective.ts` (one field), `src/config/forwarding-block.ts` (new), `src/index.ts` (export
lines), `test/unit/effective-options.test.ts` (rows added) and `test/unit/forwarding-block.test.ts` (new). Nothing
else; the pipeline's validate step and the dialog string are connect-03's (one line there once this lands).

## 2. Contract

```ts
// effective.ts: EffectiveOptions gains
clearAllForwardings: boolean;   // true when `ssh -G` printed `clearallforwardings yes`; false when `no` or absent
// forwarding-block.ts
export type ForwardingPath = 'socks' | 'secondSsh' | 'socket';
export type ForwardingBlock = {blocked: false} | {blocked: true; reason: 'clearAllForwardings'};
export function forwardingBlock(options: Pick<EffectiveOptions, 'clearAllForwardings'>, path: ForwardingPath): ForwardingBlock;
// blocked only when clearAllForwardings is true AND path is 'socks' (the SOCKS forward rides the ssh the option
// applies to: the local connection server's, or the install connection's when the local server is off and dynamic
// forwarding is on); 'secondSsh' and 'socket' are never blocked here (their tunnel ssh is started by the family
// with its own forward after the user's options; F-2104 BR-11 and the room's 2026-10-10 answer).
```

## 3. Test table

| Given | Expected |
|---|---|
| F-2104.BR-11: `ssh -G` text with `clearallforwardings yes` | `options.clearAllForwardings === true` |
| F-2104.BR-11: `clearallforwardings no` | `false` |
| F-2104.BR-11: the keyword absent | `false` |
| F-2104.BR-11: `ClearAllForwardings YES` (mixed case keyword and value) | `true` (keywords and values compared lower-case) |
| F-2104.BR-11/7.E4: `forwardingBlock({clearAllForwardings: true}, 'socks')` | `{blocked: true, reason: 'clearAllForwardings'}` |
| `forwardingBlock({clearAllForwardings: true}, 'secondSsh')` | `{blocked: false}` |
| `forwardingBlock({clearAllForwardings: true}, 'socket')` | `{blocked: false}` |
| `forwardingBlock({clearAllForwardings: false}, 'socks')` | `{blocked: false}` |
| the existing effective-options rows | unchanged (the new field present and `false`) |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-ssh: ClearAllForwardings detected before the shared connection (card ssh-14)`.

## 6. Open rows

None. (`ForwardingPath` repeats lib-forwarding's `TunnelPath` literals on purpose: lib-ssh does not import
lib-forwarding, the import graph stays acyclic, and a three-literal type is not code duplication; ruled 2026-10-10 on
#246's review.) (The dialog's reason string is connect-03's: a product string of its own, "`ClearAllForwardings` is set for
this host, so the shared connection cannot forward the server's port"; the kind is `invalidSetting`.)
