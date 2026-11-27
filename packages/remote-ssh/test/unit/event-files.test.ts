import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type EventStore,
  eventStoreOf,
  isRecord,
  newSession,
  NODE_EVENT_FILES,
} from '../../src/state/event-files.ts';
import {MemoryFiles} from './event-files.fixture.ts';

const ONE_DAY = 24 * 60 * 60 * 1000;

/** The folder of the rows' event files. */
const FOLDER = '/profile/globalStorage/remote-oss.remote-ssh/events';

/** An event of the rows: what it is about, when it happened and what it says. */
interface Note {
  key: string;
  time: number;
  value: string;
}

/** The note a value of a file holds, when every member fits. */
function noteOf(value: unknown): Note | undefined {
  return isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.time === 'number' &&
    typeof value.value === 'string'
    ? {key: value.key, time: value.time, value: value.value}
    : undefined;
}

/** The store of the window with session `session` over `files`, its clock the files' own. */
function windowOn(
  files: MemoryFiles,
  session: string,
  options: {
    earlier?: readonly Note[];
    prune?: (notes: readonly Note[]) => readonly Note[];
  } = {},
): EventStore<Note> {
  return eventStoreOf<Note>({
    folder: FOLDER,
    session,
    files,
    now: () => files.clock,
    keyOf: note => note.key,
    parse: noteOf,
    earlier: () => options.earlier ?? [],
    ...(options.prune === undefined ? {} : {prune: options.prune}),
  });
}

/** Takes the note of `key` saying `value`, at the files' time, into `store`. */
function appendNote(
  files: MemoryFiles,
  store: EventStore<Note>,
  key: string,
  value: string,
): Promise<void> {
  return store.append([{key, time: files.clock, value}]);
}

/** What `store` reads: each key with the value that decides it, in key order. */
function read(store: EventStore<Note>): string[] {
  return [...store.winners()]
    .map(([key, winner]) => `${key}=${winner.event.value}`)
    .sort();
}

/**
 * A file `name` left in the folder holding one note, what window `bbbb` read beside it, and the folder after that
 * window wrote a day later.
 */
async function afterLeftover(name: string, key: string) {
  const files = new MemoryFiles();
  files.files.set(`${FOLDER}/${name}`, {
    text: JSON.stringify({events: [{key, time: 900, value: 'left'}]}),
    modified: files.clock,
  });
  const reader = windowOn(files, 'bbbb');
  const seen = read(reader);
  files.clock += ONE_DAY + 1;
  await appendNote(files, reader, 'new', 'written');
  return {seen, names: files.names(FOLDER).sort(), reader};
}

describe('the event files of the windows of one folder', () => {
  it('a window writes only its own file, whole, under a temporary name renamed over it', async () => {
    const files = new MemoryFiles();
    await appendNote(files, windowOn(files, 'aaaa'), 'a', 'one');
    deepStrictEqual(files.operations, [
      'write aaaa.json.tmp-0001',
      'rename aaaa.json.tmp-0001 aaaa.json',
    ]);
  });

  it('a write that fails is a rejection of the append, not a throw', async () => {
    const files = new MemoryFiles();
    const store = windowOn(files, 'aaaa');
    files.failWrites = true;
    deepStrictEqual(
      await appendNote(files, store, 'a', 'one').then(
        () => 'settled',
        (error: unknown) => (error as Error).message,
      ),
      'the disk is full',
    );
  });

  it('the newest note of a key decides over every window, and a note of the same time goes to the later session', async () => {
    const files = new MemoryFiles();
    const first = windowOn(files, 'aaaa');
    const second = windowOn(files, 'bbbb');
    await appendNote(files, first, 'same', 'from a');
    await appendNote(files, second, 'same', 'from b');
    files.clock += 1;
    await appendNote(files, first, 'later', 'from a');
    files.clock -= 1;
    await appendNote(files, second, 'later', 'older from b');
    deepStrictEqual(read(windowOn(files, 'cccc')), [
      'later=from a',
      'same=from b',
    ]);
  });

  it('what the earlier version kept is the oldest layer: any note of a window decides over it', async () => {
    const files = new MemoryFiles();
    const earlier = [
      {key: 'kept', time: 0, value: 'earlier'},
      {key: 'replaced', time: 0, value: 'earlier'},
    ];
    const window = windowOn(files, 'aaaa', {earlier});
    await appendNote(files, window, 'replaced', 'written');
    deepStrictEqual(read(window), ['kept=earlier', 'replaced=written']);
  });

  it('the owner’s prune decides which of this window’s notes a write keeps, and the others leave the file', async () => {
    const files = new MemoryFiles();
    const window = windowOn(files, 'aaaa', {
      prune: notes => notes.filter(note => note.key !== 'dropped'),
    });
    await window.append([
      {key: 'kept', time: 1, value: 'one'},
      {key: 'dropped', time: 1, value: 'two'},
    ]);
    deepStrictEqual(
      [
        read(window),
        JSON.parse(files.read(`${FOLDER}/aaaa.json`) ?? '{}') as unknown,
      ],
      [['kept=one'], {events: [{key: 'kept', time: 1, value: 'one'}]}],
    );
  });
});

