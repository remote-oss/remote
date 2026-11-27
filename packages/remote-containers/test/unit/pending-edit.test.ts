import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {MemoryFiles} from 'lib-state/testing/memory-files';
import {
  openPendingEdit,
  PENDING_EDITS_KEY,
  storePendingEdit,
  takePendingEdit,
} from '../../src/open/pending-edit.ts';
import type {IntentMemento} from '../../src/state/timed-store.ts';
import {
  handoffFolderOf,
  pendingEditHandoffsOn,
  writeRawHandoff,
} from './handoff-kinds.fixture.ts';

/** A memento over one map of an earlier version. */
function earlierMemento(initial?: unknown): IntentMemento {
  return {
    get: key => (key === PENDING_EDITS_KEY ? initial : undefined),
    update: () => Promise.resolve(),
  };
}

const CONFIG = '/w/proj/.devcontainer/devcontainer.json';
const LOG_FILE = '/logs/dev-containers-attempt-20261101T120000.log';

describe('the pending edit (card containers-11)', () => {
  it('F-0410 AC-4: a stored edit is taken once for the same folder, and its file is gone', async () => {
    const files = new MemoryFiles();
    const handoffs = pendingEditHandoffsOn(files);
    await storePendingEdit(handoffs, '/w/proj', CONFIG);
    const first = takePendingEdit(handoffs, '/w/proj');
    deepStrictEqual(
      [
        first,
        takePendingEdit(handoffs, '/w/proj'),
        files.names(handoffFolderOf('pending-edit')),
      ],
      [{configFile: CONFIG}, undefined, []],
    );
  });

  it("F-0410 AC-4: another folder's edit is not taken", async () => {
    const handoffs = pendingEditHandoffsOn(new MemoryFiles());
    await storePendingEdit(handoffs, '/w/a', CONFIG);
    deepStrictEqual(
      [takePendingEdit(handoffs, '/w/b'), takePendingEdit(handoffs, '/w/a')],
      [undefined, {configFile: CONFIG}],
    );
  });

  it('contracts: a file or an earlier value of another shape is dropped', () => {
    const files = new MemoryFiles();
    const earlier = pendingEditHandoffsOn(
      files,
      earlierMemento({'/w/p': {storedAt: 1000, value: {configFile: 3}}}),
    );
    writeRawHandoff(
      files,
      'pending-edit',
      '/w/q',
      JSON.stringify({storedAt: 1000, value: {configFile: 3}}),
    );
    deepStrictEqual(
      [takePendingEdit(earlier, '/w/p'), takePendingEdit(earlier, '/w/q')],
      [undefined, undefined],
    );
  });

  it('F-0410 AC-4: an edit older than five minutes is not taken', async () => {
    const files = new MemoryFiles();
    const handoffs = pendingEditHandoffsOn(files);
    await storePendingEdit(handoffs, '/w/p', CONFIG);
    files.clock += 300_001;
    deepStrictEqual(takePendingEdit(handoffs, '/w/p'), undefined);
  });

  it('R-27: the key an earlier version kept it under is the extension’s own', () => {
    deepStrictEqual(
      PENDING_EDITS_KEY,
      'remote-oss.remote-containers.pendingEdits',
    );
  });

  it('F-0410 AC-4: an edit that an earlier version kept in the global state is taken, and left where it is', () => {
    const handoffs = pendingEditHandoffsOn(
      new MemoryFiles(),
      earlierMemento({'/w/p': {storedAt: 1000, value: {configFile: CONFIG}}}),
    );
    deepStrictEqual(
      [takePendingEdit(handoffs, '/w/p'), takePendingEdit(handoffs, '/w/p')],
      [{configFile: CONFIG}, {configFile: CONFIG}],
    );
  });

  it('F-0410 AC-4: the window that reloads leaves the edit, another window writes the global state from a stale copy, and the window it switches to still takes the edit; the control: the same edit in the global state is lost', async () => {
    const files = new MemoryFiles();
    const leaving = pendingEditHandoffsOn(files);
    const arriving = pendingEditHandoffsOn(files);
    await storePendingEdit(leaving, '/w/proj', CONFIG);
    const shared: {value: Record<string, unknown>} = {value: {}};
    const stale = {...shared.value};
    shared.value = {'/w/proj': {storedAt: 1000, value: {configFile: CONFIG}}};
    shared.value = {...stale, other: 1};
    deepStrictEqual(
      [takePendingEdit(arriving, '/w/proj'), shared.value['/w/proj']],
      [{configFile: CONFIG}, undefined],
    );
  });

  it('F-0410 AC-4: two windows that activate at once on the same folder, one opens the edit', async () => {
    const files = new MemoryFiles();
    const leaving = pendingEditHandoffsOn(files);
    await storePendingEdit(leaving, '/w/proj', CONFIG);
    const taken = [
      pendingEditHandoffsOn(files),
      pendingEditHandoffsOn(files),
    ].map(window => takePendingEdit(window, '/w/proj'));
    deepStrictEqual(taken, [{configFile: CONFIG}, undefined]);
  });
});

