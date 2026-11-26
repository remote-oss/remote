import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NODE_EVENT_FILES} from '../../src/event-files.ts';
import {type HandoffStore, handoffStoreOf} from '../../src/handoffs.ts';
import {MemoryFiles} from '../../src/testing/memory-files.ts';

const FOLDER =
  '/profile/globalStorage/remote-oss.remote-containers/handoffs/note';

const FIVE_MINUTES = 5 * 60 * 1000;

const ONE_DAY = 24 * 60 * 60 * 1000;

/** A handoff of the rows: some text. */
interface Note {
  text: string;
}

/** Whether a value is a note. */
function isNote(value: unknown): value is Note {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {text?: unknown}).text === 'string'
  );
}

/** The store of notes over `files`, on the files' own clock, which lives for `lifetime` milliseconds. */
function notesOn(
  files: MemoryFiles,
  lifetime: number | null = FIVE_MINUTES,
): HandoffStore<Note> {
  return handoffStoreOf({
    folder: FOLDER,
    files,
    now: () => files.clock,
    isValue: isNote,
    ...(lifetime === null ? {} : {lifetime}),
  });
}

/** The name the file of a handoff left for `key` has, which the row reads from the folder it is the only file of. */
function onlyFileOf(files: MemoryFiles): string {
  const [name, ...others] = files.names(FOLDER);
  deepStrictEqual(others, []);
  return `${FOLDER}/${name ?? ''}`;
}