describe('the folding of other windows’ files', () => {
  it('a file untouched for a day is claimed by a rename, taken into the writer’s own, and the claim removed', async () => {
    const files = new MemoryFiles();
    await appendNote(files, windowOn(files, 'aaaa'), 'old', 'one');
    files.clock += ONE_DAY + 1;
    files.operations.length = 0;
    const writer = windowOn(files, 'bbbb');
    await appendNote(files, writer, 'new', 'two');
    deepStrictEqual(
      [files.names(FOLDER).sort(), files.operations, read(writer)],
      [
        ['bbbb.json'],
        [
          'rename aaaa.json aaaa.claim-0002',
          'write bbbb.json.tmp-0003',
          'rename bbbb.json.tmp-0003 bbbb.json',
          'remove aaaa.claim-0002',
        ],
        ['new=two', 'old=one'],
      ],
    );
  });

  it('a fold never replaces this window’s newer note of a key with the older one of the file it claims', async () => {
    const files = new MemoryFiles();
    files.files.set(`${FOLDER}/bbbb.json`, {
      text: JSON.stringify({
        events: [
          {key: 'a', time: 2, value: 'older'},
          {key: 'b', time: 2, value: 'claimed'},
        ],
      }),
      modified: 0,
    });
    files.clock = 5;
    const writer = windowOn(files, 'aaaa');
    await appendNote(files, writer, 'a', 'newer');
    files.clock = ONE_DAY + 10;
    await appendNote(files, writer, 'c', 'last');
    const own = JSON.parse(files.read(`${FOLDER}/aaaa.json`) ?? '{}') as {
      events: Note[];
    };
    deepStrictEqual(
      own.events.map(note => [note.key, note.value, note.time]).sort(),
      [
        ['a', 'newer', 5],
        ['b', 'claimed', 2],
        ['c', 'last', ONE_DAY + 10],
      ],
    );
  });

  it('a window never claims its own file, however old it is', async () => {
    const files = new MemoryFiles();
    const owner = windowOn(files, 'aaaa');
    await appendNote(files, owner, 'one', 'x');
    files.clock += ONE_DAY + 1;
    files.operations.length = 0;
    await appendNote(files, owner, 'two', 'y');
    deepStrictEqual(
      files.operations.filter(operation => operation.includes('claim')),
      [],
    );
  });

  it('a file younger than a day is left alone', async () => {
    const files = new MemoryFiles();
    await appendNote(files, windowOn(files, 'aaaa'), 'old', 'x');
    files.clock += ONE_DAY - 1;
    await appendNote(files, windowOn(files, 'bbbb'), 'new', 'y');
    deepStrictEqual(files.names(FOLDER).sort(), ['aaaa.json', 'bbbb.json']);
  });

  it('a fold that races the owner of the file it claims keeps every note', async () => {
    const files = new MemoryFiles();
    const owner = windowOn(files, 'aaaa');
    await appendNote(files, owner, 'one', 'x');
    files.clock += ONE_DAY + 1;
    await appendNote(files, windowOn(files, 'bbbb'), 'two', 'y');
    files.clock += 1;
    await appendNote(files, owner, 'three', 'z');
    deepStrictEqual(read(windowOn(files, 'cccc')), [
      'one=x',
      'three=z',
      'two=y',
    ]);
  });

  it('a file another window claimed first is skipped', async () => {
    const files = new MemoryFiles();
    await appendNote(files, windowOn(files, 'aaaa'), 'old', 'x');
    files.clock += ONE_DAY + 1;
    const rename = files.rename.bind(files);
    files.rename = (source, target) => {
      if (path.basename(source) === 'aaaa.json') {
        throw new Error('ENOENT: claimed by another window');
      }
      rename(source, target);
    };
    await appendNote(files, windowOn(files, 'bbbb'), 'new', 'y');
    deepStrictEqual(files.names(FOLDER).sort(), ['aaaa.json', 'bbbb.json']);
  });

  it('a claim a fold left behind is still read, and folded again once it is a day old', async () => {
    const {seen, names, reader} = await afterLeftover(
      'aaaa.claim-0f0f',
      'left',
    );
    deepStrictEqual(
      [seen, names, read(reader)],
      [['left=left'], ['bbbb.json'], ['left=left', 'new=written']],
    );
  });

  it('a write never renamed into place is never read, and is removed once a day old', async () => {
    const {seen, names} = await afterLeftover('aaaa.json.tmp-0f0f', 'half');
    deepStrictEqual([seen, names], [[], ['bbbb.json']]);
  });

  it('a day-old file of another name is left alone', async () => {
    const files = new MemoryFiles();
    files.files.set(`${FOLDER}/notes.txt`, {text: 'x', modified: files.clock});
    files.clock += ONE_DAY + 1;
    await appendNote(files, windowOn(files, 'bbbb'), 'new', 'y');
    deepStrictEqual(files.names(FOLDER).sort(), ['bbbb.json', 'notes.txt']);
  });
});

describe('the files of other windows that are not events', () => {
  it('a file that is no JSON, no events list or a malformed event adds nothing, and the good events stay', () => {
    const files = new MemoryFiles();
    const good = {key: 'good', time: 5, value: 'kept'};
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
            {...good, key: 7},
            {...good, time: 'later'},
            {...good, value: 3},
          ],
        }),
      ],
    ];
    for (const [name, text] of written) {
      files.files.set(`${FOLDER}/${name}`, {text, modified: files.clock});
    }
    deepStrictEqual(read(windowOn(files, 'eeee')), ['good=kept']);
  });

  it('a file that goes between its listing and its reading adds nothing, as a window that ended and was folded leaves it', async () => {
    const files = new MemoryFiles();
    await appendNote(files, windowOn(files, 'aaaa'), 'gone', 'x');
    files.read = () => undefined;
    deepStrictEqual(read(windowOn(files, 'bbbb')), []);
  });
});

describe('the event files on this machine', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'event-files-'));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it('writes, renames, lists, reads, dates and removes files, and reads nothing where there is none', () => {
    const inside = path.join(root, 'events');
    const files = NODE_EVENT_FILES;
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
