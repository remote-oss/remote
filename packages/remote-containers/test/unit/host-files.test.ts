import {deepStrictEqual} from 'node:assert';
import {chmodSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {hostFiles} from '../../src/authoring/window-files.ts';

/** Runs `body` over a folder of its own and removes it after. */
async function inFolder(body: (folder: string) => Promise<void>) {
  const folder = mkdtempSync(path.join(tmpdir(), 'host-files-'));
  try {
    await body(folder);
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

describe('the files of the machine the extension runs on (card coverage-118)', () => {
  it('coverage-118: a path is a folder, a file or missing, and exists agrees with the kind', async () => {
    await inFolder(async folder => {
      const files = hostFiles();
      const dir = path.join(folder, 'dir');
      await files.makeFolder(dir);
      const file = path.join(folder, 'a.txt');
      await files.write(file, new Uint8Array([1, 2, 3]));
      deepStrictEqual(
        [
          await files.kindOf(dir),
          await files.kindOf(file),
          await files.kindOf(path.join(folder, 'none')),
          await files.exists(file),
          await files.exists(path.join(folder, 'none')),
        ],
        ['folder', 'file', 'missing', true, false],
      );
    });
  });

  it('coverage-118: a write replaces the bytes, and a read gives them back', async () => {
    await inFolder(async folder => {
      const files = hostFiles();
      const file = path.join(folder, 'bytes');
      await files.write(file, new Uint8Array([1, 2, 3]));
      await files.write(file, new Uint8Array([9]));
      deepStrictEqual([...(await files.read(file))], [9]);
    });
  });

  it('coverage-118: a listing gives each entry with its kind, a broken link is other, and an unlistable folder gives none', async () => {
    await inFolder(async folder => {
      const files = hostFiles();
      const dir = path.join(folder, 'sub');
      await files.makeFolder(path.join(dir, 'inner'));
      await files.write(path.join(dir, 'one.txt'), new Uint8Array([1]));
      symlinkSync(path.join(folder, 'nowhere'), path.join(dir, 'broken'));
      const locked = path.join(folder, 'locked');
      await files.makeFolder(locked);
      await files.write(path.join(locked, 'hidden.txt'), new Uint8Array([2]));
      chmodSync(locked, 0o111);
      try {
        const listed = (await files.list(dir))
          .map(each => [each.name, each.kind] as const)
          .sort((a, b) => (a[0] < b[0] ? -1 : 1));
        deepStrictEqual(
          [listed, await files.list(locked)],
          [
            [
              ['broken', 'other'],
              ['inner', 'folder'],
              ['one.txt', 'file'],
            ],
            [],
          ],
        );
      } finally {
        chmodSync(locked, 0o755);
      }
    });
  });

  it('coverage-118: a folder is made with its missing parents, and a file or a folder is removed, with no failure when it is not there', async () => {
    await inFolder(async folder => {
      const files = hostFiles();
      const nested = path.join(folder, 'a', 'b', 'c');
      await files.makeFolder(nested);
      const file = path.join(nested, 'f.txt');
      await files.write(file, new Uint8Array([1]));
      await files.removeFile(file);
      await files.removeFile(file);
      await files.removeFolder(nested);
      await files.removeFolder(nested);
      deepStrictEqual(
        [await files.kindOf(nested), await files.exists(folder)],
        ['missing', true],
      );
    });
  });

  it('coverage-118: creationProblem walks to the nearest existing ancestor, and a not-writable one gives the file system words', async () => {
    await inFolder(async folder => {
      const files = hostFiles();
      const open = path.join(folder, 'open');
      const locked = path.join(folder, 'locked');
      await files.makeFolder(open);
      await files.makeFolder(locked);
      chmodSync(locked, 0o111);
      try {
        deepStrictEqual(
          [
            await files.creationProblem(path.join(open, 'sub')),
            await files.creationProblem(path.join(locked, 'sub')),
          ],
          [undefined, `EACCES: permission denied, access '${locked}'`],
        );
      } finally {
        chmodSync(locked, 0o755);
      }
    });
  });
});
