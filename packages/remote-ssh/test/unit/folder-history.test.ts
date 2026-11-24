import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  newSession,
  NODE_HISTORY_FILES,
} from '../../src/companion/folder-history.ts';
import {
  HISTORY_FOLDER as FOLDER,
  legacyOf,
  MemoryFiles,
  windowOn,
} from './history-files.fixture.ts';
const ONE_DAY = 24 * 60 * 60 * 1000;

/** The history entry of a folder. */
function folder(entryPath: string): {path: string; kind: 'folder'} {
  return {path: entryPath, kind: 'folder'};
}

/** Records each of `entries` under `hostKey` in `store`, one tick of the clock apart. */
async function inTurn(
  files: MemoryFiles,
  store: ReturnType<typeof windowOn>,
  hostKey: string,
  ...entries: ReadonlyArray<{path: string; kind: 'folder' | 'workspace'}>
): Promise<void> {
  for (const entry of entries) {
    await store.recordOpened(hostKey, entry);
    files.clock += 1;
  }
}

/**
 * A file `name` left in the folder holding one opened event of `entryPath`, what window `bbbb` read beside it, and the
 * folder after that window recorded `/new` a day later.
 */
async function afterLeftover(name: string, entryPath: string) {
  const files = new MemoryFiles();
  files.files.set(`${FOLDER}/${name}`, {
    text: JSON.stringify({
      events: [
        {host: 'host-a', entry: folder(entryPath), kind: 'opened', time: 900},
      ],
    }),
    modified: files.clock,
  });
  const reader = windowOn(files, 'bbbb');
  const seen = reader.stored();
  files.clock += ONE_DAY + 1;
  await reader.recordOpened('host-a', folder('/new'));
  return {seen, names: files.names(FOLDER).sort(), reader};
}

describe('the folder history store (card ssh-provider-02, card #3095)', () => {
  it('F-2503 BR-1, BR-2, AC-4: a path already in the list moves to the top, with no second copy', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await inTurn(
      files,
      store,
      'host-a',
      folder('/f1'),
      folder('/f2'),
      folder('/f1'),
    );
    deepStrictEqual(store.stored(), [
      {hostKey: 'host-a', entries: [folder('/f1'), folder('/f2')]},
    ]);
  });

  it('F-2503 BR-1, AC-5: a folder and a workspace file share one list, the latest first, with their kinds', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await inTurn(files, store, 'host-a', folder('/f1'), {
      path: '/w.code-workspace',
      kind: 'workspace',
    });
    deepStrictEqual(store.stored(), [
      {
        hostKey: 'host-a',
        entries: [
          {path: '/w.code-workspace', kind: 'workspace'},
          folder('/f1'),
        ],
      },
    ]);
  });

  it('F-2503 BR-4, AC-8, AC-29: each host keeps only its own entries, the hosts in the order they were first opened', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await store.recordOpened('host-a', folder('/a'));
    files.clock += 1;
    await store.recordOpened('host-b', folder('/b'));
    files.clock += 1;
    await store.recordOpened('host-a', folder('/c'));
    deepStrictEqual(store.stored(), [
      {hostKey: 'host-a', entries: [folder('/c'), folder('/a')]},
      {hostKey: 'host-b', entries: [folder('/b')]},
    ]);
  });

  it('F-2503 BR-6, AC-21: 122 records on one host are all kept, the latest first', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    for (let index = 0; index < 122; index += 1) {
      files.clock += 1;
      await store.recordOpened('host-a', folder(`/f${String(index)}`));
    }
    const [host] = store.stored();
    deepStrictEqual(
      [host?.entries.length, host?.entries[0]?.path, host?.entries[121]?.path],
      [122, '/f121', '/f0'],
    );
  });

  it('F-2503 BR-7, AC-31: removing the only entry of a host drops the host, and says so', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await store.recordOpened('host-a', folder('/a'));
    await store.recordOpened('host-b', folder('/b'));
    files.clock += 1;
    const changed = await store.removeOpened('host-a', '/a');
    deepStrictEqual(
      [changed, store.stored()],
      [true, [{hostKey: 'host-b', entries: [folder('/b')]}]],
    );
  });

  it('F-2503 BR-7, 7.E1: removing a path that is not there says false and writes nothing', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await store.recordOpened('host-a', folder('/a'));
    const written = files.operations.length;
    const changed = await store.removeOpened('host-a', '/missing');
    deepStrictEqual([changed, files.operations.length], [false, written]);
  });

  it('a window writes only its own file, whole, under a temporary name renamed over it', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await store.recordOpened('host-a', folder('/a'));
    deepStrictEqual(files.operations, [
      'write aaaa.json.tmp-0001',
      'rename aaaa.json.tmp-0001 aaaa.json',
    ]);
  });

  it('a write that fails is a rejection of the record or the removal, not a throw', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    await store.recordOpened('host-a', folder('/a'));
    files.failWrites = true;
    const reasons = await Promise.all(
      [
        store.recordOpened('host-a', folder('/b')),
        store.removeOpened('host-a', '/a'),
      ].map(pending =>
        pending.then(
          () => 'settled',
          (error: unknown) => (error as Error).message,
        ),
      ),
    );
    deepStrictEqual(reasons, ['the disk is full', 'the disk is full']);
  });
});

