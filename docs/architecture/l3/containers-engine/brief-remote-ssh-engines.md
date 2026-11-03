# Brief: dev containers from a Remote-SSH window (group 16, part B)

Owner: athena (architect). Plan: #1807 group 16. Specs:
- remote-oss/remote-containers#103 (F-1302 Dev containers on SSH hosts and tunnels, `spec:reviewed`), with ruling R-89
  (its §16: nested authorities over the outer resolver's exec server);
- the SSH-window lines the part A brief (`brief-remote-docker-hosts.md` §5) and earlier briefs left to this one.

Decisions: R-26, R-27, R-79, R-89, ADR-0009, ADR-0010, ADR-0013, F-1403 (the `resolvers` proposal),
`brief-cli-path.md` (the CLI control client), `contracts.md` §1 and §2. Tunnel windows take the same route over the
tunnel's exec server once the user has answered F-8902 (Q5, Q8 to Q12). Until then they're out of this brief.

## 1. The route (R-89)

A dev container opened from an `ssh-remote` window has the nested authority `dev-container+<hex>@ssh-remote+<host>`.
lib-authority's container codec already carries the outer hop. Everything that touches the engine runs **on the SSH
host**, over the outer resolver's **exec server**:
- the Docker CLI;
- the dev container CLI;
- the server install into the container;
- the exec relays;
- the shutdown stop.

Core passes that exec server to our resolver as `RemoteAuthorityResolverContext.execServer`. Commands that run in the
SSH window before the reload (Reopen, Open Folder in Container, the wizard's reads, Clone in Volume) get it with
`workspace.getRemoteExecServer(env.remoteAuthority)`. Nothing uses a local Docker (BR-3).

`ExecServer` is the `[oss] vscode.proposed.resolvers.d.ts` interface: `spawn`, `kill`, `env`, `tcpConnect`, `fs`.
Packages type it with a structural type of ours carrying only the members used, citing the `[oss]` file.

## 2. remote-ssh serves the exec server (cross-family; `brief-cli-path.md`'s "slice 3")

- **remote-ssh's resolver gains `resolveExecServer(authority)`.** It returns an exec server over the window's **CLI
  control connection** (exec mode), the authenticated connection `brief-cli-path.md` already holds per connect.
- **lib-server's `cli-control` client gains** the CLI control server's methods (`[cli] cli/src/tunnels/control_server.rs`,
  MIT):
  - `spawn`, with three duplex streams;
  - `sys_kill`, `get_env`;
  - `net_connect`, one duplex stream (for `tcpConnect`);
  - `fs_stat`, `fs_read`, `fs_write`, `fs_connect`, `fs_rm`, `fs_mkdirp`, `fs_rename`, `fs_readdir`.

  It also gains the duplex-stream framing those methods use, read from the CLI's own RPC code (`[cli] cli/src/rpc.rs`).
- **The adapter** `execServerOf(control)` maps those methods to the `ExecServer` shape. It lives in lib-server, so
  Remote - Tunnels serves the same adapter over its own control connection later.
- **Direct mode** (no CLI: `remote.SSH.useExecServer` off, or no CLI build for the host's platform):
  - `resolveExecServer` refuses with a reason, and the nested resolve fails through C8 with that reason in its log;
  - no second exec route is built over plain ssh channels, because it would duplicate the CLI's work for an opted-out
    case.
  - **CLI builds:** the CLI archives come in Alpine builds first (#1815's ruling). F-1302's rows need a CLI for the lab's
    SSH host, which is the "row needs a glibc host" condition for glibc builds.
- **Security:** the exec server answers only the window's own extension host through core's API. remote-ssh registers
  nothing else. `spawn`'s environment goes in the CLI's spawn options, never in argv (R-26).

## 3. remote-containers over the exec server

1. **C2's engine host:** `EngineHost` gains an exec-server adapter. `run` and `spawn` call `execServer.spawn('docker',
   argv, {env})`, and the coordinate's variables go in `env`. The engine coordinate is the SSH host's: the effective
   engine is read from the host's environment (`env()`) plus the window's settings (F-0205's rules), not the client's.
2. **C3's CLI on the SSH host** (ADR-0009, a second exception, amended with this card):
   - **The program:** the pinned dev container CLI and our preload are written once per version to
     `<the outer server's data folder>/remote-oss-containers-cli/<version>/` through `fs_write`. They run on the outer
     VS Code server's own `node`, as C11's relay script runs on a server's `node`.
   - **The environment:** the spawn environment is the host's (`env()`), so `${localEnv}` and `${localWorkspaceFolder}`
     resolve on the host (BR-11).
   - **The override file** goes on the host, mode 0600, deleted after the run.
3. **C11's exec channel and the exec dialer:** `docker exec -i` spawned through the exec server. The window tunnel's
   relay and lib-server's install into the container then work unchanged on top of them.
4. **Paths:**
   - host paths are the SSH host's, POSIX (ADR-0013's host platform from `env().osPlatform`);
   - `devcontainer.local_folder` is the host folder (BR-4);
   - the payload's `hostPath` is the host's path.
5. **The label** gains " @ <host>" from the outer authority, so the title reads `[Dev Container: <name> @ <host>]` and
   Open Recent records the hop (BR-13).
6. **The shutdown stop on the SSH host** (F-0417 AC-29, AC-31, AC-32, BR-13; the reference fails here, 7.E5):
   - **Where the helper runs:** C9's helper runs on the host, where the engine is, started through the exec server
     with the outer server's `node`, detached so it outlives the SSH connection. It listens on an owner-only Unix
     socket in the host's runtime folder.
   - **The lease:** each dev container connection's lease is an `fs_connect` stream to that socket. When the window
     closes, the SSH connection ends, the stream ends, and the helper's 10 s check and stop run on the host (same
     registry code, same rules).
   - **One helper per host user**, found again by its socket.

## 4. The rest of the SSH-window lines

- **Reopen Folder in SSH** (`brief-reopen-locally.md`: F-0406 AC-4, AC-5, AC-15 SSH half, AC-19, AC-37): the origin is
  the outer authority, and the reopen goes to `vscode-remote://ssh-remote+<host><folder>`.
- **The views** (`brief-views-and-commands.md` §6):
  - F-0901 AC-14, AC-23's SSH analogue, AC-17, AC-26;
  - F-0903 AC-21: no Wayland bind, since the host's socket isn't the client's.
- **Attach** (`brief-attach.md` §11): F-0601 AC-25 and AC-69 (c). The picker lists the host's containers through the exec
  server, with the " @ <host>" suffix.
- **Personalization** (`brief-personalization.md` §6): the relays' host side stays on the **client** (F-1003 6.5: the
  local agent). Only the relay host's `docker exec -i` goes through the exec server. F-1002 asks the SSH host's Git
  configuration first (BR-14).
