# Task card coverage-15: F-2102's shared-login rows on a password host (batch 7b of #142's acceptance rows)

Issue: #574. Why: #142's acceptance rows, batch 7b. With `remote.SSH.useLocalServer` on, one login serves every
window of a host. While one window (the owner) waits at a question, a second window waits ("Waiting for other windows to
connect", S157) and shows a mirror of the question, and one answer serves both (F-2102 5.2, 6.2, 7.E1–7.E10,
`remote-oss/remote-ssh#20`). These rows prove it in the windows suite on the password host. Builder: iris or hestia
(hermes assigns). Size: about 2.5 agent-days. **Depends on:**
- tooling-25 (#566): the Kill host pick;
- tooling-26 (#573): held answers, `appendScript`, `signal`, `acceptedPasswords`, the `password-ask` alias;
- coverage-14 (#568): the file layout, `connectionHelpers`, `kill`, `userSettings`.

## 1. The file and its rules

A new file `tests/acceptance/windows/shared-login.test.ts`, in the `windows` launch, with its own window names `p1`–`p3`.
`pw` is the run's password, read from `HARNESS_PASSWORD_FILE`.

**Each scenario starts clean:**
- every `p*` window closed;
- no connection helper running;
- `remote.SSH.useLocalServer` true;
- the `acceptedPasswords()` count noted.

Windows open **one after the other**, each waiting for its held line before the next opens. That makes the first
window the owner. Where a Kill makes the owner unknown, the test reads it at run time: the owner is the window whose new
held line has no `progress` line with `Waiting for other windows to connect` of its own after the Kill.

**Answers are held** (tooling-26). Unless the row says otherwise, every question entry carries `after`:
- a signal the test gives at the step;
- or `never`, for an answer the row expects to be withdrawn.

`(pw)` below is `{surface: 'maskedInput', match: 'password', answer: {text: pw}}`. `(key yes)` is `{surface: 'pick',
match: 'fingerprint', answer: 'yes'}`.

**Terms:**
- "connected" is as coverage-14 §2;
- "S157 in w" means a `progress` line of window `w` whose message is `Waiting for other windows to connect`, with
  `details: false`;
- "Initializing in w" means a `progress` line of `w` with `Initializing VS Code Server` and `details: true`.

## 2. The scenarios

Each row's name starts with `F-2102 AC-<n>:`.

| # | Script and steps | Assertions | AC |
|---|---|---|---|
| A | `p1`: (pw) after `never`. `p2`: (pw) after `a-go`. Open `p1`; wait for its held line. Open `p2`; wait for its held line | `p2`'s progress title is `Setting up SSH Host password` and S157 in `p2`, with no `details`; `p2`'s held line is a `maskedInput` whose question equals `p1`'s | AC-9 |
| A' | signal `a-go` | `p1` and `p2` connected within 30 s; `p1`'s entry `withdrawn`; `acceptedPasswords()` grew by 1; no later held line in either window | AC-10 |
| B | reload `p1` | `p1` connected; no new held or `maskedInput` line of `p1` | AC-12 |
| C | open `p3` on `password` | `p3` connected; no held or `maskedInput` line of `p3` | AC-13 |
| D | `p1`, `p2`: (pw) after `never`. `p3`: `hostPick` → `{label: 'password'}` twice, then (pw) after `d-go`. In `p3`, Kill; wait until each of `p1`–`p3` has a new held line | exactly one window has no S157 after the Kill (the owner); the other two have S157 | AC-8 (one question, one owner) |
| D' | in `p3`, Kill again | no `notice` or `failureDialog` line of any window; no `withdrawn` line within 3 s | AC-35 |
| D'' | signal `d-go` | all three connected within 30 s; `acceptedPasswords()` grew by 1 since D | AC-8, AC-35 |
| E | clean. `p1`: (pw) after `never`. `p2`: (pw, but `answer: 'dismiss'`) after `e-esc`, then (pw) after `e-go`. Open `p1`, wait; open `p2`, wait; signal `e-esc` | within 2 s of `p2`'s `dismiss` line, a new held line of `p2` with the same question; `p1`'s held line has no `withdrawn` line | AC-27 |
| E' | signal `e-go` | `p1` and `p2` connected | AC-27 |
| F | clean. `p1`: (pw) after `f-go`. `p2`: (pw) after `never`. Open `p1`, wait; open `p2`, wait; close `p2`; signal `f-go` | `p1`'s held line wasn't withdrawn before the signal; `p1` connected | AC-36 |
| G | clean. `p1`: (pw) after `never`. `p2`: (pw) after `never`, then (pw) after `g-go`. Open `p1`, wait; open `p2`, wait; close `p1` | within 10 s of the close: `p2`'s first entry `withdrawn`, a new held line of `p2`, and Initializing in `p2` after the close | AC-38 |
| G' | signal `g-go` | `p2` connected | AC-38 |
| H | clean. Open `p1` and `p2` on `password` with (pw) after `h-0` and the shared join, signal `h-0`; both connected. Then `p1` and `p2`: (pw, `answer: 'dismiss'`) after `<w>-esc`, then (pw) after `h-go`. `p2`: `hostPick` → `{label: 'password'}`. In `p2`, Kill; wait until both have a new held line; read the owner `o` and the waiter `w`; signal `<o>-esc` | `w`'s held line is `withdrawn`, then within 10 s a new held line of `w` and Initializing in `w` | AC-28 |
| H' | signal `h-go`; then reload `o` | `w` connected; after the reload `o` is connected with no new held or `maskedInput` line of `o` | AC-28 |
| I | clean; delete `<run>/known_hosts_password_ask`. `p1`: (key yes) after `never`, then (pw) after `i-pw`. `p2`: (key yes) after `i-key`, then (pw) after `never`. Open `p1` on `password-ask`, wait; open `p2` on `password-ask`, wait; signal `i-key` | `p1`'s key entry `withdrawn`; then a held `maskedInput` line of `p1` (the owner went on to the password) | AC-11 |
| I' | signal `i-pw` | `p1` and `p2` connected | AC-11 |
| J | clean; delete `<run>/known_hosts_password_ask`. `p1`: (key yes) after `never`, then `failureDialog` `"password-ask"` → `dismiss`, then `mitigationPick` → `dismiss`. `p2`: `pick` `fingerprint` → `no` after `j-no`, then (key yes), then (pw). Open `p1`, wait; open `p2`, wait; signal `j-no` | `p1`'s `failureDialog` line reads `Could not establish connection to "password-ask".`; then a `pick` line of `p2` with the fingerprint question, after the `no`, and Initializing in `p2` after it | AC-37 |
| J' | — | `p2` connected | AC-37 |
| L | clean, and on the host end the server (`pkill -f '/home/harness/[.]vscodium-server-insiders/bin/'`, as coverage-13's setup does), so none runs when `p1` connects. `p1`: (pw) after `l-0`. `p2`: (pw) after `never`. Open `p1`, wait; open `p2` (it joins through S157 while no server runs, with a held line); signal `l-0`; both connected. Then `p1` and `p2`: (pw) after `l-go`; `p2`: `hostPick` → `{label: 'password'}`. In `p2`, Kill; wait until both have a new held line; signal `l-go` | within 30 s, one of two outcomes: both `p1` and `p2` are connected; or exactly one is, and the other, after `reloadWindow`, is connected with no new held or `maskedInput` line. `acceptedPasswords()` grew by 1 since the Kill. "Cannot reconnect" in the other window is core's | AC-34 |
| K | clean; `userSettings({'remote.SSH.useLocalServer': false})`. `p1`: (pw) twice, with no `after`. `p2`: (pw). Open `p1`; reload `p1`; open `p2` | no helper ever runs; `p1` has two `maskedInput` lines, one before and one after the reload; `p2` has its own `maskedInput` line; no S157 line in any window; all connected | AC-19, AC-20 |

Set the setting back to `true` at the end, and close every `p*` window.

## 3. The catalogue

F-2102 AC-8, 9, 10, 11, 12, 13, 19, 20, 27, 28, 34, 35, 36, 37 and 38 go to `acceptance`. Core halves, listed in #142:
- AC-8's "Reconnecting to SSH: <host>..." and "SSH: <host>";
- AC-28's "Cannot reconnect. Please reload the window." dialog, which is core's own reconnection dialog.

AC-34 is `acceptance` too: the AC accepts either outcome, and row L asserts that disjunction (athena on #575). Its
"Cannot reconnect" dialog is core's half.

For the tag check (athena on #575): AC-28's core half exists because our resolve fails for good. A cancelled
reconnection isn't retryable (`KIND_MAY_RECOVER`), and the host gives core `notAvailable`, unhandled (`mapFailure`).
Name lib-authority's row `isReconnection -> notAvailable handled false` in the PR body. If remote-ssh has no row for "a
cancelled reconnection isn't retryable", list it under "Needs a unit row". AC-8 is run with three windows, a superset
of its two.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass. If a row
fails because the extension does something else, don't change the row: report it on the issue.

## 5. Review

PR title `tests: F-2102's shared-login rows (card coverage-15, #142)`. themis or triton reviews; athena gives the tag
check.