describe('the folder history store, written by two windows at once (card #3095)', () => {
  it("#2757, #3095: a folder recorded by a window that never saw another window's record keeps both", async () => {
    const files = new MemoryFiles();
    const first = windowOn(files, 'aaaa');
    const second = windowOn(files, 'bbbb');
    await first.recordOpened('host-a', folder('/c1'));
    files.clock += 1;
    await second.recordOpened('host-a', folder('/c2'));
    deepStrictEqual(windowOn(files, 'cccc').stored(), [
      {hostKey: 'host-a', entries: [folder('/c2'), folder('/c1')]},
    ]);
  });

  it('a removal in one window wins over the older record of another, and a newer record wins over the removal', async () => {
    const files = new MemoryFiles();
    const first = windowOn(files, 'aaaa');
    const second = windowOn(files, 'bbbb');
    await first.recordOpened('host-a', folder('/x'));
    await first.recordOpened('host-a', folder('/y'));
    files.clock += 1;
    await second.removeOpened('host-a', '/x');
    const afterRemoval = windowOn(files, 'cccc').stored();
    files.clock += 1;
    await first.recordOpened('host-a', folder('/x'));
    deepStrictEqual(
      [afterRemoval, windowOn(files, 'cccc').stored()],
      [
        [{hostKey: 'host-a', entries: [folder('/y')]}],
        [{hostKey: 'host-a', entries: [folder('/x'), folder('/y')]}],
      ],
    );
  });

  it('two events of one entry at the same time are ordered by their session', async () => {
    const files = new MemoryFiles();
    await windowOn(files, 'bbbb').recordOpened('host-a', folder('/x'));
    const earlier = windowOn(files, 'aaaa');
    await earlier.recordOpened('host-a', folder('/y'));
    const removed = windowOn(files, 'cccc');
    await removed.removeOpened('host-a', '/x');
    await earlier.recordOpened('host-a', folder('/x'));
    deepStrictEqual(removed.stored(), [
      {hostKey: 'host-a', entries: [folder('/y')]},
    ]);
  });
});

