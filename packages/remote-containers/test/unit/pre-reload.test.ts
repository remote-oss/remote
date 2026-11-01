import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {CliFailure, ConfigurationResult} from '../../src/cli/cli-lines.ts';
import type {PickerAnswer} from '../../src/config/choose-configuration.ts';
import type {
  EngineDialogPort,
  FirstCheckResult,
} from '../../src/engine/preflight.ts';
import {beforeReload, type PreReloadPorts} from '../../src/open/pre-reload.ts';
import {type Pending, pendingOf, settled, unhandledDuring} from './pending.ts';

const FOLDER = '/w/p';
const MAIN = '/w/p/.devcontainer/devcontainer.json';
const DOTFILE = '/w/p/.devcontainer.json';
const CONFIGURATION: ConfigurationResult = {
  kind: 'configuration',
  configuration: {},
  workspaceFolder: '/workspaces/p',
  workspaceMount: undefined,
  mergedConfiguration: undefined,
};
const START =
  '[Reading Dev Container Configuration (show log)](command:remote-containers.revealLogTerminal)';

/** The folders of the fake file system: what each holds. */
const ONE_FILE: Record<string, string[]> = {
  [FOLDER]: ['.devcontainer'],
  [`${FOLDER}/.devcontainer`]: ['devcontainer.json'],
};
const TWO_FILES: Record<string, string[]> = {
  [FOLDER]: ['.devcontainer', '.devcontainer.json'],
  [`${FOLDER}/.devcontainer`]: ['devcontainer.json'],
};

/** What a row steers, and what the fakes recorded. */
interface Scene {
  tree: Record<string, string[]>;
  contents: Record<string, string>;
  pick: PickerAnswer;
  read: Promise<ConfigurationResult | CliFailure>;
  /** The check waits for this before it answers. */
  hold: Pending<undefined>;
  /** What the check does once the hold is released. */
  check(dialogs: EngineDialogPort): Promise<FirstCheckResult>;
  /** The order of what happened, as far as the rows look at it. */
  order: string[];
  timers: Array<() => void>;
  /** The Cancel callbacks of the progresses shown. */
  cancels: Array<() => void>;
  /** The signals the engine check and the CLI read were given. */
  signals: AbortSignal[];
  sink: MemorySink;
}

function sceneOf(): Scene {
  return {
    tree: ONE_FILE,
    contents: {},
    pick: {kind: 'picked', index: 0},
    read: Promise.resolve(CONFIGURATION),
    hold: pendingOf<undefined>(),
    check: () => Promise.resolve('proceed'),
    order: [],
    timers: [],
    cancels: [],
    signals: [],
    sink: new MemorySink(),
  };
}

/** Records `text` after the microtasks that the closing of a progress started. */
function later(scene: Scene, text: string): void {
  queueMicrotask(() => {
    scene.order.push(text);
  });
}

function portsOf(scene: Scene): PreReloadPorts {
  return {
    firstCheck: async (base, dialogs, cancellation) => {
      scene.order.push(`firstCheck ${String(base)}`);
      scene.signals.push(cancellation);
      await scene.hold.promise;
      return scene.check(dialogs);
    },
    dialogs: {
      showError: message => {
        later(scene, `check dialog ${message}`);
        return Promise.resolve(undefined);
      },
      openExternal: () => Promise.resolve(undefined),
      revealLog: () => undefined,
    },
    config: {
      files: {
        list: folder =>
          Promise.resolve(
            (scene.tree[folder] ?? []).map(name => ({
              name,
              kind: name.endsWith('.json') ? 'file' : 'folder',
            })),
          ),
        read: file =>
          Promise.resolve(Buffer.from(scene.contents[file] ?? '{"image":"i"}')),
        exists: () => Promise.resolve(true),
      },
      surfaces: {
        pick: () => {
          later(scene, 'pick');
          return Promise.resolve(scene.pick);
        },
        dialogs: {
          showError: message => {
            later(scene, `error ${message}`);
            return Promise.resolve(undefined);
          },
          revealLog: () => undefined,
        },
        showWarning: () => {
          later(scene, 'warning');
          return Promise.resolve(undefined);
        },
        openPreview: () => {
          later(scene, 'preview');
          return Promise.resolve();
        },
      },
      // eslint-disable-next-line id-length -- the choice's dependency is named cli
      cli: {
        readConfiguration: (input, stdin, onEvent, cancellation) => {
          scene.order.push('readConfiguration');
          scene.signals.push(cancellation);
          return scene.read;
        },
      },
      useTemplate: () => Promise.resolve(),
      compare: (left, right) => left.localeCompare(right, 'en'),
      translate: template => template,
      logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
    },
    progress: {
      showProgress: (title, until, cancel) => {
        scene.cancels.push(cancel);
        scene.order.push(`progress shown ${title}`);
        void until.then(() => {
          scene.order.push('progress closed');
        });
      },
      setTimer: (milliseconds, callback) => {
        scene.timers.push(callback);
        return () => undefined;
      },
      translate: template => template,
    },
  };
}

