import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {
  ChosenConfiguration,
  FeaturesOutcome,
} from '../../src/authoring/configure-features.ts';
import {featuresRunOf} from '../../src/authoring/features-run.ts';
import type {AuthoringFiles} from '../../src/authoring/window-files.ts';
import {
  finishWith,
  FINISH_BUTTON,
  type FakeOptionPicker,
  pressEscape,
  scriptedInput,
  type Step,
} from './option-picker.fixture.ts';

const NODE = 'ghcr.io/devcontainers/features/node';
const GIT_ID = 'ghcr.io/devcontainers/features/git';
const COMMON = 'ghcr.io/devcontainers/features/common-utils';

/** A catalogue whose order (Node, Git, Common Utilities) differs from the screen's (by label). */
const INDEX = JSON.stringify({
  collections: [
    {
      sourceInformation: {
        repository: 'https://github.com/devcontainers/features',
      },
      features: [
        {id: NODE, version: '1.6.3', name: 'Node'},
        {id: GIT_ID, version: '1.3.2', name: 'Git'},
        {id: COMMON, version: '2.5.3', name: 'Common Utilities'},
      ],
    },
  ],
});

const FILE = '/w/p/.devcontainer/devcontainer.json';

interface Scene {
  written: string[];
  opened: string[];
  errors: string[];
  screens: FakeOptionPicker[];
  runWith(
    text: string,
    steps: Step[],
    options?: {
      download?: () => Promise<string>;
      writeFails?: 'error' | 'text';
    },
  ): Promise<FeaturesOutcome>;
}

/** The run over fakes. */
function sceneOf(): Scene {
  const scene: Scene = {
    written: [],
    opened: [],
    errors: [],
    screens: [],
    runWith: async (text, steps, options = {}) => {
      const input = scriptedInput(steps);
      const files: AuthoringFiles = {
        kindOf: () => Promise.resolve('file'),
        exists: () => Promise.resolve(true),
        list: () => Promise.resolve([]),
        read: () => Promise.resolve(new Uint8Array()),
        write: (file, bytes) => {
          if (options.writeFails === 'error') {
            return Promise.reject(new Error('EACCES: read-only file'));
          }
          if (options.writeFails === 'text') {
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the port may reject with any value
            return Promise.reject('disk full');
          }
          scene.written.push(`${file}\n${new TextDecoder().decode(bytes)}`);
          return Promise.resolve();
        },
        makeFolder: () => Promise.resolve(),
        removeFile: () => Promise.resolve(),
        removeFolder: () => Promise.resolve(),
        creationProblem: () => Promise.resolve(undefined),
      };
      const featuresRun = featuresRunOf({
        catalogue: {
          environment: {},
          download: options.download ?? (() => Promise.resolve(INDEX)),
          setTimer: () => () => undefined,
        },
        quick: {...input.ports, translate: template => template},
        showError: (message, detail) => {
          scene.errors.push(`${message}|${detail}`);
          return Promise.resolve();
        },
        openPreview: file => {
          scene.opened.push(file);
          return Promise.resolve();
        },
        translate: template => template,
        logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
      });
      const chosen: ChosenConfiguration = {
        file: FILE,
        relative: '.devcontainer/devcontainer.json',
        text,
        files,
        root: undefined,
      };
      const outcome = await featuresRun(chosen);
      scene.screens.push(...input.pickers);
      return outcome;
    },
  };
  return scene;
}

function withoutFile(text: string): string {
  return text.split('\n').slice(1).join('\n');
}

