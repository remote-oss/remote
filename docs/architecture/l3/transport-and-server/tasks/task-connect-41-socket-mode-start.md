# Task card connect-41: socket mode reaches the server start

Issue: #679. Release 0.2, **gating**: it's the socket-mode half of #299's blockers. Size: M (about 2.5 agent-days).
Builder: assigned by hermes. Spec: F-2410 (remote-oss/remote-ssh#55). Found by the unwired-contribution audit
(2026-10-13).

## 1. The defect

- **The read:** `remote.SSH.remoteServerListenOnSocket` is read (`pipeline/connect-settings.ts`, `tunnelSettingsOf`),
  so `selectTunnelPath` (lib-forwarding) returns `'socket'`, and `effectiveUseLocalServer` makes the connect run in
  terminal mode.
- **The start:** the server always starts with `socketMode: false` (`pipeline/parameters.ts`, `runtimeOptionsFor`), so
  it listens on a TCP port.
- **The failure:** the tunnel step's `forwardFor` (`pipeline/tunnel-step.ts`) throws "the socket path needs a socket
  endpoint", and every connect with the setting on fails.
- **What's already built:**
  - lib-server's socket start, one server per endpoint kind (server-14, #339/#342): `SOCKET_MODE`, `KIND_PREFIX`, the
    `server.socketPath` fact, and `endpointOf` giving `{kind: 'socket', path}`;
  - the tunnel's socket branch (#357, terminal mode T7).

  Only the remote-ssh side is missing.

**A second fault on the same path:** `pipeline/connect.ts` computes `portOf(started.server)` for the shared record and
for the connection's `serverPort`. `portOf` throws for a socket endpoint ("a socket-mode server reached the port path").

## 2. The rules

- **R1. The one decision.** A connect's socket mode is `steps.tunnelPath() === 'socket'`. That's the tunnel step's own
  choice, which is made once per connect (`openTunnelStep`'s `chosen ??=`). The start and the tunnel therefore can't
  disagree, whichever asks first.
- **R2. The start:** `runtimeOptionsFor(settings, bounds, licenceAccepted, socketMode)`, a fourth parameter, sets
  `socketMode`. The server steps take `socketMode: () => boolean` in their dependencies. `wiring.ts` passes
  `() => tunnelStep.tunnelPath() === 'socket'`, from the same tunnel step object the connect uses: make it once per
  connect and spread it as today. `scriptParametersFor` passes the same value to `start.socketMode`.
- **R3. No CLI path in socket mode, in 0.2** (athena, register 1440a86).
  - The reason is scope, not the CLI:
    - [cli] `command-shell` has `--on-socket` (`cli/src/commands/args.rs` at 07f806f999), and the reference's socket
      mode uses it (F-2410 5.0 step 5);
    - but our CLI path is dormant in 0.2, and CLI over a socket needs the bridge's control connection forwarded to a
      socket, which is later work.
  - So in socket mode the plan installs directly: `CliModeInput` gains `socketMode: boolean`, and `decideCliMode`
    answers `{kind: 'direct', reason: 'socketMode'}` right after the `settingOff` check. `DirectReason` gains
    `'socketMode'`.
  - The plan's log line names the reason, as it does for the others.
  - **0.2 release notes:** "With `remote.SSH.remoteServerListenOnSocket` on, Remote - SSH always installs and starts
    the server directly, not through the VS Code CLI." Add the line to the release-notes draft the 0.2 notes card
    keeps, or, if there's none yet, to this card's PR description for hermes to carry.
- **R4. A socket endpoint in the connect** (`connect.ts`):
  - the shared record is stored only for a port endpoint. A socket-mode connect is in terminal mode, whose lease
    stores nothing, so skip the `storeSharedRecord` call for a socket endpoint rather than call it with a bogus port;
  - the connection's `serverPort` is `0` for a socket endpoint, as the CLI path's is. The connector then answers
    `serverPort()` with `0`, and the web UI (F-2509) has no port, as on the CLI path.
- **R5. Reuse by kind** (F-2410 BR-6, BR-7) is lib-server's (server-14): a socket connect finds or starts the socket
  kind's server and leaves a running port-kind server alone. This card adds nothing to it, and a row checks it.

## 3. Changes

| File | Change |
|---|---|
| `packages/remote-ssh/src/pipeline/parameters.ts` | `runtimeOptionsFor`'s fourth parameter `socketMode = false`; `ParameterInput` gains `socketMode` |
| `packages/remote-ssh/src/pipeline/server-steps.ts` | `ServerStepDependencies.socketMode: () => boolean`, read once when the start runs, and passed to `runtimeOptionsFor` and `parametersFor`; the plan's `cliMode` input gains `socketMode` |
| `packages/remote-ssh/src/pipeline/wiring.ts` | one tunnel step per connect, whose `tunnelPath` the server steps' `socketMode` reads |
| `packages/remote-ssh/src/pipeline/connect.ts` | R4 |
| `packages/lib-server/src/cli-path/decision.ts` | R3 |

Nothing in lib-server's scripts changes.

## 4. Rows

**Unit rows:**

| Cite | Given | Expected |
|---|---|---|
| F-2410 BR-4 | `runtimeOptionsFor(settings, bounds, false, true)`; the default | `socketMode` `true`; `false` |
| F-2410 BR-4 | the wiring (`wiring.test.ts`) with the tunnel settings on socket, then the start's parameters | `start.socketMode` is `true`; with socks or secondSsh, `false` |
| F-2410 BR-4 | the wiring asked for the start before the tunnel path, and the tunnel path after | both see the same answer (the decision is made once) |
| F-2410 AC-3 | `decideCliMode` with `socketMode: true` and every other input allowing the CLI | `{kind: 'direct', reason: 'socketMode'}`; with `useExecServerSetting: false` the reason stays `settingOff` |
| F-2410 AC-2 | the connect (`connect.test.ts`) with a start answering `{kind: 'socket', path: '/tmp/code-x'}` | the connect resolves `connected`, `serverPort` `0`, `storeSharedRecord` never called, and no warn line about the shared record |

**Acceptance rows** (VSCodium):
- **The launch:** a runner-remote launch `socket`, after `terminal` in `launchesOf`, with
  `settings: {'remote.SSH.remoteServerListenOnSocket': true, 'remote.SSH.remotePlatform': {harness: 'linux'}}` (AC-2's
  "platform stored"). Suite `suite-socket`.
- **Its registration:** the suite folder joins `tests/acceptance/tsconfig.json`, `knip.jsonc`, `eslint.config.ts`'s
  project list, the README's labels and the launch-table tool rows.
- **The rows**, each name starting with its cite:
  1. `F-2410 AC-2, AC-3: in socket mode the window connects and the server listens on a socket in /tmp`:
     - `vscode.workspace.fs.stat` of `vscode-remote://ssh-remote+harness/home/harness`, retried every 500 ms for up
       to 60 s, gives a directory;
     - `onHost('sh', '-c', 'for f in /tmp/code-*; do [ -S "$f" ] && echo "$f"; done')` prints at least one path;
     - the server process whose arguments carry `--socket-path` exists (`onHost('ps', '-o', 'args')`), and no process
       of the server carries `--port` with that socket's start. Check this by the server's `.socket.pid` file in its
       data folder, which is server-14's `KIND_PREFIX.pid`;
     - **it must fail on main and pass with the fix:** paste both runs.
  2. `F-2410 AC-9, BR-7: a running port-kind server is left as it is`:
     - in `before`, note the pids of the processes whose arguments carry `--port` (the `remote` and `reconnect`
       launches leave one);
     - after row 1, each of them still runs. If there was none at the start, the row fails with a message saying so,
       rather than passing.

**Full VSCodium run:** every launch green. Paste the summary.

## 5. Gates and review

All gates, the changed files at 100 %. PR title `remote-ssh, lib-server: socket mode reaches the server start (card
connect-41, #679)`. themis or triton reviews; athena gives the design check. proteus checks a manual
`remoteServerListenOnSocket: true` connect on the built VSIX.

## 6. Open rows (stop and report on #679)

1. **The harness host can't run the direct install** in socket mode (no downloader for the stand-in). Report it. R3
   itself is ruled (direct in 0.2; CLI over a socket is later work).
2. **The server's argument list in socket mode** carries something other than `--socket-path` on the harness host's
   server. Report it, and assert on the `.socket.pid` file's process instead.
