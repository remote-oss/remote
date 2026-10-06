# ADR-NNNN: lib-server reaches every host through one narrow host channel

- Status: proposed (draft by `remote-architect-worker-1` for the lead, who assigns the number). The shape was accepted
  for the container view on 2026-10-06.
- Date: 2026-10-06
- Deciders: the lead
- Scope: `lib-host`, `lib-server`, `lib-ssh`; the transports of `remote-containers` (`docker exec`) and `remote-wsl`
  (`wsl.exe`)
- Requirements:
  - remote-ssh F-2401 to F-2413, F-2506, F-2701 to F-2704;
  - remote-containers F-0503, F-0505, F-0419;
  - remote-wsl F-6301, F-6303;
  - R-47, R-58, R-68; ADR-0004.

## Context

Three extensions install and start the same server on a remote side:
- Remote-SSH, over `ssh`;
- Dev Containers, inside a container through the engine CLI;
- WSL, inside a distro through `wsl.exe`.

The steps are the same in all three: probe the platform, check prerequisites, resolve the archive, gate the licence,
lock, download or copy, unpack, start, reuse, kill and clean up. They differ only in how a command runs and how a file
reaches the remote side. If lib-server depended on lib-ssh, the containers and WSL packages would bundle an SSH
transport they never use. If each transport had its own installer, the R-47, R-58 and R-68 rules would exist three
times, against ADR-0003's rule on duplicated code.

## Decision

1. `lib-host` defines the host channel: `runScript` (script text, interpreter, environment, input), `copyToHost`,
   `identity` and `platformHint`. It also defines a closed set of failure kinds: `channelClosed`, `spawnFailed`,
   `copyToolMissing`, `copyFailed`, `timeout` and `cancelled`. It has no implementation of its own apart from a
   recording fake for tests.
2. `lib-server` uses only `lib-host` and `lib-product`. Every remote action is a script that `lib-server` writes,
   run through `runScript`, with its result read from a marked block in the output. Every archive reaches the host
   through a host-side download or `copyToHost`.
3. Implementations live with their transports: `lib-ssh` over `ssh` and `scp`, `remote-containers` over the engine's
   exec and copy, and `remote-wsl` over `wsl.exe`.
4. The channel stays narrow. Adding an operation requires a new revision of this ADR, naming the requirement that no
   script can meet.

## Options considered

| Option | For | Against |
|---|---|---|
| A narrow host channel in its own library (chosen) | One installer for three transports; lib-server is tested on a fake; no transport leaks into another package's bundle | Every remote action must be expressible as a script; output parsing is our own protocol |
| lib-server depends on lib-ssh and abstracts later | Fastest for the first coding target | Containers and WSL would import an SSH library; the abstraction is harder to add once code exists |
| One installer per transport | Each transport optimises freely | Three copies of the R-47, R-58 and R-68 rules; conformance differences between extensions |
| A rich remote API (file system, processes, sockets) | Fewer scripts | A large surface three transports must implement, and most of it unused |

## Consequences

- The first coding target can build lib-server against the fake before any transport exists.
- The remote-side scripts become the contract with the host. They are text in the VSIX (container view §2) and are
  tested on lab hosts per platform.
- Forwarding stays outside the channel: lib-forwarding takes a dialer from each transport.
- A transport that cannot run scripts (none known) would need a new ADR.

## Check

- The import lint shows no edge from lib-server to any transport library.
- lib-server's unit tests run only against the `lib-host` fake.
- A review rule: a new channel operation needs a revision of this ADR.
