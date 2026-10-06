# C4 level 3: area A components (transport and server lifecycle)

- Status: first version for the lead's review (deliverable 2)
- Date: 2026-10-06
- Author: `remote-architect-worker-1`; lead: `remote-architect`
- Built on: `../../c4-l2-containers.md` (b007348), the area A dossier, `contracts.md`, ADR-0002 to ADR-0006 as
  revised on 2026-10-06
- Traceability: `traceability.tsv` in this folder, one row per feature this area owns

Area A covers five libraries (`lib-host`, `lib-product`, `lib-ssh`, `lib-server`, `lib-forwarding`), the transport
part of `remote-ssh` and the tunnel client of `remote-server`. Component ids are stable and are used by the contracts
and the matrix. A component marked **pure** has no editor API, no process and no file access, so its tests are plain
Mocha unit tests (ADR-0002 rule 7). Those components are the first coding candidates.

## Dependency rules inside area A

- `lib-host` defines the host channel and its failure kinds and nothing else. `lib-ssh` implements it for SSH,
  `remote-containers` for `docker exec`, and `remote-wsl` for `wsl.exe`.
- `lib-server` sees only `lib-host` and `lib-product`. It never knows which transport it runs over.
- `lib-forwarding` sees no transport. Each transport hands it a **dialer**, which opens a byte stream to a host and
  port on the remote side. For SSH the dialer goes through the local connection server's SOCKS port; for Tunnels it
  goes through the relay.
- Editor UI that a library needs (the licence dialog, the no-source dialog, prompts, terminals) goes through a narrow
  UI port that the library declares and the extension package wires. B's resolver, window and indicator APIs are
  never touched.

## lib-host

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| H1 | host-channel | The interface of `runScript`, `copyToHost`, `identity`, `platformHint`; the failure kinds `channelClosed`, `spawnFailed`, `copyToolMissing`, `copyFailed`, `timeout`, `cancelled` | pure (types and a recording fake for tests) |

## lib-product

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| P1 | profile-reader | Reads the running editor's `product.json` once per session through an injected file reader; exposes names, folders, scheme, gallery, licence fields, templates, `tunnelApplicationName` | pure given the file text |
| P2 | template-expander | Expands `${os}`, `${arch}`, `${commit}`, `${quality}`, `${version}`, `${release}` and, where the extension's policy allows, `${applicationName}`; rejects unknown names and non-http(s) results | pure |
| P3 | archive-resolver | The resolution order: user override under the extension's policy, product template, built-in table, then no source. Containers' base-URL form (F-1402) is included | pure |
| P4 | product-table | The one file where product names, the licence host list of F-3902 rule 11, the VSCodium release prefixes and the dev tunnels domain appear (ADR-0006 Check) | pure data |

## lib-ssh

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| S1 | client-locator | Candidate order and the `-V` check of `ssh`; `scp` beside it; the Windows warning decision | pure decision plus a process port |
| S2 | argument-builder | Every `ssh` and `scp` argument list: `-F`, `-T`, `ConnectTimeout`, `RemoteCommand` override, `-v`, forwards; host and user validation | pure |
| S3 | session-spawner | Spawns S2's invocations with the editor's environment and the askpass variables; streams and exit; the connect wait | process |
| S4 | config-model | Files in effect; the host list (Host, Match, Include rules of F-2202); `ssh -G` lookups through S3; the Add New SSH Host parser and the Host-block writer | parser and writer pure, file and process access through ports |
| S5 | stderr-classifier | Maps ssh's error lines to failure kinds, reason texts and hints (network, forwarding, timeout, host key changed, authentication) | pure |
| S6 | prompt-classifier | Recognises the host-key, continuation, passphrase and password prompt texts and picks the surface and placeholder | pure |
| S7 | prompt-ui | Shows S6's surface, returns the answer or a cancel; external askpass policy | UI port |
| S8 | login-terminal | The hidden terminals of terminal mode, prompt reading through `terminalDataWriteEvent`, reveal policy | UI port |
| S9 | connection-server | The local connection server: helper process, leases, record, prompt hand-over, kill (ADR draft) | process |
| S10 | ssh-host-channel | H1 implemented over a lease of S9 or a direct S3 session | process |

## lib-server

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| V1 | bootstrap-scripts | The POSIX `sh` and PowerShell scripts as text, their parameter block, and the parser of their result block | parser pure; scripts tested on lab hosts |
| V2 | host-probe | Runs V1's probe over H1 and returns host facts or a prerequisite failure | over H1 |
| V3 | install-planner | Decides reuse, source, where the download runs, lock place, data folder and launcher | pure |
| V4 | archive-transfer | Host-side download, client-side download and `copyToHost`, manual bootstrap, temp files | over H1 plus a download port |
| V5 | install-locks | Client lock file and host lock retry loop | file port, over H1 |
| V6 | licence-gate | R-68 classification, per-profile acceptance store, the modal through the UI port | classification pure; UI port |
| V7 | server-runtime | Start or reuse, socket mode, readiness line, start options, remote environment fix-ups, default extensions | over H1 |
| V8 | server-maintenance | Kill, uninstall, old-version clean-up | over H1 |
| V9 | server-cache | The R-58 cache keys and folders for the container transport (F-0419) | pure keys; over H1 |
| V10 | server-prefetch | Background download of the next server into the kept cache when the record says `onProductUpdate` (F-6301 6.6) | over the download port |

