# Task card coverage-20: the configuration-file rows of F-2201 (batch 4 of #142's acceptance rows)

Issue: #592. Why: #142's acceptance rows, batch 4. F-2201 (`remote-oss/remote-ssh#28`) decides which SSH configuration
files are read: the default ones under `HOME`, or `remote.SSH.configFile`. It covers what each form of the setting does
when the hosts are listed and when a window connects. These rows prove it in a plain editor whose `HOME` is a folder of
the run. That governs our extension's reads, not `ssh`'s: OpenSSH takes `~` and its default files from the password
database (athena on #549, #591). So the card promises, and proves, that the developer's own `~/.ssh` is never
**written**. Builder: iris or hestia (hermes assigns). Size: about
2 agent-days. **Depends on:**
- tooling-25 (#566): `hostPick` and `filePick`;
- tooling-26 (#573): `appendScript`;
- tooling-28 (#583);
- coverage-14 (#568): `userSettings`;
- connect-29 (#571).

## 1. The launch

A second plain launch in `acceptance-launches.ts`: `{label: 'config-files', kind: 'plain', suite: 'config-files',
environment: {HOME: '<run>/home', SSH_AUTH_SOCK: ''}}`. An empty `SSH_AUTH_SOCK` keeps the developer's agent
out. Its Node mocha run reads `tests/acceptance/config-files/*.test.ts`, with
`windows/harness.ts`'s helpers. `<run>/home` is made empty before the launch. `H` below is `<run>/home`.

The run's base settings set `remote.SSH.configFile`. Each row sets the setting it needs with `userSettings` (absent
means the key removed). `cfghost` is a block written by the rows:
- `Host cfghost`;
- `HostName 127.0.0.1`, `Port <P>`, `User harness`;
- the harness `IdentityFile` lines, `IdentitiesOnly yes`, `BatchMode yes`, `StrictHostKeyChecking accept-new`;
- `UserKnownHostsFile <run>/known_hosts`.

`system()` is the list of the client's `/etc/ssh/ssh_config` `Host` words without `*`, `?` or `!`, in order. It may be
empty; the test doesn't change that file.

**`sshArguments()`** (`windows/harness.ts`): the argv of each `ssh` process whose parent is one of the run's connection
helpers, from `/proc/<pid>/cmdline`, as lists of strings, noted while a connect runs. The argv holds no secret, by the
register rule. "-F <file>" below means the argv has `-F` followed by that file.

**`Host onlydefault`** (the `cfghost` block's lines under that name) is written to `H/.ssh/config` before the rows. Its
absence from a pick's `items` shows that our listing skipped the default files.

**A root run fails loudly:** the mode-000 rows first assert `process.getuid() !== 0`, since root reads mode 000.

A failing window's script is `failureDialog` → `dismiss`, then `mitigationPick` → `dismiss`. "Fixed rows" are
`$(plus) Add New SSH Host...` and `Configure SSH Hosts...`. A pick row means `hostPick` → `dismiss` in `local` after
running `opensshremotes.openEmptyWindow`, and reading the line's `items`.

## 2. The rows (`config-files/config-files.test.ts`)

| Cite | Files and setting | Steps | Assertions |
|---|---|---|---|
| F-2201 AC-3 | setting absent; no `H/.ssh/config` | pick | `items` = `system()` + fixed rows; no `notice` line |
| F-2201 AC-42 | setting absent; `H/.ssh/config` a folder, then a file with mode 000 | pick, twice | each: `system()` + fixed rows; no `notice` line |
| F-2201 AC-5 | setting absent | `filePick` → `dismiss`; run `opensshremotes.openConfigFile` | question `Select SSH configuration file to update`; `items` start with `H/.ssh/config` (absolute, though missing) and `/etc/ssh/ssh_config`, then `Settings` and `Help` |
| F-2201 AC-9 | setting `<run>/cfg-a` (holding `cfghost`) | the same | question `Edit custom SSH configuration file`; `items` = `<run>/cfg-a`, `Settings`, `Help` |
| F-2201 AC-43 | setting `"   "` | the same | question `Edit custom SSH configuration file` |
| F-2201 AC-12 | `H/cfg-b` holding `cfghost`; setting `~/cfg-b` | pick; then `openWindow('cfghost', 'c1')` | `items` = `cfghost` + fixed rows; `c1` connected |
| F-2201 AC-40 | the same | `filePick` → `{label: '~/cfg-b'}`; run `openConfigFile` | the `filePick` row reads `~/cfg-b`. Afterwards no file or folder named `~` exists under `H`, in the run's folder or in the editor's working folder |
| F-2201 AC-13 | (`onlydefault` must not appear) setting, one at a time: `cfg-b` (relative; `H/cfg-b` exists), `~`, `${env:HOME}/cfg-b`, `$HOME/cfg-b`, `"   "`, `<run>/missing`, `<run>` (a folder), `<run>/cfg-000` (mode 000, holding `cfghost`) | pick, per value | `items` = fixed rows only; no `notice` line |
| F-2201 AC-28, AC-35 (missing) | setting `<run>/missing` | `openWindow('cfghost', 'c2')` | dialog `Could not establish connection to "cfghost".`; `sshArguments()` during the connect has `-F <run>/missing` |
| F-2201 AC-35 (relative, `$HOME`, `${env:HOME}`) | setting `cfg-b`, then `$HOME/cfg-b`, then `${env:HOME}/cfg-b` | `openWindow('cfghost', …)` per value | dialog `Could not establish connection to "cfghost".`; `connectionLog()` names the setting and its value, and has no `Checking ssh client:` line for that connect (ssh not started; remote-ssh#30 Q1, connect-28) |
| F-2201 AC-35 (folder, `~`) | setting `<run>`, then `~` | the same | dialog `Could not establish connection to "cfghost": Could not resolve hostname.` |
| F-2201 AC-35 (mode 000) | setting `<run>/cfg-000` | the same | dialog `Could not establish connection to "cfghost": Permission denied.` |
| F-2201 AC-44 | setting `<run>/cfg-a` | `openWindow('onlydefault', 'c3')` | dialog `Could not establish connection to "onlydefault": Could not resolve hostname.`; `sshArguments()` has `-F <run>/cfg-a` |
| F-2201 AC-31 | setting absent | pick; then `openWindow('onlydefault', 'c10')` | `items` include `onlydefault` (our listing read `H/.ssh/config`); `sshArguments()` during the connect has no `-F`; the connect fails, since `ssh` reads the account's own files, where `onlydefault` isn't |
| F-2201 AC-10 | setting `<run>/cfg-a` (`cfghost` only there) | `openWindow('cfghost', 'c11')` | connected; `connectionLog()` holds connect-32's `configFileLine('<run>/cfg-a')` (#593) |
| F-2201 AC-18 | setting `<run>/cfg-c`: `cfghost` with `IgnoreUnknown Foo` and `Foo bar` | pick; `openWindow('cfghost', 'c4')` | `items` include `cfghost`; `c4` connected |
| F-2201 AC-26 | setting `<run>/cfg-d`: `cfghost` plus `Bogus yes` (no `IgnoreUnknown`) | `openWindow('cfghost', 'c5')` | dialog `Could not establish connection to "cfghost".`; `connectionLog()` has a line naming `<run>/cfg-d` and a line number |
| F-2201 AC-34 | setting `<run>/cfg-e`: a top-level `Include <run>/cfg-d`, then `cfghost` | `openWindow('cfghost', 'c6')` | the same dialog; `connectionLog()` names `<run>/cfg-d` |
| F-2201 AC-41 | setting `<run>/cfg-f` (mode 0666) holding `cfghost` | `openWindow('cfghost', 'c7')` | connected |
| F-2201 AC-38 | setting, one at a time: `<run>/cfg-loop` (A includes B, B includes A, each with one host), `<run>/cfg-crlf` (`cfghost` with CRLF line ends), `<run>/cfg-bom` (`cfghost` after a UTF-8 BOM), `<run>/cfg-bin` (8 binary bytes, then `cfghost`) | pick, per file; then `openWindow('cfghost', …)` for the CRLF file | loop: each host once; CRLF and BOM: `cfghost`; binary: fixed rows only; no `notice` line; the CRLF window connected |
| F-2201 AC-36 | setting `<run>/cfg-a` | `openWindow('cfghost', 'c8')` (connected; helper started); rewrite `cfg-a` with `HostName 192.0.2.1` for `cfghost`; `openWindow('cfghost', 'c9')` | `c9` connected (the running helper kept its configuration); one connection helper |
| F-2201 AC-29 | — | before the first row and after the last, snapshot `H` and every `*.json` settings file under `<run>/user-data/User`, except the files the rows wrote. Also snapshot the account's real `~/.ssh` (from `os.userInfo().homedir`): its entries' names, sizes and mtimes, never their contents | the snapshots are equal, apart from the rows' own writes; the real `~/.ssh` snapshot is equal |

Close every window a row opened before the next row, and wait for no connection helper.

## 3. The catalogue

F-2201 AC-3, 5, 9, 10, 12, 13, 18, 26, 28, 29, 31, 34, 35, 36, 38, 40, 41, 42, 43 and 44 go to `acceptance`. AC-10's
row needs connect-32 (#593). AC-5's "Settings" and "Help" descriptions rest on `buildFileChoice`'s unit rows; name them
in the PR.

These stay `todo`, each listed with what it waits for:
- AC-1: a client system file with hosts, which the run doesn't own;
- AC-15, 16 and 39: connect-22;
- AC-19 and 33: connect-23;
- AC-27: a trust-enabled launch.

AC-6, 7 and 32 are core's Settings editor, browser and menus.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new launch; paste its summary. The repository's gates pass.

## 5. Review

PR title `tests: the configuration-file rows of F-2201 (card coverage-20, #142)`. themis or triton reviews; proteus checks
the launch's own `HOME`; athena gives the tag check.
