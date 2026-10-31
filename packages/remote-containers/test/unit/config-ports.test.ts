import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type ConfigEditorHost,
  configFilesOf,
  configSurfacesOf,
  type QuickPickHandle,
} from '../../src/config/config-ports.ts';

/** A quick pick that records what was set on it and lets a test play the user. */
class FakePick implements QuickPickHandle {
  items: QuickPickHandle['items'] = [];
  activeItems: QuickPickHandle['activeItems'] = [];
  selectedItems: QuickPickHandle['selectedItems'] = [];
  placeholder: string | undefined = undefined;
  canSelectMany = true;
  matchOnDescription = true;
  matchOnDetail = true;
  ignoreFocusOut = true;
  events: string[] = [];
  accepted: Array<() => void> = [];
  hidden: Array<() => void> = [];
  buttons: Array<(event: {item: QuickPickHandle['items'][number]}) => void> =
    [];

  onDidAccept(listener: () => void): void {
    this.accepted.push(listener);
  }

  onDidHide(listener: () => void): void {
    this.hidden.push(listener);
  }

  onDidTriggerItemButton(
    listener: (event: {item: QuickPickHandle['items'][number]}) => void,
  ): void {
    this.buttons.push(listener);
  }

  show(): void {
    this.events.push('show');
  }

  hide(): void {
    this.events.push('hide');
    for (const listener of this.hidden) {
      listener();
    }
  }

  dispose(): void {
    this.events.push('dispose');
  }
}

/** The surfaces over fakes. */
function scene(options: {openFails?: unknown; warningAnswer?: string} = {}) {
  const pick = new FakePick();
  const sink = new MemorySink();
  const calls: unknown[] = [];
  const host: ConfigEditorHost = {
    createQuickPick: () => pick,
    showWarningMessage: (message, given, ...items) => {
      calls.push(['warn', message, given, items]);
      return Promise.resolve(options.warningAnswer);
    },
    showTextDocument: (file, given) => {
      calls.push(['open', file, given]);
      return 'openFails' in options
        ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the editor may reject with anything
          Promise.reject(options.openFails)
        : Promise.resolve(undefined);
    },
    iconOf: name => `icon:${name}`,
  };
  const surfaces = configSurfacesOf(
    host,
    {showError: () => Promise.resolve(undefined), revealLog: () => undefined},
    createLogger(sink, {minimumLevel: () => 'info'}),
  );
  return {pick, surfaces, sink, calls};
}

const ROWS = [
  {label: 'Alpha', description: 'a/devcontainer.json'},
  {label: 'Beta', description: 'b/devcontainer.json'},
];

describe('the editor adapters of the configuration choice (card containers-13)', () => {
  it('F-0301 AC-40: the quick pick has the placeholder, one button per row, the first row active, and filters on the label alone (5.0 step 4, BR-15)', () => {
    const {pick, surfaces} = scene();
    void surfaces.pick(ROWS, 'Select a devcontainer.json file.', 'Open File');
    deepStrictEqual(
      [
        pick.placeholder,
        pick.canSelectMany,
        pick.matchOnDescription,
        pick.matchOnDetail,
        pick.ignoreFocusOut,
        pick.items,
        pick.activeItems,
        pick.events,
      ],
      [
        'Select a devcontainer.json file.',
        false,
        false,
        false,
        false,
        ROWS.map(each => ({
          ...each,
          buttons: [{iconPath: 'icon:go-to-file', tooltip: 'Open File'}],
        })),
        [
          {
            ...ROWS[0],
            buttons: [{iconPath: 'icon:go-to-file', tooltip: 'Open File'}],
          },
        ],
        ['show'],
      ],
    );
  });

  it('F-0301 5.0 step 4: accepting the selected row answers its index and closes the pick', async () => {
    const {pick, surfaces} = scene();
    const answered = surfaces.pick(ROWS, 'p', 't');
    pick.selectedItems = [pick.items[1] ?? {label: ''}];
    pick.accepted.forEach(listener => {
      listener();
    });
    deepStrictEqual(
      [await answered, pick.events],
      [{kind: 'picked', index: 1}, ['show', 'hide', 'dispose']],
    );
  });

  it('F-0301 6.3: accepting with no row selected, because the filter hid them all, is dismissed', async () => {
    const {pick, surfaces} = scene();
    const answered = surfaces.pick(ROWS, 'p', 't');
    pick.accepted.forEach(listener => {
      listener();
    });
    deepStrictEqual(await answered, {kind: 'dismissed'});
  });

  it('F-0301 5.0 step 6: the button of a row answers openFile with its index', async () => {
    const {pick, surfaces} = scene();
    const answered = surfaces.pick(ROWS, 'p', 't');
    pick.buttons.forEach(listener => {
      listener({item: pick.items[1] ?? {label: ''}});
    });
    deepStrictEqual(await answered, {kind: 'openFile', index: 1});
  });

  it('F-0301 6.3: a pick hidden before an answer, by Escape or by the focus moving, is dismissed and disposed', async () => {
    const {pick, surfaces} = scene();
    const answered = surfaces.pick(ROWS, 'p', 't');
    pick.hidden.forEach(listener => {
      listener();
    });
    deepStrictEqual(
      [await answered, pick.events],
      [{kind: 'dismissed'}, ['show', 'dispose']],
    );
  });

  it('F-0301 7.E2: the warning is modal, with its detail and no buttons of ours', async () => {
    const {surfaces, calls} = scene({warningAnswer: 'x'});
    const answer = await surfaces.showWarning('', 'detail', []);
    deepStrictEqual(
      [answer, calls],
      ['x', [['warn', '', {modal: true, detail: 'detail'}, []]]],
    );
  });

  it('F-0301 5.0 step 6: a file opens as a preview', async () => {
    const {surfaces, calls} = scene();
    await surfaces.openPreview('/w/p/a.json');
    deepStrictEqual(calls, [['open', '/w/p/a.json', {preview: true}]]);
  });

  it('F-0301 5.0 step 6: a file the editor cannot open is left to the editor, and only logged', async () => {
    const failed = scene({openFails: new Error('binary file')});
    await failed.surfaces.openPreview('/w/p/a.json');
    const textual = scene({openFails: 'nope'});
    await textual.surfaces.openPreview('/w/p/b.json');
    deepStrictEqual(
      [failed, textual].map(each => each.sink.lines.map(line => line.message)),
      [
        ['could not open /w/p/a.json: binary file'],
        ['could not open /w/p/b.json: nope'],
      ],
    );
  });
});

