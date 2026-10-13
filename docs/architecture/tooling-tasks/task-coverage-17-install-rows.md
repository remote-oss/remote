# Task card coverage-17: the server install rows of F-2403 and F-3902 (batch 6b of #142's acceptance rows)

Issue: #581. Why: #142's acceptance rows, batch 6b. These rows prove end to end in the VSCodium run how the server
reaches the host:
- F-2403 (`remote-oss/remote-ssh#48`): the download, the install, their stages and their failures;
- F-3902 (`#79`): where the archive comes from.

The source is tooling-27's download host. Builder: hestia or iris (hermes assigns). Size: about 2.5 agent-days.
**Depends on:**
- tooling-27 (#578): the download host, its harness variables and `downloadRequests()`;
- coverage-13 (#556): a launch's `hostSetup` and the per-case launch pattern (`PortsCase`). Generalise `PortsCase` into
  `HostCase`, with `suite` and `label` prefix as fields, so the ports and install cases share one mechanism.

## 1. The cases

`tests/acceptance/suite-install/cases.json`, one launch per case, in this order, after coverage-13's ports cases.
- **Every case is a fresh resolve** (coverage-13 §1.4).
- **Host setup:** unless the case says `keep`, each case's setup kills the server, as coverage-13 does, and runs `rm -rf
  /home/harness/.vscodium-server-insiders /tmp/srv`, so the host has no server and no data folder.
- **Script:** a dialog case answers `failureDialog` and `mitigationPick` with `dismiss`, as `suite-failure` does.

`T(b)` is `${HARNESS_DOWNLOADS_HTTP}/<b>/${os}-${arch}/${commit}`. `T(b, local)` uses `${HARNESS_DOWNLOADS_LOCAL}`, and
`T(b, https)` uses `${HARNESS_DOWNLOADS_HTTPS}`. All three are tooling-27's bases. "S043 dialog" is `Could not establish
connection to "harness": Downloading VS Code Server failed. Please try again later.`. "S075 dialog" is `…: Failed to
install the VS Code Server.`. Setting names are `remote.SSH.<name>`.

| Label | Settings | Setup | Expected | AC |
|---|---|---|---|---|
| `install-fresh` | `serverDownloadUrlTemplate: T(ok)` | — | connected. `progress` lines `Downloading VS Code Server`, then `Installing VS Code Server`, in that order. The host has `bin/<commit>/`. `downloadRequests()` has exactly one request, for `/ok/…` | F-2403 AC-1, AC-2, AC-5; F-3902 AC-3 |
| `install-present` | the same | `keep` | connected; neither stage line; no new request | F-2403 AC-7 (running) |
| `install-present-stopped` | the same | `keep` the files, but stop the server (coverage-13's kill command, without the `rm`) | connected; neither stage line; no new request | F-2403 AC-7 (not running) |
| `install-fresh-legacy` | `T(ok)`, `useExecServer: false` | — | connected; the two stages in order; no `downloadProgress` line | F-2403 AC-6 |
| `download-unreachable` | `serverDownloadUrlTemplate: http://downloads:1/x/${commit}` (a closed port), `localServerDownload: off` | — | S043 dialog; no record line holds `Failed to download VS Code Server` | F-2403 AC-9, AC-26 (BusyBox `wget` connection error); F-3902 AC-7 (`off`) |
| `download-404` | `T(missing)`, `localServerDownload: off` | — | S043 dialog. No record line holds `404` | F-2403 AC-10 |
| `download-503` | `T(busy)`, `localServerDownload: off` | — | S043 dialog. No record line holds `503` | F-2403 AC-10 |
| `download-local` | `serverDownloadUrlTemplate: T(ok, local)`, `localServerDownload: auto` | — | connected. A `progress` line `Downloading VS Code Server locally`, and no S043 or S075 line. The host has `bin/<commit>/`. No file the size of the archive is left in the client's temporary folder or under `<run>/user-data` (searched before and after the case) | F-2403 AC-11; F-3902 AC-7 (`auto`) |
| `download-junk` | `T(junk)`, `localServerDownload: off` | — | S075 dialog, not S043 | F-2403 AC-13 |
| `download-cut` | `T(cut)`, `localServerDownload: off` | — | S043 dialog; no record line holds `Failed to download VS Code Server` | F-2403 AC-26 (cut) |
| `download-untrusted` | `T(ok, https)`, `localServerDownload: off` | — | S043 dialog, as for `download-cut` | F-2403 AC-26 (TLS) |
| `wgetrc-proxy` | `T(ok)`, `useCurlAndWgetConfigurationFiles: true` | write `/home/harness/.wgetrc` with `use_proxy = on` and `http_proxy = http://10.255.255.1:3128/` (owner `harness`) | connected (BusyBox `wget` reads no configuration file). Setup of the next case removes the file | F-2403 AC-17 |
| `install-broken` | `T(junk)`, `localServerDownload: off` | — | S075 dialog; the install folder holds something (`ls` of `bin/` isn't empty, or a staging file is left) | — (setup of AC-22) |
| `install-repaired` | `T(ok)` | `keep` | connected; `bin/<commit>/` complete | F-2403 AC-22 |
| `licence-update-service` | `serverDownloadUrlTemplate: https://update.code.visualstudio.com:<HTTPS port>/ok/${os}-${arch}/${commit}`; script: `licenceModal` → `decline` | — | a `licenceModal` line whose `detail` holds `https://aka.ms/vscode-server-license`; no request reached the download host | F-3902 AC-14 |
| `template-placeholder` | `serverDownloadUrlTemplate: ${HARNESS_DOWNLOADS_HTTP}/ok/${platform}` | — | a `failureDialog` line naming `remote.SSH.serverDownloadUrlTemplate` and `${platform}`; no request; no `/home/harness/.vscodium-server-insiders` | F-3902 AC-5 |
| `install-path` | `T(ok)`, `serverInstallPath: {"harness": "/tmp/srv"}` | — | connected; `/tmp/srv/.vscodium-server-insiders/bin/<commit>/` exists | F-3902 AC-18 |

**The licence modal's detail.** For F-3902 AC-14, a `licenceModal` record line gains `detail`, the dialog's detail text
as passed (`scripted-adapters.ts`, with its unit row; `RecordLine` in `suite-local/script.ts` mirrors it).

**F-3902 AC-6** is shown by the run's first launch, not by a case. In `suite-remote/remote-window.test.ts`, the row
`F-3902 AC-6: the host has bin/<commit> and no CLI, and the log says once that the CLI was not used` asserts:
- the host has `bin/<commit>/` and no `cli/` folder;
- `connectionLog()` has exactly one line `the CLI path was not used: the editor names no CLI source`. Today
  `server-steps.ts` logs it from the module-private `CLI_NOT_USED_REASONS`. Export a builder for the line,
  `cliNotUsedLine(reason)`, so that the row builds the expected text from it and doesn't copy it.

That launch connects with exec server on by default and with no CLI source, since cli-05's archive is opt-in.

## 2. The rows (`suite-install/install.test.ts`, run in each launch)

`cite` is the case's AC column and its label, for example `F-2403 AC-10 (download-404)`.

| Name | Assertion |
|---|---|
| `` `${cite}: the connect ended as the case says` `` | connected, or the `failureDialog` line's question |
| `` `${cite}: the stages are the case's` `` (cases that name them) | the `progress` lines, in order |
| `` `${cite}: the host holds what the case says` `` | `onHost('test', '-d', …)` |
| `` `${cite}: the download host saw the case's requests` `` | `downloadRequests()` since the case began |
| `` `F-2403 AC-21 (${label}): no text of the list appears` `` (every dialog case) | none of STR:S040, S054, S055, S061, S080, S124, S154 (their texts from F-2403's string table, `remote-oss/remote-ssh#48` §2) is in the dialog's question, in the `mitigationPick` line's `items` (connect-26 adds `items`), or in any `notice` line of the launch (AC-21 includes the notification centre) |

## 3. The catalogue

F-2403 AC-1, 2, 5, 6, 7, 9, 10, 11, 13, 17, 21, 22 and 26, and F-3902 AC-3, 5, 6, 7, 14 and 18, go to `acceptance`.
Core halves for #142: the indicator of F-2403 AC-5, and the dialog's buttons, which F-2601 AC-2 proves.

They stay `todo`, each listed with what it waits for:

| AC | Waits for |
|---|---|
| F-2403 AC-3, 4, 8, 19, 25, 27; F-3902 AC-19–23 | the CLI path (dormant in 0.2) |
| F-2403 AC-12 | a host with too little space |
| F-2403 AC-14 | tooling-20's Retry |
| F-2403 AC-15, 16 | GNU wget or curl on the host in the VSCodium run (host variants) |
| F-2403 AC-23 | per-launch host variants |
| F-2403 AC-24 | a 10-minute wait the run can't spend; asked as a dispatch-only row |
| F-3902 AC-16 | an earlier release's archive on the download host |
| F-3902 AC-24 | the licence dialog's detail rows of AC-12's setup in genuine VS Code |

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the 17 new launches; paste the `suite-install` summaries. The repository's
gates pass. Report a row that fails on the issue; don't change the row.

## 5. Review

PR title `tests: the server install rows of F-2403 and F-3902 (card coverage-17, #142)`. themis or triton reviews;
proteus checks the 17 launches' time; athena gives the tag check.
