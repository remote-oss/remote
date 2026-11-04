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
      const subdir = path.join(folder, 'dir');
      await files.makeFolder(subdir);
      const file = path.join(folder, 'a.txt');
      await files.write(file, new Uint8Array([1, 2, 3]));
      deepStrictEqual(
        [
          await files.kindOf(subdir),
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

  it('coverage-118: a listing gives each entry with its kind, a broken link is other, and an unlistable folder gives none (skipped when run as root)', async function () {
    if (process.getuid?.() === 0) {
      this.skip();
    }
    await inFolder(async folder => {
      const files = hostFiles();
      const subdir = path.join(folder, 'sub');
      await files.makeFolder(path.join(subdir, 'inner'));
      await files.write(path.join(subdir, 'one.txt'), new Uint8Array([1]));
      symlinkSync(path.join(folder, 'nowhere'), path.join(subdir, 'broken'));
      const locked = path.join(folder, 'locked');
      await files.makeFolder(locked);
      await files.write(path.join(locked, 'hidden.txt'), new Uint8Array([2]));
      chmodSync(locked, 0o111);
      try {
        const listed = (await files.list(subdir))
          .map(each => [each.name, each.kind] as const)
          .sort((left, right) => (left[0] < right[0] ? -1 : 1));
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

  it('coverage-118: creationProblem walks to the nearest existing ancestor, and a not-writable one gives the file system words (skipped when run as root)', async function () {
    if (process.getuid?.() === 0) {
      this.skip();
    }
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