describe('the pending edit at activation (card containers-11)', () => {
  /** The activation over a store that holds an edit for `/w/proj`. */
  async function activated(
    options: {
      remoteName?: string;
      folders?: Array<{scheme: string; fsPath: string}>;
      openFails?: unknown;
      logFile?: string;
      logExists?: boolean;
    } = {},
  ) {
    const files = new MemoryFiles();
    const handoffs = pendingEditHandoffsOn(files);
    await storePendingEdit(handoffs, '/w/proj', CONFIG, options.logFile);
    const opened: string[] = [];
    const events: string[] = [];
    const sink = new MemorySink();
    await openPendingEdit({
      handoffs,
      remoteName: () => options.remoteName,
      folders: () => options.folders ?? [{scheme: 'file', fsPath: '/w/proj'}],
      openLog: file => {
        events.push(`openLog ${file}`);
        return Promise.resolve();
      },
      exists: () => Promise.resolve(options.logExists ?? true),
      open: file => {
        opened.push(file);
        events.push(`open ${file}`);
        return 'openFails' in options
          ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the row feeds a rejection that is not an Error
            Promise.reject(options.openFails)
          : Promise.resolve();
      },
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    });
    return {
      opened,
      events,
      lines: sink.lines.map(line => `${line.level}: ${line.message}`),
      left: files.names(handoffFolderOf('pending-edit')),
    };
  }

  it('F-0410 AC-4: a local window with one file folder opens its pending edit', async () => {
    const seen = await activated();
    deepStrictEqual([seen.opened, seen.left], [[CONFIG], []]);
  });

  it('F-0410: a window with a remoteName takes nothing', async () => {
    const seen = await activated({remoteName: 'dev-container'});
    deepStrictEqual(seen.opened, []);
  });

  it('F-0410: a window with two folders, or a folder that is not a file, takes nothing', async () => {
    const pair = await activated({
      folders: [
        {scheme: 'file', fsPath: '/w/proj'},
        {scheme: 'file', fsPath: '/w/other'},
      ],
    });
    const memfs = await activated({
      folders: [{scheme: 'memfs', fsPath: '/w/proj'}],
    });
    const none = await activated({folders: []});
    deepStrictEqual([pair.opened, memfs.opened, none.opened], [[], [], []]);
  });

  it('F-0410: a window on another folder takes nothing and leaves the edit', async () => {
    const seen = await activated({
      folders: [{scheme: 'file', fsPath: '/w/other'}],
    });
    deepStrictEqual([seen.opened, seen.left.length], [[], 1]);
  });

  it('F-0410: a failed open is logged at warn, and the activation goes on', async () => {
    const seen = await activated({openFails: new Error('gone')});
    deepStrictEqual(seen.lines, [
      'warn: the configuration file could not be opened: gone',
    ]);
  });

  it('contracts: a failed open that is not an error is logged by its text', async () => {
    const seen = await activated({openFails: 'refused'});
    deepStrictEqual(seen.lines, [
      'warn: the configuration file could not be opened: refused',
    ]);
  });
  it('F-0410 AC-4, F-0502 AC-29: the configuration opens first and the attempt’s log after it', async () => {
    const seen = await activated({logFile: LOG_FILE});
    deepStrictEqual(seen.events, [`open ${CONFIG}`, `openLog ${LOG_FILE}`]);
  });

  it('F-0410 5.0: a log file that is gone is skipped, and the configuration still opens', async () => {
    const seen = await activated({logFile: LOG_FILE, logExists: false});
    deepStrictEqual(seen.events, [`open ${CONFIG}`]);
  });

  it('F-0410 5.0: a configuration that cannot be opened is logged, and the log still opens', async () => {
    const seen = await activated({
      logFile: LOG_FILE,
      openFails: new Error('gone'),
    });
    deepStrictEqual(
      [seen.events, seen.lines],
      [
        [`open ${CONFIG}`, `openLog ${LOG_FILE}`],
        ['warn: the configuration file could not be opened: gone'],
      ],
    );
  });

  it('F-0410 5.0: an edit with no log file opens the configuration only', async () => {
    const seen = await activated();
    deepStrictEqual(seen.events, [`open ${CONFIG}`]);
  });

  it('F-0410 AC-4: the log file is stored with the configuration and comes back with it, an old record without one still parses, and a log file that is no text is dropped', async () => {
    const files = new MemoryFiles();
    const stored = pendingEditHandoffsOn(
      files,
      earlierMemento({
        '/w/b': {storedAt: 1000, value: {configFile: CONFIG}},
        '/w/c': {storedAt: 1000, value: {configFile: CONFIG, logFile: 3}},
      }),
    );
    await storePendingEdit(stored, '/w/a', CONFIG, LOG_FILE);
    deepStrictEqual(
      [
        takePendingEdit(stored, '/w/a'),
        takePendingEdit(stored, '/w/b'),
        takePendingEdit(stored, '/w/c'),
      ],
      [
        {configFile: CONFIG, logFile: LOG_FILE},
        {configFile: CONFIG},
        undefined,
      ],
    );
  });

  /** The log lines of an activation whose read of the handoff fails by `failure`. */
  async function linesAfterFailedRead(failure: () => never): Promise<string[]> {
    const sink = new MemorySink();
    const handoffs = pendingEditHandoffsOn(new MemoryFiles());
    await openPendingEdit({
      handoffs: {...handoffs, store: {...handoffs.store, take: failure}},
      remoteName: () => undefined,
      folders: () => [{scheme: 'file', fsPath: '/w/proj'}],
      open: () => Promise.resolve(),
      openLog: () => Promise.resolve(),
      exists: () => Promise.resolve(true),
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    });
    return sink.lines.map(line => `${line.level}: ${line.message}`);
  }

  it('contracts: a pending edit that cannot be read is logged, and the activation goes on', async () => {
    deepStrictEqual(
      await linesAfterFailedRead(() => {
        throw new Error('unreadable store');
      }),
      ['warn: the pending edit could not be read: unreadable store'],
    );
  });

  it('contracts: a pending edit that cannot be read, rejected with a text, is logged by its text', async () => {
    deepStrictEqual(
      await linesAfterFailedRead(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the row feeds a rejection that is not an Error
        throw 'unreadable store';
      }),
      ['warn: the pending edit could not be read: unreadable store'],
    );
  });
});
