import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {
  type ComposeCheckDependencies,
  composeCheck,
  composeRoute,
} from '../../src/engine/preflight.ts';
import {composeDialogOf} from '../../src/surfaces/engine-dialogs.ts';

/** A run that ended with `status`. */
function ended(status: number): EngineRunOutcome {
  return {kind: 'ran', status, stdout: '1.29.0', stderr: ''};
}

/** What a scene shows and runs. */
interface Scene {
  dependencies: ComposeCheckDependencies;
  dialogs: Array<[string, string, readonly string[]]>;
  opened: string[];
  logRevealed: number[];
  commands: string[];
}

/** Surroundings where the program `plugin` answers `compose version` and the setting's program answers as `standalone` says. */
function sceneOf(options: {
  plugin: EngineRunOutcome;
  standalone?: EngineRunOutcome;
  composePath?: unknown;
  dockerPath?: unknown;
  choice?: string | undefined;
}): Scene {
  const scene: Scene = {
    dependencies: undefined as unknown as ComposeCheckDependencies,
    dialogs: [],
    opened: [],
    logRevealed: [],
    commands: [],
  };
  scene.dependencies = {
    engineFor: (file): EngineHost => ({
      // eslint-disable-next-line id-length -- the port's method is named run
      run: argv => {
        scene.commands.push(`${file} ${argv.join(' ')}`);
        return Promise.resolve(
          file === 'docker' ? options.plugin : (options.standalone ?? ended(0)),
        );
      },
      spawn: () => Promise.reject(new Error('never spawned')),
    }),
    dockerPath: () => options.dockerPath ?? 'docker',
    composePath: () => options.composePath,
    dialogs: {
      showError: (message, detail, items) => {
        scene.dialogs.push([message, detail, items]);
        return Promise.resolve(options.choice);
      },
      openExternal: address => {
        scene.opened.push(address);
        return Promise.resolve(undefined);
      },
      revealLog: () => {
        scene.logRevealed.push(1);
      },
    },
    translate: template => template,
    setTimer: () => () => undefined,
    clock: () => 0,
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    searchPath: () => '/usr/bin',
  };
  return scene;
}

const NEVER = new AbortController().signal;

describe('the check of Docker Compose before a reload (F-0201 BR-4, brief-compose §3)', () => {
  it('F-0201 AC-5: a plugin that answers lets the flow go on, with no dialog and the setting’s program never run', async () => {
    const scene = sceneOf({plugin: ended(0), composePath: '/opt/dc'});
    deepStrictEqual(
      [
        await composeCheck(scene.dependencies, '/w', NEVER),
        scene.dialogs,
        scene.commands,
      ],
      ['proceed', [], ['docker compose version']],
    );
  });

  it('F-0201 AC-11: a standalone Compose that answers lets the flow go on with no dialog', async () => {
    const scene = sceneOf({plugin: ended(1), composePath: '/opt/dc'});
    deepStrictEqual(
      [await composeCheck(scene.dependencies, '/w', NEVER), scene.dialogs],
      ['proceed', []],
    );
  });

  it('F-0201 AC-44: the default program missing shows the single line S134, and Documentation opens the Compose page and stops the flow', async () => {
    const scene = sceneOf({
      plugin: ended(1),
      standalone: {kind: 'failed', detail: 'spawn docker-compose ENOENT'},
      choice: 'Documentation',
    });
    deepStrictEqual(
      [
        await composeCheck(scene.dependencies, '/w', NEVER),
        scene.dialogs,
        scene.opened,
      ],
      [
        'stopped',
        [['Docker Compose required', '', ['Documentation']]],
        ['https://docs.docker.com/compose/install/'],
      ],
    );
  });

  it('F-0201 AC-6: a program that is not the default and is missing is named in the detail, and Cancel stops the flow and opens nothing', async () => {
    const scene = sceneOf({
      plugin: ended(1),
      standalone: {kind: 'failed', detail: 'spawn /nowhere/dc ENOENT'},
      composePath: '/nowhere/dc',
      choice: undefined,
    });
    deepStrictEqual(
      [
        await composeCheck(scene.dependencies, '/w', NEVER),
        scene.dialogs,
        scene.opened,
      ],
      [
        'stopped',
        [
          [
            'Docker Compose required',
            "Command not found: '/nowhere/dc'.",
            ['Documentation'],
          ],
        ],
        [],
      ],
    );
  });

  it('F-0201 AC-45: a program that cannot run shows S135 alone with Show Log, which reveals the log and stops the flow', async () => {
    const scene = sceneOf({
      plugin: ended(1),
      standalone: ended(1),
      composePath: '/opt/dc',
      choice: 'Show Log',
    });
    deepStrictEqual(
      [
        await composeCheck(scene.dependencies, '/w', NEVER),
        scene.dialogs,
        scene.logRevealed,
      ],
      [
        'stopped',
        [['', 'Docker Compose returned an error.', ['Show Log']]],
        [1],
      ],
    );
  });

  it('F-0201 AC-12: a check cancelled while it runs shows nothing and stops the flow', async () => {
    const scene = sceneOf({plugin: ended(1), composePath: '/nowhere/dc'});
    const cancelling = new AbortController();
    const {dependencies} = scene;
    const original = {...dependencies};
    dependencies.engineFor = file => {
      cancelling.abort();
      return original.engineFor(file);
    };
    deepStrictEqual(
      [
        await composeCheck(dependencies, '/w', cancelling.signal),
        scene.dialogs,
      ],
      ['stopped', []],
    );
  });

  it('F-0201 AC-25: a Docker program that cannot be found leaves the setting’s program to try, and the route is read again at every call', async () => {
    const scene = sceneOf({
      plugin: ended(1),
      dockerPath: 'tools/docker',
      composePath: '/opt/dc',
    });
    const first = await composeRoute(scene.dependencies, undefined, NEVER);
    const second = await composeRoute(scene.dependencies, undefined, NEVER);
    deepStrictEqual(
      [first, second, scene.commands],
      [
        {kind: 'standalone', file: '/opt/dc', dashAndUnderscore: true},
        {kind: 'standalone', file: '/opt/dc', dashAndUnderscore: true},
        ['/opt/dc version --short', '/opt/dc version --short'],
      ],
    );
  });

  it('F-0201 AC-6: the dialog of a missing program and of a broken one are built from the route, translated', () => {
    deepStrictEqual(
      [
        composeDialogOf(
          {kind: 'missing', written: 'x', byDefault: true},
          template => `<${template}>`,
        ),
        composeDialogOf(
          {kind: 'broken', written: 'x'},
          template => `<${template}>`,
        ),
      ],
      [
        {
          message: '<Docker Compose required>',
          detail: '',
          buttons: [{label: '<Documentation>', action: 'openCompose'}],
        },
        {
          message: '',
          detail: '<Docker Compose returned an error.>',
          buttons: [{label: '<Show Log>', action: 'showLog'}],
        },
      ],
    );
  });
});
