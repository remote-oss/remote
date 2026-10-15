import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {CliFailure, ConfigurationResult} from '../../src/cli/cli-lines.ts';
import {
  chooseConfiguration,
  type ConfigurationChoice,
  type PickerAnswer,
} from '../../src/config/choose-configuration.ts';
import type {FirstCheckResult} from '../../src/engine/preflight.ts';
import {type Pending, pendingOf, settled, unhandledDuring} from './pending.ts';

const FOLDER = '/w/p';
const DOCKER = '/usr/bin/docker';
const ALPHA = '.devcontainer/a/devcontainer.json';
const BETA = '.devcontainer/b/devcontainer.json';
const ONLY = '.devcontainer/devcontainer.json';
const IMAGE = '{"name":"Alpha","image":"i"}';
const NEVER = new AbortController().signal;

/** What a row steers and what the fakes recorded. */
interface Scene {
  /** The content of each file, by its path relative to the folder. */
  contents: Record<string, string>;
  /** What the picker answers. */
  answer: PickerAnswer;
  /** What the error dialogs answer. */
  errorAnswer: string | undefined;
  read: ConfigurationResult | CliFailure;
  /** What the CLI's read answers when a row wants to settle it by hand; else `read` is the answer. */
  reading: Promise<ConfigurationResult | CliFailure> | undefined;
  /** The engine check, which a row may hold open. */
  engineCheck: Promise<FirstCheckResult>;
  /** What the worktree setting is, as the command passes it. */
  mountGitWorktreeCommonDir: boolean;
  calls: string[];
  rows: unknown[];
  targets: unknown[];
  sink: MemorySink;
}

function configurationOf(workspaceFolder: string): ConfigurationResult {
  return {
    kind: 'configuration',
    configuration: {},
    workspaceFolder,
    workspaceMount: undefined,
    mergedConfiguration: undefined,
  };
}

function sceneOf(contents: Scene['contents']): Scene {
  return {
    contents,
    answer: {kind: 'picked', index: 0},
    errorAnswer: undefined,
    read: configurationOf('/workspaces/p'),
    reading: undefined,
    engineCheck: Promise.resolve('proceed'),
    mountGitWorktreeCommonDir: false,
    calls: [],
    rows: [],
    targets: [],
    sink: new MemorySink(),
  };
}

/** The listing of the folder a scene's relative paths describe. */
function listing(scene: Scene): Record<string, Array<[string, string]>> {
  const tree: Record<string, Array<[string, string]>> = {};
  for (const relative of Object.keys(scene.contents)) {
    const parts = relative.split('/');
    let folder = FOLDER;
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      (tree[folder] ??= []).push([part, last ? 'file' : 'folder']);
      folder = `${folder}/${part}`;
    });
  }
  for (const [folder, entries] of Object.entries(tree)) {
    const seen = new Set<string>();
    tree[folder] = entries.filter(([name]) => {
      const fresh = !seen.has(name);
      seen.add(name);
      return fresh;
    });
  }
  return tree;
}

