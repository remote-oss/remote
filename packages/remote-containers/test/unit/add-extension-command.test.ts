import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type AddExtensionOutcome,
  type AddExtensionPorts,
  type AttachedWindow,
  addExtensionCommandOf,
} from '../../src/authoring/add-extension-command.ts';
import type {WindowFolder} from '../../src/authoring/configure-features.ts';
import type {PickerAnswer} from '../../src/config/choose-configuration.ts';
import type {Candidate} from '../../src/config/discovery.ts';
import {filesOf} from './authoring-files.fixture.ts';
import {
  fakePortsOf,
  type FakeEditor,
  uriOf,
} from './configuration-edit.fixture.ts';

const FOLDER: WindowFolder = {scheme: 'file', fsPath: '/w/p', path: '/w/p'};
const MAIN = '/w/p/.devcontainer/devcontainer.json';
const DOTFILE = '/w/p/.devcontainer.json';
const SUBFOLDER = '/w/p/.devcontainer/a/devcontainer.json';
const LINK =
  '[Dev Container configuration](command:remote-containers.openDevContainerFile)';
const STORAGE = '/store';

interface Scene {
  ports: AddExtensionPorts;
  /** The notifications, modals, previews and reveals, in order. */
  seen: string[];
  /** The calls of the editor and the file system. */
  calls: string[];
  start(): Promise<AddExtensionOutcome>;
}

/** The command over a window of `folders` whose disk holds `contents`; `editor` steers the editor's documents. */
function sceneOf(
  contents: Record<string, string>,
  options: {
    folders?: readonly WindowFolder[];
    editor?: Omit<FakeEditor, 'files'>;
    modal?: string | undefined;
    pick?: PickerAnswer;
    attached?: AttachedWindow;
    ownFile?: string;
    stored?: Candidate;
    mirrored?: Candidate[];
  } = {},
): Scene {
  const seen: string[] = [];
  const editor = fakePortsOf({...options.editor, files: contents});
  const hostFiles = filesOf(contents);
  const ports: AddExtensionPorts = {
    window: {
      folders: () => options.folders ?? [FOLDER],
      remoteName: () => undefined,
    },
    filesOf: () => hostFiles,
    hostFiles,
    compare: (left, right) => left.localeCompare(right),
    ...(options.stored === undefined
      ? {}
      : {stored: () => Promise.resolve(options.stored)}),
    ...(options.mirrored === undefined
      ? {}
      : {mirrored: () => Promise.resolve(options.mirrored ?? [])}),
    surfaces: {
      pick: (rows, placeholder) => {
        seen.push(
          `pick ${placeholder} ${rows.map(each => `${each.label}:${each.description}`).join(',')}`,
        );
        return Promise.resolve(options.pick ?? {kind: 'dismissed'});
      },
      openPreview: file => {
        seen.push(`preview ${file}`);
        return Promise.resolve();
      },
      showModal: (detail, buttons) => {
        seen.push(`modal ${detail} | ${buttons.join(',')}`);
        return Promise.resolve(options.modal);
      },
      showError: () => Promise.resolve(undefined),
      revealLog: () => undefined,
    },
    addFiles: () => {
      seen.push('addFiles');
      return Promise.resolve();
    },
    translate: template => template,
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    edit: editor.ports,
    attached: () => options.attached,
    ownConfigFile: () => options.ownFile,
    storage: STORAGE,
    exists: file => Promise.resolve(file in contents),
    uriOf: file => uriOf(file),
    reveal: uri => {
      seen.push(`reveal ${uri.fsPath}`);
      return Promise.resolve();
    },
    notify: message => {
      seen.push(`notify ${message}`);
    },
    notifyError: message => {
      seen.push(`error ${message}`);
    },
  };
  return {
    ports,
    seen,
    calls: editor.calls,
    start: () => addExtensionCommandOf(ports)('ms.tool'),
  };
}

const EMPTY = '{\n  "name": "x"\n}';