describe('the folding of other windows’ files (card #3095)', () => {
  it('a file untouched for a day is claimed by a rename, taken into the writer’s own, and the claim removed', async () => {
    const files = new MemoryFiles();
    await windowOn(files, 'aaaa').recordOpened('host-a', folder('/old'));
    files.clock += ONE_DAY + 1;
    files.operations.length = 0;
    const writer = windowOn(files, 'bbbb');
    await writer.recordOpened('host-a', folder('/new'));
    deepStrictEqual(
      [files.names(FOLDER).sort(), files.operations, writer.stored()],
      [
        ['bbbb.json'],
        [
          'rename aaaa.json aaaa.claim-0002',
          'write bbbb.json.tmp-0003',
          'rename bbbb.json.tmp-0003 bbbb.json',
          'remove aaaa.claim-0002',
        ],
        [{hostKey: 'host-a', entries: [folder('/new'), folder('/old')]}],
      ],
    );
  });

  it('a file younger than a day is left alone', async () => {
    const files = new MemoryFiles();
    await windowOn(files, 'aaaa').recordOpened('host-a', folder('/old'));
    files.clock += ONE_DAY - 1;
    await windowOn(files, 'bbbb').recordOpened('host-a', folder('/new'));
    deepStrictEqual(files.names(FOLDER).sort(), ['aaaa.json', 'bbbb.json']);
  });

  it('a fold that races the owner of the file it claims keeps every event', async () => {
    const files = new MemoryFiles();
    const owner = windowOn(files, 'aaaa');
    await owner.recordOpened('host-a', folder('/one'));
    files.clock += ONE_DAY + 1;
    await windowOn(files, 'bbbb').recordOpened('host-a', folder('/two'));
    files.clock += 1;
    await owner.recordOpened('host-a', folder('/three'));
    deepStrictEqual(windowOn(files, 'cccc').stored(), [
      {
        hostKey: 'host-a',
        entries: [folder('/three'), folder('/two'), folder('/one')],
      },
    ]);
  });

  it('a file another window claimed first is skipped', async () => {
    const files = new MemoryFiles();
    await windowOn(files, 'aaaa').recordOpened('host-a', folder('/old'));
    files.clock += ONE_DAY + 1;
    const rename = files.rename.bind(files);
    files.rename = (source, target) => {
      if (path.basename(source) === 'aaaa.json') {
        throw new Error('ENOENT: claimed by another window');
      }
      rename(source, target);
    };
    await windowOn(files, 'bbbb').recordOpened('host-a', folder('/new'));
    deepStrictEqual(files.names(FOLDER).sort(), ['aaaa.json', 'bbbb.json']);
  });

  it('a claim a fold left behind is still read, and folded again once it is a day old', async () => {
    const {seen, names, reader} = await afterLeftover(
      'aaaa.claim-0f0f',
      '/left',
    );
    deepStrictEqual(
      [seen, names, reader.stored()],
      [
        [{hostKey: 'host-a', entries: [folder('/left')]}],
        ['bbbb.json'],
        [{hostKey: 'host-a', entries: [folder('/new'), folder('/left')]}],
      ],
    );
  });

  it('a write never renamed into place is never read, and is removed once a day old', async () => {
    const {seen, names} = await afterLeftover('aaaa.json.tmp-0f0f', '/half');
    deepStrictEqual([seen, names], [[], ['bbbb.json']]);
  });

  it('a day-old file of another name is left alone', async () => {
    const files = new MemoryFiles();
    files.files.set(`${FOLDER}/notes.txt`, {text: 'x', modified: files.clock});
    files.clock += ONE_DAY + 1;
    await windowOn(files, 'bbbb').recordOpened('host-a', folder('/new'));
    deepStrictEqual(files.names(FOLDER).sort(), ['bbbb.json', 'notes.txt']);
  });
});

