# Task card coverage-16: F-2102's ControlMaster rows (batch 7c of #142's acceptance rows)

Issue: #576. Why: #142's acceptance rows, batch 7c. F-2102 6.8 (`remote-oss/remote-ssh#20`) says how the shared local
connection server lives beside an OpenSSH ControlMaster that the user's host block asks for. Builder: iris or hestia
(hermes assigns). Size: about 1 agent-day. **Depends on** tooling-25 (#566), tooling-26 (#573) and coverage-14 (#568),
for the Kill pick, `appendScript` and the windows helpers.

## 1. The aliases (`tools/acceptance.ts`, `harnessSshConfig`)

Each alias is the password account (`harness-pw`, `PASSWORD_LINES`) with its own control socket in the run's folder:

| Alias | `ControlMaster` | `ControlPath` | `ControlPersist` |
|---|---|---|---|
| `master` | `auto` | `<run>/cm-%C` | `600` (today `60`; AC-24 names 600) |
| `master-ask` | `ask` | `<run>/cm-ask-%C` | `600` |
| `master-yes` (new) | `yes` | `<run>/cm-yes-%C` | `600` |
| `master-autoask` (new) | `autoask` | `<run>/cm-autoask-%C` | `600` |

`server/host-accounts.test.ts`'s rows for the aliases keep passing. Add one row per new alias: its socket appears after a
login.

**Helpers** (`windows/harness.ts`):
- `masterCheck(alias)`: whether `ssh -F <run>/ssh_config -O check <alias>` exits 0;
- `masterProcess(alias)`: the id of the client's `ssh` process whose command line holds that alias's control socket
  folder and `[mux]` (`pgrep -f`), or nothing;
- `masterExit(alias)`: `ssh -F <run>/ssh_config -O exit <alias>`;
- `batchLogin(alias)`: whether `ssh -F <run>/ssh_config -o BatchMode=yes <alias> true` exits 0.

## 2. The rows (`tests/acceptance/windows/controlmaster.test.ts`, windows `m1`–`m3`)

Each row starts with `F-2102 AC-<n>:`. (pw) is as coverage-15 §1, with no `after`. Before the file, and after it:
`masterExit` for each alias, close every `m*` window, wait for no connection helper, and set `remote.SSH.useLocalServer`
to `true`.

| # | Script and steps | Assertions | AC |
|---|---|---|---|
| 1 | `m1`: (pw). Open `m1` on `master` | `m1` connected; `masterCheck('master')`; `batchLogin('master')` | AC-24 |
| 2 | `m1`: `hostPick` → `{label: 'master'}`. Note `masterProcess('master')`; in `m1`, Kill | the helper is replaced (gone within 2 s, a new one within 5 s); `masterProcess('master')` is the same id; `m1` connected within 5 s; no `maskedInput` line of `m1` after the Kill | AC-25 |
| 3 | reload `m1` | `m1` connected; no new `maskedInput` line | AC-25 (reload) |
| 4 | `userSettings({'remote.SSH.useLocalServer': false})`; reload `m1` | `m1` connected; no new `maskedInput` line; no helper runs | AC-26 |
| 5 | `m1`: (pw). `masterExit('master')` | within 30 s `m1` is connected again; exactly one new `maskedInput` line of `m1`; `masterCheck('master')` (a new socket) | AC-30 |
| 6 | clean (as above). `m2`: (pw), then `{surface: 'maskedInput', match: 'Allow shared connection', answer: {text: 'yes'}}`. Open `m2` on `master-ask` | `m2` connected; `m2`'s second `maskedInput` line's question contains `Allow shared connection to`. If the prompt comes as a `pick` instead, the row fails: report it on the issue, since the AC says an input | AC-39 |
| 7 | clean. `m3`: (pw), then `hostPick` → `{label: 'master-yes'}`, then (pw). Open `m3` on `master-yes`; in `m3`, Kill; reload `m3` | after the reload `m3` asked for the password again: one more `maskedInput` line; `m3` connected | AC-40 (`yes`) |
| 8 | clean. `m3`: (pw), `{surface: 'maskedInput', match: 'Allow shared connection', answer: {text: 'yes'}}`, then `hostPick` → `{label: 'master-autoask'}`. Open `m3` on `master-autoask`; in `m3`, Kill; reload `m3` | after the reload `m3` is connected with no new `maskedInput` line | AC-40 (`autoask`) |

In row 8 the first connect may or may not ask "Allow shared connection" (OpenSSH asks only when a master is in use). If
it doesn't, the entry stays unused, which is allowed. Assert only the line counts after the Kill.

## 3. The catalogue

F-2102 AC-24, 25, 26, 30, 39 and 40 go to `acceptance`.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass. Report a row
that fails on the issue; don't change the row.

## 5. Review

PR title `tests: F-2102's ControlMaster rows (card coverage-16, #142)`. themis or triton reviews; athena gives the tag check.
