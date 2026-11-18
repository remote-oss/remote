import {deepStrictEqual} from 'node:assert';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type ConfirmationFileSystem,
  confirmationFilesOf,
  NODE_CONFIRMATION_FILES,
} from '../../src/preconnect/confirmation-files.ts';

const HASH = 'a'.repeat(64);

/** A copy's name: the SHA-256 of a path in hexadecimal. */
const NAME = 'c'.repeat(64);

const POSIX = process.platform !== 'win32';

describe('the files that keep the pre-connection confirmations (card #2812, #2326)', () => {
  let root = '';
  let folder = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'confirmations-'));
    folder = path.join(root, 'preconnect-confirmations');
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  /** Puts `text` in the file of `name` of the folder, owned by this user and writable by it alone. */
  function place(name: string, text: string): string {
    mkdirSync(folder, {recursive: true});
    const file = path.join(folder, name);
    writeFileSync(file, text, {mode: 0o600});
    return file;
  }

  it('a hash written is read back, also by a second copy over the same folder, as after a reload', async () => {
    await confirmationFilesOf(folder).write(NAME, HASH);
    deepStrictEqual(confirmationFilesOf(folder).read(NAME), {
      kind: 'hash',
      hash: HASH,
    });
  });

  it('a name with no file has no copy', () => {
    deepStrictEqual(confirmationFilesOf(folder).read(NAME), undefined);
  });

  it('a hash with exactly one trailing newline is read, and with more of them is ignored as no hash', () => {
    place('1'.repeat(64), `${HASH}\n`);
    place('2'.repeat(64), `${HASH}\n\n`);
    place('3'.repeat(64), `${HASH}\r\n`);
    const copies = confirmationFilesOf(folder);
    deepStrictEqual(
      ['1', '2', '3'].map(digit => copies.read(digit.repeat(64))),
      [
        {kind: 'hash', hash: HASH},
        {kind: 'ignored', reason: 'it is not a hash'},
        {kind: 'ignored', reason: 'it is not a hash'},
      ],
    );
  });

  it('a file that does not hold a lowercase hexadecimal SHA-256 is ignored with its reason', () => {
    const contents = [
      '',
      'not a hash',
      'A'.repeat(64),
      `${HASH}ff`,
      'g'.repeat(64),
      ` ${HASH}`,
    ];
    contents.forEach((text, index) => {
      place(String(index).repeat(64), text);
    });
    const copies = confirmationFilesOf(folder);
    deepStrictEqual(
      contents.map((text, index) => copies.read(String(index).repeat(64))),
      contents.map(() => ({kind: 'ignored', reason: 'it is not a hash'})),
    );
  });

  it('a name that is no file name of the form, and a hash that is no hash, touch nothing', async () => {
    const copies = confirmationFilesOf(folder);
    await copies.write('../escape', HASH);
    await copies.write(NAME, 'not a hash');
    deepStrictEqual(
      [
        copies.read('../escape'),
        existsSync(folder),
        existsSync(path.join(root, 'escape')),
      ],
      [undefined, false, false],
    );
  });

  it('a temporary file of a crash is never read, whatever it holds', () => {
    place(`${NAME}.tmp-abc123`, HASH);
    deepStrictEqual(
      [confirmationFilesOf(folder).read(NAME), readdirSync(folder)],
      [undefined, [`${NAME}.tmp-abc123`]],
    );
  });

  it('a write that fails before the rename leaves no file under the final name', async () => {
    const failing = {
      ...NODE_CONFIRMATION_FILES,
      rename: () => {
        throw new Error('the machine stopped');
      },
    };
    let failure = 'none';
    await confirmationFilesOf(folder, failing)
      .write(NAME, HASH)
      .then(undefined, (caught: unknown) => {
        failure = (caught as Error).message;
      });
    deepStrictEqual(
      [
        failure,
        existsSync(path.join(folder, NAME)),
        confirmationFilesOf(folder).read(NAME),
      ],
      ['the machine stopped', false, undefined],
    );
  });

  it('a write that fails with something that is no Error rejects with an Error that holds its text', async () => {
    const failing = {
      ...NODE_CONFIRMATION_FILES,
      rename: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- a file system that breaks its contract, on purpose
        throw 'plain text';
      },
    };
    let failure: unknown = 'none';
    await confirmationFilesOf(folder, failing)
      .write(NAME, HASH)
      .then(undefined, (caught: unknown) => {
        failure = caught;
      });
    deepStrictEqual(
      [failure instanceof Error, (failure as Error).message],
      [true, 'plain text'],
    );
  });

  it('a second write replaces the first and leaves no temporary file', async () => {
    const copies = confirmationFilesOf(folder);
    await copies.write(NAME, HASH);
    await copies.write(NAME, 'b'.repeat(64));
    deepStrictEqual(
      [copies.read(NAME), readdirSync(folder)],
      [{kind: 'hash', hash: 'b'.repeat(64)}, [NAME]],
    );
  });

  it('a file that fails mid-read is no file', () => {
    place(NAME, HASH);
    const failing: ConfirmationFileSystem = {
      ...NODE_CONFIRMATION_FILES,
      open: file => ({
        ...NODE_CONFIRMATION_FILES.open(file),
        read: () => {
          throw new Error('input/output error');
        },
      }),
    };
    deepStrictEqual(confirmationFilesOf(folder, failing).read(NAME), undefined);
  });

  it('a descriptor that cannot be closed changes nothing of what was read', () => {
    place(NAME, HASH);
    const stubborn: ConfirmationFileSystem = {
      ...NODE_CONFIRMATION_FILES,
      open: file => {
        const opened = NODE_CONFIRMATION_FILES.open(file);
        return {
          ...opened,
          close: () => {
            opened.close();
            throw new Error('bad descriptor');
          },
        };
      },
    };
    deepStrictEqual(confirmationFilesOf(folder, stubborn).read(NAME), {
      kind: 'hash',
      hash: HASH,
    });
  });

  describe('on a system with users and modes', () => {
    beforeEach(function () {
      if (!POSIX) {
        this.skip();
      }
    });

    it('the folder is created with mode 0700 and the file with mode 0600', async () => {
      await confirmationFilesOf(folder).write(NAME, HASH);
      deepStrictEqual(
        [
          (statSync(folder).mode & 0o777).toString(8),
          (statSync(path.join(folder, NAME)).mode & 0o777).toString(8),
        ],
        ['700', '600'],
      );
    });

    it('a symlink is no file, even when it points at a file that holds a hash', () => {
      mkdirSync(folder, {recursive: true});
      const target = path.join(root, 'elsewhere');
      writeFileSync(target, HASH, {mode: 0o600});
      symlinkSync(target, path.join(folder, NAME));
      deepStrictEqual(confirmationFilesOf(folder).read(NAME), {
        kind: 'ignored',
        reason: 'it is a symbolic link',
      });
    });

    it('a symlink swapped in after the file was opened is never read: the facts and the content are those of the file that was opened', () => {
      const file = place(NAME, HASH);
      const target = path.join(root, 'elsewhere');
      writeFileSync(target, 'b'.repeat(64), {mode: 0o600});
      const swapping: ConfirmationFileSystem = {
        ...NODE_CONFIRMATION_FILES,
        open: opened => {
          const handle = NODE_CONFIRMATION_FILES.open(opened);
          rmSync(file);
          symlinkSync(target, file);
          return handle;
        },
      };
      deepStrictEqual(confirmationFilesOf(folder, swapping).read(NAME), {
        kind: 'hash',
        hash: HASH,
      });
    });

    it('a file that cannot be opened for another reason than being absent is ignored with that reason', () => {
      place(NAME, HASH);
      const denied: ConfirmationFileSystem = {
        ...NODE_CONFIRMATION_FILES,
        open: () => {
          throw Object.assign(new Error('permission denied'), {code: 'EACCES'});
        },
      };
      deepStrictEqual(confirmationFilesOf(folder, denied).read(NAME), {
        kind: 'ignored',
        reason: 'it cannot be opened',
      });
    });

    it('a directory is no file', () => {
      mkdirSync(path.join(folder, NAME), {recursive: true});
      deepStrictEqual(confirmationFilesOf(folder).read(NAME), {
        kind: 'ignored',
        reason: 'it is not a regular file',
      });
    });

    it('a file that belongs to another user is ignored', () => {
      place(NAME, HASH);
      const real = NODE_CONFIRMATION_FILES.user() ?? 0;
      const stranger: ConfirmationFileSystem = {
        ...NODE_CONFIRMATION_FILES,
        user: () => real + 1,
      };
      deepStrictEqual(confirmationFilesOf(folder, stranger).read(NAME), {
        kind: 'ignored',
        reason: 'it belongs to another user',
      });
    });

    it('a file that group or others can write is ignored', () => {
      const file = place(NAME, HASH);
      place('d'.repeat(64), HASH);
      chmodSync(file, 0o620);
      chmodSync(path.join(folder, 'd'.repeat(64)), 0o602);
      const copies = confirmationFilesOf(folder);
      deepStrictEqual(
        [NAME, 'd'.repeat(64)].map(name => copies.read(name)),
        [
          {kind: 'ignored', reason: 'group or others can write it'},
          {kind: 'ignored', reason: 'group or others can write it'},
        ],
      );
    });

    it('a file that others can read but not write is read', () => {
      const file = place(NAME, HASH);
      chmodSync(file, 0o644);
      deepStrictEqual(confirmationFilesOf(folder).read(NAME), {
        kind: 'hash',
        hash: HASH,
      });
    });
  });

  it('on a system without users the owner and the mode are not asked', () => {
    place(NAME, HASH);
    const windows: ConfirmationFileSystem = {
      ...NODE_CONFIRMATION_FILES,
      user: () => undefined,
      open: file => ({
        ...NODE_CONFIRMATION_FILES.open(file),
        facts: () => ({regular: true, owner: undefined, mode: 0o666}),
      }),
    };
    deepStrictEqual(confirmationFilesOf(folder, windows).read(NAME), {
      kind: 'hash',
      hash: HASH,
    });
  });
});
