import {deepStrictEqual} from 'node:assert';
import type {RootEntry} from '../../src/authoring/curated-templates.ts';
import {readFolderFacts} from '../../src/authoring/folder-facts.ts';

/** The files of a folder tree: a folder maps to its entries. */
function treeOf(tree: Readonly<Record<string, RootEntry[]>>): {
  list(folder: string): Promise<RootEntry[]>;
  listed: string[];
} {
  const listed: string[] = [];
  return {
    listed,
    list: folder => {
      listed.push(folder);
      return Promise.resolve(tree[folder] ?? []);
    },
  };
}

describe('the facts the wizard reads of a folder (card containers-80)', () => {
  it('F-0802 BR-14: the root entries and the files below, as relative paths, with folders not listed', async () => {
    const tree = treeOf({
      '/w': [
        {name: 'src', kind: 'folder'},
        {name: 'a.md', kind: 'file'},
        {name: 'link', kind: 'other'},
      ],
      '/w/src': [
        {name: 'main.go', kind: 'file'},
        {name: 'deep', kind: 'folder'},
      ],
      '/w/src/deep': [{name: 'x.py', kind: 'file'}],
    });
    deepStrictEqual(await readFolderFacts(tree, '/w'), {
      rootEntries: [
        {name: 'src', kind: 'folder'},
        {name: 'a.md', kind: 'file'},
        {name: 'link', kind: 'other'},
      ],
      files: ['src/main.go', 'src/deep/x.py', 'a.md'],
      truncated: false,
    });
  });

  it('F-0802 BR-14: a folder with no entry has none', async () => {
    deepStrictEqual(await readFolderFacts(treeOf({}), '/w'), {
      rootEntries: [],
      files: [],
      truncated: false,
    });
  });

  it('F-0802 BR-14: a folder deeper than the bound is truncated, and the walk goes no deeper', async () => {
    const tree: Record<string, RootEntry[]> = {};
    let current = '/w';
    for (let depth = 0; depth < 10; depth += 1) {
      tree[current] = [{name: 'd', kind: 'folder'}];
      current = `${current}/d`;
    }
    const fake = treeOf(tree);
    const facts = await readFolderFacts(fake, '/w');
    deepStrictEqual([facts.truncated, fake.listed.length], [true, 8]);
  });

  it('F-0802 BR-14: more than 5000 entries in a folder below make the walk truncated', async () => {
    const many = [...Array(5001).keys()].map(index => ({
      name: `f${String(index)}`,
      kind: 'file' as const,
    }));
    const facts = await readFolderFacts(
      treeOf({'/w': [{name: 'big', kind: 'folder'}], '/w/big': many}),
      '/w',
    );
    deepStrictEqual(facts.truncated, true);
  });

  it('F-0802 BR-14: more than 5000 entries at the root are truncated at once, with no walk', async () => {
    const many = [...Array(5001).keys()].map(index => ({
      name: `f${String(index)}`,
      kind: 'file' as const,
    }));
    const fake = treeOf({'/w': many});
    const facts = await readFolderFacts(fake, '/w');
    deepStrictEqual(
      [facts.truncated, facts.files, fake.listed],
      [true, [], ['/w']],
    );
  });
});
