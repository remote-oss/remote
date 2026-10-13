# Task card server-19: a host folder that can't be written fails with S075 and its path, not as a busy lock

Issue: #668. Release 0.2, from a user's report (an AFS home), ruled by athena (decisions.md, 2026-10-13). Size: M.
Builder: iris or hestia.

## 1. The defect

**What the user saw:** the log reads "Host platform: linux x64", then, about 55 s later, "connect failed:
retriesExhausted", with nothing in between and no reason shown.

**Why:**
1. The install bodies run `mkdir -p "$INSTALL_DIR" 2>/dev/null || finish CreateInstallDirFailed`
   (`packages/lib-server/src/scripts/bootstrap.ts`). On a home that exists but can't be written, the install folder
   may already exist, so `mkdir -p` succeeds.
2. `lock_take` (`packages/lib-server/src/scripts/posix-script.ts`, `LOCK_FUNCTIONS`) returns 1 for any failure: a lock
   file that can't be opened or created, a `flock` that fails for another reason than a held lock, an `ln` that fails
   for another reason than an existing link, and, in `/tmp` mode, a lock path that's a symlink or not a regular file.
3. Every caller maps 1 to `finish LockBusy`. The lock loop (`lib-server/src/transfer/lock-loop.ts`) repeats a
   `LockBusy` step until its attempts run out, then answers `retriesExhausted`.
4. Every error text is discarded (`2>/dev/null`). The failure carries no detail, so the log has none.

The start script's own writes have the same blind spot:
- the token file;
- the empty log file (`(umask 077; printf '' >"$LOG_FILE") || leave ServerFailedToStart`);
- the pid file.

## 2. The rules (athena)

- **R1.** A failure to create or write the data folder, the install folder, the lock file, or the server's log, token
  or pid file is reported as two facts:
  - `server.writeFailedPath`, the path;
  - `server.writeFailedError`, the error text the failing command printed, with its newlines folded by `fact`.

  The status is `CreateInstallDirFailed`, which already maps to `serverInstall` with S075.
- **R2.** The remote-ssh mapping puts `cannot write <path>: <error>` into the failure's `logDetail`, so the log shows it
  next to "connect failed". The dialog's reason stays S075 ("Failed to install the VS Code Server").
- **R3.** `lock_take` tells a busy lock from a lock it can't use:
  - it returns **1 only when the lock is held** by someone else: `flock -n` fails and prints nothing, or `ln` fails
    because `$LOCK_CANDIDATE.target` exists;
  - it returns **2** for every other failure, with the failing command's error text in `LOCK_ERROR`. For the two
    `/tmp` guards, the text is `not a regular file`.
- **R4.** On `LockBusy`, the script also reports `server.lockPath`, the lock file's path.
- **R5.** A connect that ends in `retriesExhausted` logs the last attempt's cause:
  `the host lock <path> was still held after <n> attempts`, as the failure's `logDetail`.

## 3. Changes

### 3.1 lib-server scripts

**`posix-script.ts`, `lock_take`:**

```sh
lock_take() {
  LOCK_CANDIDATE=$(lock_path "$1")
  LOCK_ERROR=''
  if [ "$LOCK_IN_TEMPORARY" = yes ]; then
    if [ -L "$LOCK_CANDIDATE" ] || { [ -e "$LOCK_CANDIDATE" ] && [ ! -f "$LOCK_CANDIDATE" ]; }; then
      LOCK_ERROR='not a regular file'
      return 2
    fi
  fi
  if [ "$(lock_method)" = flock ]; then
    LOCK_ERROR=$( ( exec 9>>"$LOCK_CANDIDATE" ) 2>&1 ) || return 2
    exec 9>>"$LOCK_CANDIDATE"
    LOCK_ERROR=$(flock -n 9 2>&1) && LOCK_ERROR='' || { [ -n "$LOCK_ERROR" ] && return 2; return 1; }
  else
    LOCK_ERROR=$( { true >>"$LOCK_CANDIDATE"; } 2>&1 ) || return 2
    LOCK_ERROR=$(ln "$LOCK_CANDIDATE" "$LOCK_CANDIDATE.target" 2>&1) || { [ -e "$LOCK_CANDIDATE.target" ] && return 1; return 2; }
  fi
  LOCK_HELD=$LOCK_CANDIDATE
  trap 'exit 1' HUP INT TERM
  trap 'lock_release' EXIT
}
```

