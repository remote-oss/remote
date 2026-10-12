# Task card cli-04: the CLI path wired into the connect, with the window's local bridge (#412)

Why: #457 for #412, the CLI path, brief `brief-cli-path.md` §4, §4a and §6. cli-02 (the plan's `cli` kind), cli-03a (the
control client) and cli-03b (`installCli`, `startCli`, #451) give the parts. This card wires them into remote-ssh's
connect and builds the window's local bridge. Builder: daedalus. Reviewers: athena (design), themis or triton
(security: two tokens, a challenge, a local listener).

**Depends on cli-03b (#451).**

## 1. The timing the spec gives (F-2103 5.0 steps 5–8)

The window resolves **as soon as the CLI reports its port** (step 5): the title changes while the indicator still says
"Opening Remote...". The server download, with S045, comes **after**, some seconds later (steps 6–8). So the connect
doesn't wait for `serve`:
- the connect returns `Connected` once the control connection to the CLI has authenticated;
- the first socket the editor opens on the bridge starts `serve` (socket 0), and S045 runs during it;
- every later socket gets `openSocket`.

## 2. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/cli/cli-bridge.ts` | new: the bridge (section 4) |
| `packages/remote-ssh/src/cli/cli-connect.ts` | new: the CLI branch of the connect (section 3) |
| `packages/remote-ssh/src/pipeline/connect.ts` | `plan.kind === 'cli'` runs `cli-connect.ts`; the fallback (section 5) |
| `packages/remote-ssh/src/pipeline/steps.ts`, `server-steps.ts` | `installCli`, `startCli`, `stopCli` steps over cli-03b and section 3a |
| `packages/lib-server/src/scripts/bootstrap.ts`, `src/lifecycle/cli.ts`, `src/index.ts` | `stopCli` (section 3a) |
| `packages/lib-server/test/unit/bootstrap-script.test.ts`, `cli-lifecycle.test.ts`; `tests/acceptance/server/cli.test.ts` | `stopCli`'s rows (section 7) |
| `packages/remote-ssh/src/surfaces/…` | the S045 notification (section 6) |
| `packages/remote-ssh/test/unit/cli-bridge.test.ts`, `cli-connect.test.ts`, `connect.test.ts` | rows (section 7) |

## 3. The CLI branch of the connect

After the plan (`kind: 'cli'`) and the licence gate, as the server path has them:
1. **Install:** `steps.installCli(input, lease, host, plan, onPhase, cancellation)` over cli-03b's `installCli`. The
   phases are today's (S041; S044 and S029 on the client fallback; S084).
2. **Start:** `steps.startCli(…)` with a **control token**, 32 characters from `newNonce`. It returns `StartedServer`
   with `endpoint: {kind: 'port', port: <CLI port>}`.
3. **Reach the CLI:** `steps.openTunnel(input, lease, started.server, …)`, today's step, unchanged. It forwards a local
   port to the CLI's port on the path the settings choose (socks relay, second ssh). Its `opened.address` is a
   127.0.0.1 listener. The control client connects there with a plain TCP socket (`node:net`), which is cli-03a's
   `ByteStream`. This is brief §4a's "through W2's dialer", reached through the tunnel W2 already builds, with no
   new dialer path.
4. **Check the CLI requires the token** (themis on #430): `authenticate('<a second fresh nonce>')` must give
   `challengeRefused` with `message` `CodeError(AuthChallengeBadToken)`. Anything else (`authenticated`, another error,
   `closed`) means the CLI accepts callers it shouldn't. Then the connect fails as `serverStart` with the detail `the CLI
   did not require its token`. The control connection and the tunnel are closed, and **the CLI is stopped**
   (`stopCli`, section 3a; themis on #458): a CLI that requires no token stays up until its session ends and serves any
   local user meanwhile. No fallback: the CLI ran but is unsafe. Measured against the user's CLI build on Alpine with cli-03a's client: started with
   `VSCODE_CLI_REQUIRE_TOKEN`, a wrong token gave `challengeRefused` / `CodeError(AuthChallengeBadToken)` and the right
   one then gave `authenticated` on the same connection; started without it, the wrong token gave `authenticated`.
5. **Authenticate:** `authenticate(controlToken)` gives `authenticated`. A failure here is §6's "the CLI doesn't
   start": the control connection and the tunnel are closed, **the CLI is stopped** (`stopCli`), then the fallback
   (section 5).
6. **The bridge:** `openCliBridge(control, serveParams, events)` (section 4) gives a local listener. `Connected` is
   `{address: bridge.address, connectionToken: serveParams.connectionToken, …}`, as today's.

### 3a. `stopCli` (lib-server)

lib-server's `kill` can't stop the CLI: `stop_servers` kills a recorded process only when its command line holds
`$DATA_DIR/bin/`, and the CLI's file is `$DATA_DIR/<applicationName>-<commit>`. A new script step and function:

```ts
/** Stops the CLI that `startCli` started: `processId` only when it is still that CLI. */
export function stopCli(channel: HostChannel, base: ScriptParameters, processId: number, cancellation: AbortSignal): Promise<{kind: 'stopped' | 'notRunning'} | {kind: 'failed'; failure: RuntimeFailure}>;
```

- `ScriptStep` gains `'stopCli'`, with the body: `is_server_process "$CLI_STOP_PID" "$CLI_FILE"` (the existing guard,
  with the CLI's own file as the needle, so a recycled pid of another program is never killed). Then
  `pkill -P "$CLI_STOP_PID"` where `pkill` exists, `kill "$CLI_STOP_PID"`, `fact cli.stopped yes`, and `leave Ok`. A pid
  that fails the guard gives `fact cli.stopped no` and `leave Ok`.
- `CLI_STOP_PID` is a script parameter (a number, never a secret). It isn't in the lock loop: stopping one process needs
  no host lock.
- Callers: step 4 and step 5 of section 3, with `StartedServer.processId` from step 2.

Steps 1–3 need no stop: a failed `installCli` started nothing, and a failed `startCli` already ends its CLI (its script
kills the CLI that gave no ready line, and a CLI that exited is gone).

**Two tokens, never mixed:**
- the **control token** authenticates this extension to the CLI. It's given to `startCli` (environment only) and to
  `authenticate`, and goes nowhere else;
- the **connection token** is the server's. It's a fresh nonce, sent as `serve`'s `connection_token`, and the editor gets
  it as `Connected.connectionToken`.

Neither reaches a log line (contracts R-rules on secrets).

`serveParams`: `commit` is the CLI's own commit, the plan's `commit` (V7a). `quality` is the product's quality.
`useLocalDownload` is `false` (the CLI downloads on the host, as observed). The CLI's own client-download mode is
not this card's.

`release` closes the bridge, the control connection and the tunnel, then releases the lease, in that order.
`onTransport` adds the bridge's `onLost` (section 4) to today's listeners.

## 4. The bridge (`cli-bridge.ts`)

```ts
export interface CliBridge {
  /** The local listener the editor connects to. */
  readonly address: {host: '127.0.0.1'; port: number};
  /** Called once when the control connection ends without being asked to (`controlClosed`, a loss), or `serve` failed (`serveFailed`, a close). */
  onLost(listener: (cause: CliBridgeLoss) => void): void;
  close(): void;
}

export type CliBridgeLoss =
  | {kind: 'serveFailed'; error: CliServeError; errorLine: string | undefined}
  | {kind: 'controlClosed'};

export function openCliBridge(
  control: CliControl,
  serveParams: CliServeParams,
  events: {onServeLog(line: ServerLogLine): void},
  dependencies: {listen: LocalListen; scheduler: Scheduler; serveMilliseconds: number},
): Promise<CliBridge>;
```

- **The listener** is on `127.0.0.1`, an ephemeral port (contracts: every local listener names `127.0.0.1`), through
  remote-ssh's existing local-listener port, as the tunnel's own listener is.
- **The first accepted socket** runs `control.serve(serveParams, events.onServeLog)`, and every later one runs
  `control.openSocket(events.onServeLog)`. The client already runs them one at a time.
- **While a socket waits for its `serve`,** its bytes are buffered in arrival order and written to the `CliSocket` once
  it opens. Measured on cli-03a's fake: the editor writes its first frame at once.
- **Relay** both ways: `CliSocket.onData` to the TCP socket, TCP data to `CliSocket.send`. Each side's close ends the
  other. A TCP socket closed while its `serve` is pending is closed on the CLI side as soon as the socket opens.
- **The bound** (themis on #431): each `serve` and `openSocket` is bounded by `serveMilliseconds`. The first is the R-79
  bound for a server start (contracts V7: the start's ready bound plus the download's own deadline); later ones
  (about 0.1 s measured) use the connect wait. On expiry the bridge calls `control.close()` and reports
  `controlClosed`.
- **`serveFailed`:** a `serve` or `openSocket` that resolves `serveFailed` closes that TCP socket and reports `onLost`
  with the error, once (the first loss wins). An `openSocket` failure after a working `serve` is reported too: the window
  can't open its socket.
- **`close()`** stops the listener, closes every relayed socket and the control connection, and never reports `onLost`.

## 5. The fallback (brief §6)

Before `Connected` is returned, a CLI failure falls back **once per connect** to the direct install (`plan`'s `download`
or `reuse` kind for the same host, as `useExecServer: false` would give):
- `installCli` failed: not found (404) or no build, or any other download failure;
- `startCli` failed: no ready line, the CLI exited, `serverStart`;
- the control connection couldn't authenticate (step 5; for example a `vsda` CLI).

Each fallback logs one line with the cause: `the CLI path failed (<cause>); installing the server directly`. The
direct path's own failure, if any, is then the one shown. The unsafe-CLI case of step 4 doesn't fall back.

After `Connected` there is no fallback, and the two losses differ (athena on #458):
- **`serveFailed` is `closed`** (`onTransport('closed')`, the resolver host's `transportClosed`). A failed `serve` is
  deterministic: a missing runtime library (F-2103 7.E2), a bad template or a failed download fails the same way on
  every retry, so a reconnect would loop, which the spec rules out. The window gets F-2601's dialog with the failure
  classified from `parseCliServeError`. The kinds map to F-2103's 7.E rows and the S043/S075 reasons as `ofTransfer`
  and `ofStart` already map them: `download` → S043, `template` and `commitMismatch` → F-3902 rule 8's
  `invalidServerTemplate`, `other` → S075. The log gets `the CLI could not serve: <kind>: <message>` and the level-4
  line.
- **`controlClosed` is `lost`** (`onTransport('lost')`): the control connection or its tunnel ended, which a
  reconnect can heal, as today's tunnel loss (contracts §W2's loss rule).

## 6. S045

The notification `Downloading VS Code Server...` (STR:S045), through the editor's progress API, outside the connect's
progress (which has ended):
- `s045EventOf(line)` on each `serverlog` line: `show` opens it (indeterminate), `percent` sets the percentage,
  `hold` keeps it at 100 %;
- `serve`'s reply, a failure or `close()` closes it;
- it is shown at most once per `serve`, and never for `openSocket` (no download happens there, V7a).

The serverlog lines all go to the connect's log at their level (V7a "Logging").

## 7. Test table

One assertion per `it`; the cite starts the name. Over cli-03a's `fakeCli` and remote-ssh's existing fakes.

**cli-bridge.test.ts**

| Cite | Given | Expected |
|---|---|---|
| F-2103 5.0 step 5 | `openCliBridge` resolved, no socket accepted yet | the fake CLI got no `serve` |
| F-2103 5.0 step 6 | one socket accepted | the fake got `serve` with `socket_id` 0 and `connectionToken` `serveParams`' |
| §4a | a second socket accepted after the first is serving | the fake got a second `serve` with `socket_id` 1 |
| §4a | bytes written to socket 0 before its `serve` replied | the fake's `servermsg {i: 0}` bodies, joined, equal them, in order |
| §4a | the fake sends `servermsg {i: 1, body}` | only socket 1's TCP peer got `body` |
| §4a | socket 0's TCP peer closes | socket 0 sent no more `servermsg` |
| §4a | the fake sends `serverclose {i: 0}` | socket 0's TCP peer saw the end |
| themis on #431 | the fake never answers the first `serve`; the bound passes | `onLost` got `controlClosed`, and the control was closed |
| §6 | the first `serve` gets the error reply of #412's run 5 | `onLost` got `serveFailed` with `error.kind` `template` |
| §6 | the same | socket 0's TCP peer saw the end |
| §6 | two losses in a row | `onLost`'s listener ran once |
| §4a | `close()` | the listener refuses a new connection, the control is closed, and `onLost` never ran |
| contracts | the listener's address | host `127.0.0.1` |

**cli-connect.test.ts**

| Cite | Given | Expected |
|---|---|---|
| themis on #430 | a CLI that answers any token | the connect fails `serverStart`, detail `the CLI did not require its token` |
| themis on #430 | the same | no fallback ran (the direct path's steps weren't called) |
| themis on #458 | the same | `stopCli` ran with the CLI's process id |
| themis on #458 | `authenticate` with the control token is refused | `stopCli` ran with the CLI's process id, before the fallback's first step |
| themis on #430 | a CLI that requires its token | the first `challenge_issue` carried a token that isn't the control token |
| §4a | a connect that succeeds | `Connected.address` is the bridge's |
| §4a | the same | `Connected.connectionToken` is `serve`'s `connection_token`, and neither is the control token |
| S10 | the same | `startCli`'s environment holds the control token, and no log line holds either token |
| F-2103 5.0 step 5 | the same | the connect resolved before any `serve` |
| §6 | `installCli` fails with a 404 | the direct install ran once, and the log has `the CLI path failed (…); installing the server directly` |
| §6 | `startCli` fails | the same |
| §6 | `authenticate` with the control token is refused | the same |
| §6 | the CLI path fails, then the direct install fails | the connect's failure is the direct install's |
| §6 | the CLI path fails twice in one connect (fallback then the direct path) | the CLI path was tried once |
| athena on #458, F-2103 7.E2 | after `Connected`, the bridge reports `serveFailed` | the window's `onTransport` got `closed`, never `lost` |
| athena on #458 | the same, with `error.kind` `download` | the presenter got the failure with the S043 reason |
| athena on #458 | the same, with `error.kind` `other` | the presenter got the failure with the S075 reason |
| §6 | the same, with `error.kind` `template` | the log holds `the CLI could not serve: template: …` |
| §W2 | after `Connected`, the bridge reports `controlClosed` | the window's `onTransport` got `lost` |
| — | `release()` | the bridge, the control, the tunnel and the lease were closed in that order |

**stopCli** (lib-server)

| Cite | Given | Expected |
|---|---|---|
| themis on #458 | the `stopCli` script | it calls `is_server_process "$CLI_STOP_PID" "$CLI_FILE"` before any `kill` |
| themis on #458 | a result block `Ok` with `cli.stopped=yes` | `{kind: 'stopped'}` |
| themis on #458 | `Ok` with `cli.stopped=no` | `{kind: 'notRunning'}` |
| themis on #458 | `stopCli` | the request's `environment` is `{}` and its runs aren't wrapped in the lock loop |
| themis on #458 (real host, `cli.test.ts`, with the archive) | `startCli`, then `stopCli` with its pid | within 5 s, `ps -eo args` on the host shows no `command-shell` |
| themis on #458 (real host) | `stopCli` with the pid of a `sleep 60` started on the host | `notRunning`, and the `sleep` still runs |

**S045** (over the progress fake)

| Cite | Given | Expected |
|---|---|---|
| F-2103 5.0 step 6 | the serverlog lines of V7a's table, then `{}` | S045 shown once, the percentages in order, held at 100, closed after the reply |
| F-2103 BR-8 | a `serve` with only the check and start lines | S045 never shown |
| §4a | an `openSocket` | S045 never shown |

## 8. Gates and review

PR title `remote-ssh: the CLI path, with the window's local bridge (card cli-04, #412)`. The real-host and VSCodium
rows are cli-05's.

## 9. Open rows

- The server source passed at start (`remote-oss/remote-ssh#79` point 1, asked) is cli-03b's. If metis answers
  "run time", it's a change to `startCli`'s environment, not to this card.
