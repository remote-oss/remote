# Task card cli-03a: the CLI's control client, over a byte stream (#412, contracts V7a)

Why: #412, the CLI path, brief `brief-cli-path.md` §4a and §10. The extension speaks the CLI's control protocol: the
challenge, `serve`, the `serverlog` stream, the error reply, and the `servermsg` frames the window's bridge (cli-04)
relays. Contracts **V7a** (#422) records the protocol from `[cli]` and from the live run on #412. This card builds the
client in lib-server's new `cli-control` component, over a byte-stream port and with no socket of its own, so it is
unit-tested against a fake CLI. The CLI archive transfer and `startCli` are card cli-03b. Reviewing coder:
`remote-coding-worker-1`.

**Merges only after step 0** (brief §9) and #422. It can be built now.

**Not in this card:** any rule for when the CLI ends (V7a's Lifetime paragraph is provisional, pending
`remote-oss/remote-ssh#21`). The client never ends the CLI process; it only closes its own connection.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-server/package.json` | dependency `@msgpack/msgpack` (ISC, no dependencies), pinned `3.1.3` |
| `packages/lib-server/src/cli-control/rpc.ts` | new: the framing (section 2.2) |
| `packages/lib-server/src/cli-control/client.ts` | new: `openCliControl` (section 2.3) |
| `packages/lib-server/src/cli-control/progress.ts` | new: `serverlog` → the S045 events (section 2.4) |
| `packages/lib-server/src/testing/fake-cli.ts` | new: a fake CLI over an in-memory stream pair (section 3) |
| `packages/lib-server/src/index.ts` | the exports of section 2 |
| `packages/lib-server/package.json` `exports` | `./testing/fake-cli` |
| `docs/adr/0005-reuse-of-open-source-components.md` | one reuse row: `@msgpack/msgpack` for the CLI's control protocol (brief §4a) |
| `packages/lib-server/test/unit/cli-control.test.ts`, `cli-progress.test.ts` | rows (section 3) |

`pnpm check-licences` must pass with the new dependency (ISC is allowed).

## 2. Contract

### 2.1 The byte stream

```ts
/** A connection that carries bytes both ways; lib-forwarding's `Duplex` satisfies it. */
export interface ByteStream {
  send(chunk: Uint8Array): boolean;
  onData(listener: (chunk: Uint8Array) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}
```

### 2.2 `rpc.ts`, the framing (V7a "Control protocol")

- Every message is one msgpack map, and messages follow each other on the stream with no separator. Decode with
  `@msgpack/msgpack`'s `Decoder` over a growing buffer: a partial message waits for the next chunk; several messages in
  one chunk are all handled in order.
- A request is `{id, method, params}`, with ids 1, 2, 3… per connection. A reply is `{id, result}` or `{id, error:
  {code, message}}`. A notification is `{id: null, method, params}` (or without `id`).
- A reply to an unknown id, or a message that isn't a map, is ignored and counted (`malformed`), never thrown.
- Bytes in `servermsg`'s `body` are msgpack `bin`. Encode them as `Uint8Array`, and decode them as `Uint8Array`.

### 2.3 `openCliControl`

```ts
export type CliControlFailure =
  | {kind: 'challengeRefused'; message: string}   // the CLI refused the token or the response
  | {kind: 'serveFailed'; error: CliServeError; message: string; errorLine: string | undefined}
  | {kind: 'closed'};                              // the stream ended before the reply

export interface CliControl {
  /** Runs `challenge_issue` then `challenge_verify` (V7a). */
  authenticate(token: string): Promise<{kind: 'authenticated'} | CliControlFailure>;
  /** Runs the connect's `serve` on socket 0; `onLog` gets each `serverlog` line as it arrives, before the reply. */
  serve(
    params: {commit: string; quality: string; connectionToken: string; useLocalDownload: boolean},
    onLog: (line: {text: string; level: number}) => void,
  ): Promise<{kind: 'serving'; socket: CliSocket} | CliControlFailure>;
  /** Runs `serve` again, with the next `socket_id` and the first `serve`'s parameters, and opens that socket. */
  openSocket(
    onLog: (line: {text: string; level: number}) => void,
  ): Promise<{kind: 'serving'; socket: CliSocket} | CliControlFailure>;
  close(): void;
}

export interface CliSocket {
  readonly socketId: number;
  /** Sends bytes to the server as one `servermsg {i, body}`. */
  send(chunk: Uint8Array): void;
  onData(listener: (chunk: Uint8Array) => void): void;
  /** The server closed it (`serverclose {i}`), or the control connection ended. */
  onClose(listener: () => void): void;
}

export function openCliControl(stream: ByteStream): CliControl;
```

- **The challenge's response** is base64url without padding of the SHA-256 of the challenge's UTF-8 bytes (V7a), with
  `node:crypto`'s `createHash('sha256')` and `Buffer.toString('base64url')`. An error reply to either step is
  `challengeRefused` with the reply's `message`.
- **Every socket has its own `serve`.** `[cli]` attaches one server bridge per `serve` call, for that call's
  `socket_id` (`src/tunnels/control_server.rs` `attach_server_bridge`), and a `servermsg` whose `i` has no bridge fails
  with `NoAttachedServerError` (`handle_server_message`). Because `servermsg` goes without id, that failure is never
  answered: the editor's connection would just hang. So `serve` and `openSocket` share one implementation, which
  sends `serve` for a new socket id and resolves that socket only after the reply.
- **`serve`** sends `{socket_id: 0, commit_id: commit, quality, extensions: [], connection_token, use_local_download,
  compress: false}`. Every `serverlog {line, level}` notification goes to `onLog` in arrival order. A `{}` reply is
  `serving` with socket 0, which the client keeps for the first editor connection (cli-04). An error reply is
  `serveFailed`, where:
  - `error` is `parseCliServeError(message)`, the existing function;
  - `errorLine` is the text of the last `serverlog` line whose level was 4, or `undefined` when there was none. V7a:
    only this line may reach a failure's detail.
  `serve` is called once per connection. A second call throws `Error('serve was already called')`.
- **`openSocket`** sends `serve` with the next socket id (1, 2, 3…) and the parameters the first `serve` sent, and
  handles its `serverlog` lines, reply and failures as `serve` does. The CLI finds its server running and only attaches
  the bridge, with no download, in about 0.1 s (V7a). Called before `serve` resolved `serving`, it throws
  `Error('serve has not succeeded')`. A failed `openSocket` leaves the other sockets open; its id is not reused.
- **One `serve` at a time.** `[cli]`'s `serverlog` names no socket, so a level-4 line could not be told apart between two
  running `serve` calls. A `serve` request is sent only after the previous one has replied; calls wait in order.
- **The socket:** a `servermsg {i, body}` with `i === socketId` is delivered to that socket's `onData`, and
  `serverclose {i}` ends it. `send` writes `servermsg {i: socketId, body}` as a **request without id** (a
  notification), as `[cli]` `handle_server_message` reads it. A `send` after the socket ended sends nothing. A
  `servermsg` for an unknown `i` is ignored.
- `close()` closes the stream. Every pending reply settles `closed`, and every open socket's `onClose` runs once.
- The stream's `onClose` does the same as `close()`.

### 2.4 `progress.ts`, `serverlog` → S045 (V7a's table)

```ts
export type S045Event =
  | {kind: 'show'}                 // "Downloading <product> server -> …"
  | {kind: 'percent'; value: number}
  | {kind: 'hold'};                // inflate, integrity, start lines: S045 stays at 100 %

/** The S045 event of one `serverlog` line, or nothing for a line that changes nothing. */
export function s045EventOf(line: {text: string; level: number}): S045Event | undefined;
```

- `Downloading … server -> …` (any product name; match `^Downloading .+ server -> `) is `show`.
- `server download progress: <a>/<b> (<p>%)` is `percent` with `p` as a number. A line without the `(…%)` part (a total
  of 0, `[cli]` `DownloadLogger`) is nothing.
- `server inflate progress: …`, `Server integrity verified…`, `Server setup complete`, `Starting server…` are `hold`.
- Everything else is nothing.

Closing S045 at `serve`'s reply is cli-04's.

## 3. Test table

One assertion per `it`; the cite starts the name. `fake-cli.ts` gives `fakeCli(script)`: a pair of in-memory
`ByteStream`s, where the CLI side decodes the client's requests and answers from `script`. `script` is a function from
a request to a list of messages to send back (notifications and a reply), and the fake records every request. Like `[cli]`, the
fake attaches a bridge for each `serve` it answers with `{}`, and it records as `rejected` every `servermsg` whose `i`
has no bridge, without answering it. Messages use the exact shapes of the live record on #412.

`cli-control.test.ts`:

| Cite | Given | Expected |
|---|---|---|
| V7a | `authenticate('tok123')` against a CLI that issues `XDhuZUzkmmta9qWF` | `challenge_verify`'s `response` is `tfZvthfXETBzL5SSTVHWciJHrJvZAk47yiIljTLiVms` (the value the real CLI accepted on #412) |
| V7a | the same | `{kind: 'authenticated'}` |
| V7a | the CLI replies `CodeError(AuthChallengeBadToken)` to `challenge_issue` | `{kind: 'challengeRefused', message: 'CodeError(AuthChallengeBadToken)'}` |
| V7a | `serve` with `commit: 'c1'`, `quality: 'insider'` | the request's params are `{socket_id: 0, commit_id: 'c1', quality: 'insider', extensions: [], connection_token: …, use_local_download: false, compress: false}` |
| V7a | the CLI sends three `serverlog` lines then `{}` | `onLog` got the three, in order, before `serve` resolved `serving` |
| V7a, R1 | the CLI sends a level-4 line `Error installing server: cannot expand ${release} …`, then the error reply of #412's run 5 | `serveFailed`, `error.kind` `template`, `errorLine` that line's text |
| V7a | an error reply with no level-4 line before it | `errorLine` is `undefined` |
| V7a | a reply and a notification in one chunk | both handled, in order |
| V7a | a message split across three chunks | handled once complete |
| V7a | a non-map message, then a valid reply | the reply is handled; nothing throws |
| §4a | `serve` resolved | its socket's id is 0 |
| `[cli]` attach_server_bridge | `serve`, then `openSocket` twice | the CLI side got three `serve` requests, with `socket_id` 0, 1 and 2 |
| `[cli]` attach_server_bridge | the same | the second and third `serve` params equal the first's apart from `socket_id` |
| `[cli]` attach_server_bridge | `openSocket` whose `serve` the CLI has not answered yet | the promise is still pending |
| `[cli]` attach_server_bridge | `serve`, `openSocket`, then `send(bytes)` on each socket | the fake's `rejected` is empty |
| `[cli]` attach_server_bridge | the fake receives `servermsg {i: 5}` with no `serve` for 5 | the fake's `rejected` is `[5]` (the fake's own row) |
| V7a | `openSocket`, the CLI sends a level-4 line then the error reply of #412's run 5 | `serveFailed`, `errorLine` that line's text |
| V7a | the same | socket 0's `onClose` has not run |
| V7a | `openSocket` with `onLog`, the CLI sends two `serverlog` lines then `{}` | `onLog` got the two |
| contracts | `openSocket` before `serve` | it throws `serve has not succeeded` |
| contracts | `openSocket` after a failed `serve` | it throws `serve has not succeeded` |
| contracts | `serve` twice | the second throws `serve was already called` |
| V7a, `[cli]` serverlog | two `openSocket` calls at once | the second `serve` request was sent after the first's reply |
| §4a | `socket.send(bytes)` on socket 0 | the CLI side got `{method: 'servermsg', params: {i: 0, body: bytes}}` with no `id` |
| §4a | the CLI sends `servermsg {i: 1, body}` | only socket 1's `onData` got `body` |
| §4a | the CLI sends `serverclose {i: 0}` | socket 0's `onClose` ran once |
| §4a | `send` on socket 0 after `serverclose {i: 0}` | the CLI side got no `servermsg` for 0 after it |
| contracts | the stream closes during `serve` | `serve` resolves `closed` |
| contracts | the stream closes during `openSocket` | `openSocket` resolves `closed`, and every open socket's `onClose` ran once |
| contracts | `close()` twice | the stream was closed once |

`cli-progress.test.ts` (one row per line of V7a's table, with the measured texts):

| Cite | Line | Expected |
|---|---|---|
| F-2103 5.0 step 6 | `Downloading VSCodium server -> /tmp/.tmpIropcf/68280b82` | `show` |
| F-2103 5.0 step 6 | `server download progress: 2103263/88469322 (2%)` | `{kind: 'percent', value: 2}` |
| F-2103 5.0 step 6 | `server download progress: 88469322/88469322 (100%)` | `{kind: 'percent', value: 100}` |
| `[cli]` DownloadLogger | `server download progress: 512/0` | nothing |
| F-2103 5.0 step 7 | `server inflate progress: 180/3581 (5%)` | `hold` |
| F-2103 5.0 step 7 | `Server integrity verified, version: 1.140.06729-insider / b9695… / arm64 / ` | `hold` |
| F-2103 5.0 step 7 | `Server setup complete` | `hold` |
| V7a | `Checking … for a running server...` | nothing |
| V7a | `Extension host agent listening on /tmp/codium-insiders-…` | nothing |

## 4. Rule for the worker

As card log-01; coverage at lib-server's 100/100/100 ratchet (`fake-cli.ts` under `src/testing` is covered by its use).

## 5. Gates and review

PR title `lib-server: the CLI's control client (card cli-03a, #412)`.

## 6. Open rows

None for the protocol (V7a). The CLI's lifetime stays out of scope (pending `remote-oss/remote-ssh#21`).