async function choose(scene: Scene): Promise<ConfigurationChoice> {
  const tree = listing(scene);
  return chooseConfiguration(
    {
      folder: FOLDER,
      dockerPath: DOCKER,
      mountGitWorktreeCommonDir: scene.mountGitWorktreeCommonDir,
      cancellation: NEVER,
      engineCheck: scene.engineCheck,
    },
    {
      files: {
        list: folder =>
          Promise.resolve(
            (tree[folder] ?? []).map(([name, kind]) => ({
              name,
              kind: kind as 'file' | 'folder',
            })),
          ),
        read: file => {
          scene.calls.push(`read ${file.slice(FOLDER.length + 1)}`);
          const content = scene.contents[file.slice(FOLDER.length + 1)];
          return Promise.resolve(
            content === undefined || content === 'unreadable'
              ? 'unreadable'
              : Buffer.from(content),
          );
        },
      },
      surfaces: {
        pick: (rows, placeholder, tooltip) => {
          scene.calls.push('pick');
          scene.rows.push([rows, placeholder, tooltip]);
          return Promise.resolve(scene.answer);
        },
        dialogs: {
          showError: (message, detail, items) => {
            scene.calls.push(
              `showError ${JSON.stringify([message, detail, items])}`,
            );
            return Promise.resolve(scene.errorAnswer);
          },
          revealLog: () => {
            scene.calls.push('revealLog');
          },
        },
        showWarning: (message, detail, items) => {
          scene.calls.push(
            `showWarning ${JSON.stringify([message, detail, items])}`,
          );
          return Promise.resolve(undefined);
        },
        openPreview: file => {
          scene.calls.push(`openPreview ${file.slice(FOLDER.length + 1)}`);
          return Promise.resolve();
        },
        showInformation: message => {
          scene.calls.push(`showInformation ${message}`);
        },
      },
      // eslint-disable-next-line id-length -- the choice's dependency is named cli
      cli: {
        readConfiguration: (target, containerId, onEvent) => {
          scene.targets.push([target, containerId]);
          scene.calls.push('readConfiguration');
          onEvent({
            kind: 'log',
            level: 3,
            text: 'reading',
            channel: undefined,
            type: 'text',
            timestamp: undefined,
            startTimestamp: undefined,
          });
          onEvent({
            kind: 'progress',
            name: 'Reading',
            status: 'running',
            detail: undefined,
          });
          return scene.reading ?? Promise.resolve(scene.read);
        },
      },
      compare: new Intl.Collator('en', {sensitivity: 'accent'}).compare,
      translate: template => template,
      logger: createLogger(scene.sink, {minimumLevel: () => 'debug'}),
    },
  );
}

function lines(scene: Scene): string[] {
  return scene.sink.lines.map(line => `${line.level}: ${line.message}`);
}

function infoLines(scene: Scene): string[] {
  return lines(scene).filter(line => line.startsWith('info'));
}

function S181(relative: string): string {
  return `Failed to read Dev Container configuration '${relative}' file.`;
}
function S113(relative: string): string {
  return `Dev Container configuration '${relative}' file is missing image information. You can add this manually or overwrite with a template.`;
}

