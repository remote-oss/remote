# Task card server-14: the server's socket path, one server per endpoint kind (terminal mode T6)

Why: athena's terminal-mode brief (`brief-terminal-mode.md`, T6; 0.2 blocker #299) and her ruling on #299 (main
2fe121f). In socket mode (`remote.SSH.remoteServerListenOnSocket`, F-2410) the server listens on a Unix socket in the
host's temporary folder instead of a TCP port, and opens no TCP listener (F-2410 AC-9). The `[oss]` server
(`src/server-main.ts`) listens on `--socket-path <p>` **instead of** `--host`/`--port` (one `listen`), and prints the
same ready line with the path in place of the port: `Extension host agent listening on <path>`. **Ruled:** one server
per endpoint kind, each reused only by a connect of its own kind; a mode switch starts the other kind and leaves the
first running (F-2410 BR-6, BR-7); "Kill VS Code Server on Host..." stops both (F-2411). Reviewing coder:
`remote-coding-worker-1`.

Prototyped over main through the real shell (2026-10-12, daedalus): a socket start passes `--socket-path` and no
`--host`/`--port` and reports the path; a second socket start reuses it with the same path; a port start then starts a
second server and leaves the socket one running; the kill stops both processes. Every existing row of
`bootstrap-script.test.ts` and `runtime.test.ts` passed with `socketMode: false`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-server/src/scripts/bootstrap.ts` | `StartParameters.socketMode`; the kind's files; `--socket-path`; the ready reader (section 2.1) |
| `packages/lib-server/src/lifecycle/runtime.ts` | `RuntimeOptions.socketMode`; `StartedServer.endpoint`; `serverPort` (section 2.2) |
| `packages/lib-server/test/unit/fake-host.ts` | the stand-in launcher prints the `--socket-path` value when given one; `parametersFor` has `socketMode: false` |
| `packages/lib-server/test/unit/bootstrap-script.test.ts` | rows added (section 3.1) |
| `packages/lib-server/test/unit/runtime.test.ts` | rows changed and added (section 3.2) |
| `packages/remote-ssh/src/pipeline/parameters.ts` | `runtimeOptionsFor` and `scriptParametersFor` pass `socketMode: false` (T5 sets it) |
| `packages/remote-ssh/src/pipeline/connect.ts`, `tunnel-step.ts` | the reads of `server.port` become the endpoint's port (section 2.3) |
| `tests/acceptance/server/start.test.ts`, `real-server.test.ts` | the same, in the reads listed in 2.3 |

Nothing else. No connect uses socket mode until T5 (remote-ssh passes `false`), so nothing observable changes in
this card's connect.

## 2. Contract

### 2.1 The start script (`bootstrap.ts`)

- `StartParameters` gains `/** Whether the server listens on a socket in the host's temporary folder instead of a
  TCP port. */ socketMode: boolean;`, assigned to the script as `SOCKET_MODE` (`yes` or `no`) beside
  `READY_SECONDS`.
- **The kind's files.** `startBody` begins with
  `if [ "$SOCKET_MODE" = yes ]; then KIND_PREFIX=$BOOT_PREFIX.socket; else KIND_PREFIX=$BOOT_PREFIX; fi`, and
  `PID_FILE`, `LOG_FILE` and `TOKEN_FILE` are `$KIND_PREFIX.pid`, `.log`, `.token`. Port mode's names are unchanged
  (`.<commit>.pid` and so on); socket mode's are `.<commit>.socket.pid` and so on. A running server is therefore found
  and reused only through its own kind's PID file: that is "reuse only on a match".
- **The kill needs no change.** `stop_servers` stops every `"$DATA_DIR"/.*.pid`, which matches both kinds' PID files,
  and `KILL_BODY` removes them all.
- **The endpoint options.** `startOptions` puts `--socket-path "$SOCKET_FILE"` in place of `--host <bindHost> --port
  <port>` when `start.socketMode` is true. `"$SOCKET_FILE"` is passed unquoted-by-TypeScript, like `"$TOKEN_FILE"`.
- **The socket path.** In the launch branch (where the token is made), before `set --`, socket mode sets
  `SOCKET_FILE="${TMPDIR:-/tmp}/code-$(tr -dc 'a-f0-9' </dev/urandom | head -c 32)"`. It's random (not derived) so a
  predictable path in a shared `/tmp` can't be squatted; F-2410 BR-4 names `code-<uuid>` in the host's temporary
  folder. A reused server's path comes back from its log's ready line, so nothing else records it.
- **The ready reader** stays POSIX (no GNU `\|`): `ready_port` takes the first word after the ready line,
  `sed -n 's/.*<READY_LINE> \([^ ]*\).*/\1/p'`, and `started` classifies it:

  ```sh
  case $SOCKET_MODE:$1 in
    yes:/*) fact server.socketPath "$1" ;;
    no:[0-9]*) fact server.port "$1" ;;
    *) leave ServerFailedToStart ;;
  esac
  ```

  (replacing today's unconditional `fact server.port "$1"`). A server that reports the wrong kind fails the start.

### 2.2 The runtime (`runtime.ts`)

- `RuntimeOptions` gains `socketMode: boolean`, passed into `start.socketMode`.
- `StartedServer.port` becomes:

  ```ts
  /** Where the server listens: a TCP port on the host's loopback, or a socket in the host's temporary folder. */
  endpoint: {kind: 'port'; port: number} | {kind: 'socket'; path: string};
  ```

- `outcomeOf` reads it with a new `endpointOf(serverFacts)`: a `socketPath` fact that starts with `/` is
  `{kind: 'socket', path}`; a `socketPath` that doesn't is no endpoint; with no `socketPath`, a `port` that is an
  integer in 1–65535 is `{kind: 'port', port}`; anything else is no endpoint. No endpoint is `unreadableServerFacts`,
  as an unusable port is today.
- `serverPort(started)` gives `started.endpoint.port` for a port endpoint and `'none'` for a socket one (F-2509 AC-19:
  "remoteServerListenOnSocket true … no URL is opened") or when no server runs. Its JSDoc says so.

### 2.3 The reads of the port elsewhere (mechanical)

Each read of `server.port` / `started.server.port` becomes the port endpoint's port. In remote-ssh the server is only
started in port mode until T5, so a socket endpoint there is a defect:

- `remote-ssh/src/pipeline/connect.ts`: the shared record's `remotePort` (and, if #334 is merged, `serverPort:` on
  the `Connection`) read `portOf(started.server)`, a small helper in `connect.ts` that returns the port of a port
  endpoint and **throws** `Error('a socket-mode server reached the port path')` for a socket one (the pipeline turns a
  throw into `unknown`).
- `remote-ssh/src/pipeline/tunnel-step.ts`: `target: {kind: 'port', port: server.port}` becomes
  `portOf(server)`, imported from `./connect.ts`, where `portOf` is exported. One helper, in `connect.ts`.
- `tests/acceptance/server/start.test.ts` and `real-server.test.ts`: `outcome.server.port` becomes
  `outcome.server.endpoint.kind === 'port' ? outcome.server.endpoint.port : -1` (their rows run port mode).

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 `bootstrap-script.test.ts` (the real shell, in the `start` describe; `socket()` is `parametersFor()` with
`start.socketMode: true`)

| Cite | Given | Expected |
|---|---|---|
| F-2410 5.0 step 5 | a socket start | status `Ok`, a `server.socketPath` fact matching `^/.*/code-[0-9a-f]{32}$`, no `server.port` fact |
| F-2410 AC-9 | the launcher's arguments of a socket start | contain `--socket-path`, and neither `--host` nor `--port` |
| F-2410 BR-4 | a socket start with `TMPDIR` set to a folder of the test | the path is in that folder |
| F-2410 BR-6 | two socket starts | the second has the first's path and `server.reused` `yes` |
| F-2410 BR-6 | two socket starts | the launcher started once |
| F-2410 BR-7 | a socket start, then a port start | the port start has `server.port` `4321` and `server.reused` `no` |
| F-2410 BR-7 | the same | the launcher started twice, and the socket server's process is still alive |
| F-2410 BR-7 | a port start, then a socket start | the socket start has `server.reused` `no` (a port server is not reused for it) |
| F-2411 POST-1 | a port start and a socket start, then `kill` | neither server process is alive afterwards |
| F-2410 BR-6 | a socket start | the data folder holds `.abc123.socket.pid` and no new `.abc123.pid` |
| #299 | a socket start whose stand-in prints a port (`SERVER_READY_TEXT` makes it print `4321` even with `--socket-path`) | status `ServerFailedToStart` |

The stand-in launcher in `fake-host.ts` prints its endpoint like this, replacing today's fixed `4321` line:

```sh
ENDPOINT=4321
while [ $# -gt 0 ]; do [ "$1" = --socket-path ] && ENDPOINT=$2; shift; done
[ "$SERVER_SILENT" = yes ] || echo "Extension host agent listening on ${SERVER_READY_TEXT:-$ENDPOINT}"
```

(`SERVER_READY_TEXT` lets the last row make it print a port in socket mode; unset, the behaviour is today's.)

### 3.2 `runtime.test.ts`

Changed (their names stay; they compare a `StartedServer`): "V7: the port, process and token of an Ok block are the
server", "V7: a server the host says it found running is reused", "V7: the highest port and the lowest process id that
are valid are accepted", and "F-2509: the port of a started server": each `port: n` becomes
`endpoint: {kind: 'port', port: n}`.

Added:

| Cite | Given | Expected |
|---|---|---|
| F-2410 5.0 step 5 | an Ok block with `server.socketPath=/tmp/code-ab`, a pid and a token | `endpoint` `{kind: 'socket', path: '/tmp/code-ab'}` |
| V7 | an Ok block with `server.socketPath=code-ab` (not absolute) | `unreadableServerFacts` |
| V7 | an Ok block with both `server.socketPath=/tmp/code-ab` and `server.port=4321` | the socket endpoint (the socket fact decides) |
| F-2509 AC-19 | `serverPort` of a server with a socket endpoint | `'none'` |
| F-2410 | `startOrReuse` with `socketMode: true` over the real shell | the outcome's `endpoint.kind` is `socket` |
| F-2410 | `startOrReuse` with `socketMode: true` | the script's parameters had `start.socketMode` true (through the recording channel, as the existing `port`/`bindHost` rows check) |

### 3.3 remote-ssh

| Cite | Given | Expected |
|---|---|---|
| #299 | `portOf` of a port endpoint `4321` | `4321` |
| #299 | `portOf` of a socket endpoint | throws `/socket-mode server reached the port path/` |
| F-2410 | `runtimeOptionsFor(...)` | `socketMode` false |

Every other existing row passes unchanged.

## 4. Rule for the worker

As card log-01; coverage at lib-server's and remote-ssh's 100/100/100 ratchets; the acceptance suites
(`test:acceptance:server`) still pass in CI.

## 5. Gates and review

PR title `lib-server: the server's socket path, one server per endpoint kind (card server-14, terminal mode T6)`.

## 6. Open rows

None.
