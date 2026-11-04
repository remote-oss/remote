import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type AttachedLabelWindow,
  type LabelOutcome,
  type LabelPorts,
  labelCommandOf,
} from '../../src/ports/label-command.ts';
import {
  type FakeEditor,
  fakePortsOf,
  uriOf,
} from './configuration-edit.fixture.ts';

const CONFIG = '/w/p/.devcontainer/devcontainer.json';
const STORAGE = '/store';
const LINK =
  '[Dev Container configuration](command:remote-containers.openDevContainerFile)';
const EMPTY = '{\n  "name": "x"\n}';
const IMAGE_FILE_PREFIX = '/store/imageConfigs/';

interface Scene {
  seen: string[];
  calls: string[];
  start(): Promise<LabelOutcome>;
}

/** The command over a window whose editor gives `answer`; `editor` steers the files and tabs. */
function sceneOf(
  answer: unknown,
  options: {
    files?: Record<string, string>;
    editor?: Omit<FakeEditor, 'files'>;
    attached?: AttachedLabelWindow;
    ownFile?: string;
  } = {},
): Scene {
  const seen: string[] = [];
  const editor = fakePortsOf({
    folders: [uriOf('/w/p')],
    ...options.editor,
    files: options.files ?? {},
  });
  const ports: LabelPorts = {
    askLabel: entry => {
      seen.push(`ask ${JSON.stringify(entry)}`);
      return Promise.resolve(answer);
    },
    edit: editor.ports,
    attached: () => options.attached,
    ownConfigFile: () => options.ownFile,
    storage: STORAGE,
    translate: template => template,
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    notify: message => {
      seen.push(`notify ${message}`);
    },
    notifyError: message => {
      seen.push(`error ${message}`);
    },
  };
  return {
    seen,
    calls: editor.calls,
    start: () => labelCommandOf(ports)({entry: 1}),
  };
}

const LABELLED = {port: 3000, label: 'web'};

describe('Set Label and Update devcontainer.json (card containers-210, brief-authoring-edits §5)', () => {
  it('F-1103 AC-4 (c210-dev): the label is written to the window’s own configuration, and S277 links to it once the write is on disk', async () => {
    const scene = sceneOf(LABELLED, {
      files: {[CONFIG]: EMPTY},
      ownFile: CONFIG,
    });
    const outcome = await scene.start();
    deepStrictEqual(
      [
        outcome,
        scene.seen,
        scene.calls.filter(line => /^(edit|save|write)/.test(line)),
      ],
      [
        {kind: 'written'},
        [
          'ask {"entry":1}',
          `notify Port attributes have been added to the ${LINK}.`,
        ],
        [
          `edit ${CONFIG} ${JSON.stringify('{\n  "name": "x",\n  "portsAttributes": {\n    "3000": {\n      "label": "web"\n    }\n  }\n}')}`,
          `save ${CONFIG}`,
        ],
      ],
    );
  });

  it('F-1103 AC-10, AC-11 (c210-nothing): Escape or an unchanged value gives nothing back, and nothing is written, shown or logged as a notice', async () => {
    const results: unknown[] = [];
    for (const answer of [
      undefined,
      {port: 'x', label: 'a'},
      {port: 3000},
      5,
    ]) {
      const scene = sceneOf(answer, {
        files: {[CONFIG]: EMPTY},
        ownFile: CONFIG,
      });
      results.push([await scene.start(), scene.seen.length, scene.calls]);
    }
    deepStrictEqual(
      results,
      Array.from({length: 4}, () => [{kind: 'nothing'}, 1, []]),
    );
  });

  it('F-1103 AC-11 (c210-same): a label the entry holds already is no change and shows no notice', async () => {
    const scene = sceneOf(LABELLED, {
      files: {[CONFIG]: '{"portsAttributes": {"3000": {"label": "web"}}}'},
      ownFile: CONFIG,
    });
    deepStrictEqual(
      [await scene.start(), scene.seen],
      [{kind: 'nothing'}, ['ask {"entry":1}']],
    );
  });

  it('F-1103 AC-24, AC-25 (c210-tabs): a dirty tab gets the label in its buffer and S277 at once with nothing saved; a clean tab is saved before S277', async () => {
    const dirty = sceneOf(LABELLED, {
      files: {[CONFIG]: EMPTY},
      editor: {tabs: {[CONFIG]: {text: EMPTY, dirty: true}}},
      ownFile: CONFIG,
    });
    const clean = sceneOf(LABELLED, {
      files: {[CONFIG]: EMPTY},
      editor: {tabs: {[CONFIG]: {text: EMPTY, dirty: false}}},
      ownFile: CONFIG,
    });
    await dirty.start();
    await clean.start();
    deepStrictEqual(
      [
        dirty.calls.map(line => line.split(' ')[0]),
        dirty.seen.length,
        clean.calls.map(line => line.split(' ')[0]),
        clean.seen.length,
      ],
      [['edit'], 2, ['edit', 'save'], 2],
    );
  });

  it('F-1103 AC-6, AC-7, AC-16 (c210-attached): an attached container’s label goes to the image’s file with the window’s folder, never to the per-name file', async () => {
    const scene = sceneOf(LABELLED, {
      files: {},
      attached: {image: 'alpine:3', folder: '/srv'},
    });
    const outcome = await scene.start();
    const written = scene.calls.find(line => line.startsWith('write')) ?? '';
    deepStrictEqual(
      [
        outcome,
        written.includes(IMAGE_FILE_PREFIX),
        written.includes('nameConfigs'),
        written.includes('workspaceFolder'),
        written.includes('\\"label\\": \\"web\\"'),
      ],
      [{kind: 'written'}, true, false, true, true],
    );
  });

  it('F-1103 BR-6 (c210-refusals): a file outside the workspace, text that is no object and portsAttributes that is no object give their own error and edit nothing', async () => {
    const outside = sceneOf(LABELLED, {
      files: {[CONFIG]: EMPTY},
      editor: {
        folders: [
          {
            scheme: 'file',
            fsPath: '/elsewhere',
            toString: () => 'file:/elsewhere',
          },
        ],
        realPaths: {[CONFIG]: '/outside/devcontainer.json'},
      },
      ownFile: CONFIG,
    });
    const notObject = sceneOf(LABELLED, {
      files: {[CONFIG]: '[]'},
      ownFile: CONFIG,
    });
    const attributes = sceneOf(LABELLED, {
      files: {[CONFIG]: '{"portsAttributes": []}'},
      ownFile: CONFIG,
    });
    const outcomes = [
      await outside.start(),
      await notObject.start(),
      await attributes.start(),
    ];
    deepStrictEqual(
      [
        outcomes.map(each => each.kind),
        notObject.seen,
        attributes.seen,
        [outside, notObject, attributes].map(scene =>
          scene.calls.filter(line => /^(write|edit|save)/.test(line)),
        ),
      ],
      [
        ['failed', 'failed', 'failed'],
        [
          'ask {"entry":1}',
          `error ${CONFIG} wasn't changed: it isn't a JSON object.`,
        ],
        [
          'ask {"entry":1}',
          `error ${CONFIG} wasn't changed: it isn't a JSON object.`,
        ],
        [[], [], []],
      ],
    );
  });

  it('F-1103 AC-4 (c210-no-file): a window with neither an attached container nor a configuration file says so and edits nothing', async () => {
    const scene = sceneOf(LABELLED);
    deepStrictEqual(
      [await scene.start(), scene.seen],
      [
        {kind: 'failed'},
        [
          'ask {"entry":1}',
          'error The label could not be written: there is no configuration file',
        ],
      ],
    );
  });
});
