# Task card tooling-55: one host account per login shell, and a launch for F-2704's window rows

Release 0.2, slice 3. Size: M. Builder: `task:local` (selene). Brief: `docs/architecture/build-order.md`, "Slice 3",
F-2704: harness first. Spec: remote-oss/remote-ssh#77 (F-2704, `spec:reviewed`).

The host image already installs bash, zsh, dash, fish, tcsh (with `csh`) and mksh, and it has `harness-fish`. The
server suite runs its shell rows per shell through `HARNESS_HOST_SHELL` (`tools/acceptance-variants.ts`), but a window
launch needs one account per shell, side by side on one host. This card builds that, plus two readouts the rows need.
Everything is decided here. If what you find differs, comment on this issue and stop.

## 1. The host (`tests/acceptance/host/`)

1. `Dockerfile`:
   - Add `loksh` to the `apk add` line. Its binary is `/bin/ksh`. If Alpine 3.22 has no `loksh`, comment and stop.
   - Add `ln -s /usr/bin/dash /usr/local/bin/sh` (a dash login shell whose name is `sh`, as F-2704 AC-3's
     `/usr/bin/sh` is).
   - Add `/bin/ksh` and `/usr/local/bin/sh` to the `/etc/shells` loop.
   - Add six users exactly as `harness-fish` is made (`adduser -D -s <shell> <user>` and the `sed` on
     `/etc/shadow`):

     | User | Login shell |
     |---|---|
     | `harness-bash` | `/bin/bash` |
     | `harness-zsh` | `/bin/zsh` |
     | `harness-dash` | `/usr/local/bin/sh` |
     | `harness-ksh` | `/bin/ksh` |
     | `harness-csh` | `/bin/csh` |
     | `harness-tcsh` | `/bin/tcsh` |

   - Extend the header comment's list of users by these six, one clause in the same style.
2. `start-sshd`: add the six users to the `for account in …` loop and to the comment above it.

## 2. The aliases (`tools/acceptance.ts`, `tools/acceptance.test.ts`, README)

- The run's `ssh_config` gets one alias per new user, named as the user (`harness-bash` … `harness-tcsh`), with the
  run key, exactly as `harness-fish` is written (find its lines near `'harness-i686'`, line ~368).
- One row in `acceptance.test.ts` next to `#670: Host i686 …`, named `F-2704: Host <alias> logs in to <user> with
  the run key` and looping over the six aliases.
- In `tests/acceptance/README.md`'s accounts table, one line per alias: "the run's key; its login shell is
  `<shell>`", with `harness-dash`'s saying "`/usr/local/bin/sh`, a link to dash". Change "three users" in the
  paragraph above to say how many there are now.

## 3. The window agent (`tests/acceptance/window-agent/`)

1. `package.json` `contributes.taskDefinitions`: `[{"type": "acceptance"}]`. Add it if the manifest has no
   `contributes` yet.
2. `src/extension.ts`, two commands, written like `acceptance.agent.terminalBuffer`:
   - `acceptance.agent.runProcessTask(command: string, programArguments: string[])`:
     - runs `new vscode.Task({type: 'acceptance'}, vscode.TaskScope.Workspace, 'acceptance', 'acceptance', new
       vscode.ProcessExecution(command, programArguments))` with `vscode.tasks.executeTask`;
     - waits for the `onDidEndTaskProcess` event whose `execution` is the one returned;
     - reports `{event: 'taskEnded', exitCode}` (`exitCode` is `null` when there is none).
   - `acceptance.agent.terminalNames()`: reports `{event: 'terminalNames', names: vscode.window.terminals.map(each =>
     each.name)}`.
3. `tests/acceptance/windows/harness.ts`, two helpers beside `inWindow`, each built on `reported(name, <event>, <command>,
   …)` as `terminalBuffer` is:
   - `runProcessTask(name, command, programArguments): Promise<number | null>`;
   - `terminalNames(name): Promise<string[]>`.

## 4. The launch

- `tools/acceptance-launches.ts`: `{label: 'login-shells', kind: 'plain', suite: 'login-shells'}`, with a unit row
  beside `windows`'s.
- `tests/acceptance/login-shells/accounts.test.ts`, one row per account (the six plus `harness-fish`), named
  `#1220: <alias> connects, a task reads the server's environment, and a new terminal is named after the
  login shell`. Each row:
  1. `openWindow(alias, 'ls-<shell>')`, then `connectedWithin('ls-<shell>', INSTALL_MILLISECONDS)`, as
     `fishServerInstalled` in `windows/maintenance.ts` does;
  2. `runProcessTask('ls-<shell>', '/bin/sh', ['-c', 'env > /tmp/ls-env'])` resolves 0, and
     `onHostAs(<user>, 'cat', '/tmp/ls-env')` holds a `HOME=/home/<user>` line;
  3. `inWindow('ls-<shell>', 'workbench.action.terminal.new')`, then `terminalNames('ls-<shell>')` holds the shell's
     name. For `harness-dash` that's `sh`. For `harness-csh` it's whatever core gives (`csh` or `tcsh`): write down
     what you see in the PR, and assert that;
  4. `closeWindow('ls-<shell>')` in `finally`.
  **These rows check the harness only.** They cite no criterion. If one fails because the window doesn't connect
  (`harness-ksh`, `harness-csh` or `harness-tcsh` most likely), keep it, mark it `it.skip` with a comment naming the
  failure, and say so in the PR. The F-2704 card that follows handles it.
- Move the two `(ruling-fish)` rows (`tests/acceptance/windows/kill.test.ts` `F-2411 AC-24 (ruling-fish)` and
  `uninstall.test.ts` `F-2412 AC-24 (ruling-fish)`) as they are into `tests/acceptance/login-shells/fish.test.ts`,
  with the imports they need from `../windows/…`. Remove them from the old files and leave their names unchanged.
  `check-coverage` must still find them.

## 5. Done when

- `node tools/acceptance.ts --editor vscodium --launches login-shells,windows` passes (skipped rows apart). Paste the
  summary line.
- `pnpm test` in `tools/` passes, the whole diff is linted, and `pnpm dupes`, `pnpm dead` and
  `node tools/check-coverage.ts` are clean.
- PR title: `tests: one host account per login shell, and a launch for F-2704's window rows (card tooling-55,
  #1220)`. Request athena only, and tell proteus the new launch's name for CI.
