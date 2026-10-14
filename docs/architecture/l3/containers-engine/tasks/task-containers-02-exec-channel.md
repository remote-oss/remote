# Task card containers-02: C11, the exec channel and the exec dialer over `docker exec`

Issue: #757. Release 0.4 (Dev Containers, release 1, slice 1; D-87). Size: M (about 2.5 agent-days). Builder: iris.

**Design:**
- `docs/architecture/l3/containers-engine/contracts.md` §1 (this card follows it to the letter), §4 (`EngineHost`) and §6;
- `components.md` (C11, and C2's boundary);
- the brief's rulings 1, 2 and 5;
- ADR-0003.

**Specs:** F-0502 and F-0503 (`remote-oss/remote-containers#57` and `#34`), F-1402 §2 ("the archive is piped into the
container's filesystem", `#41`). C11 has no criteria of its own. It carries F-0502's and F-0503's transport, and those
rows come with C10 and the gate.

**Depends on:** nothing unbuilt. C1 (`containers-01`, hestia) creates the extension's manifest. This card adds only the
`dependencies` entries it needs to `packages/remote-containers/package.json`, plus `coverage.json` if C1 hasn't made one
yet (§6). Whichever card merges second keeps both changes.

## 1. Files

| File | What it holds |
|---|---|
| `packages/remote-containers/src/engine/engine-host.ts` | the `EngineHost` port of §2: types only. C2 (`containers-03`) owns this file from then on and builds its checks over it; it doesn't redefine it |
| `packages/remote-containers/src/engine/node-engine-host.ts` | `nodeEngineHost(dockerPath)`: the port over `child_process.spawn` with `shell: false`. It's the only module that spawns `docker`. C2 reuses it |
| `packages/remote-containers/src/exec/exec-arguments.ts` | pure: the argv builders of §3 |
| `packages/remote-containers/src/exec/tar-stream.ts` | pure: the one-file ustar header and trailer of §4 |
| `packages/remote-containers/src/exec/exec-failures.ts` | pure: the failure mapping of §5 |
| `packages/remote-containers/src/exec/exec-channel.ts` | `execChannelOf(engine, containerId, user): HostChannel` |
| `packages/remote-containers/src/exec/relay-script.ts` | `RELAY_SCRIPT` (the text of §7), `relayScriptPath(dataFolder)`, `installRelayScript(channel, dataFolder, cancellation)` |
| `packages/remote-containers/src/exec/exec-dialer.ts` | `execDialer(engine, containerId, user, nodePath, relayScriptPath): Dialer` |
| `packages/remote-containers/test/unit/…` | the rows of §8, one file per source file |
| `tests/acceptance/server/exec-channel.test.ts` | the real-Docker rows of §8.3 |
| `packages/lib-host/src/shell-words.ts` | `preludeCommand(byteCount)` and `posixQuote(value)`, moved from lib-ssh (§3); exported from lib-host's index |
| `packages/lib-ssh/src/process/remote-program.ts` | imports both from lib-host; `preludeProgram` keeps its output byte for byte |

**`package.json` dependencies:** `lib-host` and `lib-forwarding` (`workspace:*`).

**The dialer's signature:** it takes `nodePath` as well as the contract's four parameters. The contract says `<node>` is
"the installed server's own `node`". C10 knows that folder and passes `<installFolder>/node`, so C11 never derives it.

## 2. The `EngineHost` port (`engine/engine-host.ts`)

```ts
/** Where a `docker` run gets its input: nothing, a text, or a local file's bytes streamed unchanged. */
export type EngineInput =
  {kind: 'none'} | {kind: 'text'; text: string} | {kind: 'file'; localFile: string};

/** How a one-shot `docker` run ended: it ran (`status` undefined for a signal), or it couldn't start. */
export type EngineRunOutcome =
  | {kind: 'ran'; status: number | undefined; stdout: string; stderr: string}
  | {kind: 'failed'; detail: string};

/** What a run or a spawn is given. `environment` is added to the editor's environment for this `docker` process only. */
export interface EngineOptions {
  environment?: Readonly<Record<string, string>>;
  cancellation: AbortSignal;
}

/** A live `docker` process with piped standard streams. */
export interface EngineProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  /** Settles once with the exit status, or undefined for a signal. */
  exited: Promise<number | undefined>;
  kill(): void;
}

/** A spawn that started, or why it couldn't (the system's message). */
export type EngineSpawn =
  {kind: 'spawned'; process: EngineProcess} | {kind: 'failed'; detail: string};

/** The Docker CLI at `dockerPath`. `argv` is `docker`'s arguments, without the program. */
export interface EngineHost {
  run(argv: readonly string[], input: EngineInput, options: EngineOptions): Promise<EngineRunOutcome>;
  spawn(argv: readonly string[], options: EngineOptions): Promise<EngineSpawn>;
}
```

**Who uses what:** C11 uses only `spawn`. `run` is for C2's one-shot checks (exists, answers, API version, reaches
the engine). C11 builds it in the adapter, and C2's card writes its rows, since C2 is the first caller.

**`nodeEngineHost(dockerPath)`:**
- spawns `dockerPath` with `argv` through `child_process.spawn`, with `shell: false`, `stdio: ['pipe', 'pipe', 'pipe']`,
  `windowsHide: true`, and `env: {...process.env, ...options.environment}`;
- answers `failed` with the error's message when the `error` event comes before `spawn`;
- kills the process with `SIGTERM` on `cancellation`.
- `run` collects stdout and stderr as UTF-8, writes its input and closes stdin, and settles on `close`.

## 3. The argv builders (`exec/exec-arguments.ts`, pure)

```
scriptArguments(containerId, user, environmentNames, scriptByteCount) =
  ['exec', '-i', '--user', user, ...environmentNames.flatMap(name => ['-e', name]), containerId,
   'sh', '-c', preludeCommand(scriptByteCount)]
copyArguments(containerId, user, directory) =
  ['exec', '-i', '--user', user, containerId, 'tar', '-x', '-f', '-', '-C', directory]
dialArguments(containerId, user, nodePath, relayScriptPath, port) =
  ['exec', '-i', '--user', user, containerId, nodePath, relayScriptPath, String(port)]
```

**Environment names and values:** environment names are passed as `-e NAME` only, never `-e NAME=value`. The values go
in `EngineOptions.environment` of the `docker` process, which hands them to the container. So no value appears in
`docker`'s argv or in `ps` (R-26, contracts §1). A name that isn't `^[A-Za-z_][A-Za-z0-9_]*$` is refused before
spawning: `spawnFailed`, naming the variable.

**The prelude, not `sh -s`** (themis on #760, measured): `sh -s` with the script followed by the input doesn't leave
the input to the script on BusyBox ash (and dash with larger inputs): `printf 'cat\nhello world input\n' | sh -s` runs
the input as commands there (`sh: hello: not found`, measured again on `alpine:3.22`), and only bash behaves. So the
channel uses lib-ssh's prelude form, which themis measured on ash, dash and bash with small and 400 KB inputs:
- `preludeCommand(byteCount)` is `eval "$(dd bs=1 count=<byteCount> 2>/dev/null)"`. The shell reads exactly the
  script's bytes with `dd`, evaluates them, and the script's own reads see the rest of stdin, the input.
- Only the byte count appears in argv, never the script.
- **It moves to lib-host,** with `posixQuote`: both go in `packages/lib-host/src/shell-words.ts`, exported from lib-host's
  index. lib-ssh's `preludeProgram(byteCount)` (`process/remote-program.ts`) becomes
  `` `sh -c ${posixQuote(preludeCommand(byteCount))}` `` over the moved functions, and lib-ssh imports `posixQuote` from
  lib-host. Its output stays byte-identical, and lib-ssh's existing rows prove it unchanged.
- athena amends containers contracts §1's `runScript` line from `sh -s` to this form. Build to this card; the contract
  follows.

**Interpreters:** `powershell` is refused before spawning: `spawnFailed`, "the powershell interpreter is not available
in a container".

## 4. The tar stream (`exec/tar-stream.ts`, pure)

**No dependency is needed:** Node has no tar writer. lib-server has none in `src/`. The one under `tests/acceptance/server/tar-archive.ts`
is a test fixture that buffers whole files, which a server archive of tens of MB can't afford.

**What it writes:**
- `ustarHeader(name, size)`: one 512-byte ustar header for a regular file:
  - `name` is at most 100 bytes of ASCII, otherwise a `RangeError` naming it;
  - mode `0000644`, uid and gid `0`, mtime `0`;
  - size in octal, which allows up to 8 GiB minus 1, otherwise a `RangeError`;
  - typeflag `'0'`, magic `ustar\0` and version `00`;
  - the checksum computed over the header with the checksum field as eight spaces.
- `ustarTrailer(size)`: zero bytes that pad the content to a multiple of 512, then the two 512-byte zero blocks.

**`copyToHost` streams:** the header, then the local file's bytes in 64 KiB pieces as they're read (with back-pressure:
wait for `drain` when `write` returns false), then the trailer. Then it closes stdin.

**The fixture:** if `pnpm dupes` reports the fixture's header writer as a copy, change the fixture to use
`ustarHeader`. Otherwise leave it.

## 5. The failure mapping (`exec/exec-failures.ts`, pure)

`exitOutcome(status, stderr, operation: 'script' | 'copy')` gives a `ScriptOutcome` or a `CopyOutcome`. The rules, in
this order:

| Situation | Outcome |
|---|---|
| a stderr line starting `Error response from daemon:` or `Error: No such container:` (contracts §1, main 42c188a; ADR-0010 rule 2: no free-text match such as `is not running`) | `failed`, `channelClosed`; detail: those lines |
| status `125` | `failed`, `channelClosed`; detail: stderr's last line, or `docker exit 125` |
| status `undefined` (a signal) | `failed`, `channelClosed`; detail: `docker ended by a signal` |
| `copy`, status `127` or `126` | `failed`, `copyToolMissing`; detail: stderr's last line (the container has no runnable `tar`) |
| `copy`, any other non-zero | `failed`, `copyFailed` |
| `copy`, `0` | `copied` |
| `script`, any other status, `0` included | `exited` with that status |

**Elsewhere:**
- **The spawn:** a spawn that answers `failed` is `spawnFailed` with its detail.
- **Cancellation:** an abort before the call is `cancelled` with no spawn. An abort during a run kills the `docker`
  process and is `cancelled`.
- **No retries:** the channel never retries.

**Cancellation's limit:** killing the `docker exec` client closes the exec's streams in the daemon. The process in the
container then sees end of input and a broken pipe on its next write. That's the same limit as the SSH channel's, so
the card adds nothing for it.

## 6. The channel (`exec/exec-channel.ts`)

`execChannelOf(engine, containerId, user)` returns a `HostChannel`:
- **`runScript`:**
  - Refusals (§3) and a missing input file come first: `spawnFailed`, before anything runs. Check the file with
    `node:fs/promises` `access`, through a `files` parameter so the unit rows fake it. The parameter defaults to the
    Node implementation.
  - Encode `script` as UTF-8, and spawn `scriptArguments(…, scriptBytes.length)` with the request's environment as
    `EngineOptions.environment`.
  - Write exactly the script's bytes to stdin, with nothing added, then the input (the text as UTF-8, or the file
    streamed as in §4), then close stdin. The prelude's `dd` reads the script's bytes and no more, so the script's own
    reads see exactly the input. The contract case `digestsInput` proves it on the real container.
  - Split stdout into lines (`\n`, with a trailing `\r` removed) and call `onLine` for each, in order. Flush the last
    partial line on exit, then settle with `exitOutcome`. After a cancellation, deliver no more lines.
  - Keep stderr's last 20 lines for the details.
- **`copyToHost`:**
  - Take `directory` and `name` from `remotePath`: `path.posix.dirname` and `basename`.
  - Spawn `copyArguments(containerId, user, directory)`, stream §4's tar with `name`, then settle with `exitOutcome(…,
    'copy')`.
  - A `name` longer than 100 bytes is `copyFailed`, naming it, with no spawn.
- **`identity()`** is `containerId`.
- **`platformHint()`** is `'linux'`.
- **`clientPathOnHost`** isn't implemented (contracts §1).

**`coverage.json`:** if `packages/remote-containers/coverage.json` doesn't exist, add it as remote-ssh's, with the
ratchet at 100/100/100. Exclude `src/engine/engine-host.ts` ("types only") and `src/engine/node-engine-host.ts` ("spawns
real processes; the server acceptance rows cover it").

## 7. The relay script and the dialer

**`RELAY_SCRIPT`**, exactly this text, CommonJS for the server's own `node`:

```js
'use strict';
const net = require('net');
const port = Number(process.argv[2]);
const socket = net.connect({host: '127.0.0.1', port});
socket.on('error', () => process.exit(1));
socket.on('close', () => process.exit(0));
process.stdin.on('end', () => socket.end());
process.stdin.pipe(socket);
socket.pipe(process.stdout);
```

**Where it's written:**
- `relayScriptPath(dataFolder)` is `` `${dataFolder}/relay-${hash}.js` ``, where `hash` is the first 12 hex digits of
  the SHA-256 of `RELAY_SCRIPT`. A changed script gets a new name, and an old window keeps its own.
- `installRelayScript(channel, dataFolder, cancellation)` calls `channel.runScript` with the script below and the input
  `{kind: 'text', text: RELAY_SCRIPT}`. Every path in it is `posixQuote`d, and it runs as the channel's user, so the file
  is the remote user's, mode 0644 (contracts §1):

  ```
  set -e
  umask 022
  mkdir -p <dataFolder>
  cat > <path>.part
  chmod 0644 <path>.part
  mv -f <path>.part <path>
  ```

- It answers `{kind: 'written', path}` on status 0. Otherwise it answers `{kind: 'failed', detail}`: the channel failure,
  or `relay script not written (exit <n>)`.
- C10 calls it after lib-server's install, and C10's card says so.
- `posixQuote` comes from lib-host (§3, moved there from lib-ssh in this PR). remote-containers mustn't import lib-ssh
  (components §3).

**`execDialer(engine, containerId, user, nodePath, relayScriptPath)`:**
- `dial({kind: 'socket'})` rejects with `Error('a socket target is not available in a container')`.
- `dial({kind: 'port', port})` spawns `dialArguments(…)` and resolves a `Duplex` over the process:
  - `send(chunk)` is `stdin.write(chunk)`;
  - `onDrain` is stdin's `drain`;
  - `pause` and `resume` act on stdout;
  - `onData` gets stdout's chunks;
  - `onClose` fires once, when the process exits, and at once for a listener added after that;
  - `close()` ends stdin and kills the process.
- Bytes that arrive before the first data listener are held, as `node-network.ts`'s `socketDuplex` holds them. Mirror
  that, or reuse it if lib-forwarding can export a `streamDuplex(readable, writable, onEnd)`. Prefer the reuse, and say
  which in the PR.
- A spawn that fails rejects the `dial` with its detail. `openRelayTunnel`'s probe treats that as not ready.

## 8. Rows

### 8.1 Pure rows (unit)

| File | Given | Expected |
|---|---|---|
| `exec-arguments.test.ts` | `scriptArguments('c1', 'node', ['A', 'B_2'], 42)` | `['exec','-i','--user','node','-e','A','-e','B_2','c1','sh','-c','eval "$(dd bs=1 count=42 2>/dev/null)"']` |
| lib-host `shell-words.test.ts` | `preludeCommand(42)`; `posixQuote("it's")` | `eval "$(dd bs=1 count=42 2>/dev/null)"`; `'it'\''s'` |
| lib-ssh `remote-program.test.ts` | `preludeProgram(42)` | exactly main's string, `sh -c 'eval "$(dd bs=1 count=42 2>/dev/null)"'` (the existing rows pass unchanged) |
| | `copyArguments('c1', 'node', '/tmp/x y')` | the directory as one element, unchanged |
| | `dialArguments('c1', 'node', '/srv/node', '/d/relay-abc.js', 41000)` | `[…,'c1','/srv/node','/d/relay-abc.js','41000']` |
| `tar-stream.test.ts` | `ustarHeader('a.tar.gz', 5)`, then 5 bytes, then `ustarTrailer(5)` | a valid archive: `tar -t -v -f -` on the machine (spawned in the row) lists `a.tar.gz` with size 5. Also the length is 512 + 512 + 1024, and the checksum field holds the sum the row computes |
| | a 101-byte name; size 2³³ | `RangeError` naming each |
| | size 0, 512, 513 | trailer lengths 1024, 1024, 1535 |
| `exec-failures.test.ts` | each row of §5's table, one `it` each, with a stderr sample (`Error response from daemon: container c1 is not running`, `Error: No such container: c1`) | the outcome of the table |
| | `script` with status 125 and an empty stderr | `channelClosed`, detail `docker exit 125` |

