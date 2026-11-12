# Brief: Remote - WSL (index, cross-cutting rulings, build order)

Owner: athena (architect); design check: proteus. Request: #2348 (daedalus), for hermes's 2026-11-12 plan "card every
criterion of F-7901 to F-7904" and D-105 (no deferral; only `host: windows|macOS` may wait for a runner). Inputs, as
published in remote-oss/remote-wsl on 2026-11-12:
- the four decisions F-7901 (#11), F-7902 (#41), F-7903 (#42), F-7904 (#43);
- 22 features `spec:reviewed`: F-6001 to F-6004, F-6102, F-6103, F-6201, F-6203, F-6204, F-6206 to F-6208, F-6301 to
  F-6304, F-6401, F-6402, F-6503, F-6601, F-6602, F-6701. F-6001, F-6002, F-6003, F-6201, F-6208, F-6301 to F-6304 and
  F-6701 were republished at 04:07Z with the decisions carried in (new: F-6001 §20 and AC-34 to AC-47, F-6002 AC-31,
  F-6301 AC-27, F-6304 AC-25, F-6701 AC-34 and AC-35);
- not reviewed: F-6101, F-6202, F-6501, F-6502 (`spec:pending`, no body), F-6005 and F-6205 (`spec:needs-revision`).

This brief is five files. This one holds what crosses them; each of the other four ends with its own card cut:

| File | Features |
|---|---|
| `brief-wsl-package.md` | F-6001, F-6002, F-6003, F-6004, F-6005, F-6602, F-7901, F-7903, F-7904 |
| `brief-wsl-connect.md` | F-6103, F-6201, F-6208, F-6301, F-6302, F-6303, F-6304, F-6601, F-7902 |
| `brief-wsl-commands.md` | F-6102, F-6203, F-6204, F-6205, F-6206, F-6207, F-6401, F-6402 |
| `brief-wsl-targets-and-interop.md` | F-6503, F-6701; the place of F-6501 and F-6502 |

Decisions this brief applies: ADR-0002 (pure parts get unit rows), ADR-0004 (one spawner per program), ADR-0005,
ADR-0006 (server sources and caches), ADR-0008 (public voice), ADR-0010 (output only through markers), ADR-0013 (platform
as data, `host:` rows), R-26, R-28, R-31, R-46, R-60, R-79, R-87, R-88, the payload rule of ruling-2162-recovery-gate and
ruling-2186-attach-gate, and ruling-2325-codec-and-terminal point 2 (controls in the log terminal).

## 1. What the survey found (2026-11-12)

Seven surveys read every published criterion against main at f1a1d55b: 697 live criteria. F-7901, F-7903 and F-7904
have no criteria; their rules are checked through F-6001's and the manifest's rows.

| Group | Criteria | Ours, unbuilt | Built, needs a row | Core's | Reference data or ruled | Elsewhere | Waits on a pending spec |
|---|---|---|---|---|---|---|---|
| F-7902, F-6001 | 80 | 57 | 7 | 10 | 1 | 2 | 3 |
| F-6002 to F-6005 | 92 | 56 | 2 | 24 | 2 | 3 | 5 |
| F-6102, F-6103, F-6201, F-6203 | 93 | 55 | 8 | 7 | 7 | 6 | 10 |
| F-6204 to F-6207 | 112 | 84 | 0 | 15 | 2 | 5 | 6 |
| F-6208, F-6301 to F-6303 | 108 | 48 | 27 | 17 | 7 | 8 | 1 |
| F-6304, F-6401, F-6402 | 106 | 31 | 5 | 54 | 5 | 10 | 1 |
| F-6503, F-6601, F-6602, F-6701 | 106 | 56 | 1 | 28 | 1 | 15 | 5 |
| **All** | **697** | **387** | **50** | **155** | **25** | **49** | **31** |

- **What exists:** lib-wsl's D1 runner, D1a parsers, D3's pure core and D4 host channel are built, as are lib-server's
  single-script install, the kept cache, the licence gate, `wslPolicy()`, lib-authority's codecs, gate and resolver host,
  lib-standdown, lib-identifiers and lib-helper (Windows named pipe included, although its README says otherwise).
- **What doesn't:** `packages/remote-wsl` is a placeholder. D2's process half, D3's `toWindows`, D5, D6 to D12, the
  stepwise driver and the background download are unbuilt, and no CI launch connects a window to a distro.
- **Our own documents are stale against the specs** in a dozen places (components.md, contracts.md D3, D5, D6, D7, D11,
  traceability.tsv). This PR amends components.md and the contracts the brief rules on (§7).

The per-line list (every criterion: class, owner, test kind) is posted on this PR as a comment, generated from the
surveys; this brief holds where the two differ.

## 2. Cross-cutting rulings

Each line is binding for the cards. A `ruling-` label marks a decision of ours; the six that depart from a spec line are
listed in `release-notes.md`'s Deviations (new in this folder). A `reading-` label is our reading of an open or unclear
line.

1. **The proxy is a detached helper, `ruling-2348-proxy-helper`.** F-6201 AC-29 and AC-30 need the loopback proxy to
   outlive the window that started it, so contracts.md D5's "owner window holds the listener" can't meet them. D5 becomes
   D5h on lib-helper: one helper per user, product, outer authority and registered distro, one lease per extension host,
   ending `graceAfterLastLease` (5 s, F-6201 6.9). New L2 edge `remote-wsl -> lib-helper`. It is how we meet the spec,
   not a deviation.
2. **Every distro name that builds an authority passes `validDistroName`, `ruling-2348-distro-name`.** The wsl codec
   splits a payload at its first `@` and doesn't validate the name, so a share segment or a typed name
   `Ubuntu@ssh-remote+host` would nest an authority. D2 gains a pure `validDistroName` (no `@`, `/`, `\`, no control
   character, not empty; non-ASCII allowed, unlike `install.ts`'s install-line rule), and every builder of a `wsl+`
   authority (D12, D10, the targets view, D8's script) refuses a name that fails it. Only `matchDistro`'s registered
   spelling ever reaches `wsl.exe -d`, as one argument with no shell.
3. **The payload rule holds for WSL as for containers.** A `wsl+<distro>[@<outer>]` authority, a recent entry, a share
   path, a `code` invocation or a link only selects a code path. `wsl` never passes `isTrusted` (B contracts), and no
   payload field, setting or remembered answer skips F-6103's "Change Default" question, the licence dialog, or
   remote-ssh's host-key and login consent on the nested route.
4. **Text from a distro, a link or a recent entry is neutralised where it is shown.**
   - **The log terminal:** the "WSL" terminal is lib-log's terminal sink, so ruling-2325 point 2 and its card #2329
     (controls as code points, our own line breaks, tabs and colour codes raw) cover it. No second rule.
   - **Notifications, tooltips and quick picks:** a `{0}` that comes from a payload or a path (S053, S052, S004, S042)
     has `[`, `]`, `(`, `)` and `$(` escaped and controls dropped, because core renders links and icons in those texts.
5. **Secrets never leave memory, `R-26`.** The connection token lives in the distro's token file, the helper's memory
   and the lease channel only: never in a claim record, a log line, a relay's or `wsl.exe`'s arguments, `WSLENV` or a
   trace. The `remote.WSL.debug` environment dump lists names only (F-6002 Q1 option (b)). D11's record holds the user's
   shell environment and is never logged (§5 of brief-wsl-commands).
6. **Every wait is bounded, `R-79`**, with the bound and its basis in one named-defaults module per package: the list
   call, the probe, the helper claim (10 s), the `/version` check (1 s), the relay readiness (10 s), the 90 s silence
   watchdog (F-6208 BR-9) and the stepwise steps. The only unbounded wait is a dialog waiting for the user.
7. **Nothing beyond the spec, `R-60`.** No remembered distro, no completion watcher, no refresh of formatters, no extra
   picker or setting, no stat of recent folders, no telemetry (R-28; `telemetry` is never declared).
8. **Help, issue and documentation URLs are ours, `R-31`.** `docs/remote-wsl/` is created (§2 of brief-wsl-package).
   Microsoft hosts appear only as data in lib-product's tables or in a user's own template.
9. **The out-of-context policy is `silent` for every hidden command, `reading-2348-r46-silent`** (F-6001 BR-10 allows
   it, it is what was observed, and it adds no string), except where a feature's brief names an in-context string.
10. **The stand-down and proposal gating are F-6001 §20's**, applied to every contribution with a `when` clause (§1 of
    brief-wsl-package). The gating lint is extended to key bindings, views and walkthroughs.
11. **`wslFeatureInstalled` is a shared key, `ruling-2348-shared-context-key`.** Core sets it on a Windows desktop for
    the local machine; F-6701 needs it to describe the outer host in an SSH window. lib-identifiers gains the setter
    kind `coreAndExtension`. Only D9b sets it, only in an `ssh-remote` window, to the outer host's WSL presence; nothing
    else may write it.
12. **The Windows build used by D2's rules (F-6103's 1903 floor, F-6204's 17063 path rule, F-6203's share host) comes
    from one source**, `os.release()` in the composition root (ADR-0013). Its test seam is the harness's existing
    acceptance switch; no setting, inherited environment or payload can reach it.

## 3. Changes to shared libraries

proteus's design check of this PR is the agreement for area B's and area A's libraries. Each change is additive unless
it says otherwise, so remote-ssh and remote-containers keep their behaviour.

| Library | Change | For |
|---|---|---|
| lib-product | `OVERRIDE_POLICIES['remote-wsl']` (the WSL setting and its layer); a `noValue` kind in `expand()` for a placeholder with no value (`${release}` exempt), shared with ssh and containers | F-7902 rules 3, 7; every row that installs a server |
| lib-authority | a handled `NotAvailable` that shows nothing (also for a malformed outer); WSL's phases and a bar mapping; the progress title from the connector (registered spelling, a link to `remote-wsl.showLog`); a host option that runs the presenter inside the progress, default off; an opener target that leaves the window to core, and a local form for a drive or UNC path; `ConnectInput.execServer` (this brief lands it; containers' F-1302 card builds on it); label registrations that take an explicit authority, `workspaceTooltip` and `priority`; the views probe option (`ruling-2348-views-probe`, brief-wsl-package §1); the recent-list port lifted from remote-containers' `recent-editor.ts`; `open-gate.ts` lifted from remote-containers | F-6201, F-6203, F-6204, F-6205, F-6208, F-6503, F-6701, F-6001 §20 |
| lib-identifiers | the `coreAndExtension` setter (§2 item 11); the gating lint over key bindings, views and walkthroughs | F-6701, F-6001 AC-43 |
| lib-log | the terminal sink as F-6002 specifies it (lines kept until the first terminal, an empty terminal after a close, `reveal` with a focus choice, colour classes, a UTC stamp), a file sink over an injected `append`, and a terminal mirror for the harness. Its existing test that pins the replay changes | F-6002 |
| lib-host | `runScript`'s `onLine(line, stream?)`: an optional `'stdout' \| 'stderr'` tag, `reading-2348-stream-tag`. Only D4 must supply it; lib-ssh and containers may | F-6002 AC-20, AC-28, AC-29 |
| lib-server | the stepwise driver (`transfer`, `cleanup`, `probe`, `startOrReuse` take the mode; the requirements check follows it); `X-SHA256` kept across redirect hops; a wget-only downloader option with wget's percent lines and error text as bounded facts; the Alpine `libstdc++` step before unpack; `useHostProxy` and a debug start option in `wslPolicy()`; the start words `--disable-telemetry` for WSL; the licence modal port, acceptance store and the two source dialogs lifted out of remote-ssh with the noun as a parameter. No V10 runtime for WSL (`ruling-2348-no-update-signal`) | F-6301 to F-6304, F-7902 |
| lib-wsl | D2's process half (`presence`, `distros`, `onlineCatalogue`, `setDefault`, `onDidChange`), `validDistroName`, `pathTranslationAvailable(build)`; D1's `wslconfig.exe /setdefault` route; D3's `toWindows`, a pure pre-check that rejects a path that isn't a drive form or a WSL share, `--` before every path argument, and the share host as a parameter | F-6101 (provisional), F-6103, F-6203, F-6204, F-6207 |
| lib-helper | README: the Windows named pipe is available; a pipe has no file mode, so the nonce and the per-user registry are the defence | D5h |

## 4. Build order

1. **Unblockers, first:** lib-product's `remote-wsl` row; proteus's #2350 (the Windows harness spawns the editor CLI) and
   a `wsl` launch on `windows-2025`; the harness terminal mirror; the request-logging fixture HTTP server that serves a
   server archive; the coverage seed (§6).
2. **Shared libraries** of §3, each its own card, in the order lib-identifiers, lib-log, lib-host, lib-wsl, lib-authority,
   lib-server.
3. **The package skeleton** (brief-wsl-package): manifest, `identifiers.json`, stand-down, proposal probe and setup
   notifications, the browser entry, the log, help and walkthrough.
4. **The connect** (brief-wsl-connect): D6, D6w, D7, D7a, D5h, D5r, D11, `wsl.resolver-front`, `wsl.failure-ui`, F-6103.
5. **Commands and surfaces** (brief-wsl-commands), then **the targets view and the nested route**
   (brief-wsl-targets-and-interop).
6. **The pending specs** when they are reviewed: F-6101 and F-6202 first (presence and the picker are provisional here),
   then F-6501 and F-6502; F-6005 and F-6205's revised lines.

## 5. Tests and hosts

### 5.1 Test kinds

- **unit:** pure parts and recorded fakes (`wsl.exe`, the exec server, the terminal port), on every pull request.
- **manifest:** the built package against `identifiers.json` and the spec's verbatim tables.
- **acceptance-linux:** rows a Linux VSCodium launch can run (the log, help, walkthrough links, stand-down, the browser
  stand-in, the proposal probe, the nested route's Linux SSH container), on every pull request their change reaches.
- **acceptance-win:** rows that need a Windows client with a distro, on `windows-2025`'s WSL2 Ubuntu 24.04 (§5.2).
- **host:** rows no hosted runner can give (WSL 1 until measured, pre-1903 builds, ARM64, a machine with no WSL, a
  Windows SSH host). These are written with their row and wait for a runner (ADR-0013, D-105).

### 5.2 CI: the Windows hosted runner (proteus, plan #1807 amendment 2)

The text proteus posted on #2348 (comment of 2026-11-12) is pasted here unchanged once its two open measurements are in
(a second distro by `wsl --import`, and WSL 1), by 2026-11-13 08:00 CDT. Its findings that bind the cards now:
- `windows-2025` is a 4-vCPU, 16 GB VM with an interactive desktop, WSL 3.0.3 with WSLg, default version 2, and
  VSCodium's win32-x64 build starts in about a second;
- the `platform.yml` windows job installs Ubuntu 24.04 in about 30 s, and its Docker engine brings that to about 85 s;
- the job runs no launch today: the harness spawns the editor CLI without its `.cmd` (#2350, proteus);
- Docker on Windows runs Windows containers only; Linux containers live in the distro;
- no pre-1903 build is obtainable; a machine with no WSL is `windows-2022`.

## 6. Coverage and the cut

- **Coverage:** one tooling card adds the `wsl-r2` scope to `COVERAGE_SCOPES`, writes `coverage-wsl-r2.tsv` with every
  live criterion of the 28 published specs (`todo`), adds the catalogue's acCounts and refreshes `traceability.tsv`.
  Lines that wait on F-6101, F-6202, F-6501, F-6502 or on F-6005's and F-6205's revision are tagged with the spec they
  wait on; `host:` lines carry their host.
- **Cards:** each cluster file ends with its cut. daedalus cuts the cards from them and from the per-line list.
- **Spec questions:** one batch issue on remote-oss/remote-wsl collects the questions the four files raise, each with
  the reading the cards follow meanwhile, so no card waits on an answer.

## 7. Amendments in this PR

- `components.md`: the final component list (D5h, D6w, D7a, D9a, D9b, D12e, `wsl.log`, `wsl.web-entry`), the
  ownership corrections (F-6204's owner is D12; F-6205's formatters are plural; F-6602 has real rows; F-6002's owner is
  `wsl.log`), and D1, D1a, D3's pure core and D4 marked built.
- `contracts.md`: D3, D5 (replaced by D5h), D6's failure-kind table, D7's four rules, D9 (no longer provisional), D11,
  D12 and D12e, where the briefs rule.
- `release-notes.md` (new): the Deviations entries.
- `../../c4-l2-containers.md`: the edge `remote-wsl -> lib-helper`.
