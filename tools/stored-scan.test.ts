import {deepStrictEqual, throws} from 'node:assert';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scanStored} from '../tests/acceptance/ssh-agents/stored-scan.ts';

/** A scratch folder, removed when `body` ends. */
function inScratch(body: (folder: string) => void): void {
  const folder = mkdtempSync(path.join(tmpdir(), 'stored-scan-'));
  try {
    body(folder);
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

/** Skips the row of `context` for a superuser, who reads any file and lists any folder whatever its mode. */
function skipForSuperuser(context: Mocha.Context): void {
  if (process.getuid?.() === 0) {
    context.skip();
  }
}

describe('the scan of the files an extension stores (card #3109)', () => {
  it('#3109: a file in a folder of the folder is read and reported, which a scan that read the entries as files would miss', () => {
    inScratch(folder => {
      mkdirSync(path.join(folder, 'history'));
      writeFileSync(path.join(folder, 'history', 'entries.json'), 'host-a');
      writeFileSync(path.join(folder, 'other.json'), 'nothing');
      deepStrictEqual(scanStored(folder, 'host-a'), {
        read: 2,
        holding: [path.join('history', 'entries.json')],
      });
    });
  });

  it('#3109: a folder that holds only folders and files without the text reports none and says how many it read', () => {
    inScratch(folder => {
      mkdirSync(path.join(folder, 'empty'));
      writeFileSync(path.join(folder, 'one'), 'x');
      deepStrictEqual(scanStored(folder, 'host-a'), {read: 1, holding: []});
    });
  });

  it('#3109: a folder that is not there holds nothing', () => {
    deepStrictEqual(scanStored('/nonexistent/stored-scan-folder', 'host-a'), {
      read: 0,
      holding: [],
    });
  });

  it('#3109: a file that cannot be read fails the scan with its path, instead of passing as nothing found', function () {
    skipForSuperuser(this);
    inScratch(folder => {
      const file = path.join(folder, 'locked');
      writeFileSync(file, 'host-a');
      chmodSync(file, 0o000);
      throws(
        () => scanStored(folder, 'host-a'),
        (caught: Error) => caught.message.includes(file),
      );
    });
  });

  it('#3109: a folder that cannot be listed fails the scan with its path, instead of passing as no folder', function () {
    skipForSuperuser(this);
    inScratch(folder => {
      const locked = path.join(folder, 'locked');
      mkdirSync(locked);
      chmodSync(locked, 0o000);
      try {
        throws(
          () => scanStored(locked, 'host-a'),
          (caught: Error) => caught.message.includes(locked),
        );
      } finally {
        chmodSync(locked, 0o700);
      }
    });
  });
});
