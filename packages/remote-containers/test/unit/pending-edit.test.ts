import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  openPendingEdit,
  PENDING_EDITS_KEY,
  storePendingEdit,
  takePendingEdit,
} from '../../src/open/pending-edit.ts';
import type {IntentMemento} from '../../src/state/timed-store.ts';

/** A memento over one map. */
function memento(initial?: unknown): {
  port: IntentMemento;
  held: () => unknown;
} {
  let held = initial;
  return {
    port: {
      get: key => (key === PENDING_EDITS_KEY ? held : undefined),
      update: (key, value) => {
        held = value;
        return Promise.resolve();
      },
    },
    held: () => held,
  };
}

const CONFIG = '/w/proj/.devcontainer/devcontainer.json';

describe('the pending edit (card containers-11)', () => {
  it('F-0410 AC-4: a stored edit is taken once for the same folder', async () => {
    const store = memento();
    await storePendingEdit(store.port, '/w/proj', CONFIG, 1000);
    deepStrictEqual(
      [
        await takePendingEdit(store.port, '/w/proj', 2000),
        await takePendingEdit(store.port, '/w/proj', 2000),
      ],
      [{configFile: CONFIG}, undefined],
    );
  });

  it("F-0410 AC-4: another folder's edit is not taken", async () => {
    const store = memento();
    await storePendingEdit(store.port, '/w/a', CONFIG, 1000);
    deepStrictEqual(
      [
        await takePendingEdit(store.port, '/w/b', 1000),
        await takePendingEdit(store.port, '/w/a', 1000),
      ],
      [undefined, {configFile: CONFIG}],
    );
  });

  it('contracts: a value of another shape is dropped', async () => {
    const store = memento({'/w/p': {storedAt: 1000, value: {configFile: 3}}});
    deepStrictEqual(await takePendingEdit(store.port, '/w/p', 1000), undefined);
  });

  it('F-0410 AC-4: an edit older than five minutes is not taken', async () => {
    const store = memento();
    await storePendingEdit(store.port, '/w/p', CONFIG, 0);
    deepStrictEqual(
      await takePendingEdit(store.port, '/w/p', 300_001),
      undefined,
    );
  });

  it('R-27: the key is the extension’s own', () => {
    deepStrictEqual(
      PENDING_EDITS_KEY,
      'remote-oss.remote-containers.pendingEdits',
    );
  });
});

describe('the pending edit at activation (card containers-11)', () => {
  /** The activation over a store that holds an edit for `/w/proj`. */
  async function activated(
    options: {
      remoteName?: string;
      folders?: Array<{scheme: string; fsPath: string}>;
      openFails?: unknown;
    } = {},
  ) {
    const store = memento();
    await storePendingEdit(store.port, '/w/proj', CONFIG, 1000);
    const opened: string[] = [];
    const sink = new MemorySink();
    await openPendingEdit({
      memento: store.port,
      remoteName: () => options.remoteName,
      folders: () => options.folders ?? [{scheme: 'file', fsPath: '/w/proj'}],
      now: () => 2000,
      open: file => {
        opened.push(file);
        return 'openFails' in options
          ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the row feeds a rejection that is not an Error
            Promise.reject(options.openFails)
          : Promise.resolve();
      },
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    });
    return {
      opened,
      lines: sink.lines.map(line => `${line.level}: ${line.message}`),
      left: store.held(),
    };
  }

  it('F-0410 AC-4: a local window with one file folder opens its pending edit', async () => {
    const seen = await activated();
    deepStrictEqual([seen.opened, seen.left], [[CONFIG], {}]);
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
    deepStrictEqual(
      [seen.opened, Object.keys(seen.left as object)],
      [[], ['/w/proj']],
    );
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
});