- **The r1 lines** of part A's §5 table (F-0201, F-0401, F-0403, F-0405, F-0408, F-0410, F-0411, F-0412, F-0415, F-0416,
  F-0417, F-0419, F-0501, F-0504, F-0801, F-1101) follow from §1 to §3. Their rows run in an SSH window on the lab's
  host with Docker.

## 5. Contracts and components

- **`contracts.md`:**
  - §1: C11 over an exec server;
  - §2: the nested resolve, which takes `context.execServer`;
  - §4: `EngineHost` and `CliHost` over an exec server.
- **lib-server:** `cli-control` gains the duplex framing and the methods, plus `execServerOf`.
- **The transport area's contracts:** remote-ssh's resolver gains `resolveExecServer`.
- **ADR-0009:** the second container-CLI exception (the SSH host). It's amended with card 3.
- **`components.md`:** C19 (remote engines) joins: C2's and C3's exec-server adapters, the host-side shutdown helper,
  the nested resolve.

## 6. The cut and the cards

**The cut:**

| Lines | Where |
|---|---|
| F-1302 (25), and part A's §5 SSH-window set | this brief |
| F-0601 AC-25, AC-69 (c); F-0901 AC-14, AC-17, AC-26; F-0903 AC-21; F-0406's SSH half; F-1003 6.5; F-1002 BR-14 | this brief (§4) |
| F-0901 AC-23, F-0406 AC-17 and AC-25, F-0801 AC-19, and the tunnel r1 lines | the tunnel half, after F-8902 |

**Suggested cards**, in order:
1. **lib-server:** the duplex framing, the methods, `execServerOf`, with unit rows over `testing/fake-cli.ts`.
2. **remote-ssh:** `resolveExecServer` in exec mode, and the direct-mode refusal. The acceptance row is an extension
   in an SSH window that spawns `echo` through `getRemoteExecServer`.
3. **remote-containers:** C2, C3 (the CLI on the host, plus the ADR-0009 amendment) and C11 over the exec server; the
   nested resolve; the label. Rows: F-1302's.
4. **The host-side shutdown helper** (§3.6). Rows: F-0417 AC-29, AC-31, AC-32.
5. **The views, attach and reopen lines** of §4. Rows: theirs.

Fixtures (proteus): the lab's SSH host gets Docker (shared with part A) and a CLI build for its platform.
