import {deepStrictEqual, rejects} from 'node:assert';
import {
  type AuthoringFiles,
  isUnder,
  routedFiles,
  windowFiles,
  type WindowFileSystem,
} from '../../src/authoring/window-files.ts';

const TYPES = {file: 1, directory: 2};

/** A file system over strings, as the window's one: entries by path, with the type bits of `vscode.FileType`. */
function fileSystemOf(entries: Record<string, number | Uint8Array>): {
  fileSystem: WindowFileSystem<string>;
  calls: string[];
} {
  const calls: string[] = [];
  const present = new Map(Object.entries(entries));
  return {
    calls,
    fileSystem: {
      stat: address => {
        calls.push(`stat ${address}`);
        const found = present.get(address);
        return found === undefined
          ? Promise.reject(new Error('FileNotFound'))
          : Promise.resolve({type: typeof found === 'number' ? found : 1});
      },
      readDirectory: address => {
        calls.push(`readDirectory ${address}`);
        const prefix = address.endsWith('/') ? address : `${address}/`;
        return present.has(address)
          ? Promise.resolve(
              [...present]
                .filter(
                  ([each]) =>
                    each.startsWith(prefix) &&
                    !each.slice(prefix.length).includes('/'),
                )
                .map(([each, found]): [string, number] => [
                  each.slice(prefix.length),
                  typeof found === 'number' ? found : 1,
                ]),
            )
          : Promise.reject(new Error('FileNotFound'));
      },
      readFile: address => {
        const found = present.get(address);
        return found instanceof Uint8Array
          ? Promise.resolve(found)
          : Promise.reject(new Error('FileNotFound'));
      },
      writeFile: (address, bytes) => {
        calls.push(`writeFile ${address}`);
        present.set(address, bytes);
        return Promise.resolve();
      },
      createDirectory: address => {
        calls.push(`createDirectory ${address}`);
        present.set(address, TYPES.directory);
        return Promise.resolve();
      },
      delete: (address, options) => {
        calls.push(
          `delete ${address} ${options.recursive ? 'recursive' : 'plain'} ${options.useTrash ? 'trash' : 'permanently'}`,
        );
        if (!present.has(address)) {
          return Promise.reject(new Error('FileNotFound'));
        }
        for (const each of [...present.keys()]) {
          if (each === address || each.startsWith(`${address}/`)) {
            present.delete(each);
          }
        }
        return Promise.resolve();
      },
    },
  };
}

