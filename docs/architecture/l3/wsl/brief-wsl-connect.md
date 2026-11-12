# Brief: connecting to a distro (F-6103, F-6201, F-6208, F-6301 to F-6304, F-6601, F-7902)

Part of `brief-remote-wsl.md` (#2348), whose §2 rulings apply here. Owner components: D6 connect-engine with D6w,
D7 wsl-server-adapter with D7a, D5h wsl-proxy-helper and D5r relay, D11 (its reading side), `wsl.resolver-front` and
`wsl.failure-ui` (area B).

## 1. The connect (F-6201): D6's steps

These replace contracts.md D6's run list.
1. **Decode.** The `wsl` codec gives `{distro, outer?}`. A malformed authority, a bad outer included (`badOuter`), ends
   as a handled `NotAvailable` that shows nothing (AC-19, 7.E6; the new host outcome of brief-remote-wsl §3).
2. **No WSL here.** Off Windows with no outer, `wslMissing` (F-6101's texts, provisional). The resolver is registered on
   every platform (F-6402 Q1, `reading-2348-resolver-everywhere`).
3. **The session.** If this extension host already holds the distro's session and its proxy answers `/version` within
   1 s, return its `Connected` (BR-5; core's reconnect loop ends here). If it doesn't answer, drop the session and go on
   from step 4 (Q3 option (b), `reading-2348-reresolve-check`). After a reload the table is empty, so the window joins
   through D5h at step 10, which is why AC-17 shows only after a reload.
4. **Match.** D2's `matchDistro` gives the registered spelling. An unknown name gives the S053 notification through a
   notice port, its `{0}` neutralised (brief-remote-wsl §2 item 4), and a handled failure with no F-6208 dialog. Two
   registered names that differ only in case match neither (`reading-2348-case-tie`). The empty name is the default
   distro (Q2 option (a)); its window keeps the authority `wsl+`, so a recent entry follows the default.
   **Rejoin:** if D5h already has a helper for this product, outer and registered distro and its server answers
   `/version`, the window joins it here and returns, so a reload shows no progress (AC-8); otherwise go on.
5. **Old builds** (F-6103, §6 below).
6. **Probe:** phase `startingSubsystem`, then lib-server's probe over D4, which also starts a stopped distro.
7. **Server:** D7's `ensureServer` (§2), with the phases `downloading`, `unpacking <n>%` and `installing`.
8. **Start:** D7's `start` (§3), phase `starting`, under D6w's watchdog (§5).
9. **Node check:** `<installDir>/node` must be executable after a start that reported its port, else
   `serverNodeMissing` (STR:S015, F-6208 7.E3; `reading-2348-node-check`, since lib-server's start reports no node path).
10. **Proxy:** claim or join D5h (§4), then `Connected {address, connectionToken, extensionHostEnv: D11.take(...)}`.

**The progress (BR-8, AC-3, AC-8, AC-27):** the title is STR's "Starting VS Code in WSL ({0})", verbatim on every product
(D-14), with `{0}` the registered spelling as a link to `remote-wsl.showLog` (`]` and `)` escaped). No phase is emitted
before step 4 succeeds, none on the join path, and the host's `progressDelayMilliseconds` is 1500 for WSL.

**Per-connect state (AC-23, BR-10):** the only per-connect write is the usage stamp; F-6301 BR-13's platform record is
written when the probe maps the platform (F-6302 7.E5). The per-connect log lines (section 9) carry no token; the
"local URL for debugging" line shows the address without it. STR:S013, S038 and S051 are carried in the string table
with no surface (`reading-2348-table-only`).

## 2. Where the server comes from (F-7902, F-6301, F-6302)

**The order** (F-7902 rules 1 to 9), one numbered sequence in D7:
1. probe the distro (platform, libc, an installed server);
2. plan: an installed server of the client's commit is reused even with no source (rule 6 (i));
3. resolve the source: `remote.WSL.serverDownloadUrlTemplate` from the `defaultProfileUser` layer, then the client's
   `product.json` template, then lib-product's built-in table (R-88: never `updateUrl`);
4. no source, or an unusable template: F-7902 rule 7's modal error dialog with "Open Setting" and "Cancel", nothing
   written beyond the probe, the failure handled and the window "Disconnected from WSL: <distro>" (F-6301 7.E10, AC-27);
5. classify the licence (rule 9) and ask before any cache read, download or reuse that needs it (AC-21, AC-28, AC-33);
6. the kept cache, then the transfer, then the identity rewrite, then the start (§3), with
   `--accept-server-license-terms` exactly when the licence applied (F-6304 BR-15).

**The cache, `ruling-2348-cache-product-level`.** ADR-0006 decision 4 governs the folder: `%USERPROFILE%\vscode-remote-wsl\`,
then `<applicationName>\` for products other than `code` and `code-insiders`, then `<quality>\<commit>\<entry>`. So F-7902
rule 4's layout holds on genuine VS Code, and VSCodium gets the product level (the deviation). WSL keys every archive by
commit (F-7902 AC-8, AC-15), not by lib-server's version-and-release key. The entry name is D7a's (pure): F-7902 rule 4's
name, built from `[A-Za-z0-9._-]` only, with unit rows for `..`, `%2e%2e`, a drive letter, NUL, spaces, a query, `.tgz`
and an unknown quality.

**The partial download** keeps lib-server's name `<final>_<epoch ms>-<token>`, since the token keeps two windows'
downloads apart, `ruling-2348-partial-name` (F-7902 AC-16 says `<final>_<epoch ms>`).

**Verification:** SHA-256 when an `X-SHA256` header was sent by any hop, else the length, else none (F-7902 rule 4
governs F-6301 BR-6, `reading-2348-verification`). **TLS** stays verified even with `http.proxyStrictSSL` false, extra CAs
only from `NODE_EXTRA_CA_CERTS` (F-6301 BR-9, AC-9): the composition root pins the HTTP function.

**In the distro:** the script start's fallback after a failed client download uses wget only (F-6302 BR-4, AC-7); its
percent lines drive "Downloading: n%", and its error text reaches the log as a bounded fact (ADR-0010).

**Platforms (F-6302):**
- Alpine is lib-server's musl test (`reading-2348-alpine-detection`). Its `libstdc++` probe runs before unpack and
  blocks with F-6208 AC-24's dialog (F-6302 AC-5): contracts.md D7's "logged, never blocking" is reversed.
- An unknown machine type ends as an unsupported platform with a log note and nothing downloaded,
  `ruling-2348-unknown-arch` (F-6302 AC-11 fetches the x64 build in the distro; an x64 server on a machine that isn't
  x64 can't start and leaves an install behind).
- STR:S057 is kept and raised nowhere (Q1 option (a), R-60).

**Quality and commit checks:** STR:S041 is shown when the client's `commit` is empty or absent, before any distro starts
(F-6001 Q4). STR:S007 and S056 are kept with no check: with R-88 there is no `updateUrl` step, so F-6301 AC-21 and AC-22
can't trigger (`reading-2348-quality-checks`; a spec question asks to retire them).

**Background download, `ruling-2348-no-update-signal`.** F-7902 rule 10 and AC-29 (and F-6301 BR-13, AC-19) download
the server of an update "the editor has detected"; no extension API reports one. So nothing is fetched in the background:
`remote.WSL.downloadInBackground` is declared and read, and one log line says nothing was prefetched. AC-29's first
clause holds; the rest are the deviation. lib-server's V10 runtime is not built for WSL, and D7b keeps only that line and
the per-platform usage stamp of §1 (contracts.md D7b).

**Telemetry:** the start passes `--disable-telemetry` (F-7902 rule 11, F-6304 BR-12); the evidence (K-3, AC-30) is the
start command's line in the "WSL" terminal.

## 3. Start methods and the server's environment (F-6303, F-6304, F-6601)

- **Script start** (default): lib-server's install and start scripts over D4's stdin. It tries the client's download
  and falls back to wget in the distro. The start step always sources `server-env-setup`; the install step sources it
  only when it downloads in the distro, which needs its proxy variables. So a connect reads it once unless the fallback
  runs (`reading-2348-setup-once`, F-6303 BR-2, AC-1).
- **Script-less start** (`remote.WSL.experimental.scriptLessStartup`, the stepwise driver): no in-distro fallback, so a
  failed client download fails the connect (F-6304 Q2 answered (a), `reading-2348-scriptless-no-fallback`; AC-11 and
  F-7902 AC-14 hold as written). Its requirements check follows the mode (AC-7, AC-24). Only its start step sources the
  setup file, since no step of this route downloads in the distro, so it is sourced once (F-6303 BR-2, AC-1).
- **`ruling-2348-script-by-stdin`.** Our script and relay reach the distro over standard input and arguments, never
  through the drive mount, so a distro with automount off connects in both modes. F-6304 AC-10's first clause (that it
  fails) is the deviation.
- **Options:** `--use-host-proxy` (`useHostProxy`, F-6303 BR-14, AC-29), `--disable-telemetry`, the licence switch, and
  `--file-watcher-polling` from D7's pure `fileWatcherPolling(version, polling, interval)` (F-6601): only for WSL 1 or the
  setting, a decimal integer with no exponent, nothing for a non-finite value or an unknown version, values above
  `Number.MAX_SAFE_INTEGER` clamped, and no folder resource for a `.code-workspace` window.
- **The licence record (F-6304 BR-15):** the fact that a server needed the dialog is recorded with the installed server in
  the distro, so every later start of it passes the switch, on any client.
- **The setup file (F-6303):** `<serverDataFolderName>/server-env-setup` in the distro user's home, per product (F-7902
  rule 5). A file that exits or fails to parse gives `serverStartFailed` with its output in the log. A step whose main
  process has exited settles even if a background child keeps the pipe open. `remote.WSL.useShellEnvironment` is read
  from the user layer (BR-11).
- **Auto-shutdown:** the family's `--enable-remote-auto-shutdown` stays as a backstop; D5h's end action is what stops
  the server.

## 4. The proxy and the relay (D5h, D5r)

- **Claim (`ruling-2348-proxy-helper`):** lib-helper's per-user registry, keyed by product, outer authority and
  registered distro. The claim record holds the nonce and the endpoint only; the connection token is served over the
  nonce-authenticated lease. The helper runs under the editor's own runtime, as lib-helper does for ssh.
- **Listener:** `127.0.0.1`, one port for the helper's life, so a reload rejoins the same port (AC-8). At most 32
  relays at once; further connections are closed and logged, since each spawns a process before the server checks the
  token.
- **End:** 5 s after the last lease, the helper stops the server by the process id its start recorded, leaving `bin/`
  in place so nothing is reinstalled (lib-server's `kill` also deletes it), and exits (6.9, AC-15, AC-29, AC-30). A helper that can't start ends the connect with `proxyFailed` (STR:S022) within 10 s.
- **Relay (D5r):** each stream runs `wsl.exe -d <registered> --exec <server node> -e <fixed relay text> <port>`. The text
  is ours and fixed, with nothing interpolated; it writes a fixed readiness marker to standard error once it has
  connected, and the dial resolves only on that marker (10 s). It doesn't go through the drive mount.
- **`/version`** is unauthenticated and returns only the commit; the token is the gate (BR-7), and it stays mandatory.

## 5. Failures (F-6208): `wsl.failure-ui` and D6w

| Kind | Surface |
|---|---|
| `distroUnknown` | STR:S053 notification, handled, no dialog (§1 step 4) |
| `singleDistroOnly` | STR:S064 notification, no dialog (F-6103 AC-6) |
| `wslMissing` | F-6101's texts (provisional) |
| `noServerSource`, `invalidServerTemplate` | F-7902 rule 7's dialog, handled |
| `licenceDeclined` | handled, no dialog (F-7902 rule 9) |
| `unsupportedPlatform`, Alpine's `libstdc++` | F-6208 AC-24's dialog |
| `serverStartFailed`, `serverStartSilent` (STR:S055, `{0}` = 90), `serverNodeMissing` (STR:S015), `prerequisiteMissing`, `proxyFailed` (STR:S022), `serverDownload`, `serverInstall`, `lockTimeout`, `scriptFailed`, `channelFailed`, `noResultBlock`, `retriesExhausted` | F-6208's dialog: its main message (an id of ours, English verbatim) with STR:S009 as detail |

- Every kind is `retryable: false`; core's reconnect attempts reach §1 step 3 only.
- **The progress stays behind the dialog** (AC-3, BR-1; also F-6301 AC-14, F-6303 AC-8) through the host option that
  runs the presenter inside the progress, on for WSL.
- **The terminal is revealed** before or with the dialog (BR-3), and STR:S026, with our URL, is the attempt's last line
  (BR-11). Distro output goes only to the log, never into a dialog (AC-9).
- **D6w, the silence watchdog** (BR-9, 7.E2): a decorator on D4's `runScript` for every step in the distro. It restarts
  on every line and ends the run after 90 s of silence, which kills `wsl.exe`. AC-10's "no process left" is checked on the
  Windows launch; if the distro's children survive, the card adds a process-group end.
- STR:S036 "Ok" is kept and unused (Q2 option (a)).

## 6. Old Windows builds (F-6103)

- **The rule:** D2's `multiDistroAllowed(build)` is `build >= 18362`. The criteria cover 17134 to 18361; below 17134 is
  F-6101's (Q1 option (b), `reading-2348-old-build-floor`). An unknown build connects (7.E3).
- **The question:** a modal through D6's UI port. "Change Default" sets the default through D1's `wslconfig.exe
  /setdefault <registered>` route (System32, arguments, no shell); a decline gives the S064 notification. A failed
  set-default (7.E2) shows one notification with a new string id of ours (R-27). No setting, payload or remembered answer
  skips the question (BR-4, BR-5).
- **The build** comes from brief-remote-wsl §2 item 12's single source and its test seam.

## 7. The cut

| Card | Scope | Test kinds |
|---|---|---|
| con-1 | lib-product's `remote-wsl` row and `expand()`'s `noValue` option, on for WSL only | unit |
| con-2 | lib-server's stepwise driver and the mode-dependent requirements check | unit |
| con-3 | lib-server: `X-SHA256` across hops, wget-only with its facts, the Alpine step, `useHostProxy`, the debug option, `--disable-telemetry` for WSL, the licence and source dialogs lifted | unit |
| con-4 | lib-authority's resolver host: handled-silent `NotAvailable`, WSL phases and bar, the title from the connector, presenter inside the progress, the progress delay | unit |
| con-5 | D5h and D5r (§4), lib-helper's README | unit, acceptance-win |
| con-6 | D6 and `wsl.resolver-front` (§1), D11's reading side | unit, acceptance-win |
| con-7 | D7 and D7a: the order, cache, entry name, verification, TLS, licence, the two dialogs, platforms, quality checks, the background-download setting (§2) | unit, acceptance-win |
| con-8 | the start methods, options, licence record and setup file (§3), F-6601 | unit, acceptance-win (WSL 1 included) |
| con-9 | `wsl.failure-ui` and D6w (§5) | unit, acceptance-win |
| con-10 | F-6103 (§6) | unit, host: a pre-1903 build |
