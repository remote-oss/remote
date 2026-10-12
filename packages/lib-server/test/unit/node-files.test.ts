import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nodeClientFiles, sha256Of} from '../../src/index.ts';

/** Runs `body` in a folder of its own, removed afterwards. */
async function inFolder(
  body: (folder: string) => Promise<void>,
): Promise<void> {
  const folder = mkdtempSync(path.join(tmpdir(), 'node-files-'));
  try {
    await body(folder);
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

describe('the client files on Node.js (V4)', () => {
  it('V4: the size and the SHA-256 of a file', async () => {
    await inFolder(async folder => {
      const file = path.join(folder, 'archive');
      writeFileSync(file, 'abc');
      deepStrictEqual(
        [
          await nodeClientFiles.size(file),
          await sha256Of(file),
          await nodeClientFiles.sha256(file),
        ],
        [
          3,
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        ],
      );
    });
  });

  it('V4: a file exists, a missing file and a folder do not count', async () => {
    await inFolder(async folder => {
      const file = path.join(folder, 'archive');
      writeFileSync(file, 'x');
      deepStrictEqual(
        [
          await nodeClientFiles.exists(file),
          await nodeClientFiles.exists(path.join(folder, 'missing')),
          await nodeClientFiles.exists(folder),
        ],
        [true, false, false],
      );
    });
  });

  it('V4: removing a file that does not exist is not an error', async () => {
    await inFolder(async folder => {
      await nodeClientFiles.remove(path.join(folder, 'missing'));
      deepStrictEqual(await nodeClientFiles.exists(folder), false);
    });
  });

  it('V4: removing a file deletes it', async () => {
    await inFolder(async folder => {
      const file = path.join(folder, 'archive');
      writeFileSync(file, 'x');
      await nodeClientFiles.remove(file);
      deepStrictEqual(await nodeClientFiles.exists(file), false);
    });
  });

  it('V4: a rename moves the file in one step', async () => {
    await inFolder(async folder => {
      const source = path.join(folder, 'part');
      const destination = path.join(folder, 'archive');
      writeFileSync(source, 'content');
      deepStrictEqual(
        [
          await nodeClientFiles.rename(source, destination),
          readFileSync(destination, 'utf8'),
          await nodeClientFiles.exists(source),
        ],
        [{kind: 'renamed'}, 'content', false],
      );
    });
  });

  it('V4: a rename of a missing file fails with the text of the failure', async () => {
    await inFolder(async folder => {
      const outcome = await nodeClientFiles.rename(
        path.join(folder, 'missing'),
        path.join(folder, 'archive'),
      );
      deepStrictEqual(
        outcome.kind === 'failed' ? outcome.detail.includes('ENOENT') : outcome,
        true,
      );
    });
  });
});
