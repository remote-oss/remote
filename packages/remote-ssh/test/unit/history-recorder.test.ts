import {deepStrictEqual} from 'node:assert';
import type {LastResolve} from 'lib-authority';
import {
  FOLDER_HISTORY_KEY,
  type HistoryMemento,
  storedHistory,
} from '../../src/companion/folder-history.ts';
import {
  entryOfWindow,
  recordOnFirstResolve,
  type WindowWorkspace,
} from '../../src/companion/history-recorder.ts';

const REMOTE = 'vscode-remote';
const HOST = 'ssh-remote+host-a';

function uri(path: string, scheme = REMOTE, authority = HOST) {
  return {scheme, authority, path};
}

/** A window whose workspace file and folders are given. */
function windowOf(
  folders: ReadonlyArray<ReturnType<typeof uri>>,
  file?: ReturnType<typeof uri>,
): WindowWorkspace {
  return {workspaceFile: () => file, workspaceFolders: () => folders};
}

/** A memento keeping a JSON copy. */
function memento(): HistoryMemento {
  let stored: string | undefined;
  return {
    get: key =>
      key === FOLDER_HISTORY_KEY && stored !== undefined
        ? (JSON.parse(stored) as unknown)
        : undefined,
    update: (key, value) => {
      stored = JSON.stringify(value);
      return Promise.resolve();
    },
  };
}

/** A resolve handle whose first-resolve listener is called `times` times when `fire` runs. */
function resolveOf(lastResolve: LastResolve, times = 1) {
  const listeners: Array<() => void> = [];
  return {
    handle: {
      onFirstResolveSettled: (listener: () => void) => {
        listeners.push(listener);
      },
      lastResolve: () => lastResolve,
    },
    fire: () => {
      for (let count = 0; count < times; count += 1) {
        for (const listener of listeners) {
          listener();
        }
      }
    },
  };
}

/** Lets the recorder's write settle. */
function settled(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('the history recorder (card ssh-provider-02)', () => {
  it('F-2503 BR-2, AC-3: a single remote folder is recorded for its host once the first resolve succeeded', async () => {
    const store = memento();
    const resolve = resolveOf('succeeded');
    recordOnFirstResolve(resolve.handle, windowOf([uri('/home/u/f1')]), store);
    resolve.fire();
    await settled();
    deepStrictEqual(storedHistory(store), [
      {hostKey: 'host-a', entries: [{path: '/home/u/f1', kind: 'folder'}]},
    ]);
  });

  it('F-2503 BR-3, AC-6: a trailing slash goes, and the root stays', () => {
    deepStrictEqual(
      [
        entryOfWindow(windowOf([uri('/home/u/f1/')]))?.entry.path,
        entryOfWindow(windowOf([uri('/')]))?.entry.path,
        entryOfWindow(windowOf([uri('//')]))?.entry.path,
      ],
      ['/home/u/f1', '/', '/'],
    );
  });

  it('F-2503 BR-2, AC-5: a remote workspace file is recorded as the workspace, whatever its folders', () => {
    deepStrictEqual(
      entryOfWindow(
        windowOf(
          [uri('/home/u/a'), uri('/home/u/b')],
          uri('/home/u/w.code-workspace'),
        ),
      ),
      {
        hostKey: 'host-a',
        entry: {path: '/home/u/w.code-workspace', kind: 'workspace'},
      },
    );
  });

  it('F-2503 BR-5, AC-7, AC-30: no folder, a local folder, a local workspace file, two folders or another authority record nothing', () => {
    deepStrictEqual(
      [
        entryOfWindow(windowOf([])),
        entryOfWindow(windowOf([uri('/home/u/f1', 'file', '')])),
        entryOfWindow(windowOf([], uri('/w.code-workspace', 'file', ''))),
        entryOfWindow(windowOf([uri('/a'), uri('/b')])),
        entryOfWindow(windowOf([uri('/a', REMOTE, 'dev-container+abc')])),
      ],
      [undefined, undefined, undefined, undefined, undefined],
    );
  });

  it('F-2503 AC-28: a first resolve that failed records nothing', async () => {
    const store = memento();
    const resolve = resolveOf('failed');
    recordOnFirstResolve(resolve.handle, windowOf([uri('/home/u/f1')]), store);
    resolve.fire();
    await settled();
    deepStrictEqual(storedHistory(store), []);
  });

  it('F-2503 BR-2: a window with nothing to record records nothing when the resolve succeeded', async () => {
    const store = memento();
    const resolve = resolveOf('succeeded');
    recordOnFirstResolve(resolve.handle, windowOf([]), store);
    resolve.fire();
    await settled();
    deepStrictEqual(storedHistory(store), []);
  });

  it('F-2503 BR-2: a listener that fires twice records once', async () => {
    let writes = 0;
    const counting: HistoryMemento = {
      get: () => undefined,
      update: () => {
        writes += 1;
        return Promise.resolve();
      },
    };
    const resolve = resolveOf('succeeded', 2);
    recordOnFirstResolve(
      resolve.handle,
      windowOf([uri('/home/u/f1')]),
      counting,
    );
    resolve.fire();
    await settled();
    deepStrictEqual(writes, 1);
  });

  it('F-3906 rule 5: a write that fails is attempted once and dropped, with no throw', async () => {
    let attempts = 0;
    const failing: HistoryMemento = {
      get: () => undefined,
      update: () => {
        attempts += 1;
        return Promise.reject(new Error('disk full'));
      },
    };
    const resolve = resolveOf('succeeded');
    recordOnFirstResolve(
      resolve.handle,
      windowOf([uri('/home/u/f1')]),
      failing,
    );
    resolve.fire();
    await settled();
    deepStrictEqual(attempts, 1);
  });
});
