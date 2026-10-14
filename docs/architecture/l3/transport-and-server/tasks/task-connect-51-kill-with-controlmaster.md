# Task card connect-51: Kill ends the connection helper when its ssh is a ControlMaster client

Issue: #782. Release 0.2, **gating**: F-2102 AC-25 (`remote-oss/remote-ssh#20`, 6.8) is a slice-1 criterion. Size: S.
Builder: selene. Found by hestia while building coverage-16 (#576). Her AC-25 Kill row is the acceptance proof.

## 1. The defect

**The rule:** F-2102 AC-25. With a host block that sets `ControlMaster auto`, a `ControlPath` and `ControlPersist`,
killing the host's local connection server ends it. The ControlMaster process keeps running, the window stays connected
with no prompt, and a following reload needs no password.

**What main does:** the Kill works through `stop()` (`packages/lib-helper/src/client/acquire.ts:285`):
- the helper answers `stop`;
- it removes its record and closes its endpoint;
- `ConnectionHandler.close()` (`packages/lib-ssh/src/connection-server/handler.ts:126`) kills its `ssh`.

But the helper **process** never exits. hestia measured it: the same helper pid is alive at the end of the bound, with
no `ssh` child, and the master `ssh … [mux]` keeps running with parent 1.

**Cause** (measured on 2026-10-14 against a local sshd on this room, OpenSSH 10.2p1, Node 24.21):
1. With `ControlMaster auto` and `ControlPersist`, the `ssh` the helper spawned becomes a mux client of a backgrounded
   master. It passes its standard streams to the master over the control socket, so the master holds the helper's
   stdio socketpair ends.
2. `nodeProcessSpawner`'s `onExit` listens to the child's `close` event (`packages/lib-ssh/src/process/node-spawner.ts`,
   lines 33–37). `close` comes only when the process has exited **and** its stdio has closed. After `kill()`, `exit`
   fires with 255, but `close` never fires while the master lives (up to `ControlPersist`, 600 s).
3. `kill()` (`node-spawner.ts:46`) only signals the child. The three stdio streams stay open in the helper, and they
   keep its event loop alive. So the helper process outlives its stop, holding nothing but the dead session's streams.

**The measurement:** a Node script spawns `ssh -T cmhost 'sh -c "echo READY; exec sleep 1000"'` with piped stdio, with
`ControlMaster auto` and `ControlPersist 600`, then calls `child.kill()` after 2 s:

| Case | `exit` | `close` | The Node process |
|---|---|---|---|
| ControlMaster, `kill()` only | 2.0 s, 255 | never | never exits (`timeout 8` kills it) |
| ControlMaster, `kill()`, then `destroy()` on stdin, stdout and stderr | 2.0 s, 255 | 2.0 s | exits |
| `-o ControlMaster=no -o ControlPath=none`, `kill()` only | 2.0 s | 2.0 s | exits |

The same holds when the mux client ends on its own: its `exit` comes, but its `close` doesn't, so the helper never
learns that its `ssh` ended.

## 2. The fix (`packages/lib-ssh/src/process/node-spawner.ts`)

1. **`kill()`:** after `child.kill()`, destroy `child.stdin`, `child.stdout` and `child.stderr`. Then `close` follows at
   once, and nothing holds the caller's event loop.
2. **`onExit`:** the listener is called **once**, on the first of two events:
   - `close`, as today;
   - or `exit` followed by `STDIO_DRAIN_MILLISECONDS = 500` without `close`. In that case the three streams are
     destroyed, and the listener gets the status that `exit` gave (`null` → `undefined`, as today).

   The 500 ms lets a normal process's last output arrive, since its stdio closes within milliseconds of its exit. Only
   a process whose stdio another process has taken over waits the full 500 ms. Name the constant, and put its JSDoc
   reason in one line.
3. **Nothing else changes:** not the `ProcessHandle` port (`process/ports.ts`), not the handler, and not lib-helper.
   The helper then ends as it does without a ControlMaster: `serve` returns, `runConnectionHelper`'s `finally` runs,
   and the process exits.

## 3. Rows

**Unit rows** (`packages/lib-ssh/test/unit/session.test.ts`, beside the existing `nodeProcessSpawner` rows that spawn
`process.execPath`). The stand-in for the master is a grandchild that keeps the child's stdio: the child runs
`process.execPath -e` with a script that spawns `process.execPath -e "setTimeout(() => undefined, 30000)"` with `stdio:
'inherit'`, `detached: true`, then `unref()`s it and either waits or exits. The test kills the grandchild in an
`after`, by the pid the child prints first on stdout.

| Name | Given | Expected |
|---|---|---|
| `connect-51: kill() ends a session whose stdio another process holds` | the child that waits, after its first stdout line | `session.kill()`; `await session.exit()` resolves within 2 000 ms with `undefined` (a signal) |
| `connect-51: a process that exits while another holds its stdio is seen to exit` | the child that exits with status 4 after printing the pid | `await session.exit()` resolves with 4, between 500 and 2 000 ms after the pid line |
| `connect-51: a process's last output still arrives before its exit is reported` | a child that writes `last` to stdout and exits 0 at once, with no grandchild | the output listener got `last` before the exit listener was called |

**Defect rule:** the first two rows must fail on main (they time out) and pass with the fix. Paste both runs.

**Acceptance proof:** hestia's coverage-16 row, `F-2102 AC-25` on the alias `master` (`tests/acceptance/windows/controlmaster.test.ts`, branch `coverage-16`). After the Kill:
- the helper's pid is gone within the row's bound;
- the master `ssh … [mux]` still runs;
- the window is still connected;
- a reload connects with no `maskedInput` line.

The row fails on main and passes with this fix. The builder runs it on top of `coverage-16`, locally only (no stacked
PR), and pastes the outcome in the PR. If coverage-16 has merged by then, the full run proves it.

## 4. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-coverage and coverage.
`node-spawner.ts` is at 100 %, and the lib-ssh ratchet holds. Use the PR title
`lib-ssh: Kill ends the connection helper when its ssh is a ControlMaster client (card connect-51, #782)`. Request
athena only; hermes assigns the peer.

## 5. Open rows (stop and report on #782)

1. One of the rows' grandchild stand-ins doesn't hold the child's stdio on the CI runner (its `close` comes anyway).
   Report the measurement, and use a real `ssh` against the harness host's `master` alias in the acceptance `server/`
   suite instead.