### 8.2 Channel and dialer rows (unit, over a fake `EngineHost`)

**The fake:**
- a `FakeEngineHost` in `test/unit/fake-engine.ts`, whose `spawn` records `argv` and `environment`;
- it returns an `EngineProcess` built from `PassThrough` streams, with a script per row (print lines, exit with a
  status, wait for kill, or fail to spawn);
- it records whether `kill` was called.

**The contract:** run lib-host's `channelContractCases` over a harness that stages each `ContractScenario` on the fake,
as `packages/lib-ssh/test/unit/host-channel-contract.test.ts` does over its fake client.
- `scriptFailures`: `channelClosed` (status 125) and `spawnFailed` (a spawn that fails).
- `copyFailures`: `copyToolMissing` (127), `copyFailed` (1) and `channelClosed` (125).
- `reachesClientFiles`: false.
- Name the file `exec-channel-contract.test.ts`.

**Then these rows** (`exec-channel.test.ts`):

| Cite | Given | Expected |
|---|---|---|
| R-26 | `runScript` with environment `{TOKEN: 's3cret value'}` | the spawn's argv holds `-e TOKEN` and no element contains `s3cret`; `EngineOptions.environment` is `{TOKEN: 's3cret value'}` |
| R-26 | the same, and the script fails with stderr | the outcome's detail doesn't contain `s3cret` (it's only stderr) |
| no shell | `copyToHost` to `/tmp/a b/it's.tar.gz` | the argv holds `/tmp/a b` as one element; the tar header names `it's.tar.gz` |
| contracts §1 | `runScript` with `interpreter: 'powershell'` | `spawnFailed`, no spawn |
| contracts §1 | an environment name `A-B` | `spawnFailed` naming `A-B`, no spawn |
| contracts §1 | a script `echo é` (7 UTF-8 bytes) without a final newline, input text `x` | argv ends with `count=7`; stdin received exactly the 7 bytes, then `x`, then end; nothing added between them |
| contracts §1 | `copyToHost` of a 200 000-byte file, with a fake stdin that returns false from `write` every second call | every byte arrives in order, with the header first and the trailer last; the stream waited for `drain` each time |
| contracts §1 | `identity()`, `platformHint()`, and `clientPathOnHost` | `'c1'`, `'linux'`, undefined; `hostPathOf(channel, f)` is undefined |
| relay | `installRelayScript` over a recording channel (`lib-host/testing/recording-channel`) | one `runScript` whose script holds `umask 022`, `chmod 0644` and the quoted `relayScriptPath(dataFolder)`, and whose input is `RELAY_SCRIPT`; status 0 gives `written` |
| relay | the same with status 1, and with a channel failure | `failed`, with the detail of each |
| relay | `relayScriptPath('/home/u/.vscodium-server')` | `/home/u/.vscodium-server/relay-<12 hex>.js`, with the hex the row computes from `RELAY_SCRIPT` |
| dialer | `dial({kind: 'socket', path: '/x'})` | rejects; no spawn |
| dialer | `dial({kind: 'port', port: 41000})`; the fake process prints `abc` before any listener, then a listener is added | the argv is `dialArguments(…)`; the listener gets `abc`; `send` writes to stdin |
| dialer | the process exits | `onClose` fires once; a listener added later fires too |
| dialer | `close()` | stdin ended and `kill` called |
| dialer | the spawn fails | `dial` rejects with the detail |

**The relay script on real Node** (`relay-script.test.ts`):
- Write `RELAY_SCRIPT` to a temporary file. Start a local echo server on `127.0.0.1`, port 0. Spawn `process.execPath
  <file> <port>`.
- Write `hello` to its stdin and read `hello` back from its stdout. End stdin, and the process exits 0 within 2 s.
- With a closed port (a server started and closed first), the process exits 1 within 2 s and prints nothing.
- When the echo server closes the connection, the process exits 0.

### 8.3 Real Docker (`tests/acceptance/server/exec-channel.test.ts`, run by `pnpm test:acceptance:server`)

**The container:** the server suite already starts the harness host container with Docker (`host-fixture.ts`,
`startHostContainer`). Use its `container` id with `execChannelOf(nodeEngineHost('docker'), container, 'harness')`, so
no new image is needed. The suite runs only where Docker runs, like every file there, so there's no extra skip.

**The rows:**
- `channelContractCases` over a harness that stages the scenarios with real scripts in the container, as
  `shared-channel-contract.test.ts` stages them over ssh: `printf` lines, `exit <n>`, `sleep`, `sha256sum` for
  `digestsInput`, and a copy to a missing directory for `copyFailed`.
- `copyToHost` of a 5 MB file of random bytes to `/tmp/exec-copy/a.bin`. `sha256sum` in the container equals the local
  digest, and the file is owned by `harness`.
- `runScript` with environment `{SECRET_VALUE: 'x y'}`, where the script prints `$SECRET_VALUE`, prints `x y`. While it
  runs (`sleep 2` after the print), `ps -eo args` on this machine shows no line containing `x y`.
- **`channelClosed`, measured first:** start `runScript` with `sleep 30` and `docker stop` the container from the row
  (on a second container started for this row from the same image, not the shared one). Record `docker exec`'s status
  and stderr in the PR. The outcome must be `channelClosed`. If what `docker` reports matches none of §5's rules, stop
  and report on #757 (§10).
- The dialer isn't run against the real container: the harness image has no `node`. C10's gate rows prove it end to end
  over a real server's `node`.

## 9. Gates and review

**The gates:** typecheck, lint (rerun it if it's killed for memory), format:check, dupes, dead, check-layout,
check-identifiers, check-licences, coverage (remote-containers at 100 %), `pnpm test:unit`, and `pnpm
test:acceptance:server` (paste the new file's summary).

**The PR:** title `remote-containers: the exec channel and the exec dialer over docker exec (card containers-02,
#757)`. themis or triton reviews; athena gives the design check.

## 10. Open rows (stop and report on #757)

1. A stopped container's `docker exec` ends with a status and stderr that none of §5's rules map to `channelClosed`.
   Report what was measured.
2. `digestsInput` fails on the real container even with the prelude form. Report the measured stdin and output; don't
   change the form by guess.
3. lib-forwarding can't export a stream `Duplex` without changing `socketDuplex`'s behaviour for its other callers.
   Then write the exec one in `exec-dialer.ts`, and report.