describe('the files of the configuration choice (card containers-13)', () => {
  const TYPES = {File: 1, Directory: 2};

  it('F-0301 AC-34: a folder, a link to a folder, a file, a link to a file and anything else are listed as what they point to (BR-1)', async () => {
    const files = configFilesOf(
      {
        readDirectory: () =>
          Promise.resolve([
            ['d', 2],
            ['dl', 2 | 64],
            ['f', 1],
            ['fl', 1 | 64],
            ['x', 64],
            ['u', 0],
          ]),
        readFile: () => Promise.resolve(new Uint8Array()),
        stat: () => Promise.resolve({}),
      },
      TYPES,
    );
    deepStrictEqual(await files.list('/w'), [
      {name: 'd', kind: 'folder'},
      {name: 'dl', kind: 'folder'},
      {name: 'f', kind: 'file'},
      {name: 'fl', kind: 'file'},
      {name: 'x', kind: 'other'},
      {name: 'u', kind: 'other'},
    ]);
  });

  it('F-0301 6.2: a folder that cannot be listed has no entries', async () => {
    const files = configFilesOf(
      {
        readDirectory: () => Promise.reject(new Error('gone')),
        readFile: () => Promise.resolve(new Uint8Array()),
        stat: () => Promise.resolve({}),
      },
      TYPES,
    );
    deepStrictEqual(await files.list('/w'), []);
  });

  it('F-0412 7.E3: a path exists when the editor can stat it, and does not when it cannot', async () => {
    const files = configFilesOf(
      {
        readDirectory: () => Promise.resolve([]),
        readFile: () => Promise.resolve(new Uint8Array()),
        stat: path =>
          path === '/w/Dockerfile'
            ? Promise.resolve({})
            : Promise.reject(new Error('ENOENT')),
      },
      TYPES,
    );
    deepStrictEqual(
      [await files.exists('/w/Dockerfile'), await files.exists('/w/Missing')],
      [true, false],
    );
  });

  it('F-0301 7.E9: a file is its bytes, and one that cannot be opened is unreadable', async () => {
    const readable = configFilesOf(
      {
        readDirectory: () => Promise.resolve([]),
        readFile: () => Promise.resolve(Uint8Array.from([1, 2])),
        stat: () => Promise.resolve({}),
      },
      TYPES,
    );
    const denied = configFilesOf(
      {
        readDirectory: () => Promise.resolve([]),
        readFile: () => Promise.reject(new Error('EACCES')),
        stat: () => Promise.resolve({}),
      },
      TYPES,
    );
    deepStrictEqual(
      [await readable.read('/f'), await denied.read('/f')],
      [Uint8Array.from([1, 2]), 'unreadable'],
    );
  });
});