describe('the handoffs of one kind in one folder', () => {
  it('a handoff left is taken once, with the time it was left, and its file is gone', async () => {
    const files = new MemoryFiles();
    const store = notesOn(files);
    await store.leave('/work/a', {text: 'one'});
    const left = files.names(FOLDER).length;
    const taken = store.take('/work/a');
    deepStrictEqual(
      [left, taken, store.take('/work/a'), files.names(FOLDER)],
      [1, {storedAt: 1000, value: {text: 'one'}}, undefined, []],
    );
  });

  it('a handoff is written whole under a temporary name renamed over its file, and taken by a claim renamed from it', async () => {
    const files = new MemoryFiles();
    const store = notesOn(files);
    await store.leave('key', {text: 'one'});
    store.take('key');
    deepStrictEqual(
      files.operations.map(operation =>
        operation.replace(/[0-9a-f]{64}/g, 'HASH'),
      ),
      [
        'write HASH.json.tmp-0001',
        'rename HASH.json.tmp-0001 HASH.json',
        'rename HASH.json HASH.claim-0002',
        'remove HASH.claim-0002',
      ],
    );
  });

  it('of two windows that take at once exactly one gets the handoff', async () => {
    const files = new MemoryFiles();
    await notesOn(files).leave('key', {text: 'one'});
    const windows = [notesOn(files), notesOn(files)];
    deepStrictEqual(
      windows.map(window => window.take('key')?.value),
      [{text: 'one'}, undefined],
    );
  });

  it('a handoff for another key is not taken, and stays', async () => {
    const files = new MemoryFiles();
    const store = notesOn(files);
    await store.leave('a', {text: 'one'});
    deepStrictEqual(
      [store.take('b'), files.names(FOLDER).length, store.take('a')?.value],
      [undefined, 1, {text: 'one'}],
    );
  });

  it('a handoff left again replaces the earlier one', async () => {
    const files = new MemoryFiles();
    const store = notesOn(files);
    await store.leave('key', {text: 'first'});
    files.clock += 1;
    await store.leave('key', {text: 'second'});
    deepStrictEqual(
      [files.names(FOLDER).length, store.take('key')],
      [1, {storedAt: 1001, value: {text: 'second'}}],
    );
  });

  it('a key never reaches outside the folder', async () => {
    const files = new MemoryFiles();
    await notesOn(files).leave('../../elsewhere', {text: 'one'});
    deepStrictEqual(
      [...files.files.keys()].every(file => file.startsWith(`${FOLDER}/`)),
      true,
    );
  });

  it('a handoff is taken up to its lifetime, and not after it, and the stale one is gone', async () => {
    const files = new MemoryFiles();
    const store = notesOn(files);
    await store.leave('on-time', {text: 'one'});
    await store.leave('late', {text: 'two'});
    files.clock += FIVE_MINUTES;
    const onTime = store.take('on-time')?.value;
    files.clock += 1;
    deepStrictEqual(
      [onTime, store.take('late'), files.names(FOLDER)],
      [{text: 'one'}, undefined, []],
    );
  });

  it('a handoff with no lifetime stays takable for good', async () => {
    const files = new MemoryFiles();
    const store = notesOn(files, null);
    await store.leave('key', {text: 'one'});
    files.clock += 100 * ONE_DAY;
    deepStrictEqual(store.take('key')?.value, {text: 'one'});
  });

  it('a handoff dated in the future is taken by none', async () => {
    const files = new MemoryFiles();
    const store = notesOn(files);
    await store.leave('key', {text: 'one'});
    files.clock -= 1;
    deepStrictEqual([store.take('key'), files.names(FOLDER)], [undefined, []]);
  });

  it('a file that is no JSON, no handoff or a value the taker does not accept is taken by none, and is removed', async () => {
    const files = new MemoryFiles();
    const store = notesOn(files);
    const texts = [
      '{not json',
      JSON.stringify({value: {text: 'no time'}}),
      JSON.stringify({storedAt: 'then', value: {text: 'x'}}),
      JSON.stringify({storedAt: 1000, value: 'not a note'}),
      JSON.stringify([1, 2]),
    ];
    const taken = [];
    for (const [index, text] of texts.entries()) {
      await store.leave(`k${String(index)}`, {text: 'seed'});
      files.files.set(onlyFileOf(files), {text, modified: files.clock});
      taken.push(store.take(`k${String(index)}`));
    }
    deepStrictEqual(
      [taken, files.names(FOLDER)],
      [[undefined, undefined, undefined, undefined, undefined], []],
    );
  });

  it('a claimed file that cannot be read is taken by none, and its claim is removed', async () => {
    const files = new MemoryFiles();
    const store = notesOn(files);
    await store.leave('key', {text: 'one'});
    files.read = () => undefined;
    deepStrictEqual([store.take('key'), files.names(FOLDER)], [undefined, []]);
  });

  it('a write that fails is a rejection of the leave, not a throw', async () => {
    const files = new MemoryFiles();
    files.failWrites = true;
    deepStrictEqual(
      await notesOn(files)
        .leave('key', {text: 'one'})
        .then(
          () => 'settled',
          (error: unknown) => (error as Error).message,
        ),
      'the disk is full',
    );
  });

  it('a claim or an unrenamed write a day old is removed by the next leave, and nothing younger or of another name is', async () => {
    const files = new MemoryFiles();
    for (const name of ['old.claim-0f0f', 'old.json.tmp-0f0f', 'notes.txt']) {
      files.files.set(`${FOLDER}/${name}`, {text: 'x', modified: files.clock});
    }
    files.clock += ONE_DAY - 1;
    files.files.set(`${FOLDER}/young.claim-0f0f`, {
      text: 'x',
      modified: files.clock,
    });
    files.clock += 1;
    await notesOn(files).leave('key', {text: 'one'});
    deepStrictEqual(
      files.names(FOLDER).filter(name => !name.endsWith('.json')),
      ['notes.txt', 'young.claim-0f0f'],
    );
  });
});

describe('the handoffs on this machine', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'handoffs-'));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it('are left and taken once in a folder made on demand, with nothing left behind', async () => {
    const folder = path.join(root, 'handoffs', 'note');
    const store = handoffStoreOf({
      folder,
      files: NODE_EVENT_FILES,
      now: () => 5000,
      isValue: isNote,
    });
    const before = store.take('key');
    await store.leave('key', {text: 'one'});
    const left = readdirSync(folder).length;
    deepStrictEqual(
      [
        before,
        left,
        store.take('key')?.value,
        store.take('key'),
        readdirSync(folder),
      ],
      [undefined, 1, {text: 'one'}, undefined, []],
    );
  });
});
