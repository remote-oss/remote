# Task card containers-75: automatic port forwarding stays core's, proved by rows (F-1102)

Containers increment 2, ports. Size: M. Builder: `task:claude`. Design: athena's addendum to the ports brief on #1204
(2026-10-20). F-1102 is almost all core (§16): the Ports view, Forward a Port, detection, the local-port choice,
restore and the notification are core's. It gives us three duties and nothing new to build. Spec:
remote-oss/remote-containers#58 (F-1102, 31 criteria). **Depends on tooling-56 (#1228), for the readout and the
launch, and coverage-51 (#1229).**

## 1. The three duties

1. **The authority stays stable across a rebuild** (§16, BR-5). F-0501's payload holds `hostPath`, `localDocker` and
   `configFile`, and no container id, so this already holds. An acceptance row proves it (AC-27).
2. **The resolver keeps core's defaults:** no tunnel factory, no tunnel features and no `candidatePortSource`.
   Detection stays core's `process` mode, not ssh-remote's `output` (F-2507).
   - Add a unit row in `test/unit/register-connector.test.ts` (or wherever the containers resolver's registration is
     reachable): `F-1102 duty 2: the resolver gives core no tunnel factory, no tunnel features and no
     candidatePortSource`.
   - It asserts on the options the containers registration passes to lib-authority's `registerVscodeResolver`
     (`vscode-resolver.ts`: `candidatePortSource?: 'output'` must be absent).
   - The row's name cites no criterion: it's the brief's duty.
3. **No Docker-level publish** for a forwarded port (BR-6). Only F-1101's `appPort` publishes, so nothing is needed
   here beyond AC-2's row.

If the unit row of 2 finds a tunnel factory or a `candidatePortSource` on main, remove it in this card and say so.

## 2. Acceptance rows (`tests/acceptance/containers-ports/auto-forward.test.ts`)

These use tooling-56's `portsRows`, `statusItem(…, 'status.forwardedPorts')` and `listenIn`. Each row uses an image
configuration with no `forwardPorts` and no attributes. Names are `F-1102 AC-n (<case>)`.

| AC | Case |
|---|---|
| 1 | a listener started in the container: a row within 5 s, with a remote and a local address, and no confirmation |
| 2 | right after that: `docker inspect` shows no entry for the port in `NetworkSettings.Ports` or `HostConfig.PortBindings` |
| 5 | a listener on a privileged port the host can't bind (check `sysctl net.ipv4.ip_unprivileged_port_start` on the runner first; if it is 0, the row can't make the condition, so leave it `todo` with a comment): a substitute local port, no dialog |
| 6 | the server runs as a non-root `remoteUser`; a root listener whose port isn't on its command line isn't forwarded, and the same program as the server's user is |
| 7 | a mix of automatic and manual forwards, one stopped; Reload: every other one is back, starting with no running process |
| 15 | local port N taken on the host (a listener of the test), N+1 free: the container's N is forwarded on N+1 |
| 16 | `remote.localPortHost: "allInterfaces"`, Reload: the forward binds `0.0.0.0` (`ss -ltn` on the host); the default binds loopback only |
| 18 | three consecutive host ports taken: the substitute is neither N+1 nor the next free after the range |
| 19 | `docker kill` from the host, then "Reload Window" on core's "Cannot reconnect": restored as on a reload |
| 24 | an IPv6-only listener: forwarded, and the tooltip names the expanded, unbracketed address as §6.7 says |
| 27 | one manual, one automatic and one stopped port, then Rebuild Container: the first two are back on the new container, and the stopped one isn't |
| 29 | a dual-stack IPv6 wildcard listener: the tooltip says `0:0:0:0:0:0:0:0:<port>` |
| 31 | a listener started by `postStartCommand` before the window connects: forwarded once connected |

Remove each row's containers and listeners in `finally`.

## 3. Coverage (`coverage-containers-r1.tsv`)

| Criteria | Tag | Reason |
|---|---|---|
| the rows above | `acceptance` when their row passes | |
| AC-3, AC-17, AC-20 | `core` | `core: the auto-forward notification, its buttons and its one entry (F-1102 BR-9, BR-10)` |
| AC-8, AC-9, AC-30 | `core` | `core: Change Local Address Port's in-place edit and its warning (F-1102 BR-8)` |
| AC-4, AC-10, AC-11, AC-12, AC-14, AC-21, AC-22, AC-28 | `core` | `core: the Ports view, Forward a Port and Stop Forwarding Port (F-1102 §16)` |
| AC-13 | `core` | `core: the requireLocalPort dialog (F-1102 7.E2)` |
| AC-23 | `core` | `core: the Cannot reconnect dialog's Cancel` |
| AC-25 | `deferred` | `containers release 1: later (Windows, WSL and macOS)` |
| AC-26 | `deferred` | `containers release 1: later (Compose)` |

A row that can't pass for core's reasons stays `todo`, with a comment here.

## 4. Done when

- The `containers-ports` and `containers` launches pass. Paste the summary line.
- All gates pass, and `check-coverage` is clean.
- PR title: `remote-containers: automatic port forwarding stays core's, proved by rows (card containers-75, #1236)`. Request athena only.
