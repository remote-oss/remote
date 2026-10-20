import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nodePreconnectFiles} from '../../src/preconnect/node-files.ts';

describe('the reads of a pre-connection script on this machine (card connect-87)', () => {
  it('F-2108 AC-18, AC-25: a file and a folder exist, a missing path does not, and the bytes of a file are read', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'preconnect-'));
    try {
      const file = path.join(folder, 'x.sh');
      writeFileSync(file, 'echo hi\n');
      deepStrictEqual(
        [
          await nodePreconnectFiles.exists(file),
          await nodePreconnectFiles.exists(folder),
          await nodePreconnectFiles.exists(path.join(folder, 'missing.sh')),
          Buffer.from(await nodePreconnectFiles.readFile(file)).toString(),
        ],
        [true, true, false, 'echo hi\n'],
      );
    } finally {
      rmSync(folder, {recursive: true});
    }
  });

  it("F-2108 AC-36: a path the system cannot examine rejects with its error, and a missing file's read rejects", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'preconnect-'));
    try {
      const file = path.join(folder, 'x.sh');
      writeFileSync(file, '');
      const outcomes = await Promise.allSettled([
        nodePreconnectFiles.exists(path.join(file, 'below')),
        nodePreconnectFiles.readFile(path.join(folder, 'missing.sh')),
      ]);
      deepStrictEqual(
        outcomes.map(outcome =>
          outcome.status === 'rejected'
            ? (outcome.reason as NodeJS.ErrnoException).code
            : 'settled',
        ),
        ['ENOTDIR', 'ENOENT'],
      );
    } finally {
      rmSync(folder, {recursive: true});
    }
  });
});
