import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {DevContainerFolder} from '../../src/authority/payload.ts';
import {
  type RecentLabelPorts,
  type StoredEntry,
  storeRecentLabel,
  tildedPathOf,
  type WindowEntry,
} from '../../src/connect/recent-label.ts';

const TARGET: DevContainerFolder = {
  kind: 'folder',
  hostPath: '/home/al/work/app',
  localDocker: true,
  configFile: {
    $mid: 1,
    path: '/home/al/work/app/.devcontainer/devcontainer.json',
    scheme: 'file',
  },
};

const ENTRY: WindowEntry = {
  type: 'folder',
  uri: 'vscode-remote://dev-container%2B7b7d/workspaces/app',
  remoteAuthority: 'dev-container+7b7d',
};

/** The editor's side of the storing over fakes, with what it saw. */
function storing(
  options: {
    entry?: WindowEntry | undefined;
    stored?: StoredEntry[];
    failRead?: boolean;
    failAdd?: boolean;
    /** What a failing add rejects with. */
    rejection?: unknown;
  } = {},
) {
  const added: Array<WindowEntry & {label: string}> = [];
  const warned: string[] = [];
  let reads = 0;
  const ports: RecentLabelPorts = {
    homeFolder: () => '/home/al',
    windowEntry: () => ('entry' in options ? options.entry : ENTRY),
    recentEntries: () => {
      reads += 1;
      return options.failRead === true
        ? Promise.reject(new Error('no list'))
        : Promise.resolve(options.stored ?? []);
    },
    addEntry: entry => {
      if (options.failAdd === true) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a rejection that is no Error is a case under test
        return Promise.reject(options.rejection ?? new Error('not added'));
      }
      added.push(entry);
      return Promise.resolve();
    },
  };
  const logger = {
    ...createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    warn: (message: string) => {
      warned.push(message);
    },
  };
  return {
    store: () => storeRecentLabel(ports, template => template, logger, TARGET),
    added,
    warned,
    reads: () => reads,
  };
}

describe('tildedPathOf', () => {
  it('writes the home folder itself as ~', () => {
    deepStrictEqual(tildedPathOf('/home/al', '/home/al'), '~');
  });

  it('replaces the home folder above a path', () => {
    deepStrictEqual(
      tildedPathOf('/home/al/work/app', '/home/al'),
      '~/work/app',
    );
  });

  it('keeps a path outside the home folder', () => {
    deepStrictEqual(tildedPathOf('/srv/app', '/home/al'), '/srv/app');
  });

  it('keeps a path whose first segment only starts with the home folder', () => {
    deepStrictEqual(
      tildedPathOf('/home/alex/app', '/home/al'),
      '/home/alex/app',
    );
  });

  it('reads a home folder with a trailing separator as the folder', () => {
    deepStrictEqual(tildedPathOf('/home/al/app', '/home/al/'), '~/app');
  });

  it('keeps every path when the home folder is the root or unknown', () => {
    deepStrictEqual(
      [tildedPathOf('/srv/app', '/'), tildedPathOf('/srv/app', '')],
      ['/srv/app', '/srv/app'],
    );
  });
});

describe('storeRecentLabel', () => {
  it('adds the window with its tilded path and the static suffix when the editor has no entry', async () => {
    const seen = storing();
    await seen.store();
    deepStrictEqual(seen.added, [
      {...ENTRY, label: '~/work/app [Dev Container]'},
    ]);
  });

  it('adds a workspace window as a workspace', async () => {
    const entry: WindowEntry = {...ENTRY, type: 'workspace'};
    const seen = storing({entry});
    await seen.store();
    deepStrictEqual(seen.added, [
      {...entry, label: '~/work/app [Dev Container]'},
    ]);
  });

  it('adds the label to an entry that has none', async () => {
    const seen = storing({stored: [{uri: ENTRY.uri, label: undefined}]});
    await seen.store();
    deepStrictEqual(seen.added.length, 1);
  });

  it('adds the window when only other folders are stored', async () => {
    const seen = storing({stored: [{uri: 'file:///other', label: 'other'}]});
    await seen.store();
    deepStrictEqual(seen.added.length, 1);
  });

  it('leaves an entry that has a label alone, whatever the label says', async () => {
    const seen = storing({stored: [{uri: ENTRY.uri, label: 'old name'}]});
    await seen.store();
    deepStrictEqual([seen.added, seen.warned], [[], []]);
  });

  it('stores nothing while the window has no folder', async () => {
    const seen = storing({entry: undefined});
    await seen.store();
    deepStrictEqual([seen.added, seen.reads()], [[], 0]);
  });

  it('logs one line when the entries cannot be read', async () => {
    const seen = storing({failRead: true});
    await seen.store();
    deepStrictEqual(
      [seen.warned, seen.added],
      [['the Open Recent entry was not stored: no list'], []],
    );
  });

  it('logs one line when the entry cannot be added', async () => {
    const seen = storing({failAdd: true});
    await seen.store();
    deepStrictEqual(seen.warned, [
      'the Open Recent entry was not stored: not added',
    ]);
  });

  it('logs a failure that is not an error by its text', async () => {
    const seen = storing({failAdd: true, rejection: 'refused'});
    await seen.store();
    deepStrictEqual(seen.warned, [
      'the Open Recent entry was not stored: refused',
    ]);
  });
});
