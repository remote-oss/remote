# Task card coverage-49: the window rows of login shells and profile scripts (F-2704)

Release 0.2, slice 3. Size: L. Builder: `task:claude`. Spec: remote-oss/remote-ssh#77 (F-2704, `spec:reviewed`, 33
criteria). AC-10 is reference-only and has no line. Brief: `docs/architecture/build-order.md`, "Slice 3", F-2704: the
rows first, and a product change only where a row fails. **Depends on coverage-47 (#1215) and tooling-55 (#1220)**,
which gives the per-shell accounts `harness-bash`, `harness-zsh`, `harness-dash` (`sh`), `harness-ksh`, `harness-csh`,
`harness-tcsh` and `harness-fish`, the `login-shells` launch, and the helpers `runProcessTask` and `terminalNames`.

## 1. What's on main

- lib-ssh's `connection-server/session-bootstrap.ts`: the session runs the user's login shell on a command that writes
  its `export -p`, bounded by the connect wait, then `exec`s POSIX `sh` (athena's note on #77). The log lines for a
  timeout and for an exit are there (`the login shell did not finish its startup within … s`, `the SSH session ended
  before the host reported its platform: …`).
- The server suite has lib-level rows (`tests/acceptance/server/login-shells.test.ts`, run per shell by
  `tools/acceptance-variants.ts`). They stay as they are. This card adds the **window** rows.
- **No log line names the login shell.** lib-server's probe reads only its basename
  (`scripts/bootstrap.ts`: `fact host.shell "${SHELL##*/}"`, read by `probe.ts` as `loginShell`), and nothing logs
  it. BR-2, AC-26 (`/bin/bash`) and AC-33 need the path and the name, so the product change decided here
  (amended 2026-10-20 on dike's finding) is:
  - **lib-server:** the probe's fact becomes the whole value, `fact host.shell "${SHELL:-}"`. That's `$SHELL` after
    the startup files ran, because the probe runs in the `sh` the login shell's environment was handed to.
    `loginShell` stays the field's name, documented as the path. Today nothing but `probe.ts` reads the fact or the
    field. Update the probe's fixtures (`host.shell=ash`/`sh` in the lib-server, remote-ssh and remote-containers
    unit tests) to paths (`/bin/ash`, `/bin/sh`), plus any test that pins the script's text.
  - **remote-ssh** logs, at info, once per connect where the probe's facts arrive:
    `the host's login shell is ${path} (${path.posix.basename(path)})`. An empty value logs nothing. Unit rows for
    both, and one for the empty value.
  - Find where remote-ssh receives the probe result (its server steps). remote-containers logs nothing new.

## 2. Rows

Write them in `tests/acceptance/login-shells/`, one file per section of the spec if you like, named `F-2704 AC-n
(<case>)`.
- Each row writes the startup files it needs with `onHostAs(<user>, 'sh', '-c', …)`, and restores them in `finally`
  (remove what it wrote).
- A row that needs a fresh server first stops the account's server, the way `windows/maintenance.ts` stops one, and
  says so.
- **Environment:** `runProcessTask(name, '/bin/sh', ['-c', 'env > /tmp/<row>-env'])`, then read the file as the user.
- **Terminals:** `inWindow(name, 'workbench.action.terminal.new')`, `terminalNames(name)` and `terminalBuffer(name)`.
- **Dialogs and pick:** the scripted record (`recordLines('failureDialog')`, `'mitigationPick'`, `'platformPick'`,
  `'notice'`).
- **The log:** `connectionLog()`.

| AC | Account and case |
|---|---|
| 1 | bash, default mode: connected (`windowState`), no `notice` or `failureDialog` line |
| 2 | zsh with no startup files, and with a `.zshrc`: connected; the new terminal is `zsh`; its buffer has no `zsh-newuser-install` text |
| 3 | dash: connected; the new terminal is `sh` |
| 4 | bash, fresh server: `.profile`, `.bashrc` above and below its non-interactive guard (`case $- in *i*) ;; *) return;; esac`) each export a variable; all three reach the task |
| 5 | zsh, fresh server: `.zshenv`, `.zprofile`, `.zshrc` exports reach the task and a terminal (`echo` into `terminalBuffer`); a `.profile` export doesn't |
| 6 | dash, fresh server: the `.profile` export and the `ENV` file's export reach the task |
| 7 | bash: the startup files print 200 lines to stdout and one to stderr: connected, no `notice` or `failureDialog` line |
| 8 | bash with `export SHELL=/bin/zsh` in `.profile`, fresh server: the new terminal is `zsh`; `.zshrc`'s export reaches the task |
| 9 | bash with a `.bash_profile` ending in `exec zsh`: connected with no line; `.profile`'s export reaches the task, `.bashrc`-end's and `.zshrc`'s don't |
| 11 | bash, a `.bash_profile` that reads a line (`read x`), and one that sleeps longer than the connect timeout (set it to 10): the timeout dialog (`Connecting with SSH timed out`). The fish case is reference-only |
| 12 | AC-11's sleep case: "More Actions..." gives the pick with the five items in order |
| 13 | bash, `.profile` ending with `exit 1`: within 5 s, the dialog `Could not establish connection to "harness-bash".`, with Retry, More Actions..., Close Remote |
| 14 | bash, `.profile` sleeping 25 s, `remote.SSH.connectTimeout` 40: connected, no notice, and the `.profile` export reaches the task |
| 15 | fish, `remote.SSH.useLocalServer: false`, platform pick answered `linux`: connected; terminal `fish`; `config.fish`'s export reaches the task and `.profile`'s doesn't |
| 16 | bash, a running server: change `.profile`, open a second window: the task sees the old value; stop the server and reconnect: the new one |
| 17 | after the suite's rows: `settings.json` holds no key the rows didn't set (`remote.SSH.remotePlatform` from AC-15 apart); our `globalState` entry in the run's `state.vscdb` (read with `node:sqlite`) has no key holding a shell name |
| 18 | bash, terminal mode, `.profile` prints a line: connected, and the line isn't in `connectionLog()` |
| 19 | terminal mode with `remote.SSH.showLoginTerminal: true`: `terminalNames` of the local window holds `install - Local - <local folder name>` |
| 20 | in the `trust` launch's suite (trust on), an untrusted local folder, default mode, `harness-bash`: the window reaches connected while core's trust dialog is open (`dialogOf` in a renderer launch, or the trust launch's own readout) |
| 21 | in the `trust-terminal` launch's suite: terminal mode, the platform picked, the trust dialog left open: the timeout dialog is recorded, waiting; trust the folder, Retry: the platform pick again, then connected |
| 22 | bash, a connected window and a changed `.profile`: "Kill VS Code Server on Host..." from the local window (the `windows/maintenance.ts` helpers): the window's own reconnection starts a new server within 60 s; after a reload, the task sees the change |
| 23 | AC-11's sleep case: Retry reloads, and the same dialog comes again |
| 24 | AC-11's sleep case: Close Remote leaves an empty local window (`windowState`: no remote, no folder) |
| 25 | AC-13's case: the log has `the SSH session ended before the host reported its platform` |
| 26 | bash with a `.bash_profile` that `exec`s zsh: the log line of §1 names `/bin/bash (bash)` |
| 27 | bash with a `.bash_profile` that runs `zsh` as its last line, no `exec`: connected; `.bashrc`-end's and `.zshenv`'s exports reach the task, `.zshrc`'s doesn't |
| 28 | bash, `remote.SSH.useExecServer: false`: AC-4's three exports reach the task. The fish half is reference-only, and the fish account connects; leave it out |
| 29 | bash, `remote.SSH.permitPtyAllocation: true`, `.bashrc` printing below its guard: connected; the line isn't in the log |
| 30 | a run-local config file that `Include`s the run's and adds `Host rc-zsh` (user `harness-bash`, `RemoteCommand exec zsh -l`), set with `remote.SSH.configFile`: with `remote.SSH.enableRemoteCommand: false` the log's shell line says bash; with it `true` the window connects, and `ps` under the user shows zsh above the server |
| 31 | the same file, `Host rc-end` with `RemoteCommand echo hi`, `enableRemoteCommand: true`: within 5 s the AC-13 dialog, and no notice |
| 32 | AC-11's sleep case on an account with no server: after Close Remote, `pgrep -u <user>` finds nothing and the account's server data folder doesn't exist |
| 33 | ksh, csh, tcsh, each with `remote.SSH.useExecServer` true and then false: connected, and the log's shell line names `ksh`, `csh`, `tcsh` |

If a row fails, look at the cause before changing anything:
- **A host gap** (a shell's startup that doesn't do what the row needs, or a tooling-55 account that doesn't connect):
  comment here with what you saw.
- **A product failure:** fix it in lib-ssh or remote-ssh only when the spec's [adaptation] and BR-4's table say what
  to do, with a unit row. Otherwise comment and stop. The decision is athena's.
- **A criterion our design deliberately doesn't meet** (our bootstrap differs from the reference's on BR-4's table,
  for example): write the row for our behaviour as `F-2704 AC-n (ruling-1205-<case>)`, add a line to
  `release-0.2-notes.md`, and ask athena on #77.

## 3. Coverage (`coverage-slice1.tsv`)

- `acceptance`: every criterion whose row passes.
- `todo`: the rest, each with a comment here saying why.
- The lib-level server rows that already cite AC-11, AC-13, AC-14 and AC-25 stay, and count too.

## 4. Done when

- `pnpm package && node tools/acceptance.ts --editor vscodium --launches login-shells,trust,trust-terminal` passes.
  Paste the summary line.
- The server variants (`node tools/acceptance-variants.ts`) still pass: §1 changes lib-server's probe.
- All gates pass, and `node tools/check-coverage.ts` is clean.
- PR title: `remote-ssh: the window rows of login shells and profile scripts (card coverage-49, #1221)`.
  Request athena only.

## 5. Amendment (2026-10-20, from triton's review of #1278)


1. **`terminalNamed` fails and names what it saw** (`tests/acceptance/windows/harness.ts`):
   - New signature: `terminalNamed(name: string, wanted: string): Promise<void>`. It polls `terminalNames(name)` every 500 ms for up to 10 s, as it does now.
   - It resolves once a name includes `wanted`.
   - At the deadline it throws `new Error(`no terminal of window ${name} is named after ${wanted} within 10 s; its terminals are: ${last.join(', ') || 'none'}`)`, where `last` is the last list it read.
   - Update its doc comment to match.
2. **Every account row polls** (`tests/acceptance/login-shells/accounts.test.ts`):
   - All seven rows (bash, zsh, dash with `sh`, ksh, csh and tcsh with `tcsh`, fish) call `await terminalNamed(<window>, <name>)` after `workbench.action.terminal.new`.
   - They drop `shellTerminal` from the `deepStrictEqual` object, which becomes `{exitCode, homeLine}` against `{exitCode: 0, homeLine: true}`.
   - The bash, zsh, dash and ksh rows no longer read `terminalNames` directly.
   - Write this card's terminal rows the same way. Use `terminalNames` only where a row asserts the whole list (AC-19's local window).
3. **`runProcessTask` listens before it starts the task** (`tests/acceptance/window-agent/src/extension.ts`, `acceptance.agent.runProcessTask`):
   - Subscribe to `vscode.tasks.onDidEndTaskProcess` before `executeTask`, and keep every event in a list.
   - After `executeTask` resolves, take the first event whose `execution` is the returned one. If it hasn't arrived yet, wait for it.
   - Dispose of the listener in a `finally`. Report `exitCode` as now (`event.exitCode ?? null`).
   - Shape:
     ```ts
     const endings: vscode.TaskProcessEndEvent[] = [];
     let check = (): void => undefined;
     const listener = vscode.tasks.onDidEndTaskProcess(event => {
       endings.push(event);
       check();
     });
     try {
       const execution = await vscode.tasks.executeTask(task);
       const ending = await new Promise<vscode.TaskProcessEndEvent>(resolve => {
         check = () => {
           const found = endings.find(each => each.execution === execution);
           if (found !== undefined) {
             resolve(found);
           }
         };
         check();
       });
       report(agentFolder, name, {event: 'taskEnded', exitCode: ending.exitCode ?? null});
     } finally {
       listener.dispose();
     }
     ```

**Done when** gains: `node tools/acceptance.ts --editor vscodium --launches login-shells` passes with the seven account rows and the two `(ruling-fish)` rows, before your F-2704 rows are added and after. Paste both summary lines.
