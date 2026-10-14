# Task card connect-75: Uninstall deletes `<home>/<dataFolder>` and stops the custom folder's servers

Issue: #858. Gating: milestone 0.2 (D-86 puts F-2412 in 0.2). F-2412 BR-3, BR-4 and AC-20 (Q2 as written, which
`contracts.md` V8 server-maintenance rules: "`uninstall` deletes exactly `<home>/<serverDataFolderName>`"). Size: S. Builder:
`task:local`.

## 1. The defect

coverage-40 measured it (#728, comment 6161780611). It set `remote.SSH.serverInstallPath` for `harness` to
`/home/harness/custom`, then uninstalled `harness`. The command resolves with no error, but
`/home/harness/.vscodium-server-insiders` still exists 10 s later.
- **AC-20:** "`<home>/.vscode-server` is gone, the server processes are stopped, and the custom folder's content
  remains".
- **BR-4:** a folder named by `serverInstallPath` isn't deleted; its server is stopped and its files stay.
- **BR-3:** a server runs from `<home>/.vscode-server` or from the custom folder, and is stopped either way.

**The cause:**
- `packages/remote-ssh/src/pipeline/server-steps.ts:298-302`: `maintain` builds its parameters with `parametersFor({})`.
- `pipeline/parameters.ts:91-93`: that sets `installRoot` from the host's `installFolder` setting
  (`pipeline/host-settings.ts:185`).
- `packages/lib-server/src/scripts/posix-script.ts:48-49`: the script sets `DATA_ROOT=${INSTALL_ROOT:-$HOME}` and
  `DATA_DIR=$DATA_ROOT/$DATA_FOLDER`.
- `lib-server/src/scripts/bootstrap.ts:641-646`: `UNINSTALL_BODY` stops the servers under that `DATA_DIR` and runs
  `rm -rf` on it. So the uninstall deletes the custom folder's data folder and leaves `<home>/<dataFolder>`, the
  reverse of BR-4.
- `maintenance-run.ts`'s comment "Uninstall never reads the install folder setting" is only about the checks.

## 2. The fix

**Only in `lib-server/src/scripts/bootstrap.ts`, `UNINSTALL_BODY`.** Replace it with exactly:

```ts
const UNINSTALL_BODY: readonly string[] = [
  '[ -n "$DATA_ROOT" ] && [ -n "$DATA_FOLDER" ] || finish Ok',
  'stop_servers',
  'if [ "$DATA_ROOT" != "$HOME" ]; then',
  '  [ -n "$HOME" ] || finish Ok',
  '  DATA_DIR=$HOME/$DATA_FOLDER',
  '  stop_servers',
  'fi',
  'rm -rf "${DATA_DIR:?}"',
  'finish Ok',
];
```

- The first `stop_servers` stops the servers of the install root's data folder: the custom folder's when the setting
  is set, `<home>`'s otherwise. It doesn't delete any of the custom folder's files.
- With a custom root, `DATA_DIR` then names `<home>/<dataFolder>`. `stop_servers` (`posix-script.ts:372-393`) reads
  `$DATA_DIR` when it runs, so the second call stops that folder's servers. `rm -rf` then deletes that folder only.
- Without a custom root, `DATA_ROOT` is `$HOME`, so the script runs as on main.
- Nothing in remote-ssh changes: the script decides from `INSTALL_ROOT` alone.
- The Kill body is unchanged. F-2411 acts on the folder the setting names (`maintenance-run.ts`'s own comment).

## 3. Rows

All the rows go in `lib-server/test/unit/bootstrap-script.test.ts` and run the real script on the fake host, as the
rows around them do. The custom root is `custom = path.join(host.home, 'custom')`, given as
`{...parametersFor(), installRoot: custom}`.

**In `describe('kill, uninstall and cleanup')`, after line 1482:**

| Name | Given | Expected |
|---|---|---|
| `F-2412.BR-4: with a custom root, uninstall deletes the home data folder` | `<home>/.server-data/bin` and `<custom>/.server-data/bin/keep.txt` made with `mkdirSync`/`writeFileSync`; uninstall with the custom root | `<home>/.server-data` doesn't exist; `<custom>/.server-data/bin/keep.txt` exists |
| `F-2412.BR-4: with a custom root and no home data folder, uninstall is Ok and keeps the custom folder` | `<custom>/.server-data/bin/keep.txt` only | status `Ok`; `keep.txt` exists |

**In `describe('a server that is already there, and the lock')`, after the row at line 2155** (they use its `started`,
`serverFile` and `dataFolder`; a marker that exists means the process got TERM):

| Name | Given | Expected |
|---|---|---|
| `F-2412.BR-3: with a custom root, uninstall stops the custom folder's server` | `started('server', path.join(custom, '.server-data', 'cli', 'servers', 'Stable-abc123', 'server', 'node'))`, 0.5 s, then the uninstall with the custom root, then 1.5 s | the marker exists |
| `F-2412.BR-3: with a custom root, uninstall stops the home folder's server too` | `started('server', serverFile())` (the home data folder's), 0.5 s, then the uninstall with the custom root, then 1.5 s | the marker exists |
| (unchanged) `F-2412.BR-3: uninstall deletes the data folder` (line 1465) and `F-2412.BR-3: uninstall stops the server of the CLI path too` (line 2155) | no custom root | still pass: without a custom root nothing changes |

The first, second and fourth new rows fail on main: main deletes the custom data folder and stops only its servers.

**Acceptance:** coverage-40's row 19 (`docs/architecture/tooling-tasks/task-coverage-40-uninstall-rows.md` on
`origin/feature/coverage-40`), added to `tests/acceptance/windows/uninstall.test.ts` with the name
`F-2412 AC-20: with serverInstallPath set, the home data folder goes, the servers stop and the custom folder stays`.
- **Setup:** `setting('remote.SSH.serverInstallPath', {harness: '/home/harness/custom'})`. Write
  `/home/harness/custom/keep.txt` as `harness`, run `mkdir -p DATA_FOLDER` as `harness`, and make sure a server runs:
  open `u1`, close it with `closeAllButLocal()`.
- **Then:** uninstall `harness` from `local`.
- **Pass:** `removedWithin(DATA_FOLDER)`; `serverProcesses()` empty within 10 s; `existsOnHost('/home/harness/custom/keep.txt')`
  is true.
- **Reset:** in `finally`, the setting back to `undefined`, and `rm -rf /home/harness/custom` as `harness`.
- **On main,** `DATA_FOLDER` still exists after 10 s.
- If coverage-40 hasn't merged, build on its file from `origin/feature/coverage-40`.

## 4. Gates and review

Run all gates and the VSCodium run. PR title `lib-server: Uninstall deletes the home data folder and stops the custom
folder's servers (card connect-75, #858)`. Request athena only.