describe('choosing the configuration (card containers-13)', () => {
  it('F-0411 AC-35: the worktree setting reaches the read of the configuration, whose workspace folder the window opens at', async () => {
    const scene = sceneOf({[ONLY]: IMAGE});
    scene.mountGitWorktreeCommonDir = true;
    scene.read = configurationOf('/workspaces/wt-rel/wt');
    const choice = await choose(scene);
    deepStrictEqual(
      [
        choice,
        scene.targets.map(
          read =>
            (read as [{mountGitWorktreeCommonDir: boolean}, unknown])[0]
              .mountGitWorktreeCommonDir,
        ),
      ],
      [
        {
          kind: 'chosen',
          configFile: '/w/p/.devcontainer/devcontainer.json',
          workspaceFolder: '/workspaces/wt-rel/wt',
        },
        [true],
      ],
    );
  });

  it('F-0301 AC-1: one configuration is chosen with no picker, and the CLI reads it with the target of the folder (BR-4)', async () => {
    const scene = sceneOf({[ONLY]: IMAGE});
    const choice = await choose(scene);
    deepStrictEqual(
      [choice, scene.calls.includes('pick'), scene.targets],
      [
        {
          kind: 'chosen',
          configFile: '/w/p/.devcontainer/devcontainer.json',
          workspaceFolder: '/workspaces/p',
        },
        false,
        [
          [
            {
              workspaceFolder: '/w/p',
              configFile: '/w/p/.devcontainer/devcontainer.json',
              dockerPath: DOCKER,
              idLabels: [],
              mountWorkspaceGitRoot: true,
              mountGitWorktreeCommonDir: false,
              mounts: [],
              logLevel: 'info',
            },
            undefined,
          ],
        ],
      ],
    );
  });

  it('F-0301 AC-3, AC-5: two configurations give one picker with their names and paths, the placeholder and the tooltip (5.0 step 4)', async () => {
    const scene = sceneOf({
      [ALPHA]: '{"name":"Alpha","image":"i"}',
      [BETA]: '{"name":"Beta","image":"i"}',
    });
    await choose(scene);
    deepStrictEqual(scene.rows, [
      [
        [
          {label: 'Alpha', description: ALPHA},
          {label: 'Beta', description: BETA},
        ],
        'Select a devcontainer.json file.',
        'Open File',
      ],
    ]);
  });

  it('F-0301 5.0 step 4: the file picked is read again and chosen', async () => {
    const scene = sceneOf({
      [ALPHA]: '{"name":"Alpha","image":"i"}',
      [BETA]: '{"name":"Beta","image":"i"}',
    });
    scene.answer = {kind: 'picked', index: 1};
    const choice = await choose(scene);
    deepStrictEqual(
      [choice, scene.calls.filter(call => call === `read ${BETA}`).length],
      [
        {
          kind: 'chosen',
          configFile: `/w/p/${BETA}`,
          workspaceFolder: '/workspaces/p',
        },
        2,
      ],
    );
  });

  it('F-0301 AC-30, BR-12: a configuration cut after "image": is labelled by its name, an empty one by its folder, and each leads to its own dialog', async () => {
    const files = {
      [ALPHA]: IMAGE,
      '.devcontainer/b/devcontainer.json': '',
      '.devcontainer/c/devcontainer.json': '{ "name": "Gamma", "image": ',
    };
    const labels = sceneOf(files);
    await choose(labels);
    const second = sceneOf(files);
    second.answer = {kind: 'picked', index: 1};
    await choose(second);
    const third = sceneOf({
      ...files,
      '.devcontainer/c/devcontainer.json': '{ "name": "Gamma" }',
    });
    third.answer = {kind: 'picked', index: 2};
    await choose(third);
    deepStrictEqual(
      [
        (labels.rows[0] as [Array<{label: string}>])[0].map(item => item.label),
        second.calls.filter(call => call.startsWith('showError')),
        third.calls.filter(call => call.startsWith('showWarning')),
      ],
      [
        ['Alpha', 'b', 'Gamma'],
        [
          `showError ${JSON.stringify(['', S181('.devcontainer/b/devcontainer.json'), ['Show Log']])}`,
        ],
        [
          `showWarning ${JSON.stringify(['', S113('.devcontainer/c/devcontainer.json'), []])}`,
        ],
      ],
    );
  });

  it('F-0301 AC-42: a configuration that cannot be read is listed by its fallback, and picking it opens it and shows the dialog (7.E9)', async () => {
    const scene = sceneOf({
      [ALPHA]: IMAGE,
      '.devcontainer/c/devcontainer.json': 'unreadable',
    });
    scene.answer = {kind: 'picked', index: 1};
    const choice = await choose(scene);
    deepStrictEqual(
      [
        (scene.rows[0] as [Array<{label: string}>])[0].map(item => item.label),
        scene.calls.filter(
          call =>
            call.startsWith('openPreview') || call.startsWith('showError'),
        ),
        choice,
      ],
      [
        ['Alpha', 'c'],
        [
          'openPreview .devcontainer/c/devcontainer.json',
          `showError ${JSON.stringify(['', S181('.devcontainer/c/devcontainer.json'), ['Show Log']])}`,
        ],
        {kind: 'rejected'},
      ],
    );
  });

  it('F-0301 AC-43: a single configuration that cannot be read shows the dialog with no picker and no read by the CLI', async () => {
    const scene = sceneOf({[ONLY]: 'unreadable'});
    const choice = await choose(scene);
    deepStrictEqual(
      [
        choice,
        scene.calls.includes('pick'),
        scene.calls.includes('readConfiguration'),
      ],
      [{kind: 'rejected'}, false, false],
    );
  });

  it('F-0301 AC-9, AC-53: an empty file is opened before the dialog, and Show Log reveals the log (7.E1)', async () => {
    const scene = sceneOf({[ONLY]: ''});
    scene.errorAnswer = 'Show Log';
    const choice = await choose(scene);
    deepStrictEqual(
      [
        choice,
        scene.calls.filter(call =>
          /^(openPreview|showError|revealLog)/.test(call),
        ),
      ],
      [
        {kind: 'rejected'},
        [
          `openPreview ${ONLY}`,
          `showError ${JSON.stringify(['', S181(ONLY), ['Show Log']])}`,
          'revealLog',
        ],
      ],
    );
  });

  it('F-0301 7.E1: the same dialog cancelled does not reveal the log', async () => {
    const scene = sceneOf({[ONLY]: ''});
    await choose(scene);
    deepStrictEqual(scene.calls.includes('revealLog'), false);
  });

  it('F-0301 AC-10, AC-54, AC-70: a configuration with no container source is warned about, and its file opens only after the warning closes (7.E2)', async () => {
    const scene = sceneOf({[ONLY]: '{"name":"x"}'});
    const choice = await choose(scene);
    deepStrictEqual(
      [
        choice,
        scene.calls.filter(call =>
          /^(showWarning|openPreview|readConfiguration)/.test(call),
        ),
      ],
      [
        {kind: 'rejected'},
        [
          `showWarning ${JSON.stringify(['', S113(ONLY), []])}`,
          `openPreview ${ONLY}`,
        ],
      ],
    );
  });

  it('F-0301 AC-8: a picker closed shows nothing, opens nothing and logs that the selection was cancelled (6.3)', async () => {
    const scene = sceneOf({[ALPHA]: IMAGE, [BETA]: IMAGE});
    scene.answer = {kind: 'dismissed'};
    const choice = await choose(scene);
    deepStrictEqual(
      [
        choice,
        scene.calls.filter(
          call => !call.startsWith('read .') && call !== 'pick',
        ),
        lines(scene),
      ],
      [
        {kind: 'dismissed'},
        [],
        ['info: Cancelled container configuration selection.'],
      ],
    );
  });

  it('F-0301 AC-15: Open File on a row opens that file and ends the choice, with no read by the CLI (5.0 step 6)', async () => {
    const scene = sceneOf({[ALPHA]: IMAGE, [BETA]: IMAGE});
    scene.answer = {kind: 'openFile', index: 1};
    const choice = await choose(scene);
    deepStrictEqual(
      [
        choice,
        scene.calls.filter(call =>
          /^(openPreview|readConfiguration)/.test(call),
        ),
      ],
      [{kind: 'dismissed'}, [`openPreview ${BETA}`]],
    );
  });

  it('F-0301 6.2: no configuration is one notice of ours and the answer noConfiguration, with nothing else shown', async () => {
    const scene = sceneOf({});
    const choice = await choose(scene);
    deepStrictEqual(
      [choice, scene.calls, lines(scene)],
      [
        {kind: 'noConfiguration'},
        [
          'showInformation No dev container configuration was found in this folder. Add a .devcontainer/devcontainer.json file, then run the command again.',
        ],
        ['info: no dev container configuration in /w/p'],
      ],
    );
  });

  it('F-0301 AC-44: a relative workspace folder from the CLI is refused with its dialog (7.E10)', async () => {
    const outcomes: unknown[] = [];
    for (const workspaceFolder of ['src', 'relative/sub/dir']) {
      const scene = sceneOf({[ONLY]: IMAGE});
      scene.read = configurationOf(workspaceFolder);
      scene.errorAnswer = 'Show Log';
      outcomes.push([
        await choose(scene),
        scene.calls.filter(call => /^(showError|revealLog)/.test(call)),
      ]);
    }
    const dialog = `showError ${JSON.stringify(['Workspace folder in devcontainer.json must be an absolute path.', '', ['Show Log']])}`;
    deepStrictEqual(outcomes, [
      [{kind: 'rejected'}, [dialog, 'revealLog']],
      [{kind: 'rejected'}, [dialog, 'revealLog']],
    ]);
  });

  it('F-0301 7.E10: a workspace folder the substitution made absolute is chosen', async () => {
    const scene = sceneOf({[ONLY]: IMAGE});
    scene.read = configurationOf('/w/p/x');
    deepStrictEqual(await choose(scene), {
      kind: 'chosen',
      configFile: `/w/p/${ONLY}`,
      workspaceFolder: '/w/p/x',
    });
  });

  it('contracts §6: a configuration the CLI cannot read is readFailed with the file and the failure, and a warn line', async () => {
    const scene = sceneOf({[ONLY]: IMAGE});
    scene.read = {kind: 'configurationFailed', message: 'bad'};
    deepStrictEqual(
      [
        await choose(scene),
        lines(scene).filter(line => line.startsWith('warn')),
      ],
      [
        {
          kind: 'readFailed',
          configFile: `/w/p/${ONLY}`,
          failure: {kind: 'configurationFailed', message: 'bad'},
        },
        ['warn: the configuration could not be read: configurationFailed'],
      ],
    );
  });

  it('contracts §6: a read the CLI was cancelled in is dismissed', async () => {
    const scene = sceneOf({[ONLY]: IMAGE});
    scene.read = {kind: 'cancelled'};
    deepStrictEqual(await choose(scene), {kind: 'dismissed'});
  });

  it('contracts §6: what the CLI says while it reads goes to the debug log', async () => {
    const scene = sceneOf({[ONLY]: IMAGE});
    await choose(scene);
    deepStrictEqual(
      lines(scene).filter(line => line.startsWith('debug')),
      ['debug: reading', 'debug: Reading'],
    );
  });

  it('F-0301 BR-8: choosing writes nothing: the files it was given cannot write', async () => {
    const scene = sceneOf({[ONLY]: IMAGE});
    await choose(scene);
    deepStrictEqual(
      scene.calls.filter(call => /write|save|create/i.test(call)),
      [],
    );
  });
});

