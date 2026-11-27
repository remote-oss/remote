import {deepStrictEqual, throws} from 'node:assert';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  ObsoleteNotYet,
  obsoleteFoldersOf,
} from '../tests/acceptance/extensionpack/obsolete-folders.ts';

describe('the .obsolete read of the extensionpack suite (card #3237)', () => {
  let folder = '';

  /** A .obsolete file in a fresh folder. */
  function file(): string {
    folder = mkdtempSync(path.join(tmpdir(), 'obsolete-folders-'));
    return path.join(folder, '.obsolete');
  }

  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('a file that is not there lists no folders', () => {
    deepStrictEqual(obsoleteFoldersOf(file()), []);
  });

  it('a text that does not parse, the half the editor has written, is the wait\'s "not yet", naming the text', () => {
    const target = file();
    writeFileSync(target, '{"remote-oss.remote-containers-');
    throws(() => obsoleteFoldersOf(target), {
      notYet: true,
      message: 'the .obsolete does not parse: {"remote-oss.remote-containers-',
    });
  });

  it('a complete text lists the folders it names, sorted', () => {
    const target = file();
    writeFileSync(
      target,
      JSON.stringify({
        'remote-oss.remote-ssh-0.1.0__remote-oss': 1,
        'remote-oss.remote-containers-0.1.0__remote-oss': 2,
      }),
    );
    deepStrictEqual(obsoleteFoldersOf(target), [
      'remote-oss.remote-containers-0.1.0__remote-oss',
      'remote-oss.remote-ssh-0.1.0__remote-oss',
    ]);
  });

  it('a text that parses to something other than an object stands, unwrapped', () => {
    const target = file();
    writeFileSync(target, 'null');
    deepStrictEqual(
      (() => {
        try {
          obsoleteFoldersOf(target);
          return 'no failure';
        } catch (failure) {
          return [
            failure instanceof ObsoleteNotYet,
            failure instanceof TypeError,
          ];
        }
      })(),
      [false, true],
    );
  });

  it('a read that fails for any other reason stands, unwrapped', () => {
    const target = file();
    mkdirSync(target);
    deepStrictEqual(
      (() => {
        try {
          obsoleteFoldersOf(target);
          return 'no failure';
        } catch (failure) {
          return [
            failure instanceof ObsoleteNotYet,
            (failure as NodeJS.ErrnoException).code,
          ];
        }
      })(),
      [false, 'EISDIR'],
    );
  });
});
