/**
 * @fileoverview The POSIX bootstrap script's kill, uninstall and cleanup rows, and its delivery rows, run for real over stand-in tools.
 */

import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {scriptFor, type ScriptParameters} from '../../src/index.ts';
import {type FakeHost, parametersFor, runScript, single} from './fake-host.ts';
import {installHostHooks, statusOf} from './bootstrap-script.fixture.ts';

describe('the POSIX bootstrap script', () => {
  let host: FakeHost;
  installHostHooks(made => {
    host = made;
  });

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
        utimesSync(path.join(binFolder, name), seconds, seconds);
      });
      runScript(host, single('cleanup'), parameters);
      return readdirSync(binFolder).sort();
    }

    it('F-2413.BR-9: cleanup keeps the newest installs and the current one', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 2};
      deepStrictEqual(
        binAfter(['new1', 'new2', 'old3', 'old4', 'abc123'], parameters),
        ['abc123', 'new1', 'new2'],
      );
    });

    it('F-2413.BR-9: cleanup removes the log of an install it removes', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      binAfter(['new1', 'old2', 'abc123'], parameters);
      deepStrictEqual(
        existsSync(path.join(host.home, '.server-data', '.old2.log')),
        false,
      );
    });

    it('F-2413.BR-9: cleanup removes the three socket files of an install it removes', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      const dataFolder = path.join(host.home, '.server-data');
      mkdirSync(dataFolder, {recursive: true});
      for (const extension of ['log', 'pid', 'token']) {
        writeFileSync(path.join(dataFolder, `.old2.socket.${extension}`), '');
      }
      binAfter(['new1', 'old2', 'abc123'], parameters);
      deepStrictEqual(
        ['log', 'pid', 'token'].map(extension =>
          existsSync(path.join(dataFolder, `.old2.socket.${extension}`)),
        ),
        [false, false, false],
      );
    });

    it('F-2413.BR-9: cleanup leaves an install whose lock is held', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'keepNewest', count: 1};
      deepStrictEqual(
        binAfter(['new1', 'old2', 'abc123'], parameters, 'old2'),
        ['abc123', 'new1', 'old2'],
      );
    });

    const FORTY = 'a'.repeat(40);
    const OTHER_COMMIT = 'b'.repeat(40);

    it('F-6304.BR-8: onlyCurrentRemoveLeftovers removes other commits and leftovers', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'onlyCurrentRemoveLeftovers'};
      deepStrictEqual(
        binAfter(
          [OTHER_COMMIT, `${FORTY}-1700000000`, 'notes', 'abc123'],
          parameters,
        ),
        ['abc123', 'notes'],
      );
    });

    it('F-6304.BR-7: onlyCurrentKeepLeftovers keeps the leftovers', () => {
      const parameters = parametersFor();
      parameters.cleanup = {kind: 'onlyCurrentKeepLeftovers'};
      deepStrictEqual(
        binAfter(
          [OTHER_COMMIT, `${FORTY}-1700000000`, 'notes', 'abc123'],
          parameters,
        ),
        [`${FORTY}-1700000000`, 'abc123', 'notes'],
      );
    });

    it('F-2413: cleanup with no bin/ is Ok', () => {
      deepStrictEqual(statusOf(host, single('cleanup'), parametersFor()), 'Ok');
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
      const text = scriptFor(single('install'), 'powershell', parametersFor());
      deepStrictEqual(text.includes('status=ServerFailedToStart'), true);
    });

    it('F-2701: the PowerShell stand-in is far below the command-line limit', () => {
      const text = scriptFor(single('install'), 'powershell', parametersFor());
      deepStrictEqual(text.length < 8192, true);
    });

    it('R-86: nothing in the POSIX script names a bash feature', () => {
      const text = scriptFor(single('install'), 'posixShell', parametersFor());
      deepStrictEqual(/\[\[|\bshopt\b|\bdeclare\b|\blocal\b/.test(text), false);
    });
  });
});
