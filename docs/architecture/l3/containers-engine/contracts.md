# Contracts: Remote - Containers, release 1

Status: ruled by athena (architect), 2026-10-14, for `brief-release-1.md` (D-87) and `components.md`. Cards cite these
sections. A builder doesn't change a contract; a question goes to the architect.

## 1. C11 exec channel (a lib-host `HostChannel`)

`execChannelOf(engine: EngineHost, containerId: string, user: string): HostChannel`

| Operation | Rule |
|---|---|
| `runScript` | `docker exec -i --user <user> [-e NAME …] <containerId> sh -s` for `posixShell` (no `powershell` in release 1: `spawnFailed`). The script is written to stdin, then `ScriptInput` (text or a local file's bytes, unchanged), then stdin is closed. Each stdout line goes to `onLine` in order before the outcome settles. The exit status is the outcome's `status`. **Environment values are passed as `-e NAME` with the value in the `docker` process's own environment, never `-e NAME=value`**, so no value appears in `docker`'s argv or in `ps` (R-26). |
| `copyToHost` | streams a one-file tar archive of `localFile` into `docker exec -i --user <user> <containerId> tar -x -C <dir>`, renamed to `remotePath`'s basename (F-1402 §6: the archive is piped, never `docker cp` from a path the engine reads). A container without `tar` is `copyToolMissing`. |
| `identity` | the container id. |
| `platformHint` | `linux`. |
| `clientPathOnHost` | not implemented (a container never reads a client path directly). |

**Failures:** a `docker` that can't start is `spawnFailed`; a container that stopped or vanished during an operation
(exit 125, or the daemon's "is not running" / "No such container") is `channelClosed`; an abort is `cancelled`. The
channel never retries.

**The exec dialer:** `execDialer(engine, containerId, user, relayScriptPath): Dialer` (lib-forwarding's `Dialer`).
Each `dial({kind: 'port', port})` runs `docker exec -i --user <user> <containerId> <node> <relayScriptPath> <port>`,
where `<node>` is the installed server's own `node` (its install folder's root), and returns a `Duplex` over the exec
process's stdin and stdout. The relay script (shipped as text, written into the container by the install step beside
the server, owned by the remote user, mode 0644) connects to `127.0.0.1:<port>` and pipes both ways; it exits when either
side ends. `{kind: 'socket'}` is refused in release 1.

## 2. C10 container connector (a lib-authority `Connector`)

`containerConnectorOf(dependencies): Connector` for the `dev-container` family only.

**`connect(input)`, in order** (F-0408 §5.0; each step reports its phase through `onPhase`):
1. Decode the payload (§3). A malformed payload fails as `Failed{kind: 'malformedAuthority', silent: false}`.
2. C2's pre-flight checks. Their dialogs belong to F-0201. A failed check returns `Failed` with
   `userAlreadyNotified: true`.
3. C7: find, reuse, start or create the container (F-0409, F-0412, F-0415), with the rebuild intent if the payload
   carries one (F-0405 BR-17).
4. lib-server: probe, plan, transfer and start over C11 with the remote-containers policy row (§5), the licence gate
   (R-68) and `installTree` from V9 when the `vscode` volume is mounted.
5. The host listener: choose the local port with lib-forwarding's port search, preferring the server's container
   port (F-0502 BR-3); `openRelayTunnel` with C11's exec dialer and the target `{kind: 'port', port: <container
   port>}`. The log names both ports.
6. Return `Connected{address: {host: '127.0.0.1', port}, connectionToken, extensionHostEnv: {}, environmentTunnels: [],
   trusted: false}`. No tunnel factory and no tunnel features are given to core (brief ruling 1).

**Failures** (`Failed`): the dev-container family's kinds and their presentation are C8's (F-0410). A container that
stopped or was removed while connected answers `silent: true` (F-0502's "plain NotAvailable, no dialog"), and every
other failure is presented. `retryable` is true only for a lost transport of a container that still runs (F-0502's
reconnection rules). `diagnostics` never hold the token.

**`cancel()`** ends C3's and C2's processes and the exec relays. **`onTransportLost`** fires when the relay's exec
process ends while the container runs, and **`onTransportClosed`** when the container stops.

## 3. The `dev-container` payload (F-0501 BR-2a)

lib-authority's `containerCodec('dev-container', …)` carries the payload as an opaque string. remote-containers owns
its content:
- **The text:** lowercase hex of the UTF-8 JSON `{"hostPath": <folder>, "localDocker": false, "configFile": {"$mid": 1,
  "fsPath", "external", "path", "scheme"}}`, with `"settings": {"context": <name>}` when a non-default Docker context
  is current. Field order and spelling are F-0501's.
- **The rebuild intent** (C6 → C7) isn't part of the authority, which must stay stable (F-1102 §16). The reloaded
  window has another workspace identity, so its workspace state can't carry it. C6 stores it in the extension's
  `globalState` under a key of ours (R-27), keyed by the payload, with the time, before the reload. C7 reads it once at
  the start of the resolve and clears it. An intent older than 5 minutes is cleared unused, so a rebuild never fires on
  a later, ordinary open.
- **The codec functions:** `devContainerPayloadOf(target) → string` and `devContainerTargetOf(payload) → target |
  malformed` are pure, with rows for every field and a malformed hex, JSON and shape.

## 4. Ports C1–C8 use (all faked in unit rows)

| Port | Operations | Real adapter |
|---|---|---|
| `EngineHost` (C2) | `run(argv, {stdin?, environment?, cancellation}) → {status, stdout, stderr}`; `spawn(argv, …) → a live process` | `child_process.spawn` with `shell: false` (F-0201) |
| `CliHost` (C3) | `run(arguments, onJsonLine, cancellation) → {result: <the JSON result line>, status}` | spawns `process.execPath` with `ELECTRON_RUN_AS_NODE=1` on the bundled CLI's entry script (ADR-0009) |
| `TrustPort` (C5) | `isTrusted()`, `request(message) → granted or not` | `vscode.workspace` (proposal `workspaceTrust`) |
| `ConfigFiles` (C4) | `exists`, `read`, `list` over workspace URIs | `vscode.workspace.fs` |
| notices and dialogs | as remote-ssh's surfaces: an adapter per surface, scripted in the harness | `vscode.window` |

## 5. Additions to other areas' contracts

1. **Transport contracts §5.0, the remote-containers column** (filled):
   - `downloadPlacement: clientOnly`;
   - `cache: kept`;
   - `verification: none` (until the room names one);
   - `environmentSetup: none`;
   - `requirementsCheck: serverBundled`;
   - `allowedExtraStartOptions: none`;
   - `cleanup: onlyCurrentKeepLeftovers` (the volume is shared by every dev container);
   - `installMode: singleScript`;
   - `prefetch: none`.
2. **lib-server: `installTree`.** The install step takes an optional `installTree` (V9's `serverTree`). When it's set,
   the archive is extracted into `installTree` if that folder isn't a complete server, renamed into place only once
   extraction has finished (F-0503 5.0 step 5), and `<dataFolder>/bin/<commit>` becomes a symlink to it, created or
   kept (F-0503 BR-3). Without it, nothing changes. This is area A's code with area C's input, and it's carded with
   C10.
3. **lib-authority:** nothing new. `Failed.silent`, `Connected.trusted` and the container codec already exist (dossier
   Q3 and Q6 are answered by them).

## 6. Rows every card keeps

- **R-26:** no token, password or secret in any argv (`docker`, `docker exec`, the CLI) or log line. A unit row per
  spawn site checks the argv against the secrets of its fixture.
- **No shell:** every engine and CLI spawn has `shell: false`, and a row proves a value with spaces and quotes reaches
  the program unchanged (F-0201).
- **Pure parts first:** the payload codec, the label matching (F-0409's tiers), the CLI argument builder and the
  JSON-line parser are pure modules with their own rows before any adapter is written.
