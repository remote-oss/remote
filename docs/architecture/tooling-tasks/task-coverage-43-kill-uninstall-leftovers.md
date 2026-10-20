# Task card coverage-43: the 13 Kill and Uninstall criteria coverage-39 and coverage-40 left `todo`

Issue: #1080. Release 0.2, gating (D-86 puts F-2411 and F-2412 into 0.2). Size: M. Builder: `task:claude`.
Sources: F-2411 (`remote-oss/remote-ssh#56`) and F-2412 (`#57`); cards coverage-39 (#727, PR #807) and coverage-40
(#728, PRs #872 and #910), whose §3 lists these as left `todo`; connect-53 (#785, PR #843); tooling-33 (#716, PR #790,
the trust-enabled launch).

**What this card is:** each of the 13 F-2411 and F-2412 lines that are still `todo` in
`docs/architecture/catalogue/coverage-slice1.tsv` ends with a final tag, and gets the row that proves it where one is
missing. The rows go in the files coverage-39 and coverage-40 made (`tests/acceptance/windows/kill.test.ts`,
`tests/acceptance/windows/uninstall.test.ts`) and use their helpers. A criterion where the product does something else
is an open row (§3), not a test change.

## 1. The 13, and what each needs

| Criterion | State on main | What to do |
|---|---|---|
| F-2412 AC-20 | `uninstall.test.ts` has a row that cites it (coverage-40 row 19) | tag `acceptance`; nothing else |
| F-2411 AC-25 | coverage-39 dropped its row while connect-53 (#843) was open; #843 is merged | put the row back as selene described on #727: in a window on `harness`, Kill on Host with the typed `harness@harness` gives S085, the window stays remote, and the server's processes are gone; then core's reconnect state, as row 5 reads it. Tag `acceptance` |
| F-2411 AC-29 | a unit row cites it; coverage-39's KC row 29 (the unsaved editor and core's save prompt) wasn't written | write KC row 29 as coverage-39 §2 has it (Cancel, then Don't Save; Save if the agent can answer core's prompt with it, else list Save under "harness capability missing"). Tag `acceptance` |
| F-2411 AC-32 | no row | write coverage-39 rows 22 and 30 (socket mode: Kill on Host, then Kill Current). Tag `acceptance` |
| F-2411 AC-33 | a unit row cites it | write the row: from `local`, and from a window on `harness` with `remote.SSH.useLocalServer` false, Kill on Host `harness`; `sshdLog(since)` shows exactly one new login session for each kill, ended right after (`acceptedKeyLogins` gives the count). Tag `acceptance` |
| F-2412 AC-17 | unit rows cite it | write the row: in a window connected to `harness` (default mode), Uninstall picks `harness`; within 1 s the window is an empty local window (`windowState`), no notification, and `dataFolder` still exists. Tag `acceptance` |
| F-2412 AC-19, AC-37 | waited on a trust-enabled launch, which tooling-33 (#790) built (`TRUST_LAUNCH`, the `trust` suite) | write both in the `trust` launch's suite with `remote.SSH.useLocalServer` false in a Restricted Mode window: Cancel in core's trust dialog removes nothing (AC-19); "Trust Folder & Continue" removes `<home>/.vscode-server` with no message and no visible terminal (AC-37). Use tooling-33's trust-dialog helpers. Tag both `acceptance` |
| F-2411 AC-24, F-2412 AC-24 | the host has `fish` installed but no account whose login shell is it | add an account to `tests/acceptance/host/Dockerfile`, `adduser -D -s /usr/bin/fish harness-fish`, with the run's key exactly as `harness-pw`'s setup gives the others, and a `Host harness-fish` entry in the run's `ssh_config` (`tools/acceptance.ts`, where the other accounts' hosts are written). Then write both rows (Kill on Host and Uninstall pick `harness-fish`: no UI, the command ends silently, about 17 s for F-2412 AC-24, and the host is unchanged). Tag both `acceptance` |
| F-2412 AC-25 | no row | write it: `remote.SSH.useLocalServer` false, a host whose key isn't in `known_hosts` (coverage-40's unknown-key setup), pick it and answer the platform; nothing on the host is removed, no setting is written, and the window stays usable (the agent runs a command afterwards). Tag `acceptance` |
| F-2412 AC-35 | no row | write it for the variants the run's hosts give: Alpine (the harness host), a login shell `sh` (`harness`), and `ProxyJump` (the run's jump host entry, if the `ssh_config` has one). A BusyBox host without bash isn't in the run: list it under "harness capability missing" and leave AC-35 `todo` unless all four are proved |
| F-2412 AC-10 | no row: the question's wording is the runner's OpenSSH client's | measure what the runner's `ssh -V` is. If it's 10.2 or later, write the row (the quick input's message, `yes` continues, Escape gives AC-12's dialog). If not, leave it `todo` and post the version on the issue; daedalus takes the tag to athena |

## 2. Rows and gates

Each new row's name starts with its cites, a lower-case label in parentheses (`[a-z0-9-]` only), then a colon, as
`check-coverage` reads them. Run all gates and `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium` with the
launches these rows are in. `node tools/check-coverage.ts` green. PR title: `tests: the Kill and Uninstall criteria
coverage-39 and coverage-40 left open (card coverage-43, #1080)`. Request athena only; hermes assigns the peer.

## 3. Open rows (stop that criterion, report on the issue, go on with the others)

1. A row shows the product doing something other than the criterion (post the row's output and the criterion).
2. The fish account's login or its silent end differs from the criterion's timing by more than 2 s either way.
3. A criterion needs a harness capability this card doesn't add.
