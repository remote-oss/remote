# Task card coverage-11: the client-search rows of F-2101 (batch 2 of #142's acceptance rows)

Issue: #548. Why: #142's acceptance rows, batch 2 (gate risk: every connect starts by finding `ssh`). Thirteen F-2101
ACs say which program the connect checks and runs, for each kind of `remote.SSH.path`. Today unit rows prove the
decisions (`client/locate.ts`) with partial cites. These rows prove it end to end in the VSCodium run, with fake
clients on the editor's side. Builder: iris or hestia (hermes assigns). Size: about 1.5 agent-days. **Depends on
connect-28 (#563)**, which writes the client search's log lines (F-2101 §9) that AC-6 and AC-26 read; the rest needs
only main (tooling-16's launch table, #511's log switch, tooling-24's `notice` surface).

## 1. The fake clients

The run writes them into `<HARNESS_RUN_FOLDER>/clients/` before the first launch, each a POSIX `sh` script, mode 755
unless the table says otherwise. Each one:
- appends one line to `<HARNESS_RUN_FOLDER>/clients/calls.log`: its own name, a tab, then `check` when its first
  argument is `-V`, `options` when any argument is `-G` (the lookup of the host's options, `<program> [-F file] -G --
  <host>`, which runs through the same program since remote-ssh#29), else `connect`;
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

The expected `calls.log` lines of a launch are one `<name> check` line per checked program, in order, then
`<used> options`, then `<used> connect`. No other line is expected: in particular, no line of a program that's neither
checked nor used.

| Label | `remote.SSH.path` | Other settings | Checked (in order) | Used | `cite` |
|---|---|---|---|---|---|
| `client-unset` | (unset) | — | `path/ssh` | `path/ssh` | `F-2101 AC-1` |
| `client-empty` | `""` | — | `path/ssh` | `path/ssh` | `F-2101 AC-12` |
| `client-absolute` | `<run>/clients/configured/ssh` | — | `configured/ssh` | `configured/ssh` | `F-2101 AC-3` |
| `client-space` | `<run>/clients/with space/ssh` | — | `with space/ssh` | `with space/ssh` | `F-2101 AC-4` |
| `client-space-terminal` | the same | `remote.SSH.useLocalServer: false` | `with space/ssh` | `with space/ssh` | `F-2101 AC-4` |
| `client-bare` | `ssh` | — | `path/ssh` | `path/ssh` | `F-2101 AC-5` |
| `client-missing` | `<run>/clients/none/ssh` | — | `path/ssh` | `path/ssh` | `F-2101 AC-6` |
| `client-directory` | `<run>/clients/adir` | — | `path/ssh` | `path/ssh` | `F-2101 AC-7` |
| `client-not-executable` | `<run>/clients/notexec/ssh` | — | `path/ssh` | `path/ssh` | `F-2101 AC-7` |
| `client-not-on-path` | `nosuchclient` | — | `path/ssh` | `path/ssh` | `F-2101 AC-7` |
| `client-tilde` | `~/clients-copy/ssh` (see below) | environment `HOME=<run>/home` | `path/ssh` | `path/ssh` | `F-2101 AC-7` |
| `client-fails` | `<run>/clients/fails/ssh` | — | `fails/ssh`, `path/ssh` | `path/ssh` | `F-2101 AC-8` |
| `client-putty` | `<run>/clients/putty/ssh` | — | `putty/ssh`, `path/ssh` | `path/ssh` | `F-2101 AC-9` |
| `client-lower` | `<run>/clients/lower/ssh` | — | `lower/ssh` | `lower/ssh` | `F-2101 AC-10` |
| `client-stdout` | `<run>/clients/stdout/ssh` | — | `stdout/ssh` | `stdout/ssh` | `F-2101 AC-10` |
| `client-old` | `<run>/clients/old/ssh` | — | `old/ssh` | `old/ssh` | `F-2101 AC-11` |
| `client-windows` | `<run>/clients/windows/ssh` | `remote.SSH.suppressWindowsSshWarning: false` | `windows/ssh` | `windows/ssh` | `F-2101 AC-25` |
| `client-windows-suppressed` | the same | `…: true` | `windows/ssh` | `windows/ssh` | `F-2101 AC-25` |

`client-tilde` (athena on #549): the launch's `environment` sets `HOME=<run>/home` through tooling-16's per-launch
environment, so `~` (from `os.homedir()`) is a folder of the run and nothing is written into the real home. Before the
launch, the run copies `configured/ssh` to `<run>/home/clients-copy/ssh`, mode 755, with its logged name changed to
`tilde/ssh`. No `tilde/ssh` line is expected: AC-7 says the configured `~/...` value isn't used even when its expansion
exists. The other `HOME` change is harmless: the run's `ssh_config` already names the configuration file (`-F`), the
known-hosts file and the identity file, so `ssh` reads nothing from `HOME`.

The connections are to the harness host, so every connected launch runs real `ssh` with the run's `ssh_config`.

The table adds 18 launches to the VSCodium run, roughly 6 to 8 minutes. proteus decides whether they run in every
VSCodium run or in a dispatch of their own (`-f client-search=true`). Say which in the README.

## 3. The rows (`suite-client/client.test.ts`, run in each launch)

Each row's name starts with `` `${cite} (${label})` ``, for example `F-2101 AC-4 (client-space-terminal)`, the form
ruled on #546.

| Name | Assertion |
|---|---|
| `` `${cite} (${label}): the window connected` `` | `vscode.env.remoteName` is `ssh-remote` |
| `` `${cite} (${label}): the programs checked and run are the table's` `` | the launch's `calls.log` lines (the run clears the file between launches) equal the table's |
| `` `${cite} (${label}): no notification or dialog of the client search` `` | the record holds no `failureDialog` line and no `notice` line (tooling-24, merged) |
| `F-2101 AC-26 (client-fails): the log gives the setting, the rejection, the search path, the program checked, its banner and the program used, in order` | `connectionLog()` holds connect-28 §1's lines 1, 2, 3, 4 (`exit status 1`), 5, 6, 2, 3, 7, in that order. They name `<run>/clients/fails/ssh`, the launch's `PATH` folders, `ssh`, and the banner `OpenSSH_9.6p1` as the fake prints it. Build the expected lines with connect-28's builders from `log-content.ts`, not from copied text |
| `F-2101 AC-6 (client-missing): the log says the configured path is not a valid SSH binary` | connect-28 §1's line 5 for `<run>/clients/none/ssh`, from its builder |

Tag F-2101 AC-1, 3–12, 25 and 26 `acceptance` in `coverage-slice1.tsv`. AC-2 is unit (tagged by #481). AC-3 as
answered on remote-oss/remote-ssh#94: the configured program is the only client run, three times in order (the check,
F-2202's `-G` lookup, the connection), which is `client-absolute`'s expected `check`, `options`, `connect`.

## 4. Done when

- `pnpm test:acceptance:vscodium` passes with the new launches; paste the `suite-client` summaries;
- the tools rows for the fake clients' files (names, modes, banners) and the launch table pass, and the repository's
  gates pass.

If a row fails because the extension does something else, don't change the expectation: report it on the issue, as a
bug or a spec question.

## 5. Review

PR title `tests: the client-search rows of F-2101 (card coverage-11, #142)`. themis or triton; proteus for the run's new
files and the launch's own `HOME`.