describe('the history an earlier version kept in the global state (card #3095)', () => {
  const EARLIER = {
    hosts: [
      {hostKey: 'host-a', entries: [folder('/a2'), folder('/a1')]},
      {hostKey: 'host-b', entries: [folder('/b1')]},
    ],
  };

  it('is read as the oldest layer: its order kept, its hosts first, a newer record above it', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa', legacyOf(EARLIER));
    await store.recordOpened('host-c', folder('/c1'));
    await store.recordOpened('host-a', folder('/a3'));
    deepStrictEqual(store.stored(), [
      {
        hostKey: 'host-a',
        entries: [folder('/a3'), folder('/a2'), folder('/a1')],
      },
      {hostKey: 'host-b', entries: [folder('/b1')]},
      {hostKey: 'host-c', entries: [folder('/c1')]},
    ]);
  });

  it('a removal of one of its entries holds, though the global state keeps the entry', async () => {
    const files = new MemoryFiles();
    const legacy = legacyOf(EARLIER);
    await windowOn(files, 'aaaa', legacy).removeOpened('host-b', '/b1');
    deepStrictEqual(windowOn(files, 'bbbb', legacy).stored(), [
      {hostKey: 'host-a', entries: [folder('/a2'), folder('/a1')]},
    ]);
  });

  it('F-2503 BR-10: a malformed value is no history, and a malformed host or entry is dropped', () => {
    const files = new MemoryFiles();
    function storedFrom(value: unknown): unknown {
      return windowOn(files, 'aaaa', legacyOf(value)).stored();
    }
    deepStrictEqual(
      [
        storedFrom(42),
        storedFrom({hosts: 'x'}),
        storedFrom(undefined),
        storedFrom({
          hosts: [
            {
              hostKey: 'host-a',
              entries: [
                folder('/good'),
                {path: 7, kind: 'folder'},
                {path: '/bad-kind', kind: 'file'},
                'text',
              ],
            },
            {hostKey: 'host-b', entries: [{path: 7}]},
            {hostKey: 3, entries: [folder('/x')]},
            {hostKey: 'host-c', entries: 'x'},
            null,
          ],
        }),
      ],
      [[], [], [], [{hostKey: 'host-a', entries: [folder('/good')]}]],
    );
  });
});

describe('the files of other windows that are not history', () => {
  it('a file that is no JSON, no events list or a malformed event adds nothing, and the good events stay', () => {
    const files = new MemoryFiles();
    const good = {
      host: 'host-a',
      entry: folder('/good'),
      kind: 'opened',
      time: 5,
    };
    const written: ReadonlyArray<readonly [string, string]> = [
      ['aaaa.json', '{not json'],
      ['bbbb.json', JSON.stringify({events: 'x'})],
      ['cccc.json', JSON.stringify([good])],
      [
        'dddd.json',
        JSON.stringify({
          events: [
            good,
            'text',
            {...good, kind: 'moved'},
            {...good, host: 7},
            {...good, time: 'later'},
            {...good, entry: {path: '/x', kind: 'file'}},
          ],
        }),
      ],
    ];
    for (const [name, text] of written) {
      files.files.set(`${FOLDER}/${name}`, {text, modified: files.clock});
    }
    deepStrictEqual(windowOn(files, 'eeee').stored(), [
      {hostKey: 'host-a', entries: [folder('/good')]},
    ]);
  });
});

describe('a file that goes between its listing and its reading', () => {
  it('adds nothing, as a window that ended and was folded leaves it', async () => {
    const files = new MemoryFiles();
    await windowOn(files, 'aaaa').recordOpened('host-a', folder('/gone'));
    files.read = () => undefined;
    deepStrictEqual(windowOn(files, 'bbbb').stored(), []);
  });
});

describe('the history files on this machine', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'folder-history-'));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it('writes, renames, lists, reads, dates and removes files, and reads nothing where there is none', () => {
    const inside = path.join(root, 'folder-history');
    const files = NODE_HISTORY_FILES;
    const before = [
      files.names(inside),
      files.read(path.join(inside, 'x.json')),
      files.modified(path.join(inside, 'x.json')),
    ];
    files.makeFolder(inside);
    files.write(path.join(inside, 'x.json.tmp-1'), 'text');
    files.rename(
      path.join(inside, 'x.json.tmp-1'),
      path.join(inside, 'x.json'),
    );
    const after = [
      files.names(inside),
      files.read(path.join(inside, 'x.json')),
      typeof files.modified(path.join(inside, 'x.json')),
    ];
    files.remove(path.join(inside, 'x.json'));
    deepStrictEqual(
      [
        before,
        after,
        files.names(inside),
        /^[0-9a-f]{12}$/.test(files.random()),
      ],
      [[[], undefined, undefined], [['x.json'], 'text', 'number'], [], true],
    );
  });

  it('a new session is a UUID, and two never match', () => {
    const [first, second] = [newSession(), newSession()];
    deepStrictEqual(
      [
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          first,
        ),
        first === second,
      ],
      [true, false],
    );
  });
});
