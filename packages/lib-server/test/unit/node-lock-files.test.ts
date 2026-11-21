import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nodeLockFiles} from '../../src/index.ts';

/** Runs `body` in a folder of its own, removed afterwards. */
async function inFolder(
  body: (folder: string) => Promise<void>,
): Promise<void> {
  const folder = mkdtempSync(path.join(tmpdir(), 'node-lock-files-'));
  try {
    await body(folder);
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

/** The code of what `work` rejected with, or `resolved`. */
async function codeOfRejection(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
    return 'resolved';
  } catch (caught) {
    return (caught as NodeJS.ErrnoException).code;
  }
}

describe('the client lock files on Node.js (V5, F-2408 BR-6)', () => {
  it('BR-6: the first create makes an empty file, the second finds it', async () => {
    await inFolder(async folder => {
      const file = path.join(folder, 'a.lock');
      deepStrictEqual(
        [
          await nodeLockFiles.createExclusive(file),
          await nodeLockFiles.createExclusive(file),
          readFileSync(file, 'utf8'),
        ],
        ['created', 'exists', ''],
      );
    });
  });

  it('BR-6: a create has made the file by the time it returns, before its promise settles', async () => {
    await inFolder(async folder => {
      const file = path.join(folder, 'a.lock');
      const creating = nodeLockFiles.createExclusive(file);
      const madeOnReturn = existsSync(file);
      deepStrictEqual([madeOnReturn, await creating], [true, 'created']);
    });
  });

  it('BR-6: a create in a folder that does not exist rejects with the error', async () => {
    await inFolder(async folder => {
      deepStrictEqual(
        await codeOfRejection(() =>
          nodeLockFiles.createExclusive(path.join(folder, 'none', 'a.lock')),
        ),
        'ENOENT',
      );
    });
  });

  it("BR-8: the age is counted from the file's modification time; an absent file has none", async () => {
    await inFolder(async folder => {
      const file = path.join(folder, 'a.lock');
      writeFileSync(file, '');
      const fiveMinutesAgo = (Date.now() - 300000) / 1000;
      utimesSync(file, fiveMinutesAgo, fiveMinutesAgo);
      const fileAge = await nodeLockFiles.ageMilliseconds(file);
      deepStrictEqual(
        {
          aboutFiveMinutes:
            fileAge !== undefined && fileAge >= 300000 && fileAge < 310000,
          absent: await nodeLockFiles.ageMilliseconds(
            path.join(folder, 'b.lock'),
          ),
        },
        {aboutFiveMinutes: true, absent: undefined},
      );
    });
  });

  it('BR-8: the age of a path under a file rejects with the error', async () => {
    await inFolder(async folder => {
      const file = path.join(folder, 'plain');
      writeFileSync(file, '');
      deepStrictEqual(
        await codeOfRejection(() =>
          nodeLockFiles.ageMilliseconds(path.join(file, 'a.lock')),
        ),
        'ENOTDIR',
      );
    });
  });

  it('BR-8: remove and removeNow delete the file, and an absent file is no error', async () => {
    await inFolder(async folder => {
      const first = path.join(folder, 'a.lock');
      const second = path.join(folder, 'b.lock');
      writeFileSync(first, '');
      writeFileSync(second, '');
      await nodeLockFiles.remove(first);
      await nodeLockFiles.remove(first);
      nodeLockFiles.removeNow(second);
      nodeLockFiles.removeNow(second);
      deepStrictEqual([existsSync(first), existsSync(second)], [false, false]);
    });
  });

  it('BR-8: removeNow of a path it cannot remove leaves it and does not throw', async () => {
    await inFolder(folder => {
      const busy = path.join(folder, 'busy');
      mkdirSync(busy);
      writeFileSync(path.join(busy, 'inside'), '');
      nodeLockFiles.removeNow(busy);
      deepStrictEqual(existsSync(busy), true);
      return Promise.resolve();
    });
  });
});
