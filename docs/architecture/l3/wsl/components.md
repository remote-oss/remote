# C4 level 3: area D components (the WSL engine)

- Status: first version for the lead's review (deliverable 2). Rows that depend on drafts still pending (F-6101,
  F-6202, F-6501, F-6502, the decisions F-7902 to F-7904) are marked **provisional**.
- Date: 2026-10-06
- Author: `remote-architect-worker-4`; lead: `remote-architect`
- Built on:
  - the area D dossier as merged (PR #25);
  - `../../c4-l2-containers.md` (b7860c0: `lib-wsl` accepted, two WSL scripts in the remote-side text);
  - ADR-0002 to ADR-0007 (ADR-0006 decision 4: caches keyed by product);
  - the D/A answers of `remote-architect-worker-1` and the D/B answers of `remote-architect-worker-2`, both of
    2026-10-06.
- Traceability: `traceability.tsv` in this folder, one row per remote-wsl feature, B's rows included and marked.

Area D covers the library `lib-wsl` and the engine part of the `remote-wsl` package. Component ids are stable and
are used by the contracts and the matrix. A component marked **pure** has no editor API, no process and no file
access, so its tests are plain unit tests (ADR-0002 rule 7). A component marked **process** spawns programs through
an injected spawner, so its tests run on a recorded fake.

## Dependency rules inside area D

- `lib-wsl` depends on `lib-host` (it implements H1) and `lib-log`, nothing else. It knows no server, no resolver
  and no editor UI. It is consumed by `remote-wsl` and by `remote-containers` (Docker in WSL, area C).
- Every `wsl.exe` process is spawned by D1, and only by it. The other components ask D1 to run a verb, as A2 does
  for `ssh` (ADR-0004's pattern carried over).
- A spawner is injected into D1: the local one (Node's child process), or one over an outer remote's exec facility
  for the nested route (D9). Nothing above D1 knows which spawner it has.
- The `remote-wsl` engine components see `lib-wsl`, `lib-server`, `lib-product`, `lib-forwarding` and `lib-log`. They
  reach the editor only through B's connector interface and through narrow UI ports the package wires. B's
  resolver, window and indicator APIs are never touched.
- Remote-side text (L2 §2): the relay script of D5 and `scripts/wslCode.sh` of D8 ship in the VSIX as text, next to
  `lib-server`'s two bootstrap scripts.

## lib-wsl

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| D1 | wsl-runner | Locate `wsl.exe`. Build argument lists for the verbs (`--status`, `--version`, `--list --verbose`, `--list --online`, `--install -d`, `--set-default`, `-d <d> --cd <dir> --exec <prog>`). Spawn through the injected spawner. Decode: UTF-16LE for management verbs, UTF-8 for programs in a distro. Classify exit status and output into the closed kinds of the contract. Never retries | process |
| D1a | wsl-output-parser | Parse the outputs of `--status`, `--version` and `--list --verbose`/`--online` into records; tolerate the column and marker variants the specs list | pure |
| D2 | distro-inventory | WSL presence and version; the Windows build (`os.release()`'s third part, F-6103 §16); distros with state, version and default flag; case-insensitive matching returning the registered spelling; the empty name as the default distro; `docker-desktop*` filtering; the online catalogue sorted as F-6102 BR-2; set-default (the pre-1903 route through `wslconfig.exe`); install command line; a change event on refresh | process over D1 |
| D3 | path-mapper | Windows→distro and distro→Windows translation, the `\\wsl.localhost\` and `\\wsl$\` forms, `vscode-remote://wsl+<d>/…` URIs, the `/mnt/<letter>/` shape test. Drive paths go through `wslpath` in the target distro (automount root honoured); share paths are pure | pure core plus one D1 call |
| D4 | wsl-host-channel | `lib-host` H1 over D1: `runScript` (`sh -s` with input text or a streamed file), `copyToHost` (`cat >`), `clientPathOnHost` (D3's translation of the local file, or none when automount is off), `identity`, `platformHint` | process over D1 |
| D4f | wsl-fake | The recorded spawner fake for D1 and the H1 contract suite run against D4 (A's shared channel tests) | test fixture |

## remote-wsl, engine part

| Id | Component | Responsibility | Kind |
|---|---|---|---|
| D5 | distro-proxy | Own-or-join for one distro: the per-user rendezvous record, the `/version` health check, ownership by the first window, takeover when the owner is gone, end on Close Remote Connection. The owner opens W2 with D5r's dialer | process |
| D5r | wsl-relay-dialer | `lib-forwarding` dialer: one D1 process per stream, running the server's own Node runtime with `relay.js` (shipped text) that pipes standard input and output to `127.0.0.1:<port>` in the distro | process over D1 |
| D6 | connect-engine | The connector behind B's `wsl` resolver front: decode result → D2 match → pre-1903 check (F-6103) → start → probe (V2) → D7 → D5 → `Connected`; or `Failed` with a WSL kind. Per-distro session table for re-resolve (F-6201 BR-5) and the server-alive check (F-6201 Q3 (b), provisional). The 90 s silence watchdog (F-6208 BR-9). Phase events in F-6201 BR-8 order. Reads the env rendezvous (D11) with B's `windowWorkspace` | process orchestration |
| D7 | wsl-server-adapter | WSL's parameters to `lib-server`: download policy `clientFirstThenHost`, cache policy `kept` (ADR-0006 decision 4), verification `headerHashThenLength`, mode `singleScript` or `stepwise` from `remote.WSL.experimental.scriptLessStartup` (F-6304), `environmentSetup` = `<serverDataFolderName>/server-env-setup` (F-6303), extra start option `--file-watcher-polling` for WSL 1 (F-6601), V8 cleanup variant per mode | pure configuration plus wiring |
| D7b | background-download | Wires A's V10 server-prefetch (PR #35) with the remote-wsl `prefetch` row and `remote.WSL.downloadInBackground`; records platform use (F-6301 BR-13) | wiring |
| D8 | shell-handoff | `scripts/wslCode.sh` (shipped text): accepts the stock launcher's five leading arguments and VSCodium's six ([oss] `resources/win32/bin/code.sh`, VSCodium `00-remote-use-open-ext.patch`); ensures the server with in-distro `wget` (F-6401 BR-8); writes the env record for D11; runs the server CLI in its WSL mode ([oss] `src/vs/server/node/server.cli.ts`) | remote-side text |
| D9 | nested-route | For `wsl+<d>@<outer>`: obtains the outer remote's exec facility from B's resolver host and builds D1 with the remote spawner; everything above D1 is unchanged. **Provisional** on the register's answer to dossier question 3 | process |
| D10 | window-advisories | At window start: WSL 2 on `/mnt/<letter>/…`, WSL 1, a local window on a `\\wsl` share (F-6206 R1–R3); keeps the three flags; hands B the condition to render | process over D2 and D3 |
| D11 | env-rendezvous | The per-window shell environment of F-6303 6.1: a per-user store keyed by distro and folder or workspace path, written by D8 through the distro, read once by D6, expiring; with `remote.WSL.useShellEnvironment` read when the request is handled (F-6303 BR-11) | process |
| D12 | wsl-commands | The engine side of the commands whose features D owns: Reopen Folder in WSL/Windows (F-6204), Open Folder in WSL (F-6203), Reveal in File Explorer via `explorer.exe /select,` (F-6207), Add a Distro (F-6102 engine), `remote-wsl.reopenFromRecommendation` (F-6206). Each computes its target with D2/D3 and hands B's window opener or a UI port the result | thin, editor-facing through ports |

## Feature ownership (one owner each; contributors in the matrix)

| Feature | Issue | Owner | Contributors |
|---|---|---|---|
| F-6101 | wsl#17 | D2 (**provisional**, pending draft) | D1, D1a |
| F-6102 | wsl#18 | D12 | D2, B `wsl.targets-view` |
| F-6103 | wsl#19 | D2 | D6 |
| F-6203 | wsl#22 | D12 | D3, B window opener |
| F-6204 | wsl#23 | D3 | D12, B window opener |
| F-6206 | wsl#25 | D10 | D3, D12, B `wsl.package` (renders the three advisories) |
| F-6207 | wsl#26 | D12 | D3 |
| F-6301 | wsl#28 | D7 | V3, V4, V9, D4 |
| F-6302 | wsl#29 | D7 | V1, V2 |
| F-6303 | wsl#30 | D7 | V1, D11, D8 |
| F-6304 | wsl#31 | D7 | V1, V7, V8, D5 |
| F-6401 | wsl#32 | D8 | D11, D7 |
| F-6402 | wsl#33 | D6 | B `wsl.resolver-front` |
| F-6601 | wsl#37 | D7 | V7 |
| F-6701 | wsl#39 | D9 | D1, D4, D5, B codec |

B owns, per its components.md and traceability.tsv (PR #26):
- `wsl.package`: F-6001, F-6003, F-6004, F-6005, F-6602 (a documented no-op, AC-19) and F-7901;
- `wsl.resolver-front`: F-6201;
- `wsl.window-surfaces`: F-6205;
- `wsl.failure-ui`: F-6208;
- `wsl.targets-view`: F-6503, and F-6501/F-6502 when drafted.

D contributes to those rows as B's matrix lists. This matrix carries only D's rows, so no feature appears twice.
F-6002 is the lead's (`lib-log`).

## First coding candidates

The pure components come first: D1a, D3's pure core, D7's configuration, and D2's matching. After them, D1 and D4 on
the fake, with A's H1 contract suite. D5, D6 and D11 need B's resolver host and A's revised `lib-server` (V1 stepwise
mode, V3 download policy, V4 verification, V9 kept cache), so they follow those.
