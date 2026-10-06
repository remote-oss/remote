# Area D interface contracts

- Status: first version for the lead's review (deliverable 2). Marked **provisional**: anything that waits on F-6101,
  F-6202, F-6501, F-6502, F-7902 to F-7904, or on the register's answers to dossier questions 2 and 3.
- Date: 2026-10-06
- Author: `remote-architect-worker-4`; lead: `remote-architect`
- Binds:
  - ADR-0003 and ADR-0004 (no SSH spawned by area D);
  - ADR-0005 (no editor CLI; the server's own CLI in D8 is not the editor CLI);
  - ADR-0006 as revised (decision 4: client caches keyed by product);
  - R-28 and R-83 (telemetry off at server start);
  - R-47, R-58, R-68 (licence rule `sourceBased`, R-80);
  - R-27 for every invented name.
- Cites, not restates:
  - area A's H1, V1 to V9 and W2 as revised in PR #27, agreed with `remote-architect-worker-1` on 2026-10-06: runScript
    input widened to a streamed file, `clientPathOnHost`, download policy `clientFirstThenHost`, cache policy `kept`,
    per-source verification, V1 `stepwise` mode and `environmentSetup`, a V7 extra-options slot, V8 cleanup variants;
  - area B's `wsl` codec, presenter outcomes and `windowWorkspace` (PR #26).
- Component ids are those of `components.md`. Feature ids without a repo are remote-wsl's.

How to read a contract: each lists the operations with their inputs, outputs and failure states, the rules with
their feature ids, and what the component must never do. Shapes are named fields, not code. String ids (STR:Snnn)
are the specs'.

---

## 1. lib-wsl

### D1 wsl-runner

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `locate` | the spawner | the `wsl.exe` path: `%SystemRoot%\System32\wsl.exe`, else PATH | `wslMissing` |
| `manage` | verb (`status`, `version`, `list`, `listOnline`, `install`, `setDefault`), operands, cancellation | decoded text (UTF-16LE; UTF-8 when the output carries no byte-order evidence of UTF-16), exit status | `wslMissing`, `wslNeedsUpdate` (the inbox WSL that lacks a verb, F-6203 Q1/F-6204 Q1), `spawnFailed`, `cancelled` |
| `exec` | distro (registered spelling), working folder (`~` or a path), program and arguments, environment additions (passed through `WSLENV`), input (text or a streamed local file), cancellation | output lines as a stream (UTF-8), then the exit status | `distroUnknown`, `distroUnregistered` (during the run), `interopDisabled` (only from programs that start Windows binaries), `startFailed` (the distro did not start), `spawnFailed`, `cancelled` |

Rules:
- `exec` always names the distro with `-d` and runs the program with `--exec`. No shell sits between `wsl.exe` and
  the program, so arguments are never re-split. Area D's scripts are `sh -s` with the script on standard input.
- The empty distro name never reaches D1. D2 resolves it first (F-6201 BR-1).
- A process is never retried, and no output is interpreted beyond the kind classification.
- `--status` and `--list` outputs are decoded by D1 and parsed by D1a. Nothing else parses `wsl.exe` text.

Never: spawn `wsl.exe` through a shell, spawn `ssh`, or log the environment values passed to `exec`.

### D1a wsl-output-parser

| Operation | Input | Output | Failures |
|---|---|---|---|
| `parseList` | `--list --verbose` text | rows `{name, isDefault, state: running/stopped/installing/converting/other, version: 1, 2 or unknown}` | `unparseable` (logged; the caller treats it as an empty list with a log line, F-6102 §9) |
| `parseOnline` | `--list --online` text | rows `{name, friendlyName}` | `unparseable` |
| `parseStatus` | `--status` / `--version` text | `{defaultDistro?, defaultVersion?, wslVersion?, kernelVersion?}` | none (missing fields stay absent) |

Rule: the column order and the default marker are taken from the text, not from fixed offsets. The recorded outputs
in D4f cover the variants the specs show.

### D2 distro-inventory

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `presence` | none | `absent` (no `wsl.exe` or the optional feature is off), `noDistro`, `present {wslVersion?, windowsBuild}` | none (absence is a value). The texts for absence are F-6101's, **provisional** |
| `distros` | `{includeDockerDesktop: false}` | the rows of `parseList` in WSL's order, `docker-desktop*` removed unless asked (F-6701 BR-3) | the D1 failures |
| `match` | the decoded distro (possibly empty) | `{registeredName, version, isDefault}`; the empty name gives the default distro (F-6201 Q2 (a)) | `distroUnknown {asTyped}`: STR:S053 with `{0}` = the name as typed (F-6201 7.E1); `noDistro` |
| `multiDistroAllowed` | none | `true` when the Windows build is 18362 or newer, or unknown (F-6103 7.E3) | none |
| `setDefault` | registered name | done (`wsl.exe --set-default`, or `wslconfig.exe /setdefault` below 18362, F-6103 5.0 step 7) | D1 failures |
| `onlineCatalogue` | none | rows sorted by friendly name, case-insensitive, digits compared as text (F-6102 BR-2) | `unavailable` (F-6102 Q5, **provisional**) |
| `installCommandLine` | name | the exact line typed into the "WSL" terminal: `wsl.exe --install -d <NAME>` (F-6102 BR-3) | none |
| `onDidChange` | listener | fires after any refresh whose rows differ | none |

Rules:
- Every call reads fresh. There is no cached list across operations, except that `distros` coalesces calls made
  within one refresh (F-6103 BR-3: the default is read on every connect).
- `match` compares case-insensitively and returns the registered spelling, which every later `wsl.exe` call and every
  text uses (F-6201 BR-1).
- The Windows build comes from the OS release string. A seam for tests replaces it (F-6103 §16).

Never: create, remove or change a distro without a user's choice. `setDefault` is called only after F-6103's modal or
F-6502's action.

### D3 path-mapper

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `toDistro` | Windows path, target distro | `{distro, linuxPath}`. A `\\wsl.localhost\<d>\…` or `\\wsl$\<d>\…` path gives `<d>` and `/…` without a process. A drive path runs `wslpath -u` in the target distro, honouring the automount root (F-6204 BR-1) | `notTranslatable` (STR:S047 per F-6204 Q1, **provisional**), D1 failures |
| `toWindows` | distro, Linux path | the Windows path: under the automount root a drive path, else `\\wsl.localhost\<d>\…` (`wslpath -w` in the distro; F-6204 BR-2) | as above |
| `remoteUri` | distro (registered), Linux path, outer authority (optional) | `vscode-remote://wsl+<d>[@<outer>]<path>` through B's codec | none |
| `isWindowsMountShape` | Linux path | true for the literal `/mnt/<letter>/…` (F-6206 R1, never a custom root) | none |

Rules:
- Spaces and non-ASCII characters pass unchanged (F-6204 BR-2).
- A workspace file is translated as one path; the folders inside it are left to core (F-6204 BR-3).
- The share host used in output is `wsl.localhost`, never `wsl$` (F-6207 BR-3).

### D4 wsl-host-channel (implements `lib-host` H1)

| H1 operation | Over D1 |
|---|---|
| `runScript(posixShell, env, input)` | `exec(distro, '~', 'sh', ['-s'], env, script + input)`; output lines streamed; the exit status returned |
| `runScript(powershell, …)` | `spawnFailed` (a programming error: V1 chooses the interpreter from `platformHint`) |
| `copyToHost(local, remote)` | `exec(distro, '~', 'sh', ['-c', 'cat > "$1"', 'sh', remote], {}, streamed local file)` |
| `clientPathOnHost(local)` | D3 `toDistro` of the local file, or `none` when the distro's automount is off or the path is not on a fixed drive |
| `identity` | the registered distro name |
| `platformHint` | `linux` |

Failure mapping (A's six kinds, WSL kind kept in the detail): `distroUnknown`, `distroUnregistered` and `startFailed`
→ `channelClosed`; `wslMissing` and `spawnFailed` → `spawnFailed`; `cancelled` → `cancelled`. The channel adds no
timeout of its own.

Rule: D4 passes A's shared H1 contract suite on the D4f fake.

---

## 2. remote-wsl engine

### D5 distro-proxy and D5r wsl-relay-dialer

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `D5r.dial` | distro, `{port}` in the distro, cancellation | a duplex stream: the standard input and output of one D1 `exec` running `<server dir>/node` with `relay.js` and the port | `relayFailed` with the D1 kind |
| `D5.ownOrJoin` | product key, distro, server port, connection token | `{address: 127.0.0.1:<local port>, owner: self or other}` | `proxyFailed {message}` (STR:S022, F-6208 7.E4) |
| `D5.release` | the handle | ends the listener when this window is the owner (Close Remote Connection, F-6201 BR-4) | none |

Rendezvous record: a per-user file in the user's temporary folder, named with the R-27 prefix and keyed by product
(`applicationName`) and registered distro name. It holds the local port, the owner's process id and the server's
commit. It is never synced and never in global state (F-6201 BR-10).

Rules:
- Join only after `GET http://127.0.0.1:<port>/version` returns the client's commit within 1 s. Otherwise take over:
  write the record atomically by rename, open W2 with D5r, and log STR:S050 (F-6208 BR-10).
- One `wsl.exe` per relayed connection (F-6201 step 10, F-6304 BR-4). Never the VM address, never localhost
  forwarding.
- `relay.js` is shipped text of under 60 lines. It reads the port from its arguments and pipes in both directions,
  then exits when either side closes. It writes nothing to disk.

Never: listen on anything but `127.0.0.1`; pass the connection token through the rendezvous file.

### D6 connect-engine (the connector behind `wsl.resolver-front`)

Input: B's connect input `{target: {distro, outer?}, rawHostString, attempt, isReconnection, windowId,
windowWorkspace}` and the phase sink.

Run, in order:
1. If `outer` is present, D9 builds the remote D1; the local D1 is used otherwise. Off Windows with no outer, return
   `Failed {kind: wslMissing}`.
2. If the per-distro session exists and its server answers `/version`, return its `Connected` at once (F-6201 BR-5,
   reconnects included).
3. D2 `match`, then the pre-1903 rule: if not `multiDistroAllowed` and not the default, show F-6103's modal through the
   UI port; on "Change Default" call D2 `setDefault`, otherwise `Failed {kind: singleDistroOnly}` with STR:S064.
4. Phase `startingSubsystem`, then V2 `probe` over D4. This also starts a stopped distro.
5. D7 `ensureServer`, with the phases `downloading`, `unpacking <n>%` and `installing` from V1/V4 events.
6. D7 `start`, with phase `starting` at 90 %. The silence watchdog runs here.
7. D5 `ownOrJoin`, then `Connected {address, connectionToken, extensionHostEnv: D11.take(distro, windowWorkspace),
   remotePlatform: linux, serverCommit}`.

Failure kinds added to A's `Failed` (B's `wsl.failure-ui` renders them):

| Kind | When | Text | Retryable |
|---|---|---|---|
| `distroUnknown` | step 3 | STR:S053 | no |
| `singleDistroOnly` | step 3 declined | STR:S064 | no |
| `wslMissing` | no `wsl.exe`, or off Windows without an outer remote | F-6101's texts (**provisional**) | no |
| `serverStartFailed` | the start ends before "listening" (F-6208 7.E1) | F-6208 7.E1's message, detail STR:S009 | no; the dialog offers Retry |
| `serverStartSilent` | no output line for 90 s (F-6208 7.E2) | STR:S055 with `{0}` = 90, detail STR:S009 | as above |
| `serverNodeMissing` | "listening" without the node executable (F-6208 7.E3) | STR:S015, detail STR:S009 | as above |
| `prerequisiteMissing` | F-6302's checks | F-6208's generic message; the cause goes only to the log (F-6302 §2) | as above |
| `proxyFailed` | D5 | STR:S022 | as above |
| A's `noServerSource`, `invalidServerTemplate`, `licenceDeclined`, `serverDownload`, `serverInstall`, `lockTimeout`, `cancelled` | as A defines | as A defines | as A defines |

Rules:
- `retryable` is false for every kind above. Core's reconnect attempts reach step 2 only (F-6208 BR-4 to BR-8).
- On every failed start, `revealDetails` shows the "WSL" log terminal before or with the dialog (F-6208 BR-3), and
  STR:S026 is the last log line of the attempt (BR-11).
- The watchdog restarts on every output line and has no other timeout (F-6208 BR-9, F-6303 BR-4).
- A session whose server no longer answers is dropped and the run continues from step 3 (F-6201 Q3 (b),
  **provisional**).
- Per-distro sessions belong to the extension host. A reload starts with an empty table and joins through D5.

Never: show UI itself except F-6103's modal through its port; interpret B's presenter outcome.

### D7 wsl-server-adapter

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `policy` | the profile, settings snapshot (`remote.WSL.experimental.scriptLessStartup`, `remote.WSL.fileWatcher.polling`, `remote.WSL.fileWatcher.pollingInterval`), distro version | the lib-server parameters below | none |
| `ensureServer` | D4, probe facts, policy | as V3 and V4 | as V3 and V4 |
| `start` | D4, policy | as V7 | as V7, mapped to the kinds of D6 |

Parameters handed to `lib-server`: the remote-wsl row of A's policy record (`../transport-and-server/contracts.md` §5.0, PR #27). Field names are A's.

| Parameter | WSL value | Source |
|---|---|---|
| download policy | `clientFirstThenHost`, the host fallback silent; host tool `wget` only | F-6301 BR-1, BR-7; F-6302 BR-4 |
| cache policy | `kept`; root `%USERPROFILE%\vscode-remote-wsl\`; folder from V9 `clientArchiveFolder` (the reference layout for `code` and `code-insiders`, an `<applicationName>` level for every other product, ADR-0006 decision 4); V4 renames atomically into it | F-6301 BR-4, BR-5, BR-14 |
| client source on the host | `clientPathOnHost` in `singleScript` mode; streamed input in `stepwise` mode | F-6301 6.7; F-6304 6.2 step 3.3 |
| `verification` | `headerHash` (`X-SHA256` of the redirect), then `lengthOnly` | F-6301 BR-6, Q3 |
| override policy | none, or `remote.WSL.serverDownloadUrlTemplate`, user layer, template form (R-27, **provisional** on the register, dossier question 2) | F-6301 BR-12, ADR-0006 decision 2 |
| `installMode` | `stepwise` when `scriptLessStartup` is true, else `singleScript` (read here, passed in) | F-6304 BR-1 |
| environment setup | `<home>/<serverDataFolderName>/server-env-setup`, sourced before install and before start, never on reuse | F-6303 BR-1 to BR-5 |
| `requirementsCheck` | `serverBundled` plus the Alpine `libstdc++` probe (result logged, never blocking) | F-6302 BR-6, 7.E1, 7.E4 |
| start options and `allowedExtraStartOptions` (`fileWatcherPolling`) | bind `127.0.0.1`, random port, connection token, `--telemetry-level off`; extra: `--file-watcher-polling <ms>` only for WSL 1 with polling true, interval normalised (non-number → 5000; ceil; at least 500) | F-6201 BR-7; R-83; F-6601 BR-1 to BR-4 |
| `cleanup` | `singleScript`: `onlyCurrentKeepLeftovers`; `stepwise`: `onlyCurrentRemoveLeftovers` | F-6304 BR-7, BR-8, AC-9 |
| licence | `sourceBased` (R-80) through V6 | R-68 |

Rules:
- The settings are read at each resolve, folder values included before trust (F-6304 BR-9). Changes take effect only
  at a fresh server start (F-6601 BR-6).
- A failed client download is logged with its specific reason (F-6301 Q1 (b), provisional) and never shown.
- In `stepwise` mode a failed client download also falls back to `wget` in the distro (F-6304 Q2 (b), provisional).

### D7b background-download (**provisional**)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `tick` | every 30 s while `remote.WSL.downloadInBackground` is true | for each platform in `usageTime` younger than 14 days, the archive of the pending commit in the kept cache | none raised; logged |
| `recordUse` | platform | updates `usageTime.<platform>` | none |

State (global state, our id): `lastUpdateCheck`, `downloadInProgress`, `usageTime.<platform>` (F-6301 BR-13). The
source of "the pending commit" is open (dossier question 10). Until it is answered, `tick` only logs that the setting
is on or off (F-6301 6.6 steps 1, 3, 4).

### D8 shell-handoff (`scripts/wslCode.sh`, shipped text)

Contract with the editor's launcher ([oss] `resources/win32/bin/code.sh`):
- **Arguments.** `COMMIT QUALITY ELECTRON APP_NAME SERVERDATAFOLDER [VERSION] args…`. VSCodium's launcher adds
  `VERSION` (its `00-remote-use-open-ext.patch`).
- **Telling the forms apart.** The script reads the sixth argument as `VERSION` only when it matches a version
  pattern and the launcher's product is not genuine VS Code. This is **provisional**: a documented environment flag
  is the fallback if the pattern proves ambiguous.

Steps:
1. Read the distro from `WSL_DISTRO_NAME`.
2. If `~/<SERVERDATAFOLDER>/bin/<COMMIT>` is absent, download the archive inside the distro with `wget`, from the URL
   lib-product's rules give for the product, and unpack it. Print the progress lines of F-6401 5.0 step 4. Never use
   a Windows-side download (F-6401 BR-8).
3. If a window is requested, write the env record for D11.
4. Exec the server's CLI in its WSL mode, with `VSCODE_CLIENT_COMMAND`, `VSCODE_CLIENT_COMMAND_CWD` and
   `VSCODE_CLI_AUTHORITY=wsl+<distro>`, passing the user's arguments unchanged ([oss] `server.cli.ts`).

Rules:
- Extension management acts on the distro's server and opens no window (F-6401 BR-10).
- `VSCODE_WSL_DEBUG_INFO=true` adds `set -x` and nothing else (BR-11).
- The script returns when the hand-off returns; `--wait` is the server CLI's (BR-9).
- The source rule in step 2 is the same as V3's and is generated from P4 at build time. The script never contains a
  product name.

Documentation (identity, D-59 public voice): VSCodium users set `VSCODE_WSL_EXTENSION_ID=remote-oss.remote-wsl`. The
stock VS Code launcher looks for another id, which is an upstream matter (lead, 2026-10-06).

### D9 nested-route (**provisional**, dossier question 3)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `remoteSpawner` | `outer: DecodedTarget` | a D1 spawner whose processes run on the outer host through the outer resolver's exec facility (the `resolvers` exec-server surface that B parked for containers F-1302) | `outerUnavailable` (F-6201 7.E6) |

Rules:
- Everything above D1 is unchanged. `lib-server` installs through D4, and D5r dials through the remote spawner.
- STR:S029 and STR:S012 are not shown, because no editor CLI is involved (ADR-0005). STR:S031 "Installing server in
  {0}" is the stage text of step 5 on this route, with `{0}` = the distro (F-6301 6.8, F-6701 progress).
- On this route D5's listener lives on the client, and every stream goes over the outer facility.

### D10 window-advisories

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `evaluate` | the window's remote name and authority, the workspace folders, D2's version for the distro | at most one of `useLinuxFileSystem` (WSL 2 and a `/mnt/<letter>/` folder), `useWsl2` (WSL 1), `reopenInWsl` (a local window on a `\\wsl` share, with the target URI from D3) | none |
| `dismissForever` | condition | sets its flag in global state | none |

Rules: the flags are per profile and never in settings. A notification dismissed by X stores nothing (F-6206 BR-5,
BR-7). B's `wsl.package` renders the notification and calls `dismissForever` for "Don't Show Again".

### D11 env-rendezvous

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `put` (by D8, in the distro) | distro, folder or workspace path, the exported environment | a record under the distro user's temporary folder, R-27 prefix, mode 0600 | none (a failed write means no hand-over) |
| `take` (by D6) | distro, `windowWorkspace` | `extensionHostEnv` map, or none; the record is deleted | none |

Rules:
- One use only. When two windows resolve the same key at the same time, the first consumes the record and the second
  gets the default environment (agreed with area B, 2026-10-06).
- A record older than 60 s is ignored and deleted.
- With `remote.WSL.useShellEnvironment` false, `take` returns none and deletes the record (F-6303 BR-11).
- The variables left out are `PWD`, `OLDPWD`, `SHLVL`, `_`, `WSL_INTEROP` and `WSLENV`. This is **provisional**,
  F-6303 Q1.
- Before each start, D6 logs whether a record exists (F-6303 §16).

Never: log the values; keep the record after `take`.

### D12 wsl-commands (engine side)

| Command | Engine result handed to B or a port | Spec |
|---|---|---|
| `remote-wsl.reopenInWSL` | for a share path, `toDistro` without a picker; for a drive path, the distro from F-6202's picker, then `toDistro`; then `openRemote(current)` | F-6204 BR-1, BR-4, BR-5 |
| `remote-wsl.reopenInWindows` | `toWindows` of the folder or workspace file; then `openLocal(current)`; on the nested route, back to the outer authority (F-6701 6.4) | F-6204 BR-2; F-6701 |
| `remote-wsl.openFolder` | start folder `\\wsl.localhost\<default distro>\` for core's folder dialog; the chosen share path → `remoteUri` → `openRemote` | F-6203 |
| `remote-wsl.revealInExplorer` | `toWindows` of the resource chosen per F-6207 BR-1, then `explorer.exe /select,<path>` (a local process, not `env.openExternal`); untitled → STR:S052; nested → STR:S040 | F-6207 |
| `remote-wsl.explorer.addDistro` | `onlineCatalogue` for B's picker; the chosen name's `installCommandLine` typed into a new terminal named "WSL" | F-6102 |
| `remote-wsl.reopenFromRecommendation` | D10's `reopenInWsl` target, then `openRemote(current)` | F-6206 R3 |

Rules:
- Out-of-context calls follow R-46. The owned texts are STR:S003 and STR:S048 (F-6204 BR-8); elsewhere the command is
  safe and does nothing harmful.
- No reload happens on an empty path (F-6204 7.E8). An untitled workspace follows F-6204 Q3 (a), **provisional**.

---

## 3. What area D needs from others (summary)

| From | What | State |
|---|---|---|
| A (`lib-host`) | runScript with a streamed-file input; `clientPathOnHost` | agreed 2026-10-06; A's PR pending |
| A (`lib-server`) | V1 `stepwise` and `environmentSetup`; V2 requirements and Alpine checks; V3 `clientFirstThenHost`; V4 per-source verification; V7 extra options; V8 cleanup variants; V9 `kept` cache keyed per ADR-0006 decision 4; P3 WSL policy row | agreed; the WSL override waits for the register |
| A (`lib-forwarding`) | W2 opened by D5 with a dialer; W2 itself holds no rendezvous | agreed |
| B | the `wsl` codec `{distro, outer?}`; presenter outcomes; `windowWorkspace`; resolver registered on every platform; window opener; the exec facility of an outer resolver for D9 | PR #26; exec facility open (question 3) |
| lead (`lib-log`) | a terminal sink named "WSL" with a per-extension-host buffer; token masking (F-6002 Q1 (b)) | open |
| register | WSL server source (question 2), nested route (question 3), background-download trigger (question 10) | routed by the lead |
