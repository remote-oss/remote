# Area D dossier: the WSL engine

- Status: draft for the lead's review (deliverable 1). It covers the 25 published remote-wsl issues. Four feature specs
  are still pending: F-6101, F-6202, F-6501 and F-6502. The decision specs the room announced (F-7902 to F-7904) are
  pending too. Every section marks what changes when they land.
- Date: 2026-10-06
- Author: `remote-architect-worker-4`; lead: `remote-architect`
- Inputs: `remote-oss/remote-wsl` #11–#39. The 13 first-pass issues were read in full. The 12 later drafts were read
  through Sonnet digests and checked at their rules and questions. Also: the area A and B dossiers and contracts,
  `c4-l2-containers.md`, ADR-0002 to ADR-0007, the binding rulings, `catalogue/constraints.md`, and
  `shared-candidates.md`. [oss] `resources/win32/bin/code.sh` and VSCodium's
  `patches/windows/00-remote-use-open-ext.patch`.

`wsl#20` means `remote-oss/remote-wsl#20`. Feature ids without a repo are remote-wsl's. "The window" is the local
Windows editor window unless the text says otherwise.

## 1. Component candidates

**Proposal: a library `lib-wsl`.** The `wsl.exe` client, the distro inventory, path translation and the WSL host
channel have two consumers: `remote-wsl`, and `remote-containers` for Docker in WSL (F-0204, F-0207, F-1301;
shared-candidates line 28). By the container view's two-consumer rule they form a library. It depends on `lib-host`
and `lib-log` and nothing else. The rest of area D stays in the `remote-wsl` package.

