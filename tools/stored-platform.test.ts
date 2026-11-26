import {deepStrictEqual, throws} from 'node:assert';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  PlatformNotYet,
  storedPlatformOf,
} from '../tests/acceptance/windows/stored-platform.ts';

describe('the user settings read of the stored platform (card #3252)', () => {
  let folder = '';

  /** A user settings file in a fresh folder. */
  function file(): string {
    folder = mkdtempSync(path.join(tmpdir(), 'stored-platform-'));
    return path.join(folder, 'settings.json');
  }

  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('a file that is not there holds no platform', () => {
    deepStrictEqual(storedPlatformOf(file()), undefined);
  });

  it('a text that does not parse, the half the extension has written, is the wait\'s "not yet", naming the text', () => {
    const target = file();
    writeFileSync(target, '{"remote.SSH.remotePlatform":{"harness":');
    throws(() => storedPlatformOf(target), {
      notYet: true,
      message:
        'the user settings do not parse: {"remote.SSH.remotePlatform":{"harness":',
    });
  });

  it('a complete text gives the entry it holds', () => {
    const target = file();
    writeFileSync(
      target,
      JSON.stringify({
        'remote.SSH.remotePlatform': {harness: 'linux'},
        'remote.SSH.useLocalServer': false,
      }),
    );
    deepStrictEqual(storedPlatformOf(target), {harness: 'linux'});
  });

  /** What a call of `storedPlatformOf` on `target` gives, or its failure. */
  function resultOf(target: string): unknown {
    try {
      return storedPlatformOf(target);
    } catch (failure) {
      return failure;
    }
  }

  it('a text that parses to something other than an object stands, unwrapped', () => {
    const target = file();
    writeFileSync(target, 'null');
    const failure = resultOf(target);
    deepStrictEqual(
      [failure instanceof PlatformNotYet, failure instanceof TypeError],
      [false, true],
    );
  });

  it('a read that fails for any other reason stands, unwrapped', () => {
    const target = file();
    mkdirSync(target);
    const failure = resultOf(target);
    deepStrictEqual(
      [
        failure instanceof PlatformNotYet,
        (failure as NodeJS.ErrnoException).code,
      ],
      [false, 'EISDIR'],
    );
  });
});