const REQUEST = {
  folder: FOLDER,
  dockerPath: '/usr/bin/docker',
  mountGitWorktreeCommonDir: false,
  features: {defaultFeatures: {}, lockfile: true},
};

/** Runs the checks with the timer fired while the check waits, and the progress closed by the end. */
async function slowRun(scene: Scene) {
  const running = beforeReload(portsOf(scene), REQUEST);
  await settled();
  scene.timers[0]?.();
  scene.hold.resolve(undefined);
  const outcome = await running;
  outcome.progress.close();
  await settled();
  return outcome.choice;
}

/** Runs the checks, shows the progress, presses its Cancel while the check waits, and gives how they ended. */
async function cancelledRun(scene: Scene) {
  const running = beforeReload(portsOf(scene), REQUEST);
  await settled();
  scene.timers[0]?.();
  scene.cancels[0]?.();
  scene.hold.resolve(undefined);
  return running;
}

function lines(scene: Scene): string[] {
  return scene.sink.lines.map(line => `${line.level}: ${line.message}`);
}

describe('the checks before a reload (card containers-24, ruling (c))', () => {
  it('ruling (c): the engine check and the CLI read run concurrently', async () => {
    const scene = sceneOf();
    const running = beforeReload(portsOf(scene), REQUEST);
    await settled();
    const during = [...scene.order];
    scene.hold.resolve(undefined);
    await running;
    deepStrictEqual(during, [`firstCheck ${FOLDER}`, 'readConfiguration']);
  });

  it('ruling (c): a chosen configuration waits for the check', async () => {
    const scene = sceneOf();
    let outcome: Awaited<ReturnType<typeof beforeReload>> | undefined;
    const running = beforeReload(portsOf(scene), REQUEST).then(done => {
      outcome = done;
    });
    await settled();
    const during = outcome;
    scene.hold.resolve(undefined);
    await running;
    deepStrictEqual(
      [during, outcome?.choice],
      [
        undefined,
        {
          kind: 'chosen',
          configFile: MAIN,
          workspaceFolder: '/workspaces/p',
          features: [],
        },
      ],
    );
  });

  it('ruling (c): when both fail, only the check dialog shows, the answer is stopped, and the read is logged', async () => {
    const scene = sceneOf();
    scene.read = Promise.resolve({kind: 'configurationFailed', message: 'bad'});
    scene.check = async dialogs => {
      await dialogs.showError('Docker is missing', '', []);
      return 'stopped';
    };
    const choice = await slowRun(scene);
    deepStrictEqual(
      [
        choice,
        scene.order.filter(entry => /dialog|error/.test(entry)),
        lines(scene),
      ],
      [
        {kind: 'stopped'},
        ['check dialog Docker is missing'],
        [
          'info: the configuration was read while the engine check failed: configurationFailed',
        ],
      ],
    );
  });

  it('ruling (c): a check that stops before the picker shows no picker', async () => {
    const scene = sceneOf();
    scene.tree = TWO_FILES;
    scene.check = () => Promise.resolve('stopped');
    const choice = await slowRun(scene);
    deepStrictEqual(
      [
        choice,
        scene.order.includes('pick'),
        scene.order.includes('readConfiguration'),
      ],
      [{kind: 'stopped'}, false, false],
    );
  });

  it('ruling (c): the picker waits for a passing check', async () => {
    const scene = sceneOf();
    scene.tree = TWO_FILES;
    const running = beforeReload(portsOf(scene), REQUEST);
    await settled();
    const during = scene.order.includes('pick');
    scene.hold.resolve(undefined);
    const outcome = await running;
    outcome.progress.close();
    await settled();
    deepStrictEqual(
      [during, scene.order.includes('pick'), outcome.choice],
      [
        false,
        true,
        {
          kind: 'chosen',
          configFile: DOTFILE,
          workspaceFolder: '/workspaces/p',
          features: [],
        },
      ],
    );
  });

  it('ruling (c): a surface closes the progress before it shows, on every surface', async () => {
    const dialog = sceneOf();
    dialog.check = async dialogs => {
      await dialogs.showError('Docker', '', []);
      return 'stopped';
    };
    const picker = sceneOf();
    picker.tree = TWO_FILES;
    const warned = sceneOf();
    warned.contents[MAIN] = '{"name":"x"}';
    const preview = sceneOf();
    preview.contents[MAIN] = '';
    const refused = sceneOf();
    refused.read = Promise.resolve({
      ...CONFIGURATION,
      workspaceFolder: 'src',
    });
    const seen: unknown[] = [];
    for (const scene of [dialog, picker, warned, preview, refused]) {
      await slowRun(scene);
      const from = scene.order.findIndex(entry =>
        entry.startsWith('progress shown'),
      );
      seen.push(scene.order.slice(from, from + 3));
    }
    deepStrictEqual(seen, [
      [`progress shown ${START}`, 'progress closed', 'check dialog Docker'],
      [`progress shown ${START}`, 'progress closed', 'pick'],
      [`progress shown ${START}`, 'progress closed', 'warning'],
      [`progress shown ${START}`, 'progress closed', 'preview'],
      [
        `progress shown ${START}`,
        'progress closed',
        'error Workspace folder in devcontainer.json must be an absolute path.',
      ],
    ]);
  });

  it('ruling (c): a fast run never shows the progress', async () => {
    const scene = sceneOf();
    scene.hold.resolve(undefined);
    const {choice, progress} = await beforeReload(portsOf(scene), REQUEST);
    progress.close();
    scene.timers[0]?.();
    await settled();
    deepStrictEqual(
      [choice.kind, scene.order.filter(entry => entry.startsWith('progress'))],
      ['chosen', []],
    );
  });

  it('ruling (c): a check that rejects answers stopped, logs it, closes the progress, shows nothing and leaves no unhandled rejection', async () => {
    const scene = sceneOf();
    scene.check = () => Promise.reject(new Error('boom'));
    let choice: unknown;
    const unhandled = await unhandledDuring(async () => {
      choice = await slowRun(scene);
    });
    deepStrictEqual(
      [
        choice,
        unhandled,
        lines(scene),
        scene.order.filter(entry =>
          /^(pick|error|warning|preview|information|check dialog)/.test(entry),
        ),
        scene.order.slice(-1),
      ],
      [
        {kind: 'stopped'},
        [],
        [
          'error: the engine check failed: boom',
          'info: the configuration was read while the engine check failed: configuration',
        ],
        [],
        ['progress closed'],
      ],
    );
  });

  it('ruling (c): a check that rejects with something that is not an error is logged by its text', async () => {
    const scene = sceneOf();
    const failing = pendingOf<FirstCheckResult>();
    scene.check = () => {
      failing.reject('plain');
      return failing.promise;
    };
    await slowRun(scene);
    deepStrictEqual(
      lines(scene).filter(line => line.startsWith('error')),
      ['error: the engine check failed: plain'],
    );
  });

  it('ruling (c): a choice that throws closes the progress and the command ends with the failure', async () => {
    const scene = sceneOf();
    scene.read = Promise.reject(new Error('no disk'));
    scene.hold.resolve(undefined);
    let failure: unknown;
    await beforeReload(portsOf(scene), REQUEST).catch((caught: unknown) => {
      failure = caught;
    });
    scene.timers[0]?.();
    await settled();
    deepStrictEqual(
      [
        failure instanceof Error ? failure.message : failure,
        scene.order.some(entry => entry.startsWith('progress shown')),
      ],
      ['no disk', false],
    );
  });

  it('F-0408 AC-7: Cancel aborts the one signal the engine check and the read share, and the choice is cancelled with nothing shown', async () => {
    const scene = sceneOf();
    scene.check = () => Promise.resolve('stopped');
    scene.read = Promise.resolve({kind: 'cancelled'});
    const outcome = await cancelledRun(scene);
    await settled();
    deepStrictEqual(
      [
        outcome.choice.kind,
        scene.signals.map(signal => signal.aborted),
        outcome.cancellation.aborted,
        scene.order.filter(entry => !entry.startsWith('progress')),
        lines(scene).filter(line => line.includes('was cancelled')),
      ],
      [
        'cancelled',
        [true, true],
        true,
        [`firstCheck ${FOLDER}`, 'readConfiguration'],
        ['info: the command was cancelled while reading the configuration'],
      ],
    );
  });

  it('F-0408 AC-7: a read that fails after Cancel is a cancelled choice, not a failure', async () => {
    const scene = sceneOf();
    scene.read = Promise.reject(new Error('killed'));
    scene.read.catch(() => undefined);
    const outcome = await cancelledRun(scene);
    deepStrictEqual(outcome.choice.kind, 'cancelled');
  });
});