describe('the pick and write of Configure Container Features (card containers-150)', () => {
  it('F-0807 AC-9: the screen has Finish and no Back, and nothing is checked for a file with no Features', async () => {
    const scene = sceneOf();
    await scene.runWith('{}', [pressEscape]);
    const [screen] = scene.screens;
    deepStrictEqual(
      [screen?.title, screen?.buttons, screen?.selectedItems.length],
      ['Select Features', [FINISH_BUTTON], 0],
    );
  });

  it('F-0807 AC-10, BR-1: the Features the file lists, under any version form, are checked', async () => {
    const scene = sceneOf();
    const text = JSON.stringify({features: {[`${NODE}:7`]: {}, [GIT_ID]: {}}});
    await scene.runWith(text, [pressEscape]);
    deepStrictEqual(
      scene.screens[0]?.selectedItems.map(each => each.label),
      ['Git', 'Node'],
    );
  });

  it('F-0807 AC-11, BR-1: a Feature of another registry, a bare id or a digest-pinned one is not checked', async () => {
    const scene = sceneOf();
    const text = JSON.stringify({
      features: {
        'ghcr.io/other/features/node:1': {},
        bare: {},
        [`${COMMON}@sha256:${'a'.repeat(64)}`]: {},
      },
    });
    await scene.runWith(text, [pressEscape]);
    deepStrictEqual(scene.screens[0]?.selectedItems, []);
  });

  it('F-0807 AC-13, AC-14, AC-31, BR-11: Finish writes the checked Features by their catalogue keys in catalogue order, and opens the file', async () => {
    const scene = sceneOf();
    const outcome = await scene.runWith('{\n    "image": "x"\n}\n', [
      finishWith(['Common Utilities', 'Git', 'Node']),
    ]);
    deepStrictEqual(
      [outcome, scene.written.map(withoutFile), scene.opened],
      [
        {kind: 'written', file: FILE},
        [
          `{\n    "image": "x",\n    "features": {\n        "${NODE}:1": {},\n        "${GIT_ID}:1": {},\n        "${COMMON}:2": {}\n    }\n}\n`,
        ],
        [FILE],
      ],
    );
  });

  it('F-0807 AC-17, BR-18: an other-version entry stays and the catalogue key is added beside it', async () => {
    const scene = sceneOf();
    const text = `{"features": {"${COMMON}:3": {"x": 1}}}`;
    await scene.runWith(text, [finishWith(['Common Utilities'])]);
    deepStrictEqual(JSON.parse(scene.written.map(withoutFile)[0] ?? '{}'), {
      features: {[`${COMMON}:3`]: {x: 1}, [`${COMMON}:2`]: {}},
    });
  });

  it('F-0807 AC-46, BR-18: unchecking the preselected Feature leaves an other-version entry as it is, and writes nothing', async () => {
    const scene = sceneOf();
    const text = `{"features": {"${COMMON}:3": {"x": 1}}}`;
    const outcome = await scene.runWith(text, [finishWith([])]);
    deepStrictEqual([outcome, scene.written], [{kind: 'unchanged'}, []]);
  });

  it('F-0807 AC-16, BR-3: unchecking a Feature whose catalogue key is in the file removes it', async () => {
    const scene = sceneOf();
    const text = `{"features": {"${GIT_ID}:1": {}}}`;
    await scene.runWith(text, [finishWith([])]);
    deepStrictEqual(scene.written.map(withoutFile), ['{"features": {}}']);
  });

  it('F-0807 AC-27, BR-9: nothing picked in a file with no "features" writes nothing', async () => {
    const scene = sceneOf();
    const outcome = await scene.runWith('{"image": "x"}', [finishWith([])]);
    deepStrictEqual([outcome, scene.written], [{kind: 'unchanged'}, []]);
  });

  it('F-0807 AC-30: Escape writes nothing and opens nothing', async () => {
    const scene = sceneOf();
    const outcome = await scene.runWith('{}', [pressEscape]);
    deepStrictEqual(
      [outcome, scene.written, scene.opened],
      [{kind: 'cancelled'}, [], []],
    );
  });

  it('F-0807 AC-32: OK writes what is checked, as Finish does', async () => {
    const scene = sceneOf();
    await scene.runWith('{\n    "image": "x"\n}\n', [
      picker => {
        picker.acceptChecked(['Git']);
      },
    ]);
    deepStrictEqual(scene.written.map(withoutFile), [
      `{\n    "image": "x",\n    "features": {\n        "${GIT_ID}:1": {}\n    }\n}\n`,
    ]);
  });

  it('F-0807 AC-55, 7.E6: a "features" that is an array writes nothing and opens no editor', async () => {
    const scene = sceneOf();
    const outcome = await scene.runWith('{"features": []}', [
      finishWith(['Git']),
    ]);
    deepStrictEqual(
      [outcome.kind, scene.written, scene.opened],
      ['failed', [], []],
    );
  });

  it('F-0807 AC-57, 7.E8: a catalogue that cannot be fetched gives the error with the cause, and no screen', async () => {
    const scene = sceneOf();
    const outcome = await scene.runWith('{}', [], {
      download: () => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:9')),
    });
    deepStrictEqual(
      [outcome.kind, scene.errors, scene.screens.length, scene.written],
      [
        'failed',
        [
          "Command 'Dev Containers: Configure Container Features...' resulted in an error|ECONNREFUSED 127.0.0.1:9",
        ],
        0,
        [],
      ],
    );
  });

  it('F-0807 AC-56, 7.E7: a file that cannot be written is left as it is, and the error is shown', async () => {
    const scene = sceneOf();
    const outcome = await scene.runWith('{}', [finishWith(['Git'])], {
      writeFails: 'error',
    });
    deepStrictEqual(
      [outcome, scene.errors, scene.opened],
      [
        {kind: 'failed', detail: 'EACCES: read-only file'},
        ['|EACCES: read-only file'],
        [],
      ],
    );
  });

  it('F-0807 7.E7: a write that fails with something that is no error is shown as its text', async () => {
    const scene = sceneOf();
    const outcome = await scene.runWith('{}', [finishWith(['Git'])], {
      writeFails: 'text',
    });
    deepStrictEqual(outcome, {kind: 'failed', detail: 'disk full'});
  });
});
