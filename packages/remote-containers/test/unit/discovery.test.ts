import {deepStrictEqual} from 'node:assert';
import {
  type Candidate,
  type ConfigFiles,
  discoverConfigurations,
} from '../../src/config/discovery.ts';

type Kind = 'file' | 'folder' | 'other';

/** A file system of folders by path, each with its entries. */
function filesOf(tree: Record<string, Array<[string, Kind]>>): ConfigFiles {
  return {
    list: folder =>
      Promise.resolve(
        (tree[folder] ?? []).map(([name, kind]) => ({name, kind})),
      ),
    read: () => Promise.resolve('unreadable'),
    exists: () => Promise.resolve(true),
  };
}

const FOLDER = '/w/p';
const english = new Intl.Collator('en', {sensitivity: 'accent'}).compare;
const swedish = new Intl.Collator('sv', {sensitivity: 'accent'}).compare;

function relatives(found: readonly Candidate[]): string[] {
  return found.map(candidate => candidate.relative);
}

function subfolders(
  names: string[],
  extra: Record<string, Array<[string, Kind]>> = {},
): ConfigFiles {
  const tree: Record<string, Array<[string, Kind]>> = {
    [FOLDER]: [['.devcontainer', 'folder']],
    [`${FOLDER}/.devcontainer`]: names.map(name => [name, 'folder']),
    ...extra,
  };
  for (const name of names) {
    tree[`${FOLDER}/.devcontainer/${name}`] ??= [['devcontainer.json', 'file']];
  }
  return filesOf(tree);
}

describe('the discovery of configurations (card containers-13)', () => {
  it('F-0301 AC-47: the dotfile, the main file and a subfolder come in that order, with their places and paths (BR-2)', async () => {
    const found = await discoverConfigurations(
      FOLDER,
      filesOf({
        [FOLDER]: [
          ['.devcontainer.json', 'file'],
          ['.devcontainer', 'folder'],
        ],
        [`${FOLDER}/.devcontainer`]: [
          ['a', 'folder'],
          ['devcontainer.json', 'file'],
        ],
        [`${FOLDER}/.devcontainer/a`]: [['devcontainer.json', 'file']],
      }),
      english,
    );
    deepStrictEqual(found, [
      {
        file: '/w/p/.devcontainer.json',
        relative: '.devcontainer.json',
        place: {kind: 'dotfile'},
      },
      {
        file: '/w/p/.devcontainer/devcontainer.json',
        relative: '.devcontainer/devcontainer.json',
        place: {kind: 'main'},
      },
      {
        file: '/w/p/.devcontainer/a/devcontainer.json',
        relative: '.devcontainer/a/devcontainer.json',
        place: {kind: 'subfolder', name: 'a'},
      },
    ]);
  });

  it('F-0301 AC-32: subfolders are ordered by the collator, not by code units or by numbers (BR-2)', async () => {
    const found = await discoverConfigurations(
      FOLDER,
      subfolders(['B', 'a', 'c', '10', '9', '.hid', '_u', 'lnk', 'y']),
      english,
    );
    deepStrictEqual(
      found.map(candidate =>
        candidate.place.kind === 'subfolder' ? candidate.place.name : '',
      ),
      ['_u', '.hid', '10', '9', 'a', 'B', 'c', 'lnk', 'y'],
    );
  });

  it('F-0301 AC-74: the order follows the locale of the collator (BR-2)', async () => {
    const names = ['a', 'z', 'ä', 'o', 'ö'];
    const orders = await Promise.all(
      [english, swedish].map(async compare =>
        (await discoverConfigurations(FOLDER, subfolders(names), compare)).map(
          candidate =>
            candidate.place.kind === 'subfolder' ? candidate.place.name : '',
        ),
      ),
    );
    deepStrictEqual(orders, [
      ['a', 'ä', 'o', 'ö', 'z'],
      ['a', 'o', 'z', 'ä', 'ö'],
    ]);
  });

  it('F-0301 BR-2: two names the collator cannot tell apart are ordered by code units, whatever their order in the listing', async () => {
    const orders = await Promise.all(
      [
        ['a', 'A'],
        ['A', 'a'],
      ].map(async names =>
        (await discoverConfigurations(FOLDER, subfolders(names), english)).map(
          candidate =>
            candidate.place.kind === 'subfolder' ? candidate.place.name : '',
        ),
      ),
    );
    deepStrictEqual(orders, [
      ['A', 'a'],
      ['A', 'a'],
    ]);
  });

  it('F-0301 AC-33: a file named with other letters is not a configuration (BR-1)', async () => {
    const found = await discoverConfigurations(
      FOLDER,
      subfolders(['x', 'a'], {
        [`${FOLDER}/.devcontainer/x`]: [['DevContainer.json', 'file']],
      }),
      english,
    );
    deepStrictEqual(relatives(found), ['.devcontainer/a/devcontainer.json']);
  });

  it('F-0301 AC-49: nothing deeper than one level is looked at, and no other folder is (BR-1)', async () => {
    const found = await discoverConfigurations(
      FOLDER,
      filesOf({
        [FOLDER]: [
          ['src', 'folder'],
          ['.devcontainer', 'folder'],
        ],
        [`${FOLDER}/src`]: [['devcontainer.json', 'file']],
        [`${FOLDER}/.devcontainer`]: [['a', 'folder']],
        [`${FOLDER}/.devcontainer/a`]: [['b', 'folder']],
        [`${FOLDER}/.devcontainer/a/b`]: [['devcontainer.json', 'file']],
      }),
      english,
    );
    deepStrictEqual(found, []);
  });

  it('F-0301 AC-34: a link to a folder and a link to the file are candidates with their own paths (BR-1)', async () => {
    const found = await discoverConfigurations(
      FOLDER,
      subfolders(['a', 'lnk', 'y']),
      english,
    );
    deepStrictEqual(relatives(found), [
      '.devcontainer/a/devcontainer.json',
      '.devcontainer/lnk/devcontainer.json',
      '.devcontainer/y/devcontainer.json',
    ]);
  });

  it('F-0301 BR-1: a dangling link, a file named like the folder and an entry that is no file are not candidates', async () => {
    const found = await discoverConfigurations(
      FOLDER,
      subfolders(['dangling', 'ok'], {
        [`${FOLDER}/.devcontainer/dangling`]: [['devcontainer.json', 'other']],
      }),
      english,
    );
    deepStrictEqual(relatives(found), ['.devcontainer/ok/devcontainer.json']);
  });

  it('F-0301 6.2: a folder with no configuration folder and no dotfile, and an empty configuration folder, have none', async () => {
    const results = await Promise.all([
      discoverConfigurations(FOLDER, filesOf({}), english),
      discoverConfigurations(
        FOLDER,
        filesOf({[FOLDER]: [['.devcontainer', 'folder']]}),
        english,
      ),
    ]);
    deepStrictEqual(results, [[], []]);
  });

  it('F-0301 BR-1: a .devcontainer that is a file holds nothing', async () => {
    const found = await discoverConfigurations(
      FOLDER,
      filesOf({[FOLDER]: [['.devcontainer', 'file']]}),
      english,
    );
    deepStrictEqual(found, []);
  });
});