The builder may reshape the shell, but not the return values or `LOCK_ERROR`'s contents. Keep it POSIX `sh` and
BusyBox-safe, with no `local`. The existing shellcheck and script rows apply.

**A helper for every caller** (`posix-script.ts`, beside `lock_take`):

```sh
write_failed() {   # $1 the path, $2 the error text
  fact server.writeFailedPath "$1"
  fact server.writeFailedError "$2"
  finish CreateInstallDirFailed
}
take_lock_or_finish() {
  lock_take "$1"
  case $? in
    0) ;;
    1) fact server.lockPath "$LOCK_CANDIDATE"; finish LockBusy ;;
    *) write_failed "$LOCK_CANDIDATE" "$LOCK_ERROR" ;;
  esac
}
```

**`bootstrap.ts`:**
- every `lock_take "$COMMIT" || finish LockBusy` becomes `take_lock_or_finish "$COMMIT"`;
- `remove_install` keeps calling `lock_take` and skips on any non-zero return, as today;
- every `mkdir -p <dir> 2>/dev/null || finish CreateInstallDirFailed` (or `leave`) becomes
  `MKDIR_ERROR=$(mkdir -p <dir> 2>&1) || write_failed <dir> "$MKDIR_ERROR"`. Use `leave` semantics where today's line
  uses `leave`: `write_failed` then needs a `leave` variant that releases the lock first, so add `write_failed_leave`
  calling `lock_release` before `finish`;
- **the start body's writes:**
  - the token file: an empty token after the write becomes `write_failed "$TOKEN_FILE" "<the write's error text>"`
    in place of `leave ServerFailedToStart`. Capture the text the same way;
  - the empty log file, the same, in place of `leave ServerFailedToStart`;
  - the pid file write (`echo "$SERVER_PID" >"$PID_FILE"`): on failure, kill the launched server, then
    `write_failed "$PID_FILE" ...`;
- the `[ -n "$DATA_ROOT" ] || finish CreateInstallDirFailed` lines stay as they are: no path, so no facts.

### 3.2 lib-server types

- `StartFailure`'s `scriptFailed`, and `TransferFailure`'s `scriptFailed`, gain
  `writeFailure?: {path: string; error: string}`, set from the block's `serverFacts.writeFailedPath` and
  `writeFailedError` when the status is `CreateInstallDirFailed` and the path is present.
- `retriesExhausted` (in both) gains `lockPath?: string` and `attempts: number`, from the last `LockBusy` block's
  `serverFacts.lockPath` and the loop's attempt count.
- `hostLockLoopOf` (`transfer/lock-loop.ts`) keeps the last `LockBusy` step run, and returns
  `{kind: 'retriesExhausted', last: StepRun, attempts: number}` in place of the bare `'retriesExhausted'`. Update
  `blockOfStart`, `outcomeOf` and the transfer's equivalent. Keep `HostLockLoop`'s other answers as they are.

### 3.3 remote-ssh mapping (`pipeline/failure.ts`)

- `ofStatus` takes the optional `writeFailure`. For `CreateInstallDirFailed` with a `writeFailure`, it gives
  `logged('serverInstall', 'cannot write <path>: <error>', INSTALL_FAILED)`. Without one, it's unchanged.
- `ofStart` and `ofTransfer`:
  - `scriptFailed` passes `writeFailure` on;
  - `retriesExhausted` gives `logged('retriesExhausted', <R5's text>)` when `lockPath` is present, else
    `the host lock was still held after <n> attempts`.

`connect.ts` already logs the failure's `logDetail` with the "connect failed" line. Check that it does for these
kinds, and don't add a second line.

## 4. Host account for the rows

`tests/acceptance/host/Dockerfile` adds a user `harness-ro`, with `/bin/sh` and key login like `harness`, whose server
data folder exists and can't be written, as an AFS home without a token behaves:
- `~harness-ro/.vscodium-server-insiders` and `~harness-ro/.vscodium-server-insiders/bin` are owned by root, mode 755;
- `start-sshd`'s account loop adds `harness-ro`;
- `harnessSshConfig` (`tools/acceptance.ts`) gains the alias `readonly` for `harness-ro`, through `accountAlias`, like
  `noforward`;
- `tests/acceptance/README.md` lists the account.

Also add the matching data folder for the VS Code product's name if the run's VS Code launch reaches the account. It
doesn't today: only the VSCodium launches use it.

## 5. Rows

