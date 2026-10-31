import {deepStrictEqual} from 'node:assert';
import {
  newSlot,
  slotOf,
  storeRootOf,
  tildePath,
  writeMarker,
  type StoreFiles,
} from '../../src/authoring/user-data-store.ts';

/** A store over a map of files; the folders are the first segments below `/store/configs`. */
function storeOf(initial: Readonly<Record<string, string>> = {}): {
  files: StoreFiles;
  written: Map<string, string>;
} {
  const written = new Map(Object.entries(initial));
  return {
    written,
    files: {
      folderNames: () =>
        Promise.resolve([
          ...new Set(
            [...written.keys()].map(file =>
              file.slice('/store/configs/'.length).split('/', 1).join(''),
            ),
          ),
        ]),
      readText: file => Promise.resolve(written.get(file)),
    },
  };
}

const ROOT = storeRootOf('/store');

/** The marker of a slot that belongs to `folder`. */
function markerOf(folder: string): string {
  return `// Maintained by the Dev Container extension\n${JSON.stringify({rootFolder: folder})}\n`;
}

describe('the store of configurations outside the workspace (card containers-91)', () => {
  it('F-0302 AC-4: the root is the configs folder of the global storage, and a slot holds its configuration under .devcontainer', async () => {
    deepStrictEqual(
      [ROOT, await newSlot(ROOT, '/home/a/app', storeOf().files)],
      [
        '/store/configs',
        {
          name: 'app',
          folder: '/store/configs/app',
          configFile: '/store/configs/app/.devcontainer/devcontainer.json',
        },
      ],
    );
  });

  it('F-0302 BR-4: the marker is the comment line, the folder as JSON and a newline, and a rewrite gives the same text', async () => {
    const store = storeOf();
    const slot = await newSlot(ROOT, '/home/a/app', store.files);
    function write(file: string, text: string): Promise<void> {
      store.written.set(file, text);
      return Promise.resolve();
    }
    await writeMarker(slot.folder, '/home/a/app', write);
    await writeMarker(slot.folder, '/home/a/app', write);
    deepStrictEqual(
      [...store.written],
      [
        [
          '/store/configs/app/.devcontainer/.devcontainer-internal.json',
          '// Maintained by the Dev Container extension\n{"rootFolder":"/home/a/app"}\n',
        ],
      ],
    );
  });

  it('F-0302 BR-4: the slot of a folder is found by the folder its marker names, with the comment lines dropped', async () => {
    const store = storeOf({
      '/store/configs/app/.devcontainer/.devcontainer-internal.json':
        markerOf('/home/a/app'),
      '/store/configs/app-2/.devcontainer/.devcontainer-internal.json':
        markerOf('/home/b/app'),
    });
    deepStrictEqual(
      [
        (await slotOf(ROOT, '/home/b/app', store.files))?.name,
        await slotOf(ROOT, '/home/a/app/sub', store.files),
      ],
      ['app-2', undefined],
    );
  });

  it('F-0302 BR-4: a slot whose marker is missing, is not JSON or names no folder belongs to no folder', async () => {
    const store = storeOf({
      '/store/configs/none/x': '',
      '/store/configs/bad/.devcontainer/.devcontainer-internal.json': '{',
      '/store/configs/empty/.devcontainer/.devcontainer-internal.json': 'null',
      '/store/configs/number/.devcontainer/.devcontainer-internal.json':
        '{"rootFolder":3}',
    });
    const found = await Promise.all(
      ['none', 'bad', 'empty', 'number'].map(folder =>
        slotOf(ROOT, `/home/a/${folder}`, store.files),
      ),
    );
    deepStrictEqual(found, [undefined, undefined, undefined, undefined]);
  });

  it('F-0801 AC-17: a name taken by another folder gives -2 and then -3, and the other slots are not changed', async () => {
    const store = storeOf({
      '/store/configs/app/.devcontainer/.devcontainer-internal.json':
        markerOf('/home/a/app'),
    });
    const second = (await newSlot(ROOT, '/home/b/app', store.files)).name;
    store.written.set(
      '/store/configs/app-2/.devcontainer/.devcontainer-internal.json',
      markerOf('/home/b/app'),
    );
    const third = (await newSlot(ROOT, '/home/c/app', store.files)).name;
    deepStrictEqual(
      [
        second,
        third,
        store.written.get(
          '/store/configs/app/.devcontainer/.devcontainer-internal.json',
        ),
      ],
      ['app-2', 'app-3', markerOf('/home/a/app')],
    );
  });

  it('F-0302 AC-35: the home folder is written as ~ in a path below it, and a path elsewhere stays', () => {
    deepStrictEqual(
      [
        tildePath('/home/a/.config/x/devcontainer.json', '/home/a'),
        tildePath('/home/a', '/home/a'),
        tildePath('/home/ab/x', '/home/a'),
        tildePath('/opt/x', '/home/a'),
      ],
      ['~/.config/x/devcontainer.json', '/home/a', '/home/ab/x', '/opt/x'],
    );
  });
});
