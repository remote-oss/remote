import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {overrideStoreOf} from '../../src/cli/override-files.ts';

describe('the override file store (card containers-04)', () => {
  let folder = '';

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'overrides-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('C3: the folder is private to the user, the file too, and it holds the text', async () => {
    const file = await overrideStoreOf(folder).write('{"a": 1}');
    deepStrictEqual(
      [
        (statSync(path.dirname(file)).mode & 0o777).toString(8),
        (statSync(file).mode & 0o777).toString(8),
        readFileSync(file, 'utf8'),
        path.dirname(file),
      ],
      ['700', '600', '{"a": 1}', path.join(folder, 'cli-overrides')],
    );
  });

  it('C3: removing deletes the file, and removing a file that is gone is not an error', async () => {
    const store = overrideStoreOf(folder);
    const file = await store.write('x');
    await store.remove(file);
    await store.remove(file);
    deepStrictEqual(existsSync(file), false);
  });

  it('C3: a second write is another file with a name of 16 hex digits', async () => {
    const store = overrideStoreOf(folder);
    const [first, second] = [await store.write('a'), await store.write('b')];
    deepStrictEqual(
      [first === second, /^[0-9a-f]{16}\.json$/.test(path.basename(first))],
      [false, true],
    );
  });
});