| Id | Component | Container | Responsibility | Features owned |
|---|---|---|---|---|
| D1 | wsl-runner | lib-wsl | Find `wsl.exe` (System32, then PATH). Build the argument list (`-d <distro>`, `--exec`, `--cd`, `--status`, `--list --verbose`, `--list --online`, `--install -d`, `--set-default`). Spawn it with no shell. Decode its output: UTF-16LE for the management verbs, UTF-8 for commands inside a distro. Classify exit codes and stderr into fixed kinds (wslMissing, distroUnknown, distroUnregistered, interopDisabled, startFailed) | none alone (building block) |
| D2 | distro-inventory | lib-wsl | WSL presence and version, the Windows build, the distro list (name, state, version 1/2, default flag), case-insensitive name matching that returns the registered spelling, and the empty name as the default distro. Covers the no-WSL and no-distro states, the pre-1903 single-distro rule with set-default, the online list and its sort order, and a change signal for the Targets view. `docker-desktop` distros are filtered out where the specs say so | F-6101 (pending), F-6103 (wsl#19), F-6102 engine part (wsl#18) |
| D3 | path-mapper | lib-wsl | Converts Windows paths to distro paths and back for one distro: drive paths through `wslpath` run in that distro, so a custom automount root is honoured (F-6204 BR-1/BR-2). Handles `\\wsl.localhost\<d>\` and `\\wsl$\<d>\` paths and builds `vscode-remote://wsl+<d>/…` URIs. Runs the `/mnt/<letter>/` shape test that F-6206 needs. Pure apart from the `wslpath` call | F-6204 (wsl#23), F-6203 (wsl#22), F-6207 (wsl#26) |
| D4 | wsl-host-channel | lib-wsl | The `lib-host` H1 channel over D1. `runScript` runs `sh` in the distro as its default user. `copyToHost` streams through standard input. `identity` is the registered distro name. `platformHint` is `linux`. A local spawner, plus a spawner over an outer remote for the nested route (§2, D9) | contributor |
| D5 | wsl-dialer and distro proxy | remote-wsl | The `lib-forwarding` dialer: one `wsl.exe` per byte stream. Inside the distro it runs the server's own Node runtime with a relay script shipped as text, piping standard input and output to `127.0.0.1:<server port>` (F-6304 BR-4, F-6201 BR-3). Also the Windows-side proxy on a random `127.0.0.1` port: one per distro, shared by every window, owned by the window that started it, ended on Close Remote Connection (F-6201 BR-4), and reachable at `/version` (F-6208 BR-10) | contributor to F-6201 |
| D6 | connect-engine | remote-wsl | The `connect` behind B's `wsl` resolver front. Steps: match the distro (D2), the pre-1903 check, start the distro, probe, then install and start (D7), open the proxy (D5), and return Connected or Failed with WSL kinds. Owns the 90-second silence timeout of F-6208 BR-9 and the per-distro session that answers re-resolves (F-6201 BR-5). Emits the phase events B renders (F-6201 BR-8 stage order) | contributor to F-6201, F-6208, F-6402 |
| D7 | wsl-server-adapter | remote-wsl | WSL's policy over `lib-server`: the order client cache, then client download, then in-distro `wget` (F-6301 BR-1). The archive cache on the client is per Windows user, renamed into place only after checking (BR-4/BR-5), and per product (§4). Checks SHA-256 and length (BR-6). The distro reads the cached archive through the automount (6.7) or through standard input (F-6304 6.1). Covers script and script-less start (F-6304), `server-env-setup` (F-6303), the Alpine and `check-requirements` steps (F-6302), WSL 1 polling options (F-6601), and the background download (F-6301 BR-13) | F-6301 (wsl#28), F-6302 (wsl#29), F-6303 (wsl#30), F-6304 (wsl#31), F-6601 (wsl#37) |
| D8 | shell-handoff | remote-wsl | The distro side of `code` (F-6401). A script shipped as text at the path the editor's launcher calls (`<extension>/scripts/wslCode.sh` [oss] `code.sh`), with the launcher's argument order. Ensures the server is present (in-distro `wget`, BR-8), records the shell's environment for F-6303 6.1, and calls the server CLI in its WSL mode (`VSCODE_CLIENT_COMMAND`, `VSCODE_CLI_AUTHORITY` [oss] `server.cli.ts`). Its link to the window's `extensionHostEnv` is open question 7 | F-6401 (wsl#32) |
| D9 | nested-route | remote-wsl | `wsl+<d>@<outer>`: D1 to D7 run on a Windows host reached through another remote. D4 and D5 take the outer remote's exec facility as their spawner (F-6701 BR-1). The Reopen in WSL/Windows path rules of F-6701 6.3/6.4 come from D3 | F-6701 WSL part (wsl#39) |
| D10 | window-advisories | remote-wsl | Detects the three recommendation conditions at window start (WSL 2 on `/mnt`, WSL 1, a local window on a `\\wsl` share) and keeps their flags. B renders the notifications | F-6206 (wsl#25) |

**Proposed owners outside D.**
- B: F-6001, F-6003, F-6004, F-6005, F-6201, F-6205, F-6208, F-6503, F-7901, and F-6501/F-6502 when they land.
  D supplies the data: D2 feeds the rows, D2's version and default flag feed the hover and the description,
  F-6205's `~` needs the distro user's home from D4, and D2 supplies the distro operations of F-6502.
- Lead's `lib-log`: F-6002, the WSL log. It is a read-only terminal named "WSL", not an output channel; its buffer
  starts again with every extension host. `lib-log` needs a terminal sink and a buffer per extension host. F-6002 Q1
  (masking the token) is a log rule. D writes the lines the specs list.
- F-6602 is documentation only (AC-19: nothing registered). I would trace it to `wsl.package` as a no-op owner.
- F-6402 is core's launcher plus D6's resolver behaviour. It is traced to D6 as owner if B agrees.

Catalogue rows to correct at deliverable 2:
- F-6201 and F-6208 are A in the catalogue. Their owner is B, with D6 as contributor (lead's ruling).
- F-6301 and F-6303 sit in area A's components.md as V3/V7 "with D as contributor". This dossier proposes the reverse:
  D7 owns them and V3/V4/V7 contribute (question 1).
- The F-6201/F-6205 formatter doubt is resolved in favour of F-6205.

## 2. Interfaces across the area boundary

**D implements for A (`lib-host` H1, agreed in substance; the gaps below go to worker-1).**

| H1 operation | Over `wsl.exe` |
|---|---|
| `runScript(posixShell)` | `wsl.exe -d <distro> --cd ~ --exec sh -s`, with the script on standard input. It runs as the distro's default user, root included (F-6201 6.6). Output lines are streamed. `powershell` is never requested; it maps to `spawnFailed` |
| `copyToHost` | `sh -c 'cat > <path>'` with the file on standard input. No copy tool is needed, so `copyToolMissing` never occurs |
| `identity` | the registered distro name (D2), never the typed spelling |
| `platformHint` | `linux`. The probe decides `linux-x64`, `linux-arm64` or `linux-alpine` (F-6302 BR-1) |
| failures | `wsl.exe` missing → `spawnFailed`; unknown or unregistered distro, or a distro stopped during a step → `channelClosed`, with D1's kind kept in the detail; `cancelled`; `timeout` only when lib-server sets one |

What D needs from A, as `lib-host`/`lib-server` changes (question 1):
1. **A client-file source for a step.** The script reads the archive from a host path that D3 computed (the automount,
   F-6301 6.7), or the archive arrives on standard input (`tar` in the script-less start, F-6304 6.1). Either a
   `clientPathOnHost(localFile)` operation on H1, with "absent" meaning "copy", or a byte-stream input to `runScript`.
2. **A download policy `clientFirstThenHost`.** Remote-SSH has `auto`, `always` and `off`, host first. WSL downloads on
   the client first and falls back to the host silently (F-6301 BR-1, BR-7). The script-less start has no host
   fallback today (F-6304 Q2, recommended (b)).
3. **A kept client cache, not a temporary file.** The archive stays in a per-user cache shared by windows and editor
   instances. It is written to a temporary name and renamed once checked (F-6301 BR-4/BR-5/BR-14). SSH deletes its
   copy (F-3902 rule 6).
4. **Integrity facts from the download port.** The `X-SHA256` header of the redirect and the `Content-Length`; length
   only when the source sends no hash (F-6301 BR-6, Q3).
5. **Script content.** `server-env-setup` is read by `sh` into the shell that installs and starts the server, before
   both steps, and never on reuse (F-6303 BR-1–BR-5). The Alpine `libstdc++` check and `check-requirements.sh` follow
   (F-6302). The unpack percentage is printed for the "Unpacking: <n>%" stage. In the script-less start the cleanup
   removes the other commit folders (F-6304 BR-7/BR-8). V1 statuses are reused where they fit, and WSL adds none of its
   own.
6. **Start options.** `--file-watcher-polling <ms>` only for WSL 1 with the setting on (F-6601 BR-1–BR-4). Telemetry
   off (R-83). Server bound to `127.0.0.1` with a connection token (F-6201 BR-7).
7. **A WSL row in P3's override policy.** See question 2; the register decides it.

**D gives `lib-forwarding` a dialer** (D5): `dial(host, port)` opens one `wsl.exe` relay and returns its standard
input and output as the stream. W2 wraps the dialer in the local listener. WSL needs the listener shared across windows
through a per-user rendezvous record. Its first owner keeps it; a window that is not the owner checks the record
through `/version` before using it. Whether W2 or D5 holds the rendezvous is for worker-1 and me to settle.

**D gives B a `connect` connector** with A's `Connected`/`Failed` shapes. Two additions:
- WSL failure kinds: `distroUnknown` (STR:S053), `wslMissing`, `serverStartSilent` (90 s), `serverStartFailed`,
  `prerequisiteMissing`, `proxyFailed` (STR:S022).
- The F-6208 dialog stays open while the resolve waits. Its answer decides the result: Retry → reload; Close WSL Window
  → leave the remote; Ignore → `NotAvailable(handled)`.

`cancellable` is false (F-6201 BR-9). Phase names follow F-6201 BR-8.

D also supplies B with:
- D2's inventory for the rows and the picker, with a change event;
- D3 for reopen, open-folder and recent-row URIs;
- D10's three conditions;
- the distro version and home for F-6205.

D needs from B:
- the `wsl` codec `{distro}` extended with an optional outer hop `{distro, outer: DecodedTarget}` (F-6201 BR-2);
- the resolver host;
- the window opener, which D3 callers use for reopen (always the current window, F-6204 BR-5);
- the identifier table.

**D gives C:** `lib-wsl` (D1 to D4) for the containers engine's Docker-in-WSL paths (F-0204, F-0207, F-1301). I
coordinate with worker-3 when area C has started.

## 3. External dependencies

- **Processes:**
  - `wsl.exe` (management verbs and `-d … --exec`), plus `wslpath`, `sh`, `tar`, `wget`, `uname` and the server's Node
    runtime inside the distro;
  - `explorer.exe /select,` for F-6207;
  - `wsl.exe --install -d` typed into a visible terminal for F-6102 (BR-3/BR-4).
- **Proposed API:**
  - `resolvers`: B's resolver host, and `extensionHostEnv` for F-6303 6.1;
  - the exec-server part of `resolvers` for the nested route;
  - `contribViewsRemote` and `contribRemoteHelp`, which are B's.
- **Stable API:** `env.openExternal`, `workspace.getConfiguration` (`remote.WSL.*`), `globalState`, terminals.
- **Network.** Server archives come from the URL that `lib-product` resolves. The client download honours
  `http.proxy` and always verifies TLS, with extra CAs from `NODE_EXTRA_CA_CERTS` (F-6301 BR-8/BR-9). The in-distro
  `wget` uses the distro's own proxy configuration (BR-10).
- **Files (names only):**
  - client: the archive cache `%USERPROFILE%\vscode-remote-wsl\<quality>\<commit>\`, keyed per product under §4;
  - distro: `~/<serverDataFolderName>/bin/<commit>`, `data/`, `extensions/` and `server-env-setup`;
  - distro, F-6401 route: `/tmp/remote-wsl-loc.txt`, written by the editor's launcher, not by us;
  - distro, F-6401 hand-off file: its name follows R-27 (F-6401 BR-13).
- **Global state** (internal names, our id): last update check, download in progress, last use per server platform
  (F-6301 BR-13), and the three advisory flags (F-6206 BR-5).
- **WSL configuration read, never written:** `/etc/wsl.conf` `[automount] root`, `[interop]`, `[user] default`;
  `WSLENV`; `WSL_DISTRO_NAME`.

## 4. How ADR-0004, ADR-0005 and ADR-0006 apply

- **ADR-0004.** No SSH on the local route. On the nested route (F-6701) area D spawns no `ssh`. It runs `wsl.exe`
  through the outer remote's exec facility, which Remote-SSH serves over its own `ssh` (area A). So area D never
  imports `lib-ssh`.
- **ADR-0005.** It conflicts with the nested route. The specs record the editor CLI copied from the client into the
  distro, where it downloads and serves the server on a socket (F-6701 BR-8). The CLI route's progress strings are
  STR:S029 and STR:S012 (F-6304). ADR-0005 decision 2 and ADR-0006 decision 3 say the family downloads and runs no CLI
  outside Tunnels. My design installs the server with `lib-server` through D4 over the exec facility, as on the local
  route, and connects through D5's dialer. STR:S029 and STR:S012 are then never shown. Question 3.
- **ADR-0006.** These names come from the profile:
  - the data folder in the distro (`serverDataFolderName`, R-47 rule 2);
  - the launcher (`serverApplicationName`);
  - the setup file path (F-6303 BR-1);
  - the server URL (P3).

  Two conflicts:
  1. **The client cache is not per product.** VSCodium builds from the same commit as VS Code. So
     `vscode-remote-wsl\stable\<commit>\vscode-server-stable-linux-x64.tar.gz` would hold two different products'
     archives under one name. I propose the reference layout for `code` and `code-insiders`, kept so existing caches
     are reused (F-6301 BR-4), and `vscode-remote-wsl\<applicationName>\<quality>\<commit>\` for every other product,
     in the spirit of R-58. The folder name then lives only in P4.
  2. **The server source.** F-6301 BR-12 falls back to the product's `updateUrl` when no template exists. ADR-0006
     decision 2 and R-68 allow no built-in Microsoft source, and WSL has no override setting (constraints, "Server
     distribution" row). So on genuine VS Code our WSL build has no source and nowhere for the user to set one.
     Question 2.
- **No CLI on the local route.** The `code` hand-off (D8) uses the server's own CLI ([oss] `server.cli.ts`), which
  ships inside the server archive. It is not the editor CLI of ADR-0005.
- **Remote-side code.** The container view allows two scripts shipped as text. WSL adds two more: the relay script
  (D5) and `scripts/wslCode.sh` (D8). Both are short and run by programs already present (the server's Node, `sh`).
  The view needs that sentence (question 4).

## 5. Open questions (batched for the lead)

1. **The D/A split for the server (worker-1).** Do D7 and D8 own F-6301, F-6302, F-6303, F-6304 and F-6601, with V1,
   V3, V4 and V7 as contributors? The `lib-host`/`lib-server` additions of §2, items 1 to 6, are the price. Also: who
   holds the cross-window proxy rendezvous, W2 or D5?
2. **WSL server distribution (register; constraints "Server distribution", K-list).** F-6301 BR-12 versus ADR-0006
   decision 2 and R-68. Options:
   - (a) an invented `remote.WSL.serverDownloadUrlTemplate` (R-27), with the same order and licence gate as Remote-SSH;
   - (b) WSL reads Remote-SSH's or containers' override key;
   - (c) the `updateUrl` fallback behind the R-68 dialog.

   I recommend (a). The announced F-7902 may already decide it. The licence rule is `sourceBased` (R-80), so the
   `update.code.visualstudio.com` host is gated.
3. **The nested route and ADR-0005 (register if it changes scope).** Install through `lib-server` over the exec
   facility, with no CLI (my design; STR:S029/S012 unused)? Or reproduce the CLI copy? The exec facility itself is the
   `resolveExecServer` point that B parked for containers F-1302; WSL is a second consumer, so one answer serves both.
4. **The container view.** Adopt `lib-wsl` (D1–D4) under the two-consumer rule, and allow two more text scripts (§4).
5. **F-6401 Q1, `code` in a distro shell (scope and identity).** The stock launcher looks up the extension
   `ms-vscode-remote.remote-wsl` by name [oss]. VSCodium's launcher reads `VSCODE_WSL_EXTENSION_ID` (default
   `jeanp413.open-remote-wsl`) and passes one more argument, `VERSION`. Options: (a) ship `scripts/wslCode.sh`
   accepting both argument orders, and document the variable for VSCodium users; (b) add our own distro-side `code`
   (an `[adaptation]` under F-7901); (c) both. I recommend (a). With (a), a stock VS Code never reaches us, which
   matches R-54, since our build stands down there anyway.
6. **F-6201 Q3 and F-6701 Q3.** Restart a server that died under a connected window on re-resolve (recommended (b))?
   And end an endless reconnect when the distro was removed (recommended (b))? Both are inside AC tolerance.
7. **F-6303 6.1, the shell environment for a `code`-opened window.** The launcher's hand-off cannot pass a file
   reference to the window's extension host through core. Candidates: a query on the folder URI (that changes
   observable URIs), or a rendezvous record keyed by distro and path that the next resolve consumes. This is
   deliverable 2 material, and it needs worker-2's view on the URI.
8. **F-6002 Q1 (masking) and the terminal log sink** belong to `lib-log`. I recommend masking the token, option (b).
   **F-6301 Q1** (log the specific download reasons) and **F-6304 Q2** (`wget` fallback in the script-less start): I
   recommend (b) for both.
9. **F-6001 Q3 and F-6402 Q1 (web build, non-Windows clients).** The resolver must register on every platform, because
   F-6701 was observed from a linux-arm64 client. The local route then fails with `wslMissing`. Is the browser entry in
   or out? That decides whether area D needs a web build at all; my reading is that it does not.
10. **Background download (F-6301 BR-13, Q4).** No API reports that the editor has downloaded an update. Is a check of
    the product's update feed by the extension in scope, or is it recorded and not built (R-60 does not apply: it is
    reference behaviour)?

## 6. The conformance picture

- **No WSL suite exists.** The published issues carry acceptance criteria only, about 30 per feature, and no case
  files. Their verification scenarios assume a Windows host with WSL 2 and WSL 1 distros, an Alpine distro, a distro
  without network, a custom automount root, and an outer SSH host to a Windows machine for F-6701.
- **The runner's channels needed** (none exist today; the containers suite observes the UI and Docker only):
  - `wsl.exe --list --verbose` state;
  - file listings in a distro (`~/<serverDataFolderName>/…`) and in the client cache folder;
  - Windows and distro process lists;
  - listening ports on `127.0.0.1` and a GET of `/version`;
  - the text of the "WSL" terminal;
  - a shell inside a distro, to type `code .` (F-6401);
  - a launcher run from Windows (F-6402).
- **The lab needs a Windows host.** The family's lab hosts belong to the dirty rooms, and the clean side does not touch
  them. A clean Windows runner (a CI image with WSL, or a Windows VM of the suite owner) is a money and infrastructure
  item for the lead to raise. Linux CI can run D2, D3 and D7's pure parts against a recorded `wsl.exe` fake only.
- **What a build must expose:**
  - the verbatim strings (STR:S0xx) and the progress title link to `remote-wsl.showLog`;
  - the stage order of F-6201 BR-8;
  - the dialog buttons in order (Retry, Close WSL Window, Ignore);
  - a terminal named "WSL";
  - one proxy port per distro with `/version`;
  - the server under the profile's data folder;
  - for products other than VS Code, the per-product cache folder (§4).

  No test hooks are needed. F-6103's build check may use a substitution seam (F-6103 §16 allows it), confined to D2's
  input.
- **Profiles.** WSL 2 and WSL 1 on Windows x64; ARM64 Windows for `linux-arm64` (F-6302 Q2); VS Code with an explicit
  server URL; VSCodium; a synthetic product (ADR-0006 decision 6).