## lib-helper (lead's ruling 2026-10-06; draft for area C's review)

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| X1 | helper-client | Acquire, release, request, events, stop: the extension host's side of a detached helper | process and socket |
| X2 | helper-runtime | Bundled into each helper script: endpoint, leases in arrival order, end policies as data | socket |
| X3 | registry | Atomic claim, stale detection, per-profile or per-user folders | pure plus a file port |

Consumers: S9 (SSH local connection server), area C's container watchdog (F-0417), T2 if the Tunnels relay stays.
Depends on `lib-log` only for the helper's own log file. The container view needs a new edge from `lib-ssh`, and
from `remote-containers`, to `lib-helper`.

## lib-forwarding

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| W1 | port-search | Range parsing and the ascending free-port search that probes by connecting, never by binding (F-2104 BR-6, BR-7) | pure decision plus a socket port |
| W2 | window-tunnel | The local listener on 127.0.0.1 that relays each connection through a dialer to the server's port or socket | socket |
| W3 | tunnel-factory | The resolver's tunnel factory, privacy options, environment tunnels | over a dialer |
| W4 | default-forwards | `remote.SSH.defaultForwardedPorts` through `workspace.openTunnel` after resolve (`tunnels` proposal) | editor API port |

## remote-ssh, area A part

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| R1 | connection-pipeline | `connect` for B's resolver: validate, pre-connection script, locate client, lease or session, platform, probe, install, start, tunnel, result; phase events; cancel | orchestration |
| R2 | ssh-diagnostics | Log content per resolve (F-2003), the session hint store and troubleshooting terminal (F-2605), the reason for F-2601 from S5 | file and UI ports |
| R3 | preconnect-runner | The pre-connection script, its confirmation and stored hash (F-2108) | process and UI ports |
| R4 | platform-decider | `remote.SSH.remotePlatform` matching and the write rule (F-2206); the picker is B's | pure plus settings port |

## remote-server, tunnel client

Blocked: option (a), the shipped tunnel executable, has no client relay mode and stores every token
(`contracts.md` §8). The rows below hold whatever relay the user's ruling picks; T2's mechanism is open.

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| T1 | tunnel-executable | Locates `<app root>/bin/<tunnelApplicationName>` from P1; reports it missing as a relay start failure (F-8103 7.E10) | pure path rule plus a file port |
| T2 | relay-manager | One relay per profile: start, reuse while it answers, lifetime after the last window (F-8103 BR-6) | process |
| T3 | tunnel-session | Sign-in through `vscode.authentication` (F-8102), the token handed to the relay, account type per tunnel name | editor API port |
| T4 | tunnel-service | List, look up, unregister, usage limits through the relay (F-8101, F-8201 data, F-8203) | over T2 |
| T6 | tunnel-picker | Connect to Tunnel: the account step, the tunnel list with online state, "Create a Tunnel" (F-8101) | UI port |
| T5 | tunnel-connect | `connect` for B's `tunnel` resolver: lookup, relay address, failure kinds (F-8103) | orchestration |

## How a Remote-SSH connect flows

B's resolver calls R1. R1 runs these steps:
1. S2 validates the target.
2. R3 runs the pre-connection script, if one is set.
3. S1 locates the client.
4. R1 takes a lease from S9, or opens a direct S3 session in terminal mode. Prompts go S6 → S7 or S8.
5. R4 decides the platform.
6. V2 probes the host over S10.
7. V3 plans the install. V6 gates the licence, V5 locks, V4 transfers.
8. V7 starts or reuses the server.
9. W1 and W2 open the window port through the SOCKS dialer.
10. R1 returns Connected, with W3's tunnel factory, or Failed with S5's and R2's reason and hints.

## Where area A contributes to features owned elsewhere

- F-2304: phase events from R1, which B renders.
- F-2601: the reason and hints from S5 and R2, which B's dialog shows.
- F-2602: mitigation data, which B's picker renders.
- F-2203: the file list from S4, behind B's picker.
- F-2501 and F-2505: R1 as the connect step, and a fresh connection per attempt.
- F-3906: the host list from S4.
- F-8201: tunnel rows from T4.
- F-0502: the server half for containers from V7.

## Rows to reconcile with the catalogue

- **Tagged A in the catalogue, owned by B in this view** (the A/B agreement and the lead's rulings): F-2001,
  F-2303, F-2304, F-2501, F-2505, F-2509, F-8001, F-8002, F-8301, F-8302, F-6201, F-6208.
- **Owned by A in this view, tagged elsewhere:**
  - F-2202 and F-2204 (B) → S4;
  - F-2206 (D) → R4;
  - F-2701 (D) → V1;
  - F-0503, F-0419, F-0505 (C) → V3, V9, V7, with remote-containers' `docker exec` channel as contributor.
- **Given to area D** (agreed with `remote-architect-worker-4`, 2026-10-06): F-6301, F-6302, F-6303, F-6304 and
  F-6601 are owned by D's wsl-server-adapter. A's V1, V3, V4, V7, V8 and V9 are contributors through the policy
  record (`contracts.md` §5.0). The WSL listener rendezvous is D's: only the owning window calls W2.
