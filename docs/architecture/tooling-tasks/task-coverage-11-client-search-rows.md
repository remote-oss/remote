# Task card coverage-11: the client-search rows of F-2101 (batch 2 of #142's acceptance rows)

Issue: #548. Why: #142's acceptance rows, batch 2 (gate risk: every connect starts by finding `ssh`). Thirteen F-2101
ACs say which program the connect checks and runs, for each kind of `remote.SSH.path`. Today unit rows prove the
decisions (`client/locate.ts`) with partial cites. These rows prove it end to end in the VSCodium run, with fake
clients on the editor's side. Builder: iris or hestia (hermes assigns). Size: about 1.5 agent-days. **Depends on
nothing beyond main** (tooling-16's launch table, #511's log switch).

## 1. The fake clients

The run writes them into `<HARNESS_RUN_FOLDER>/clients/` before the first launch, each a POSIX `sh` script, mode 755
unless the table says otherwise. Each one:
- appends one line to `<HARNESS_RUN_FOLDER>/clients/calls.log`: its own name, a tab, then `check` when its first
  argument is `-V`, else `connect`;
- for `-V`: prints its banner to the stream the table names, then exits with the table's status;
- otherwise: `exec /usr/bin/ssh "$@"`, the real client, so the connection works.

| Name (path under `clients/`) | Banner (stream) | `-V` status | Other |
|---|---|---|---|
| `path/ssh` | `OpenSSH_9.6p1, OpenSSL 3.0.13` (stderr) | 0 | put first on `PATH` by the launches that search it |
| `configured/ssh` | `OpenSSH_9.6p1, OpenSSL 3.0.13` (stderr) | 0 | — |
| `with space/ssh` | the same | 0 | a folder name with a space |
| `fails/ssh` | `OpenSSH_9.6p1` (stderr) | 1 | — |
| `putty/ssh` | `PuTTY Release 0.81` (stdout) | 0 | — |
| `lower/ssh` | `openssh_9.0p1 lowercase fake` (stderr) | 0 | — |
| `stdout/ssh` | `OpenSSH_9.0p1, fake on stdout` (stdout only) | 0 | — |
| `old/ssh` | `OpenSSH_6.5p1, OpenSSL 1.0.1 14 Mar 2012` (stderr) | 0 | — |
| `windows/ssh` | `OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2` (stderr) | 0 | — |
| `notexec/ssh` | as `configured` | — | mode 644 |
| `adir/` | — | — | a directory |

## 2. The launches

One launch per row below: `runner-remote`, folder `vscode-remote://ssh-remote+harness/home/harness`, suite
`suite-client` (new). `environment.PATH` is `<run>/clients/path:<the run's PATH>` and `environment.HARNESS_CLIENT_CASE`
is the label. The launch writes its `remote.SSH.path` through tooling-16's `settings`.

**Every launch is a fresh resolve:** before it starts, no connection helper of the run may be running for `harness`. A
live helper is reused without any check (F-2101 AC-14), which would hide the row. The run waits for the helper's
grace (`HELPER_GRACE_MILLISECONDS`) to pass after the previous launch, or ends the run's helpers through their
registry. The builder picks one and says which in the README.

