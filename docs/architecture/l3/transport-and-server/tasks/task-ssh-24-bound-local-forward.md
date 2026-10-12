# Task card ssh-24: a local forward names its bind address

Why: themis's finding on #353, traced by athena to S2 (contracts §S2 corrected, 15834c0). `forwardArguments` writes a
local forward as `-L <port>:127.0.0.1:<remote>`, with no bind address, so `ssh` binds "localhost": both loopbacks.
When another process holds `127.0.0.1:<port>` only, `ssh` warns once (`bind [127.0.0.1]:<port>: Address already in
use`), binds `::1` instead, and carries on; the window then dials `127.0.0.1:<port>` into the other process. Naming the
bind address makes the same case a failure `ssh` reports (`cannot listen to port: <port>` and `Could not request local
forwarding.`), which card ssh-23's gate already catches. Reproduced on OpenSSH 10.2 (athena and daedalus,
2026-10-12): the bare form printed only the `bind` line, the bound form all three. Reviewing coder:
`remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/arguments/invocation.ts` | `forwardArguments`: the two `-L` forms (section 2) |
| `packages/lib-ssh/test/unit/invocation.test.ts` | five rows change their expected text; rows added (section 3) |

Nothing else. `-D` already names `127.0.0.1` and is unchanged.

## 2. Contract

```ts
if (forward.kind === 'local') {
  return ['-L', `${LOOPBACK}:${localPort}:${LOOPBACK}:${String(forward.remotePort)}`];
}
return ['-L', `${LOOPBACK}:${localPort}:${forward.socketPath}`];
```

So a local forward is `-L 127.0.0.1:<port>:127.0.0.1:<remote>`, and a socket forward `-L 127.0.0.1:<port>:<path>`. The
window's port is then IPv4 loopback only, as F-2104 6.2 step 4 and 6.8 step 4 describe ("the window port is held by
that `ssh` process, IPv4 loopback only").

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 Rows that change their expected text (names unchanged)

| Row | New expected `-L` value |
|---|---|
| "F-2104.BR-1: a local forward is a -L pair" | `127.0.0.1:51001:127.0.0.1:8080` |
| "F-2410: a socket forward is a -L pair to the path" | `127.0.0.1:51002:/tmp/code-x.sock` |
| "F-2104.BR-1: both forwards stand in the given order" | `['-D', '127.0.0.1:51000', '-L', '127.0.0.1:51001:127.0.0.1:8080']` |
| "F-2104 6.2: a tunnel run keeps its local forward before the host" | `['-L', '127.0.0.1:51001:127.0.0.1:8080', '--', 'alias', TUNNEL_COMMAND]` |
| "F-2410 5.0: a tunnel run keeps its socket forward before the host" | its `-L` value is `127.0.0.1:51002:/tmp/code-x.sock` |

These are the only existing rows that fail with section 2 in place (checked on a prototype over main).

### 3.2 Rows added

| Cite | Given | Expected |
|---|---|---|
| #353 (themis, athena) | a local forward | its `-L` value starts with `127.0.0.1:` |
| #353 | a socket forward | its `-L` value starts with `127.0.0.1:` |
| F-2104 6.2 step 4 | every `-L` value of a run with all three forwards | each starts with `127.0.0.1:` (no bare port) |

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: a local forward names its bind address (card ssh-24)`.

## 6. Open rows

None. Ruled by athena (contracts §S2, 15834c0).
