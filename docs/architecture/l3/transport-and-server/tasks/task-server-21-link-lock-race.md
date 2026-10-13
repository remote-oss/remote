# Task card server-21: a lock released between `ln` and the holder check is still a busy lock

Issue: #701 (proteus, from CI run 38480261074). Release 0.2: a CI flake on F-2408's lock rows, and a rare product race
when two windows connect to one host at once. Size: S. Builder: hestia (she wrote #683). Spec: F-2408 (the host lock;
remote-oss/remote-ssh#53) with server-19's R3.

## 1. The defect

server-19 (#683) made `lock_take`'s link method (`packages/lib-server/src/scripts/posix-script.ts`) return 1 only for a
held lock:

```sh
if LOCK_ERROR=$(ln "$LOCK_CANDIDATE" "$LOCK_CANDIDATE.target" 2>&1); then
  LOCK_ERROR=''
else
  [ ! -e "$LOCK_CANDIDATE.target" ] || return 1
  return 2
fi
```

Between the failing `ln` and the `-e` test, the holder can release the lock and remove `.target`. The test then finds
no holder, and `lock_take` returns 2. `take_lock_or_finish` reports `CreateInstallDirFailed`, which is S075 "Failed to
install the VS Code Server", instead of `LockBusy` and a retry. `tests/acceptance/server/lock.test.ts:73`
(F-2408 "waits for the other window and then installs") failed this way in CI. Its 500 ms release makes the timing
likely.

## 2. The rule

When `ln` fails and `.target` is gone, the lock was released in between, or `ln` can't work at all here. Tell the two
apart by **taking the lock once more**:
- `lock_release` runs `rm -f "$LOCK_HELD" "$LOCK_HELD.target"`, which removes the **shared candidate file too** (dike
  on #702, reproduced in `sh`). So first **re-create the candidate**,
  `LOCK_ERROR=$( { true >>"$LOCK_CANDIDATE"; } 2>&1 ) || return 2`, exactly as the first attempt does;
- then **try `ln` once more**.

The outcomes:
- the second `ln` succeeds: the lock is taken (return 0), with `LOCK_HELD` and the traps as for a first success;
- the second `ln` fails and `.target` now exists: another window took it in between, so return 1 (busy);
- the second `ln` fails and `.target` is still absent: `ln` can't link here, so return 2 with the **second** `ln`'s
  error text in `LOCK_ERROR`.

Exactly one retry, with no loop and no sleep; the lock loop above does the waiting. The flock method is unchanged:
`flock -n` decides busy with no separate file check, so it has no such window.

## 3. Rows

`packages/lib-server/test/unit/bootstrap-script.test.ts` (or the posix-script rows server-19 added), in a real `sh`,
with a stub `ln` first on `PATH`, made the way `test/unit/fake-host.ts` stubs `uname` for the probe rows:

| Cite | Given | Expected |
|---|---|---|
| #701 | a stub `ln` that, on its first call, removes **both the candidate and `.target`**, as `lock_release` does, and fails (exit 1, text `File exists`), then on the second call runs the real `ln` | `lock_take` returns 0 and the lock is held (the candidate and `.target` exist) |
| #701 | a stub that fails both calls, and creates `.target` before the second fails | returns 1 |
| #701 | a stub that fails both calls and never creates `.target` (text `Operation not permitted`) | returns 2; `LOCK_ERROR` is the second call's text |
| server-19 R3 | the existing link-mode rows (held lock, unwritable folder) | unchanged |

**Mutations** (list both in the PR):
- remove the retry, and the first row fails;
- keep the retry but drop the candidate's re-creation, and the first row fails (the second `ln` finds no candidate:
  `No such file or directory`).

**Real-host check:** run `tests/acceptance/server/lock.test.ts` ten times in a loop on the harness host (link method,
the `useFlock` false case if the file has one), and paste the count: ten green.

## 4. Gates and review

All gates, shellcheck, `posix-script.ts`'s rows. PR title `lib-server: a lock released between ln and the holder check
is still busy (card server-21, #701)`. themis or triton reviews; proteus watches the next CI runs for the F-2408 flake.

## 5. Open rows (stop and report on #701)

1. BusyBox `ln` prints a different text from coreutils' for an existing target. That changes nothing here, since the
   rule tests the file, not the text. Report it only if a row depends on the text.
