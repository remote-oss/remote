# Task card connect-54: Kill stops every server process under bin/, its extension host and file watcher included

Issue: #786. Release 0.2, **gating** (F-2411 under D-86). Size: S. Builder: selene. Area A (lib-server). Found by
coverage-39's build (#727). Its 10 s process checks had to ignore leftovers from earlier files; they go back to strict
after this card.

## 1. The defect

**The rule:**
- F-2411 BR-3: "What is stopped: the VS Code Server processes of the SSH login user on that host. The exec-server
  launcher (`code-<commit>` processes) and older login sessions are not stopped."
- AC-32 (and 6.9): the server processes on H are gone within about 10 s.

**What main does:** `STOP_FUNCTIONS` in `packages/lib-server/src/scripts/posix-script.ts` (`stop_servers`) runs two
loops:
- **The direct install:** for each `"$DATA_DIR"/.*.pid`, if the process's command line holds `$DATA_DIR/bin/`, it runs
  `pkill -P <pid>` (direct children only), then `kill <pid>`.
  - The pid is the launcher shell's. The server's main `node` is its child.
  - The extension host and file watcher (`node … out/bootstrap-fork --type=extensionHost` and `--type=fileWatcher`)
    are the main process's children, so they're grandchildren of the pid.
  - When the main process dies, they're reparented to PID 1 and survive. coverage-39 measured this for a server whose
    window had gone away earlier.
- **The CLI path:** a sweep of `/proc` that kills every process whose program is under `$DATA_DIR/cli/servers/`, or a
  POSIX shell running a script there (`is_cli_server_process`). This loop already reaches every process of the tree,
  because each one runs a file under that folder.

## 2. The fix

Give the direct install the same sweep the CLI path has, and keep the pid-file loop.
1. **Generalise the classifier.** Replace `is_cli_server_process` with `is_server_tree_process PID PREFIX`, with
   unchanged logic. It's true when the process's first command-line field starts with `PREFIX`, or when that field's
   basename is `sh`, `bash`, `dash` or `ash` and its second field starts with `PREFIX`. Its pid guards stay as today:
   `''`, non-digits, `0` and `1`.
2. **`stop_servers`:**
   - The pid-file loop stays as it is.
   - The `/proc` sweep (skipping `$$`) kills a process when `is_server_tree_process "$PID" "$DATA_DIR/bin/"` or
     `is_server_tree_process "$PID" "$DATA_DIR/cli/servers/"` holds. It keeps the `pkill -P` before `kill`.
   - So the extension host, the file watcher, the pty host and any orphaned server process are stopped. Their program
     is the install's own `node`, under `$DATA_DIR/bin/<commit>/`.
3. **What isn't touched:**
   - a process that only names a path under `bin/` in a later argument (`tail -f`, an editor; the rule of F-2412
     AC-27's rows, applied to `bin/`);
   - the exec-server launcher `$DATA_DIR/code-<commit>`;
   - every process of another user, because `/proc/<pid>/cmdline` of another user's process may be readable, but
     `kill` fails silently for it, as today.
4. **No `/proc`:** a host without it (none of release 0.2's hosts) keeps today's pid-file behaviour. The sweep's
   `for PROC_DIR in /proc/[0-9]*` simply finds nothing.
5. The uninstall path calls the same `stop_servers`, so it gains the same reach. That's F-2412 BR-3's "stops the
   servers" as well.

## 3. Rows (`packages/lib-server/test/unit/bootstrap-script.test.ts`, the "kill, uninstall and cleanup" describe; the
existing `started`, `startedScript`, `afterStep` and marker helpers of the CLI rows)

| Name | Given | Expected |
|---|---|---|
| `F-2411.BR-3: kill stops an extension host under bin/ that no pid file names` | after `install`, `started('extensionHost', `${dataFolder()}/bin/<commit>/node`, ['<install>/out/bootstrap-fork', '--type=extensionHost'])`, with no pid file for it | `afterStep('kill', …)` lists `extensionHost` |
| `F-2411.BR-3: kill stops a file watcher whose parent has gone (PID 1)` | the same for `--type=fileWatcher`, started detached so its parent is the test runner (not a pid-file process) | listed |
| `F-2411.BR-3: kill stops a launcher shell running a script under bin/` | `startedScript('launcher', 'sh', <dataFolder>/bin/<commit>/bin/code-server)` | listed |
| `F-2412 AC-27: kill leaves a sleep that only names a path under bin/` | `started('sleeper', 'sleep', ['30', <dataFolder>/bin/<commit>/node])` | not listed |
| `F-2411.BR-3: kill leaves the exec-server launcher` | `started('launcher', `${dataFolder()}/code-<commit>`)` | not listed |
| the existing pid-file and CLI rows | unchanged | pass unchanged |

**Defect rule:** the first three rows must fail on main and pass with the fix. Paste both runs.

**Acceptance proof:** coverage-39's 10 s process checks after Kill on Host (AC-32 and the card's server-process
checks in `tests/acceptance/windows/kill.test.ts`), with the "ignore leftovers of earlier files" exception removed. Its
builder removes the exception once this merges. Say so on #727.

## 4. Gates and review

Run all gates and shellcheck, with the changed files at 100 %. Use the PR title
`lib-server: kill stops every server process under bin/ (card connect-54, #786)`. Request athena only.

## 5. Open rows (stop and report on #786)

1. On the harness host (Alpine/BusyBox), `/proc/<pid>/cmdline` of the extension host doesn't start with the install's
   `node` path, for example because a wrapper re-execs. Report the real command line.