describe('Add to devcontainer.json (card containers-207, brief-authoring-edits §3)', () => {
  it('F-0809 AC-4, AC-5, AC-13 (c207-buffer): the one configuration is edited in its buffer and shown, S174 links to the configuration, and nothing is written or saved', async () => {
    const scene = sceneOf({[MAIN]: EMPTY});
    const outcome = await scene.start();
    deepStrictEqual(
      [
        outcome,
        scene.seen,
        scene.calls.filter(line => /^(write|rename|save)/.test(line)),
      ],
      [
        {kind: 'added'},
        [
          `reveal ${MAIN}`,
          `notify Extension has been added to the ${LINK}.`,
        ].reverse(),
        [],
      ].map(each => each) as never,
    );
  });

  it('F-0809 AC-6, AC-42 (c207-duplicate): an id the configuration holds gives S175, shows no editor and edits nothing', async () => {
    const scene = sceneOf({
      [MAIN]: '{"customizations": {"vscode": {"extensions": ["ms.tool"]}}}',
    });
    const outcome = await scene.start();
    deepStrictEqual(
      [
        outcome,
        scene.seen,
        scene.calls.filter(line => line.startsWith('edit')),
      ],
      [
        {kind: 'duplicate'},
        [`notify Extension is already included in the ${LINK}.`],
        [],
      ],
    );
  });

  it('F-0809 AC-11, AC-12 (c207-none): no configuration shows the modal; Cancel ends it, and Add Files... goes to the wizard', async () => {
    const cancelled = sceneOf({});
    const adding = sceneOf({}, {modal: 'Add Files...'});
    deepStrictEqual(
      [
        await cancelled.start(),
        await adding.start(),
        cancelled.seen,
        adding.seen,
      ],
      [
        {kind: 'cancelled'},
        {kind: 'adding'},
        ['modal No container configuration file found. | Add Files...'],
        [
          'modal No container configuration file found. | Add Files...',
          'addFiles',
        ],
      ],
    );
  });

  it('F-0809 AC-47, AC-23, AC-26 (c207-pick): several configurations are picked from; the pick edits only that file, a dismissed pick edits nothing, and Open File previews without adding', async () => {
    const contents = {[MAIN]: EMPTY, [SUBFOLDER]: '{"name": "sub a"}'};
    const picked = sceneOf(contents, {pick: {kind: 'picked', index: 1}});
    const dismissed = sceneOf(contents);
    const opened = sceneOf(contents, {pick: {kind: 'openFile', index: 0}});
    const outcomes = [
      await picked.start(),
      await dismissed.start(),
      await opened.start(),
    ];
    deepStrictEqual(
      [
        outcomes,
        picked.seen[0],
        picked.calls
          .filter(line => line.startsWith('edit'))
          .map(line => line.split(' ')[1]),
        dismissed.calls.filter(line => line.startsWith('edit')),
        opened.seen.slice(1),
      ],
      [
        [{kind: 'added'}, {kind: 'cancelled'}, {kind: 'cancelled'}],
        'pick Select a devcontainer.json file. x:.devcontainer/devcontainer.json,sub a:.devcontainer/a/devcontainer.json',
        [SUBFOLDER],
        [],
        [`preview ${MAIN}`],
      ],
    );
  });

  it('F-0809 AC-31, AC-9 (c207-own): a window that knows the configuration it was made from edits that file whatever else is found', async () => {
    const scene = sceneOf(
      {'/host/proj/.devcontainer/devcontainer.json': EMPTY, [DOTFILE]: '{}'},
      {ownFile: '/host/proj/.devcontainer/devcontainer.json'},
    );
    const outcome = await scene.start();
    deepStrictEqual(
      [
        outcome,
        scene.calls
          .filter(line => line.startsWith('edit'))
          .map(line => line.split(' ')[1]),
      ],
      [{kind: 'added'}, ['/host/proj/.devcontainer/devcontainer.json']],
    );
  });

  it('F-0809 AC-35, AC-38, AC-49, AC-50 (c207-external): a configuration of the store or a mirror is written on disk when no tab holds it and edited in the buffer when one does, and no editor is shown', async () => {
    const stored: Candidate = {
      file: '/store/slot/devcontainer.json',
      relative: '~/slot/devcontainer.json',
      place: {kind: 'stored', slot: 'slot'},
    };
    const closed = sceneOf({[stored.file]: EMPTY}, {stored});
    const open = sceneOf(
      {[stored.file]: EMPTY},
      {
        stored,
        editor: {tabs: {[stored.file]: {text: EMPTY, dirty: false}}},
      },
    );
    deepStrictEqual(
      [
        await closed.start(),
        await open.start(),
        closed.calls.filter(line => /^(write|rename)/.test(line)).length,
        open.calls.filter(line => line.startsWith('edit')).length,
        [...closed.seen, ...open.seen].filter(line =>
          line.startsWith('reveal'),
        ),
      ],
      [{kind: 'added'}, {kind: 'added'}, 2, 1, []],
    );
  });

  it('F-0809 AC-38, AC-51 (c207-pick-external): a pick between a configuration of the store and one of the window edits the store’s on disk and the window’s in its buffer', async () => {
    const stored: Candidate = {
      file: '/store/slot/devcontainer.json',
      relative: '~/slot/devcontainer.json',
      place: {kind: 'stored', slot: 'slot'},
    };
    const contents = {[MAIN]: EMPTY, [stored.file]: EMPTY};
    const onDisk = sceneOf(contents, {
      stored,
      pick: {kind: 'picked', index: 0},
    });
    const inBuffer = sceneOf(contents, {
      stored,
      pick: {kind: 'picked', index: 1},
    });
    deepStrictEqual(
      [
        await onDisk.start(),
        await inBuffer.start(),
        onDisk.calls.filter(line => /^(write|rename)/.test(line)).length,
        onDisk.seen.filter(line => line.startsWith('reveal')),
        inBuffer.calls.filter(line => line.startsWith('edit')).length,
        inBuffer.seen.filter(line => line.startsWith('reveal')),
      ],
      [{kind: 'added'}, {kind: 'added'}, 2, [], 1, [`reveal ${MAIN}`]],
    );
  });

  it('F-0809 AC-20, AC-25, AC-43 (c207-attached): an attached window writes the id to the image’s attach file, or to the name’s when that exists, and records the open folder; no editor is shown', async () => {
    const attached: AttachedWindow = {
      image: 'nginx:1',
      name: 'web',
      folder: '/work',
    };
    const image = sceneOf({}, {attached});
    const named = sceneOf(
      {[`${STORAGE}/nameConfigs/web.json`]: '{"extensions": ["a.b"]}'},
      {attached},
    );
    deepStrictEqual(
      [
        await image.start(),
        await named.start(),
        image.calls
          .filter(line => line.startsWith('write'))
          .map(line => line.split(' ')[1]),
        named.calls
          .filter(line => line.startsWith('write'))
          .map(line => line.split(' ')[1]),
        image.calls.some(line =>
          line.includes('\\"workspaceFolder\\": \\"/work\\"'),
        ),
        [...image.seen, ...named.seen].filter(line =>
          line.startsWith('reveal'),
        ),
      ],
      [
        {kind: 'added'},
        {kind: 'added'},
        [`${STORAGE}/imageConfigs/.u1.tmp`],
        [`${STORAGE}/nameConfigs/.u1.tmp`],
        true,
        [],
      ],
    );
  });

  it('F-0809 AC-39 (c207-broken): a configuration that is no JSON object, or whose list is no array, gives an error notification, shows no editor and writes nothing', async () => {
    const text = sceneOf({[MAIN]: 'not json'});
    const array = sceneOf({[MAIN]: '{"extensions": "x"}'});
    deepStrictEqual(
      [
        await text.start(),
        await array.start(),
        text.seen,
        array.seen,
        [...text.calls, ...array.calls].filter(line =>
          /^(edit|write|save)/.test(line),
        ),
      ],
      [
        {kind: 'failed'},
        {kind: 'failed'},
        [
          `error The configuration ${LINK} is not a JSON object, so the extension was not added.`,
        ],
        [
          'error extensions in the configuration is not an array, so the extension was not added.',
        ],
        [],
      ],
    );
  });

  it('F-0809 AC-39 (c207-badname): an attached container whose name cannot be a file name gives an error and writes nothing', async () => {
    const scene = sceneOf(
      {[`${STORAGE}/nameConfigs/x:y.json`]: '{}'},
      {attached: {image: 'a:b', name: 'x:y', folder: undefined}},
    );
    deepStrictEqual(
      [
        await scene.start(),
        scene.seen,
        scene.calls.filter(line => /^(write|rename|edit)/.test(line)),
      ],
      [
        {kind: 'failed'},
        ['error The extension could not be added: badName'],
        [],
      ],
    );
  });
});