/** The calls of a scene that reached a surface. */
function surfaceCalls(scene: Scene): string[] {
  return scene.calls.filter(call =>
    /^(pick|showError|showWarning|openPreview|showInformation|revealLog)/.test(
      call,
    ),
  );
}

/** What the CLI's read gives. */
type ReadResult = ConfigurationResult | CliFailure;

/** Chooses with the check held open, and then settled as `outcome`: what had happened by then, and the answer. */
async function chosenWhileChecking(scene: Scene, outcome: FirstCheckResult) {
  const check = pendingOf<FirstCheckResult>();
  scene.engineCheck = check.promise;
  const answered: {choice?: ConfigurationChoice} = {};
  const choosing = choose(scene).then(choice => {
    answered.choice = choice;
  });
  await settled();
  const during = {choice: answered.choice, calls: [...scene.calls]};
  check.resolve(outcome);
  await choosing;
  return {during, choice: answered.choice};
}

/** Chooses with a check that stopped, then ends the CLI's read as `end` says: the answer, and the info lines at each time. */
async function stoppedBeforeRead(
  scene: Scene,
  end: (reading: Pending<ReadResult>) => void,
) {
  const reading = pendingOf<ReadResult>();
  scene.reading = reading.promise;
  scene.engineCheck = Promise.resolve('stopped');
  const choice = await choose(scene);
  const before = infoLines(scene);
  end(reading);
  await settled();
  return {choice, before, after: infoLines(scene)};
}

