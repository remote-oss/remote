# Coding brief: lib-forwarding W2 window tunnel and W3 tunnel factory — slice 1 (critical path), slice 2 the rest

> Issued by `remote-architect` 2026-10-08; the PM allocates the seat (a Claude task). Design: `contracts.md` §6 (W1
> done as card forwarding-01; W2, W3 here; W4 is card forwarding-02). Depends on lib-ssh S3/S9/S10 (the dialer comes
> from the connection: a `-L` second-ssh forward or the helper's SOCKS relay), lib-host, lib-log. Binding: ADR-0002,
> 0003, 0004, 0007, 0008; R-79.

## What is built

| Piece | Content |
|---|---|
| W2 `open(dialer, target, localPort)` | the window tunnel from `127.0.0.1:<W1 port>` to the server's port on the host's IPv4 loopback (always loopback in TCP mode, whatever `bindHost` says, F-2104 BR-13) or to a socket path; two dialers: (a) the shared connection's SOCKS relay (S9's `connected {socksPort}`), (b) a second `ssh -N -L` session through S2/S3 when the local server is off; readiness by a probe connection; `tunnelNotReady` after the policy wait (about 10 s on the second-ssh path, F-2104 BR-10) as a value; the local address returned; closed with the connection |
| W3 `factoryFor(dialer, privacy)` | the resolver's tunnel factory handed to core (proposed `tunnels`): opens one tunnel per request over the same dialer; `tunnelFeatures` (privacy options; `private` only for SSH, the `public` option is Tunnels'); ports forwarded before a reconnection are revived over the new dialer (F-2104 Q4, F-2507 Q1) |
| W3 `environmentTunnels(entries)` | from card forwarding-02's parsed `LocalForward` entries to the resolver's environment tunnels (F-2507) |
| Adapters | the dialer port (implemented by lib-ssh for both forms), the local listener port (Node `net`, the only socket code), `src/testing/` fakes |

## Behaviour to get right (each a named test)

- The target is the host's IPv4 loopback in TCP mode regardless of `bindHost` (F-2104 BR-13).
- `open` resolves only after a probe connection through the tunnel succeeds; a stalled dialer ends in
  `tunnelNotReady` at the policy bound, never a hang (R-79).
- The second-ssh dialer builds its invocation through S2 (`-N -L 127.0.0.1:<port>:127.0.0.1:<serverPort>`, nothing
  else added) and spawns through S3; its process ends with the connection.
- The factory revives forwarded ports after a reconnection on the new dialer and reports the ones it could not.
- Acceptance (harness, slice 1): F-2104 (the window tunnel to the container's server through the SOCKS relay and
  through the second-ssh path when `useLocalServer` is off; the readiness bound with a stalled dialer), run with
  connect-05.

## Done

Gates green; the dialer and listener behind ports with fakes; ADR-0008; PR body answers R1–R6.
