import {deepStrictEqual, rejects} from 'node:assert';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nodeCredentialsPort} from '../../src/index.ts';

describe('the netrc file of the client (card server-23)', () => {
  let folder = '';
  let home = '';

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'netrc-'));
    home = path.join(folder, 'home');
    mkdirSync(home);
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  function textsOf(
    environment: Record<string, string | undefined>,
    platform: string,
  ): Promise<string | undefined> {
    return nodeCredentialsPort({
      environment,
      platform,
      homeFolder: home,
    }).readNetrc();
  }

  it('server-23: NETRC wins over ~/.netrc', async () => {
    writeFileSync(path.join(home, '.netrc'), 'home');
    const named = path.join(folder, 'named');
    writeFileSync(named, 'named');
    deepStrictEqual(await textsOf({NETRC: named}, 'linux'), 'named');
  });

  it('server-23: NETRC names the only file: a missing one means no credentials, with ~/.netrc present', async () => {
    writeFileSync(path.join(home, '.netrc'), 'home');
    deepStrictEqual(
      await textsOf({NETRC: path.join(folder, 'missing')}, 'linux'),
      undefined,
    );
  });

  it('server-23: an empty or unset NETRC reads ~/.netrc', async () => {
    writeFileSync(path.join(home, '.netrc'), 'home');
    deepStrictEqual(
      [
        await textsOf({NETRC: ''}, 'linux'),
        await textsOf({NETRC: undefined}, 'linux'),
        await textsOf({}, 'linux'),
      ],
      ['home', 'home', 'home'],
    );
  });

  it('server-23: _netrc is read on win32 only, and .netrc comes first there', async () => {
    writeFileSync(path.join(home, '_netrc'), 'underscore');
    const onLinux = await textsOf({}, 'linux');
    const onWindows = await textsOf({}, 'win32');
    writeFileSync(path.join(home, '.netrc'), 'dot');
    deepStrictEqual(
      [onLinux, onWindows, await textsOf({}, 'win32')],
      [undefined, 'underscore', 'dot'],
    );
  });

  it('server-23: no file gives undefined', async () => {
    deepStrictEqual(await textsOf({}, 'win32'), undefined);
  });

  it('server-23: a path that cannot be read as a file throws', async () => {
    await rejects(textsOf({NETRC: home}, 'linux'), {code: 'EISDIR'});
  });
});
