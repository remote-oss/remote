# ADR-NNNN: WSL is reached only through `wsl.exe`, one process per command and per relayed connection

- Status: proposed (draft by `remote-architect-worker-4` for the lead, who assigns the number)
- Date: 2026-10-06
- Deciders: the lead
- Scope: `lib-wsl` (D1, D4), the `remote-wsl` engine (D5, D6, D8, D9), and `remote-containers` where it reaches a
  WSL distro (F-0204, F-0207, F-1301)
- Requirements: remote-wsl F-6201 BR-3/BR-4, F-6301 6.7, F-6304 BR-4 and 6.1/6.2, F-6701 BR-1; the host-channel ADR
  draft of area A (H1, revised in PR #27); ADR-0002 rule 8 (no native modules); ADR-0004 (no SSH library); L2 §2
  (remote-side code is shipped text)

## Context

A Windows editor reaches a distro in one of these ways:
- the `wsl.exe` command line;
- the WSL COM and HCS interfaces;
- the WSL 2 VM's network address;
- WSL's localhost forwarding;
- the `\\wsl.localhost` file share.

The specs record what the connection must look like: one `wsl.exe` relay per connection, never the VM's address,
for WSL 1 and WSL 2 alike (F-6201 BR-3, F-6304 BR-4). Commands in the distro run as its default user (F-6201 6.6).
`wsl.exe` writes its management output in UTF-16LE and passes a program's own output through unchanged.

The engine needs four things from the transport:
- running a script (the `lib-server` steps);
- moving an archive into the distro (F-6301, F-6304);
- a byte stream to the server's port (the window's connection);
- the same three on a remote Windows host for the nested route (F-6701).

## Decision

1. **`wsl.exe` is the only way in.**
   - Every command, file transfer and connection to a distro is a `wsl.exe` child process spawned by D1 and by no
     other component.
   - No native module, no COM or HCS binding.
   - No VM address and no localhost forwarding.
   - The file share is used only by core's dialogs and by path translation, never to read or write server files.
2. **Commands** run as `wsl.exe -d <registered name> --cd <dir> --exec <program> <args>`, with no shell in between.
   Our scripts run as `sh -s` with the script on standard input. Environment additions travel through `WSLENV`.
   Output is decoded as UTF-8; management verbs are decoded as UTF-16LE.
3. **Files** reach the distro in one of two ways:
   - read in place through the drive automount, where `clientPathOnHost` returns a path (F-6301 6.7);
   - streamed through standard input (`tar` in the stepwise mode, `cat >` for `copyToHost`).

   Nothing is copied through the `\\wsl.localhost` share.
4. **Connections.**
   - Each relayed connection is one `wsl.exe` process. It runs the installed server's own Node runtime with a relay
     script under 60 lines, shipped as text, which pipes standard input and output to `127.0.0.1:<port>` in the
     distro.
   - The local side is one `127.0.0.1` listener per distro, shared by windows through a per-user rendezvous
     (contract D5).
5. **One spawner seam.** D1 takes a spawner. The local spawner uses Node's child processes. The nested route
   substitutes a spawner over the outer remote's exec facility, so D2 to D7 work unchanged on a remote Windows host
   (provisional on the register's answer to the nested-route question).
6. **Failure kinds are closed.** `wslMissing`, `wslNeedsUpdate`, `distroUnknown`, `distroUnregistered`,
   `interopDisabled`, `startFailed`, `spawnFailed` and `cancelled`. D4 maps them onto H1's six kinds, keeping the WSL
   kind in the detail.

## Options considered

| Option | For | Against |
|---|---|---|
| `wsl.exe` processes only (chosen) | What the specs record; same for WSL 1 and 2, NAT and mirrored networking; no native code; works under a remote spawner | One process per connection; output encodings to handle; process start cost (about 0.3 s on WSL 1, more on a cold WSL 2) |
| WSL 2 VM address or localhost forwarding | No relay process | Not WSL 1; breaks with mirrored networking and VPNs; the specs observe the relay; the server would listen beyond loopback (F-6201 BR-7) |
| COM/HCS APIs through a native module | Fine control | ADR-0002 rule 8; undocumented surface |
| A relay binary of our own in the distro | No dependency on the server's Node | Remote-side code beyond text (L2 §2); an architecture matrix to build and sign |
| `ManagedResolvedAuthority` without a local listener | No port | The specs require `127.0.0.1:<port>` and its `/version` URL (F-6201 BR-3, F-6208 BR-10) |

## Consequences

- `lib-wsl` is testable on Linux CI through a recorded spawner fake. Only the conformance suite needs Windows.
- The relay script and the `code` hand-off script are the two WSL pieces of remote-side text (L2 §2).
- The nested route costs nothing in this layer. Its open point is how to obtain the outer exec facility (B, register).

## Check

- A lint rule: the string `wsl.exe` and the spawner import appear only in D1's files.
- The H1 contract suite passes on D4.
- A conformance case per route counts one `wsl.exe` relay per open connection and no listener other than
  `127.0.0.1`.