describe('choosing the configuration while the engine is checked (card containers-24)', () => {
  it('ruling (c): a stopped check answers stopped and shows nothing, on every surface path', async () => {
    const pair = {[ALPHA]: IMAGE, [BETA]: IMAGE};
    const none = sceneOf({});
    const picker = sceneOf(pair);
    const refused = sceneOf({[ONLY]: ''});
    const warned = sceneOf({[ONLY]: '{"name":"x"}'});
    const relative = sceneOf({[ONLY]: IMAGE});
    relative.read = configurationOf('src');
    const outcomes: unknown[] = [];
    for (const scene of [none, picker, refused, warned, relative]) {
      scene.engineCheck = Promise.resolve('stopped');
      outcomes.push([await choose(scene), surfaceCalls(scene)]);
    }
    deepStrictEqual(
      outcomes,
      Array.from({length: 5}, () => [{kind: 'stopped'}, []]),
    );
  });

  it('ruling (c): a configuration of one file is read by the CLI while the check runs, and chosen only after it passes', async () => {
    const {during, choice} = await chosenWhileChecking(
      sceneOf({[ONLY]: IMAGE}),
      'proceed',
    );
    deepStrictEqual(
      [during, choice],
      [
        {
          choice: undefined,
          calls: [`read ${ONLY}`, 'readConfiguration'],
        },
        {
          kind: 'chosen',
          configFile: `/w/p/${ONLY}`,
          workspaceFolder: '/workspaces/p',
        },
      ],
    );
  });

  it('ruling (c): a read that fails is answered readFailed only after the check passes', async () => {
    const scene = sceneOf({[ONLY]: IMAGE});
    scene.read = {kind: 'configurationFailed', message: 'bad'};
    const {during, choice} = await chosenWhileChecking(scene, 'proceed');
    deepStrictEqual(
      [during.choice, choice],
      [
        undefined,
        {
          kind: 'readFailed',
          configFile: `/w/p/${ONLY}`,
          failure: {kind: 'configurationFailed', message: 'bad'},
        },
      ],
    );
  });

  it('ruling (c): with several files the labels are read while the check runs, the picker waits for a passing check, and the CLI read follows the pick', async () => {
    const scene = sceneOf({[ALPHA]: IMAGE, [BETA]: IMAGE});
    const {during} = await chosenWhileChecking(scene, 'proceed');
    deepStrictEqual(
      [
        during.calls,
        scene.calls.indexOf('pick') < scene.calls.indexOf('readConfiguration'),
      ],
      [[`read ${ALPHA}`, `read ${BETA}`], true],
    );
  });

  it('ruling (c): a check that stops while the labels are read shows no picker and starts no read', async () => {
    const scene = sceneOf({[ALPHA]: IMAGE, [BETA]: IMAGE});
    const {choice} = await chosenWhileChecking(scene, 'stopped');
    deepStrictEqual(
      [
        choice,
        scene.calls.includes('pick'),
        scene.calls.includes('readConfiguration'),
      ],
      [{kind: 'stopped'}, false, false],
    );
  });

  it('ruling (c): a picker the user closes is dismissed, since the check had passed before it showed', async () => {
    const scene = sceneOf({[ALPHA]: IMAGE, [BETA]: IMAGE});
    scene.answer = {kind: 'dismissed'};
    deepStrictEqual(await choose(scene), {kind: 'dismissed'});
  });

  it('ruling (c): a stopped check does not wait for the CLI read, and the read that ends later is logged at info', async () => {
    const {choice, before, after} = await stoppedBeforeRead(
      sceneOf({[ONLY]: IMAGE}),
      reading => {
        reading.resolve({kind: 'configurationFailed', message: 'bad'});
      },
    );
    deepStrictEqual(
      [choice, before, after],
      [
        {kind: 'stopped'},
        [],
        [
          'info: the configuration was read while the engine check failed: configurationFailed',
        ],
      ],
    );
  });

  it('ruling (c): a read that rejects while the check runs is handled, and is the failure of the choice once the check passes', async () => {
    const scene = sceneOf({[ONLY]: IMAGE});
    const reading = pendingOf<ReadResult>();
    scene.reading = reading.promise;
    const check = pendingOf<FirstCheckResult>();
    scene.engineCheck = check.promise;
    let failure: unknown;
    const unhandled = await unhandledDuring(async () => {
      const choosing = choose(scene).catch((caught: unknown) => {
        failure = caught;
      });
      await settled();
      reading.reject(new Error('boom'));
      await settled();
      check.resolve('proceed');
      await choosing;
    });
    deepStrictEqual(
      [unhandled, failure instanceof Error ? failure.message : failure],
      [[], 'boom'],
    );
  });

  it('ruling (c): a read that rejects when the check has stopped is logged at info with its message and is not unhandled', async () => {
    let after: string[] = [];
    const unhandled = await unhandledDuring(async () => {
      ({after} = await stoppedBeforeRead(sceneOf({[ONLY]: IMAGE}), reading => {
        reading.reject(new Error('boom'));
      }));
    });
    deepStrictEqual(
      [unhandled, after],
      [
        [],
        [
          'info: the configuration was read while the engine check failed: boom',
        ],
      ],
    );
  });

  it('ruling (c): a rejection that is not an error is logged by its text', async () => {
    const {after} = await stoppedBeforeRead(
      sceneOf({[ONLY]: IMAGE}),
      reading => {
        reading.reject('plain');
      },
    );
    deepStrictEqual(after, [
      'info: the configuration was read while the engine check failed: plain',
    ]);
  });
});
