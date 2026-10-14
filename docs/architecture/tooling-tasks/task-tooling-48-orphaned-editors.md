# Task card tooling-48: an acceptance harness that dies leaves no editor running

Issue: #875. Not gating (rooms, and `/tmp` folders on self-hosted runners; CI's runner reaps a job's processes). R-99: tools only, nothing under
`packages/*/src`. Size: S–M. Builder: `task:claude`.

## 1. Why

proteus measured it, from selene's report:
- `startDetached`'s `stop()` (`tools/acceptance-plain.ts:264`, a SIGTERM to the editor's process group) ends the
  editor within 6 s, both idle and with a failure dialog showing.
- CI leaks nothing: 4 runners probed had no editor left after their jobs.
- **The leak:** the harness process is killed before `runAcceptance`'s `finally` (`tools/acceptance.ts:916`). That
  happens with a tool-call timeout in a room, or an interrupted command. The editor runs in its own session
  (`detached: true`), so it outlives the harness.
- `cleanRun`'s sweep of left-over editors takes only those older than `STALE_EDITOR_SECONDS` (2 h), and it runs only as
  CI's `pnpm acceptance:clean`, never at a room run's start.
- In selene's room, the left-over editors made the next run's trust-terminal row time out ("window local to activate
  its agent") in runs 2–4 in a row.

**What we already have:** a room run's id is `local-<the harness's pid>` (`acceptanceRunId`, `acceptance-run.ts:79`).
Its folder is `<tmp>/acceptance-local-<pid>-<suffix>` (`acceptance.ts:845`), and every editor gets
`--user-data-dir=<runFolder>/user-data` (`acceptance-plain.ts:113`, `acceptance.ts:621`). So an editor's own command
line names the harness that started it. No pid file is needed.

## 2. The change

### 2.1 Signals: stop every started editor (`tools/acceptance-plain.ts`, `tools/acceptance.ts`)

1. **`acceptance-plain.ts`:** a module-level `const runningGroups = new Set<number>()`.
   - `startDetached` adds `child.pid` (when it's defined) after the spawn.
   - `stop()` deletes it before it signals.
   - Export `/** Stops every editor group this process started and has not stopped; for a harness that is being
     killed. */ export function stopAllStarted(): void`. It sends SIGTERM to `-pid` for each group, ignores the
     error of a group that's gone, and clears the set.
2. **`acceptance.ts`, `runAcceptance`:** at its start, before `mkdtempSync`, install the handlers:

   ```ts
   const onSignal = (signal: NodeJS.Signals): void => {
     stopAllStarted();
     for (const container of started) {
       dependencies.command('docker', ['rm', '--force', container]);
     }
     rmSync(runFolder, {recursive: true, force: true});
     process.exit(128 + osConstants.signals[signal]);
   };
   process.once('SIGINT', onSignal);
   process.once('SIGTERM', onSignal);
   ```

   - `runFolder` and `started` are declared before the handler is installed, so that it can read them. Where the
     current order prevents that, declare them first and assign them after.
   - Remove both listeners in the `finally` (`process.off`), so a test that calls `runAcceptance` twice doesn't stack
     them.
   - `osConstants` is `import {constants as osConstants} from 'node:os'`.
   - The handler is synchronous by design: `stops` (async) don't run here. The editors and containers are what leak.
3. **Not covered by the handler:** a SIGKILL, which can't be caught. §2.2 covers it at the next start.

### 2.2 The sweep by the harness's pid (`tools/acceptance-run.ts`)

1. Export

   ```ts
   /**
    * Ends the editors of room runs whose harness is gone, at any age: an editor whose user-data folder lies in an
    * `acceptance-local-<pid>-…` run folder, where no process `<pid>` runs a harness any more.
    */
   export function sweepOrphanedEditors(
     command: CommandRunner,
     isHarness: (processId: number) => boolean,
   ): void
   ```

   - `command('pgrep', ['-a', '-f', '--', 'acceptance-local-[0-9]+-[A-Za-z0-9]+/user-data'])`. Status 1 (none) is
     no error, and its output is one `<pid> <command line>` per line.
   - For each line, the harness pid is the first match of `/acceptance-local-(\d+)-[A-Za-z0-9]+\/user-data/`.
     When `isHarness(harnessPid)` is false, the editor is an orphan. `pgidOf` reads
     `command('ps', ['-o', 'pgid=', '-p', String(pid)]).stdout.trim()`; skip a line whose `ps` gives no number, because
     the process has already gone.
   - **Which group may be signalled** (themis, #876, measured live). A runner launch's editor and its test-cli `node`
     stay in the harness's own process group; only plain launches' editors lead a group of their own. Two harnesses
     started from one non-interactive shell or loop share a group. So a group is ended with
     `command('pkill', ['-TERM', '-g', String(group)])` **only when** both hold:
     1. the group isn't the sweeper's own (`group !== pgidOf(process.pid)`, read once per sweep); and
     2. its leader (the process whose pid is `group`) is either one of the matched orphan processes, or no longer
        exists (`ps -o pid= -p <group>` gives nothing): a dead harness that led it.
   - **Otherwise**, for example the sweeper's own group or a group led by a live shell, end each matched orphan process
     on its own with `command('kill', ['-TERM', String(pid)])`. An editor's main process ends its zygotes when it
     exits.
   - End each group once, and each process once, even when several matched.
   - **Zygotes go through the group, never by argument** (proteus, #876, on the pinned VSCodium 1.140.06829-insider,
     x64). Of the editor's 10 processes, the three `--type=zygote` processes carry no `--user-data-dir`. The main,
     GPU, renderer and utility processes do. All 10 are in the main process's group, and a SIGTERM to that group ends
     them within about 4 s. So the sweep matches any process that carries the folder and ends its whole group, and
     never looks for zygotes on their own.
2. **`isHarness`** (the real one, beside `runCommand`): `true` when `/proc/<pid>/cmdline` exists and contains
   `acceptance`, and `false` when it's missing or doesn't. A reused pid that runs something else counts as gone. On a
   system with no `/proc` (macOS), it returns `true`, so nothing is swept, and the 2 h rule still applies.
3. **Where it runs:**
   - **at the start of `runAcceptance`**, with `runCommand` and the real `isHarness`, so a room run cleans up after
     a killed one;
   - **in `cleanRun`**, before the 2 h `pkill`. That `pkill` stays for CI's ids, which name no pid.
4. Rename `STALE_EDITOR_SECONDS` to `STALE_RUN_SECONDS` only if tooling-47 (#873) hasn't done it yet. Otherwise use
   the name it left.

### 2.3 The short socket folders (athena, #876)

When the run folder is too deep for a Unix socket path, the windows harness makes short folders outside it, and
nothing removes them. On a self-hosted runner, `/tmp` outlives the job. The two are:
- `agentSocketPath`'s `/tmp/agent-…` (`acceptance-keys.ts:182`, called at `acceptance.ts:579`);
- `controlFolderOf`'s `/tmp/control-…`, from #877. **Build on #877 merged**, and if it hasn't merged, wait for it.

1. **`runAcceptance` records what it made.** It holds `const shortFolders: string[] = []`, declared before the signal
   handler of §2.1. It passes both functions a maker that records:

   ```ts
   function shortFolderMaker(prefix: string): () => string {
     return () => {
       const folder = mkdtempSync(prefix);
       shortFolders.push(folder);
       return folder;
     };
   }
   ```

   That is `agentSocketPath(runFolder, shortFolderMaker('/tmp/agent-'))` and `controlFolderOf(runFolder,
   shortFolderMaker('/tmp/control-'))`. The defaults of the two functions stay for their other callers.
2. **`acceptance.ts` exports `MASTER_ALIASES`:** `['master', 'master-ask', 'master-yes', 'master-autoask'] as const`.
   `harnessSshConfig` builds its master blocks from it, so the list exists once.
3. **`endShortFolders(command, configFile, folders)`**, exported from `acceptance.ts`:
   - for each alias of `MASTER_ALIASES`, `command('ssh', ['-F', configFile, '-o', 'ControlMaster=no', '-O', 'exit',
     alias])`, ignoring the status, since no master may run;
   - then `rmSync(folder, {recursive: true, force: true})` for each folder.
   It is synchronous, so the signal handler can call it.
4. **It's called** in `runAcceptance`'s `finally`, before `rmSync(runFolder)`, and in §2.1's `onSignal`, before the run
   folder's removal. The `configFile` is `path.join(runFolder, 'ssh_config')`. When the run ended before that file
   was written, the `ssh -O exit` calls are skipped (`existsSync`), and the folders are still removed.

## 3. Rows

| File | Name | Expected |
|---|---|---|
| `tools/acceptance-plain.test.ts`, in `describe('startDetached')` | `tooling-48: stopAllStarted stops every started program` | two `startDetached(writer(…))` tick writers, as the existing rows use, then `stopAllStarted()`: neither file grows after it (the existing rows' wait) |
| same | `tooling-48: stopAllStarted after a program's own stop() is harmless, and a second call does nothing` | `stop()`, then `stopAllStarted()` twice: no throw, and the file doesn't grow |
| `tools/acceptance-run.test.ts` | `tooling-48: an editor whose harness is gone is ended, at any age` | `pgrep` gives `501 /x/code --user-data-dir=/tmp/acceptance-local-77-AbC/user-data`; `isHarness(77)` is false; `ps` gives `500`: one `pkill -TERM -g 500` |
| same | `tooling-48: an editor whose harness runs is left alone` | `isHarness(77)` is true: no `pkill` |
| same | `tooling-48: a CI run's editor is not the sweep's` | `pgrep` (its pattern requires `local`) gives nothing for a `acceptance-123-1-job-AbC` folder: no `ps`, no `pkill` |
| same | `tooling-48: the sweeper's own group is never signalled` | the orphan's `ps` pgid equals the sweeper's: no `pkill -g`; one `kill -TERM <orphan pid>` |
| same | `tooling-48: a group led by a matched orphan is ended as a group` | the leader pid is one of the matched lines: one `pkill -TERM -g <group>` |
| same | `tooling-48: a group whose leader is gone is ended as a group` | `ps -o pid= -p <group>` gives nothing: one `pkill -TERM -g <group>` |
| same | `tooling-48: a group led by a live process that isn't matched gets only the orphan's own signal` | the leader exists and isn't matched: `kill -TERM <orphan pid>`, and no `pkill -g` |
| same | `tooling-48: two processes of one group end it once` | two lines, `ps` gives the same pgid: one `pkill` |
| same | `tooling-48: no editor running is no error` | `pgrep` status 1: nothing else runs |
| same | `tooling-48: cleanRun sweeps by pid before the 2 h rule` | the order of the recorded commands |
| `tools/acceptance.test.ts` | `tooling-48: a SIGTERM during a run stops the editors, removes the containers and the run folder, and exits 143` | `runAcceptance` with fake dependencies whose `bundleSuite` emits `process.emit('SIGTERM')`, with `process.exit` stubbed: the stubbed `stopAllStarted` was called, `docker rm --force <c>` was recorded, the run folder is gone, and the exit code is 143 |
| same | `tooling-48: a run with a deep run folder removes its agent and control folders when it ends` | `runAcceptance` with `tmpdir()` stubbed to a path over the limit: after the run, both recorded folders are gone; `ssh -O exit` was recorded once per master alias, with `-o ControlMaster=no`, before the removals |
| same | `tooling-48: the signal path removes them too` | as the SIGTERM row, with the deep folder: both folders are gone before the exit |
| same | `tooling-48: a run that fails before its ssh_config removes its folders without ssh -O exit` | `prepare` throws after the agent folder was made: the folder is gone, and there's no `ssh` call |
| same | `tooling-48: the master blocks of the ssh_config come from MASTER_ALIASES` | each alias of `MASTER_ALIASES` has a `Host` block with a `ControlPath` |
| same | `tooling-48: the handlers are removed when the run ends` | `process.listenerCount('SIGTERM')` is the same before and after a run |

**Room proof, in the PR:** start `pnpm test:acceptance:vscodium` and `kill -TERM` the harness while an editor runs.
Show `pgrep -af user-data` empty within 10 s. Then `kill -KILL` a second run's harness, start a third, and show the
second run's editor gone before the third's first launch.

## 4. Gates and review

Run all gates. PR title: `tools: an acceptance harness that dies leaves no editor running (card tooling-48, #875)`.
Request athena only; hermes assigns the peer.

## 5. Open rows (stop and report on #875)

1. After a SIGKILL of the harness, an editor process that carries no `--user-data-dir` (a zygote) is left outside
   every swept group: report it with `ps -o pid,pgid,args` from the room proof.
2. `process.exit` inside a signal handler cuts off output the PR's room proof needs: report it, and don't add an
   async path.
