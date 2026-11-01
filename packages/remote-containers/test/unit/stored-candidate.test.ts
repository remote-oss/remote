import {deepStrictEqual} from 'node:assert';
import {
  storeRootOf,
  type StoreFiles,
} from '../../src/authoring/user-data-store.ts';
import {labelOf} from '../../src/config/configuration-text.ts';
import {
  byAbsolutePath,
  storedCandidate,
} from '../../src/config/stored-candidate.ts';

const ROOT = storeRootOf('/home/u/.store');
const FOLDER = '/work/app';
const MARKER = `// Maintained by the Dev Container extension\n${JSON.stringify({rootFolder: FOLDER})}\n`;
const SLOT_MARKER =
  '/home/u/.store/configs/app/.devcontainer/.devcontainer-internal.json';
const SLOT_FILE = '/home/u/.store/configs/app/.devcontainer/devcontainer.json';

/** A store of the files in `files`, with one slot folder per first segment under the root. */
function storeOf(files: Readonly<Record<string, string>>): StoreFiles {
  return {
    folderNames: () =>
      Promise.resolve([
        ...new Set(
          Object.keys(files).map(file =>
            file.slice('/home/u/.store/configs/'.length).split('/', 1).join(''),
          ),
        ),
      ]),
    readText: file => Promise.resolve(files[file]),
  };
}

function lookupOf(files: Readonly<Record<string, string>>) {
  return {root: ROOT, store: storeOf(files), home: '/home/u'};
}

describe('the stored configuration as a candidate (card containers-92)', () => {
  it('F-0302 AC-6: the folder’s slot gives its configuration as a stored candidate, named by its ~ path', async () => {
    deepStrictEqual(
      await storedCandidate(
        lookupOf({[SLOT_MARKER]: MARKER, [SLOT_FILE]: '{"image":"i"}'}),
        FOLDER,
      ),
      {
        file: SLOT_FILE,
        relative: '~/.store/configs/app/.devcontainer/devcontainer.json',
        place: {kind: 'stored', slot: 'app'},
      },
    );
  });

  it('F-0302 BR-4: a folder with no slot, a slot of another folder and a slot with no configuration file give none', async () => {
    const other = `// x\n${JSON.stringify({rootFolder: '/work/other'})}\n`;
    deepStrictEqual(
      await Promise.all([
        storedCandidate(lookupOf({}), FOLDER),
        storedCandidate(
          lookupOf({[SLOT_MARKER]: other, [SLOT_FILE]: '{}'}),
          FOLDER,
        ),
        storedCandidate(lookupOf({[SLOT_MARKER]: MARKER}), FOLDER),
      ]),
      [undefined, undefined, undefined],
    );
  });

  it('F-0302 BR-3: candidates are ordered by absolute file path, and a stored place is labelled Main', () => {
    const place = {kind: 'main'} as const;
    const ordered = byAbsolutePath([
      {file: '/w/b.json', relative: 'b', place},
      {file: '/h/a.json', relative: 'a', place},
      {file: '/w/b.json', relative: 'again', place},
    ]).map(each => each.relative);
    deepStrictEqual(
      [
        ordered,
        labelOf({kind: 'stored', slot: 'app'}, undefined, template => template),
      ],
      [['a', 'b', 'again'], 'Main'],
    );
  });
});