| Label | `remote.SSH.path` | Other settings | Expected `calls.log` lines of the launch | AC |
|---|---|---|---|---|
| `client-unset` | (unset) | — | `path/ssh check`, then `path/ssh connect` | F-2101 AC-1 |
| `client-empty` | `""` | — | the same | F-2101 AC-12 |
| `client-absolute` | `<run>/clients/configured/ssh` | — | `configured/ssh check`, `configured/ssh connect`, and no `path/ssh` line | F-2101 AC-3 |
| `client-space` | `<run>/clients/with space/ssh` | — | `with space/ssh check`, `with space/ssh connect` | F-2101 AC-4 (local server on) |
| `client-space-terminal` | the same | `remote.SSH.useLocalServer: false` | the connection lines come from `with space/ssh` | F-2101 AC-4 (off) |
| `client-bare` | `ssh` | — | `path/ssh check`, `path/ssh connect` | F-2101 AC-5 |
| `client-missing` | `<run>/clients/none/ssh` | — | `path/ssh check`, `path/ssh connect` | F-2101 AC-6 |
| `client-directory` | `<run>/clients/adir` | — | the same | F-2101 AC-7 |
| `client-not-executable` | `<run>/clients/notexec/ssh` | — | the same | F-2101 AC-7 |
| `client-not-on-path` | `nosuchclient` | — | the same | F-2101 AC-7 |
| `client-tilde` | `~/clients-copy/ssh` (the run puts a working copy there in the editor user's home) | — | the same | F-2101 AC-7 |
| `client-fails` | `<run>/clients/fails/ssh` | — | `fails/ssh check`, `path/ssh check`, `path/ssh connect` | F-2101 AC-8 |
| `client-putty` | `<run>/clients/putty/ssh` | — | `putty/ssh check`, `path/ssh check`, `path/ssh connect` | F-2101 AC-9 |
| `client-lower` | `<run>/clients/lower/ssh` | — | `lower/ssh check`, `lower/ssh connect` | F-2101 AC-10 |
| `client-stdout` | `<run>/clients/stdout/ssh` | — | `stdout/ssh check`, `stdout/ssh connect` | F-2101 AC-10 |
| `client-old` | `<run>/clients/old/ssh` | — | `old/ssh check`, `old/ssh connect` | F-2101 AC-11 |
| `client-windows` | `<run>/clients/windows/ssh` | `remote.SSH.suppressWindowsSshWarning: false` | `windows/ssh check`, `windows/ssh connect` | F-2101 AC-25 |
| `client-windows-suppressed` | the same | `…: true` | the same | F-2101 AC-25 |

`client-tilde` writes into the editor user's real home folder: the run removes `~/clients-copy` at its end, whatever
happens. The connections are to the harness host, so every connected launch runs real `ssh` with the run's
`ssh_config`.

The table adds 18 launches to the VSCodium run, roughly 6 to 8 minutes. proteus decides whether they run in every
VSCodium run or in a dispatch of their own (`-f client-search=true`). Say which in the README.

## 3. The rows (`suite-client/client.test.ts`, run in each launch)

| Name | Assertion |
|---|---|
| `` `${cite}: the window connected` `` | `vscode.env.remoteName` is `ssh-remote` |
| `` `${cite}: the programs checked and run are the table's` `` | the launch's `calls.log` lines (the run clears the file between launches) equal the table's |
| `` `${cite}: no notification or dialog of the client search` `` | the record holds no `failureDialog` line. A notice row waits for tooling-24's `notice` surface; until it lands, list it as open in the PR |
| `F-2101 AC-26: the log names the setting, the program checked, its banner and the program run` (in `client-fails` only) | `connectionLog()` has lines that contain the configured path, the reason it was rejected, `PATH`, `path/ssh`, the banner `OpenSSH_9.6p1` and the program the connection runs. Match the extension's own log texts, read from `client/locate.ts` and `locate-step.ts` |
| `F-2101 AC-6: the log says the configured path is not a valid SSH binary` (in `client-missing` only) | a log line says so, in the extension's own words for the rejection |

Tag F-2101 AC-1, 3–12, 25 and 26 `acceptance` in `coverage-slice1.tsv`. AC-2 is unit (tagged by #481).

## 4. Done when

- `pnpm test:acceptance:vscodium` passes with the new launches; paste the `suite-client` summaries;
- the tools rows for the fake clients' files (names, modes, banners) and the launch table pass, and the repository's
  gates pass.

If a row fails because the extension does something else, don't change the expectation: report it on the issue, as a
bug or a spec question.

## 5. Review

PR title `tests: the client-search rows of F-2101 (card coverage-11, #142)`. themis or triton; proteus for the run's new
files and the home-folder copy.