describe('the files of the authoring command (card containers-126)', () => {
  describe('the window’s files', () => {
    const BYTES = new TextEncoder().encode('{}');

    function scene() {
      const made = fileSystemOf({
        '/w': TYPES.directory,
        '/w/a.txt': BYTES,
        '/w/sub': TYPES.directory,
        '/w/sub/b.txt': BYTES,
        '/w/link': 64 | TYPES.file,
        '/w/odd': 0,
      });
      return {
        ...made,
        files: windowFiles(made.fileSystem, TYPES, path => path),
      };
    }

    it('F-0801 AC-14: the kind of an entry is file, folder or missing', async () => {
      const {files} = scene();
      deepStrictEqual(
        [
          await files.kindOf('/w/a.txt'),
          await files.kindOf('/w/sub'),
          await files.kindOf('/w/none'),
          await files.exists('/w/a.txt'),
          await files.exists('/w/none'),
        ],
        ['file', 'folder', 'missing', true, false],
      );
    });

    it('F-0801 AC-14: a folder lists its entries with their kinds, and a folder that cannot be listed none', async () => {
      const {files} = scene();
      deepStrictEqual(
        [await files.list('/w'), await files.list('/none')],
        [
          [
            {name: 'a.txt', kind: 'file'},
            {name: 'sub', kind: 'folder'},
            {name: 'link', kind: 'file'},
            {name: 'odd', kind: 'other'},
          ],
          [],
        ],
      );
    });

    it('F-0801 AC-14: a file is read and written, and a folder is made with the ones above it', async () => {
      const {files, calls} = scene();
      await files.write('/w/new.txt', BYTES);
      await files.makeFolder('/w/x/y');
      deepStrictEqual(
        [await files.read('/w/new.txt'), calls.slice(-2)],
        [BYTES, ['writeFile /w/new.txt', 'createDirectory /w/x/y']],
      );
    });

    it('F-0801 AC-14: a file or a folder is removed for good, a folder with what is in it', async () => {
      const {files, calls} = scene();
      await files.removeFile('/w/a.txt');
      await files.removeFolder('/w/sub');
      deepStrictEqual(
        [
          calls.filter(call => call.startsWith('delete')),
          await files.exists('/w/a.txt'),
          await files.exists('/w/sub/b.txt'),
        ],
        [
          [
            'delete /w/a.txt plain permanently',
            'delete /w/sub recursive permanently',
          ],
          false,
          false,
        ],
      );
    });

    it('F-0801 AC-14: removing what is not there is no error, and a removal that fails for another reason is one', async () => {
      const {files, fileSystem} = scene();
      await files.removeFile('/w/none');
      await files.removeFolder('/w/none');
      fileSystem.delete = () => Promise.reject(new Error('no permission'));
      await rejects(files.removeFile('/w/a.txt'), /no permission/);
    });

    it('F-0801 AC-14: the window’s file system has no access check, so there is no creation problem', async () => {
      const {files} = scene();
      deepStrictEqual(await files.creationProblem('/w/new'), undefined);
    });
  });

  describe('the routing', () => {
    function recording(name: string, calls: string[]): AuthoringFiles {
      function note(what: string, file: string): void {
        calls.push(`${name} ${what} ${file}`);
      }
      return {
        kindOf: file => {
          note('kindOf', file);
          return Promise.resolve('file');
        },
        exists: file => {
          note('exists', file);
          return Promise.resolve(true);
        },
        list: file => {
          note('list', file);
          return Promise.resolve([]);
        },
        read: file => {
          note('read', file);
          return Promise.resolve(new Uint8Array());
        },
        write: file => {
          note('write', file);
          return Promise.resolve();
        },
        makeFolder: file => {
          note('makeFolder', file);
          return Promise.resolve();
        },
        removeFile: file => {
          note('removeFile', file);
          return Promise.resolve();
        },
        removeFolder: file => {
          note('removeFolder', file);
          return Promise.resolve();
        },
        creationProblem: file => {
          note('creationProblem', file);
          return Promise.resolve(undefined);
        },
      };
    }

    async function routes(
      folder: string | undefined | (() => string | undefined),
      files: string[],
    ): Promise<string[]> {
      const calls: string[] = [];
      const routed = routedFiles(
        recording('host', calls),
        recording('window', calls),
        folder,
      );
      for (const file of files) {
        await routed.kindOf(file);
      }
      return calls;
    }

    it('F-0801 AC-14: the window’s folder and what is below it go to the window, a sibling with the same prefix and a host path to the host', async () => {
      deepStrictEqual(
        await routes('/workspaces/x', [
          '/workspaces/x',
          '/workspaces/x/.devcontainer/devcontainer.json',
          '/workspaces/xy',
          '/home/user/.config/store',
        ]),
        [
          'window kindOf /workspaces/x',
          'window kindOf /workspaces/x/.devcontainer/devcontainer.json',
          'host kindOf /workspaces/xy',
          'host kindOf /home/user/.config/store',
        ],
      );
    });

    it('F-0801 AC-14: with no folder every call goes to the host', async () => {
      deepStrictEqual(await routes(undefined, ['/workspaces/x/a']), [
        'host kindOf /workspaces/x/a',
      ]);
    });

    it('F-0801 AC-14: a folder given as a function is read at each call', async () => {
      let folder: string | undefined = undefined;
      const calls: string[] = [];
      const routed = routedFiles(
        recording('host', calls),
        recording('window', calls),
        () => folder,
      );
      await routed.kindOf('/w/a');
      folder = '/w';
      await routed.kindOf('/w/a');
      deepStrictEqual(calls, ['host kindOf /w/a', 'window kindOf /w/a']);
    });

    it('F-0801 AC-14: every operation is routed by its path', async () => {
      const calls: string[] = [];
      const routed = routedFiles(
        recording('host', calls),
        recording('window', calls),
        '/w',
      );
      await routed.exists('/w/a');
      await routed.list('/w');
      await routed.read('/w/a');
      await routed.write('/w/a', new Uint8Array());
      await routed.makeFolder('/w/b');
      await routed.removeFile('/w/a');
      await routed.removeFolder('/w/b');
      await routed.creationProblem('/w/c');
      await routed.exists('/h/a');
      await routed.creationProblem('/h/c');
      deepStrictEqual(calls, [
        'window exists /w/a',
        'window list /w',
        'window read /w/a',
        'window write /w/a',
        'window makeFolder /w/b',
        'window removeFile /w/a',
        'window removeFolder /w/b',
        'window creationProblem /w/c',
        'host exists /h/a',
        'host creationProblem /h/c',
      ]);
    });

    it('F-0801 AC-14: a path is under a folder by its segments', () => {
      deepStrictEqual(
        [
          isUnder('/w', '/w'),
          isUnder('/w', '/w/a/b'),
          isUnder('/w', '/wx'),
          isUnder('/w', '/'),
          isUnder('/w/a', '/w'),
          isUnder('/w', '/w/..env'),
          isUnder('/w', '/w/../x'),
        ],
        [true, true, false, false, false, true, false],
      );
    });
  });
});