**Script rows** (`packages/lib-server/test/unit/bootstrap-script.test.ts` and the posix-script rows, in a real `sh` on
the test machine, as the existing script rows do):

| Cite | Given | Expected |
|---|---|---|
| #668 R3 | `lock_take` in flock mode on a lock another process holds with `flock` | returns 1; `LOCK_ERROR` empty |
| #668 R3 | flock mode, the lock file in a folder without write permission | returns 2; `LOCK_ERROR` names the path (the shell's "Permission denied" text) |
| #668 R3 | link mode, `$LOCK_CANDIDATE.target` existing | returns 1 |
| #668 R3 | link mode, the folder without write permission | returns 2 with a non-empty `LOCK_ERROR` |
| #668 R3 | `/tmp` mode, the lock path a symlink; a directory | returns 2 with `not a regular file` (each) |
| #668 R1 | the install body with `INSTALL_DIR`'s parent read-only (the folder missing) | status `CreateInstallDirFailed`; `server.writeFailedPath` is `INSTALL_DIR`; `writeFailedError` is non-empty |
| #668 R1 | the install body with `INSTALL_DIR` existing and read-only | `CreateInstallDirFailed`; `writeFailedPath` is the lock file's path |
| #668 R4 | the install body with the lock held by another process | `LockBusy`, and `server.lockPath` is the lock file's path |
| #668 R1 | the start body with the token file's folder read-only | `CreateInstallDirFailed`, `writeFailedPath` the token file |

**lib-server unit rows:**
- a block with `CreateInstallDirFailed` and both facts gives `scriptFailed` with `writeFailure`, in both start and
  transfer;
- without the facts, no `writeFailure`;
- the lock loop's `retriesExhausted` carries `attempts` and the last block's `lockPath`.

**remote-ssh unit rows (`failure.test.ts`):**
- `writeFailure` gives `logDetail` `cannot write /p: Permission denied` with reason S075;
- `retriesExhausted` with `lockPath` gives R5's text, and without it the short text.

**Real-host rows** (`tests/acceptance/server/`, against the harness host, opt-in like the other real-shell rows):
- the install step as `harness-ro` gives `CreateInstallDirFailed` with `writeFailedPath` under
  `/home/harness-ro/.vscodium-server-insiders/bin/`;
- a second process holding the harness user's lock gives `LockBusy` with `lockPath`.

**VSCodium row** (athena's): a failing connect in `tests/acceptance/suite-failure/cases.json`, alias `readonly`:
- the script answers the failure dialog with dismiss and the mitigation pick with dismiss, as `refused` does;
- the dialog is `Could not establish connection to "readonly": Failed to install the VS Code Server`. Take the exact
  dialog text from the run, measured, not written by guess;
- cite `#668`, and a row in `suite-failure` that the launch's log has a line containing
  `cannot write /home/harness-ro/.vscodium-server-insiders/bin/`;
- the connect ends within 15 s, not after the lock loop's 55 s. Add a `bound` from the first `progress` line of 15000
  ms.

**It must fail on main:** run the VSCodium case on main first. It ends as `retriesExhausted` after about 55 s. Paste it
in the PR.

## 6. Gates and review

All gates, with the changed lib-server and remote-ssh files at 100 % and shellcheck on the scripts. Run the full
VSCodium suite with every launch green, and the server rows with the archive. PR title
`lib-server, remote-ssh: a host folder that can't be written fails with S075 and its path (card server-19, #668)`.
themis or triton reviews (security: the `/tmp` guards keep failing closed); athena gives the design check; proteus
reruns the read-only-folder repro.

## 7. Open rows (stop and report on #668)

1. **`flock -n` prints text when the lock is held** on the harness host's `flock` (BusyBox or util-linux), so R3's
   empty-text rule can't tell busy from broken. Report the exact output of both cases. Don't switch to exit codes by
   guess.
2. **AFS without the lock right**, where `flock` fails but the `ln` method or `lockfilesInTmp` would work: this card
   reports the failure with its text. Choosing a fallback is F-2408's to rule (`remote.SSH.useFlock` and
   `remote.SSH.lockfilesInTmp` are the user's switches). Note it on #668, and don't add a fallback.
3. **The CLI path's install body** (`INSTALL_CLI_BODY`) has the same writes. Apply R1 to its `mkdir -p` lines too. If
   the CLI path has its own lock loop or failure mapping beyond the ones named here, report it rather than copying the
   mapping a third time.
