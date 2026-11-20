/**
 * @fileoverview The POSIX bootstrap script's kill, uninstall and cleanup rows, and its delivery rows, run for real over stand-in tools.
 */

import {deepStrictEqual} from 'node:assert';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {scriptFor, type ScriptParameters} from '../../src/index.ts';
import {type FakeHost, parametersFor, runScript, single} from './fake-host.ts';
import {installHostHooks, statusOf} from './bootstrap-script.fixture.ts';

/** Whether the process is still running after up to 5 s: a signal returns before the process has exited. */
async function stillRunning(processId: number): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      process.kill(processId, 0);
    } catch {
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return true;
}

describe('the POSIX bootstrap script', () => {
  let host: FakeHost;
  installHostHooks(made => {
    host = made;
  });

  /**
   * Installs and starts a server and returns its process id with its pid file removed, so that only the sweep over
   * the command lines can find it.
   */
  function sweptServer(): number {
    runScript(host, single('install'), parametersFor());
    runScript(host, single('start'), parametersFor());
    const pidFile = path.join(
      host.home,
      '.server-data',
      '.abc1230000000000000000000000000000000000.pid',
    );
    const serverPid = Number(readFileSync(pidFile, 'utf8').trim());
    rmSync(pidFile);
    return serverPid;
  }

  describe('kill, uninstall and cleanup', () => {
    it('F-2411.BR-3: kill stops the server and removes bin/', () => {
      runScript(host, single('install'), parametersFor());
      runScript(host, single('start'), parametersFor());
      runScript(host, single('kill'), parametersFor());
      deepStrictEqual(
        existsSync(path.join(host.home, '.server-data', 'bin')),
        false,
      );
    });

    it('F-2411.BR-3: kill stops a server whose candidates find hands to grep in two batches, as it does past the argument limit', async () => {
      const serverPid = sweptServer();
      const batches = path.join(host.home, 'grep-batches');
      const findFile = path.join(host.tools, 'find');
      rmSync(findFile);
      writeFileSync(
        findFile,
        [
          '#!/bin/sh',
          'case " $* " in *" -maxdepth 0 "*) exit 0 ;; esac',
          'while [ "$1" != -exec ]; do shift; done',
          'shift',
          'PROGRAM=$1 FLAGS=$2 FIRST=$4 SECOND=$6',
          'set -- /proc/[0-9]*/cmdline',
          'HALF=$(($# / 2))',
          'INDEX=0 LOWER= UPPER=',
          'for FILE in "$@"; do',
          '  INDEX=$((INDEX + 1))',
          '  if [ "$INDEX" -le "$HALF" ]; then LOWER="$LOWER $FILE"; else UPPER="$UPPER $FILE"; fi',
          'done',
          `for BATCH in "$LOWER" "$UPPER"; do echo batch >>'${batches}'; "$PROGRAM" "$FLAGS" -e "$FIRST" -e "$SECOND" $BATCH; done`,
          'exit 0',
        ].join('\n'),
      );
      chmodSync(findFile, 0o755);
      runScript(host, single('kill'), parametersFor());
      const alive = await stillRunning(serverPid);
      deepStrictEqual(
        [readFileSync(batches, 'utf8').trim().split('\n').length, alive],
        [2, false],
      );
    });

    it('F-2411.BR-3: kill with a find that fails, as one without -exec {} + does, still stops the server, its candidates read by one grep', async () => {
      const serverPid = sweptServer();
      const findFile = path.join(host.tools, 'find');
      rmSync(findFile);
      writeFileSync(
        findFile,
        ['#!/bin/sh', "echo 'find: unrecognized: {}' >&2", 'exit 1'].join('\n'),
      );
      chmodSync(findFile, 0o755);
      runScript(host, single('kill'), parametersFor());
      deepStrictEqual(await stillRunning(serverPid), false);
    });

    it('F-2411.BR-3: kill keeps the candidates find listed when find then exits non-zero, as processes ending during its walk make it, and runs no grep over the glob', async () => {
      const serverPid = sweptServer();
      const findFile = path.join(host.tools, 'find');
      rmSync(findFile);
      writeFileSync(
        findFile,
        [
          '#!/bin/sh',
          'case " $* " in *" -maxdepth 0 "*) exit 0 ;; esac',
          `echo /proc/${String(serverPid)}/cmdline`,
          "echo 'find: /proc/1/cmdline: No such file or directory' >&2",
          'exit 1',
        ].join('\n'),
      );
      chmodSync(findFile, 0o755);
      const grepFile = path.join(host.tools, 'grep');
      const realGrep = readlinkSync(grepFile);
      const globCalls = path.join(host.home, 'glob-greps');
      rmSync(grepFile);
      writeFileSync(
        grepFile,
        [
          '#!/bin/sh',
          `case " $* " in *" /proc/"*) echo glob >>'${globCalls}' ;; esac`,
          `exec '${realGrep}' "$@"`,
        ].join('\n'),
      );
      chmodSync(grepFile, 0o755);
      runScript(host, single('kill'), parametersFor());
      deepStrictEqual(
        [await stillRunning(serverPid), existsSync(globCalls)],
        [false, false],
      );
    });

    it('F-2411.BR-3: kill on a host without find still stops the server, its candidates read by one grep', async () => {
      const serverPid = sweptServer();
      rmSync(path.join(host.tools, 'find'));
      runScript(host, single('kill'), parametersFor());
      deepStrictEqual(await stillRunning(serverPid), false);
    });

    it('F-2411.7.E6: kill with nothing installed is Ok', () => {
      deepStrictEqual(statusOf(host, single('kill'), parametersFor()), 'Ok');
    });

    it('F-2412.BR-3: uninstall deletes the data folder', () => {
      runScript(host, single('install'), parametersFor());
      runScript(host, single('uninstall'), parametersFor());
      deepStrictEqual(existsSync(path.join(host.home, '.server-data')), false);
    });

    it('F-2412.7.E6: uninstall with nothing to remove is Ok', () => {
      deepStrictEqual(
        statusOf(host, single('uninstall'), parametersFor()),
        'Ok',
      );
    });

    it('F-2412.BR-4: uninstall leaves other folders of the home alone', () => {
      mkdirSync(path.join(host.home, '.other-data'));
      runScript(host, single('uninstall'), parametersFor());
      deepStrictEqual(existsSync(path.join(host.home, '.other-data')), true);
    });

    /** The custom root of the connect-75 rows, as the host's install setting names it. */
    function custom(): string {
      return path.join(host.home, 'custom');
    }

    it('F-2412.BR-4: with a custom root, uninstall deletes the home data folder', () => {
      mkdirSync(path.join(host.home, '.server-data', 'bin'), {recursive: true});
      const keep = path.join(custom(), '.server-data', 'bin', 'keep.txt');
      mkdirSync(path.dirname(keep), {recursive: true});
      writeFileSync(keep, '');
      runScript(host, single('uninstall'), {
        ...parametersFor(),
        installRoot: custom(),
      });
      deepStrictEqual(
        [existsSync(path.join(host.home, '.server-data')), existsSync(keep)],
        [false, true],
      );
    });

    it('F-2412.BR-4: with a custom root and no home data folder, uninstall is Ok and keeps the custom folder', () => {
      const keep = path.join(custom(), '.server-data', 'bin', 'keep.txt');
      mkdirSync(path.dirname(keep), {recursive: true});
      writeFileSync(keep, '');
      deepStrictEqual(
        [
          statusOf(host, single('uninstall'), {
            ...parametersFor(),
            installRoot: custom(),
          }),
          existsSync(keep),
        ],
        ['Ok', true],
      );
    });

    /** The names under bin/ after making folders with older and older times. */
    function binAfter(
      names: readonly string[],
      parameters: ScriptParameters,
      heldLock?: string,
      freshNames: readonly string[] = [],
    ): string[] {
      const binFolder = path.join(host.home, '.server-data', 'bin');
      mkdirSync(binFolder, {recursive: true});
      for (const name of names) {
        mkdirSync(path.join(binFolder, name));
        writeFileSync(path.join(host.home, '.server-data', `.${name}.log`), '');
      }
      if (heldLock !== undefined) {
        const lock = path.join(
          binFolder,
          heldLock,
          `boot-lock.user.${heldLock}`,
        );
        writeFileSync(lock, '');
        writeFileSync(`${lock}.target`, '');
      }
      names.forEach((name, index) => {
        const seconds = 1_700_000_000 - index * 100;
        // A fresh folder keeps the time it was made: now.
        if (!freshNames.includes(name)) {
          utimesSync(path.join(binFolder, name), seconds, seconds);
        }
      });
      runScript(host, single('cleanup'), parameters);
      return readdirSync(binFolder).sort();
    }

    /** Commit-like names, which the policy that keeps the newest ranks. */
    const NEW1 = '1'.repeat(40);
    const NEW2 = '2'.repeat(40);
    const OLD2 = 'd'.repeat(40);
    const OLD3 = '3'.repeat(40);
    const OLD4 = '4'.repeat(40);

    it('F-2413.BR-9: cleanup keeps the newest installs and the current one', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 2};
      deepStrictEqual(
        binAfter(
          [NEW1, NEW2, OLD3, OLD4, 'abc1230000000000000000000000000000000000'],
          parameters,
        ),
        ['abc1230000000000000000000000000000000000', NEW1, NEW2].sort(),
      );
    });

    it('F-2413.BR-9: cleanup removes the log of an install it removes', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      binAfter(
        [NEW1, OLD2, 'abc1230000000000000000000000000000000000'],
        parameters,
      );
      deepStrictEqual(
        existsSync(path.join(host.home, '.server-data', `.${OLD2}.log`)),
        false,
      );
    });

    it('F-2413.BR-9: cleanup removes the three socket files of an install it removes', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      const dataFolder = path.join(host.home, '.server-data');
      mkdirSync(dataFolder, {recursive: true});
      for (const extension of ['log', 'pid', 'token']) {
        writeFileSync(
          path.join(dataFolder, `.${OLD2}.socket.${extension}`),
          '',
        );
      }
      binAfter(
        [NEW1, OLD2, 'abc1230000000000000000000000000000000000'],
        parameters,
      );
      deepStrictEqual(
        ['log', 'pid', 'token'].map(extension =>
          existsSync(path.join(dataFolder, `.${OLD2}.socket.${extension}`)),
        ),
        [false, false, false],
      );
    });

    it('F-2413.BR-9: cleanup leaves an install whose lock is held', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      deepStrictEqual(
        binAfter(
          [NEW1, OLD2, 'abc1230000000000000000000000000000000000'],
          parameters,
          OLD2,
        ),
        ['abc1230000000000000000000000000000000000', NEW1, OLD2].sort(),
      );
    });

    const FORTY = 'a'.repeat(40);
    const OTHER_COMMIT = 'b'.repeat(40);

    it('F-2413 6.4 step 2: cleanup ranks only the commits, removes a leftover wherever it stands and leaves another folder alone', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 4};
      function commit(digit: string): string {
        return digit.repeat(40);
      }
      const leftover = `${commit('9')}-1700000000`;
      deepStrictEqual(
        binAfter(
          [
            commit('1'),
            'notes',
            commit('2'),
            leftover,
            commit('3'),
            'abc1230000000000000000000000000000000000',
            commit('4'),
            commit('5'),
            commit('6'),
          ],
          parameters,
        ),
        [
          commit('1'),
          commit('2'),
          commit('3'),
          'abc1230000000000000000000000000000000000',
          'notes',
        ].sort(),
      );
    });

    it('F-2413 6.4: cleanup removes a leftover that has not been modified for two hours', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 5};
      const leftover = `${'9'.repeat(40)}-1700000000`;
      const binFolder = path.join(host.home, '.server-data', 'bin');
      mkdirSync(path.join(binFolder, leftover), {recursive: true});
      const twoHoursAgo = (Date.now() - 2 * 3_600_000) / 1000;
      utimesSync(path.join(binFolder, leftover), twoHoursAgo, twoHoursAgo);
      runScript(host, single('cleanup'), parameters);
      deepStrictEqual(existsSync(path.join(binFolder, leftover)), false);
    });

    it('F-2413 6.4: cleanup leaves a leftover that was modified just now, which may be an install in progress, and does not count it', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      const leftover = `${'9'.repeat(40)}-1700000000`;
      deepStrictEqual(
        binAfter(
          [
            leftover,
            '1'.repeat(40),
            'abc1230000000000000000000000000000000000',
          ],
          parameters,
          undefined,
          [leftover],
        ),
        [
          leftover,
          '1'.repeat(40),
          'abc1230000000000000000000000000000000000',
        ].sort(),
      );
    });

    it('F-6304.BR-8: onlyCurrentRemoveLeftovers removes other commits and leftovers', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'onlyCurrentRemoveLeftovers'};
      deepStrictEqual(
        binAfter(
          [
            OTHER_COMMIT,
            `${FORTY}-1700000000`,
            'notes',
            'abc1230000000000000000000000000000000000',
          ],
          parameters,
        ),
        ['abc1230000000000000000000000000000000000', 'notes'],
      );
    });

    it('F-6304.BR-7: onlyCurrentKeepLeftovers keeps the leftovers', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'onlyCurrentKeepLeftovers'};
      deepStrictEqual(
        binAfter(
          [
            OTHER_COMMIT,
            `${FORTY}-1700000000`,
            'notes',
            'abc1230000000000000000000000000000000000',
          ],
          parameters,
        ),
        [
          `${FORTY}-1700000000`,
          'abc1230000000000000000000000000000000000',
          'notes',
        ],
      );
    });

    it('F-2413: cleanup with no bin/ is Ok', () => {
      deepStrictEqual(statusOf(host, single('cleanup'), parametersFor()), 'Ok');
    });

    describe('the cli-bin stages of killed runs (card #2886)', () => {
      const COMMIT = 'abc1230000000000000000000000000000000000';
      const STAGE = `${COMMIT}.1700000000000`;

      /** The host's cli-bin, with bin/ present so the cleanup reaches it. */
      function cliBin(): string {
        const data = path.join(host.home, '.server-data');
        mkdirSync(path.join(data, 'bin'), {recursive: true});
        return path.join(data, 'cli-bin');
      }

      it('removes a stage of a dead pid with its .stage. and .archive. entries, and keeps the stage of a live pid', () => {
        const cliBinFolder = cliBin();
        const ended = spawnSync('true');
        const deadStage = `${STAGE}.${String(ended.pid)}`;
        mkdirSync(path.join(cliBinFolder, deadStage), {recursive: true});
        mkdirSync(
          path.join(cliBinFolder, `${deadStage}.stage.${String(ended.pid)}`),
          {recursive: true},
        );
        writeFileSync(
          path.join(cliBinFolder, `${deadStage}.archive.${String(ended.pid)}`),
          '',
        );
        // Past the sweep floor: an entry the row created seconds ago is younger than ten minutes.
        const aged = new Date(Date.now() - 11 * 60_000);
        for (const name of [
          deadStage,
          `${deadStage}.stage.${String(ended.pid)}`,
          `${deadStage}.archive.${String(ended.pid)}`,
        ]) {
          utimesSync(path.join(cliBinFolder, name), aged, aged);
        }
        const liveStage = `${STAGE}.${String(process.pid)}`;
        mkdirSync(path.join(cliBinFolder, liveStage), {recursive: true});
        // Backdated past the floor, so only the pid check can keep it.
        utimesSync(path.join(cliBinFolder, liveStage), aged, aged);
        deepStrictEqual(
          [
            statusOf(host, single('cleanup'), parametersFor()),
            readdirSync(cliBinFolder).sort(),
          ],
          ['Ok', [liveStage]],
        );
      });

      it('keeps the .stage. and .archive. entries of a live pid', () => {
        const cliBinFolder = cliBin();
        const liveStage = `${STAGE}.${String(process.pid)}`;
        mkdirSync(path.join(cliBinFolder, liveStage), {recursive: true});
        mkdirSync(
          path.join(cliBinFolder, `${liveStage}.stage.${String(process.pid)}`),
          {recursive: true},
        );
        writeFileSync(
          path.join(
            cliBinFolder,
            `${liveStage}.archive.${String(process.pid)}`,
          ),
          '',
        );
        // Backdated past the floor, so only the pid check can keep them.
        const aged = new Date(Date.now() - 11 * 60_000);
        for (const name of [
          liveStage,
          `${liveStage}.stage.${String(process.pid)}`,
          `${liveStage}.archive.${String(process.pid)}`,
        ]) {
          utimesSync(path.join(cliBinFolder, name), aged, aged);
        }
        deepStrictEqual(
          [
            statusOf(host, single('cleanup'), parametersFor()),
            readdirSync(cliBinFolder).sort(),
          ],
          [
            'Ok',
            [
              liveStage,
              `${liveStage}.archive.${String(process.pid)}`,
              `${liveStage}.stage.${String(process.pid)}`,
            ].sort(),
          ],
        );
      });

      it('removes an empty cli-bin', () => {
        const cliBinFolder = cliBin();
        mkdirSync(cliBinFolder, {recursive: true});
        deepStrictEqual(
          [
            statusOf(host, single('cleanup'), parametersFor()),
            existsSync(cliBinFolder),
          ],
          ['Ok', false],
        );
      });

      it('leaves a name that is not the per-run form', () => {
        const cliBinFolder = cliBin();
        mkdirSync(path.join(cliBinFolder, 'notes'), {recursive: true});
        mkdirSync(path.join(cliBinFolder, 'two.fields'), {recursive: true});
        deepStrictEqual(
          [
            statusOf(host, single('cleanup'), parametersFor()),
            readdirSync(cliBinFolder).sort(),
          ],
          ['Ok', ['notes', 'two.fields']],
        );
      });

      it('keeps a per-run name whose third field is not a pid', () => {
        const cliBinFolder = cliBin();
        mkdirSync(path.join(cliBinFolder, 'a.b.c'), {recursive: true});
        mkdirSync(path.join(cliBinFolder, 'x.y.'), {recursive: true});
        deepStrictEqual(
          [
            statusOf(host, single('cleanup'), parametersFor()),
            readdirSync(cliBinFolder).sort(),
          ],
          ['Ok', ['a.b.c', 'x.y.']],
        );
      });

      it('keeps a dead stage younger than the sweep floor of ten minutes', () => {
        const cliBinFolder = cliBin();
        const ended = spawnSync('true');
        const deadStage = `${STAGE}.${String(ended.pid)}`;
        mkdirSync(path.join(cliBinFolder, deadStage), {recursive: true});
        deepStrictEqual(
          [
            statusOf(host, single('cleanup'), parametersFor()),
            readdirSync(cliBinFolder).sort(),
          ],
          ['Ok', [deadStage]],
        );
      });

      it('keeps a dead stage whose mtime is in the future', () => {
        const cliBinFolder = cliBin();
        const ended = spawnSync('true');
        const deadStage = `${STAGE}.${String(ended.pid)}`;
        mkdirSync(path.join(cliBinFolder, deadStage), {recursive: true});
        const future = new Date(Date.now() + 2 * 60_000);
        utimesSync(path.join(cliBinFolder, deadStage), future, future);
        deepStrictEqual(
          [
            statusOf(host, single('cleanup'), parametersFor()),
            readdirSync(cliBinFolder).sort(),
          ],
          ['Ok', [deadStage]],
        );
      });
    });
  });

  describe('delivery and the other interpreter', () => {
    it('F-2703.BR-9: the script runs under dash, as a Debian host does', () => {
      deepStrictEqual(
        statusOf(host, single('install'), parametersFor(), {
          shell: '/bin/dash',
        }),
        'Ok',
      );
    });

    it('F-2701: the PowerShell script is a failure that says it is not available yet', () => {
      const text = scriptFor(
        {installMode: 'stepwise', step: 'prepare'},
        'powershell',
        parametersFor(),
      );
      deepStrictEqual(text.includes('status=ServerFailedToStart'), true);
    });

    it('F-2701: the PowerShell stand-in is far below the command-line limit', () => {
      const text = scriptFor(
        {installMode: 'stepwise', step: 'prepare'},
        'powershell',
        parametersFor(),
      );
      deepStrictEqual(text.length < 8192, true);
    });

    it('R-86: nothing in the POSIX script names a bash feature', () => {
      const text = scriptFor(single('install'), 'posixShell', parametersFor());
      deepStrictEqual(
        /\[\[(?!:[a-z]+:\])|\bshopt\b|\bdeclare\b|\blocal\b/.test(text),
        false,
      );
    });
  });
});
