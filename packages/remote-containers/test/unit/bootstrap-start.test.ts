import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';
import {
  type EngineScript,
  exited,
  scriptedEngine,
} from './engine-script.fixture.ts';
import type {BootstrapSettings} from '../../src/volumes/bootstrap.ts';
import {
  type BootstrapStart,
  startBootstrap,
} from '../../src/volumes/bootstrap-start.ts';

/** What a scene did: the engine calls, short, the log, the context's life, and the start's outcome. */
interface SceneRecord {
  calls: string[];
  logLines: string[];
  context: string[];
  outcome: BootstrapStart;
}

const BUILT_IN: BootstrapSettings = {
  image: '',
  pull: false,
  socketPath: '/var/run/docker.sock',
};

/** The short form of a call: the first two arguments, and the tool name of a check. */
function shortOf(argv: readonly string[]): string {
  return argv[0] === 'exec'
    ? `exec ${String(argv.at(-1))}`
    : argv.slice(0, 2).join(' ');
}

/** Runs a start whose engine answers each call by `answer`, which gives undefined for a plain success. */
async function sceneOf(
  answer: EngineScript,
  settings: BootstrapSettings = BUILT_IN,
): Promise<SceneRecord> {
  const sink = new MemorySink();
  const scripted = scriptedEngine(shortOf, answer, short =>
    short === 'run --detach' ? 'c1\n' : '',
  );
  const context: string[] = [];
  const outcome = await startBootstrap(
    {
      ...scripted,
      buildContext: () => {
        context.push('written');
        return Promise.resolve({
          folder: '/ctx',
          dispose: () => {
            context.push('disposed');
            return Promise.resolve();
          },
        });
      },
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    {name: 'r-1', labels: ['a=1']},
    settings,
  );
  return {
    calls: scripted.calls,
    logLines: sink.lines.map(line => line.message),
    context,
    outcome,
  };
}

/** An answer where only the volume lookup fails, so the volume is created. */
function absentVolume(short: string): EngineRunOutcome | undefined {
  return short === 'volume inspect'
    ? exited(1, '', 'no such volume')
    : undefined;
}

const TOOL_CHECKS = [
  'exec docker',
  'exec git',
  'exec node',
  'exec ssh',
  'exec git-lfs',
];

describe('the bootstrap start (card containers-151)', () => {
  it('F-0704: an absent volume is created, our image built from a fresh context, and the container checked', async () => {
    const scene = await sceneOf(absentVolume);
    deepStrictEqual(scene, {
      calls: [
        'volume inspect',
        'volume create',
        'build --tag',
        'run --detach',
        ...TOOL_CHECKS,
      ],
      logLines: [
        "the bootstrap container's tools: docker found, git found, node found, ssh found, git-lfs found",
      ],
      context: ['written', 'disposed'],
      outcome: {kind: 'started', container: 'c1'},
    });
  });

  it('F-0702 BR-8: an existing volume is used as it is, with no create', async () => {
    const scene = await sceneOf(() => undefined);
    deepStrictEqual(
      [scene.calls.slice(0, 2), scene.logLines[0]],
      [['volume inspect', 'build --tag'], 'the volume r-1 exists already'],
    );
  });

  it('F-0704 BR-2, BR-4: a custom image writes no context, and is pulled only when its setting asks', async () => {
    const custom = {...BUILT_IN, image: 'my/boot:1'};
    const [plain, pulled] = await Promise.all([
      sceneOf(() => undefined, custom),
      sceneOf(() => undefined, {...custom, pull: true}),
    ]);
    deepStrictEqual(
      [plain.calls[1], pulled.calls[1], plain.context, pulled.outcome.kind],
      ['run --detach', 'pull --', [], 'started'],
    );
  });

  it('F-0704 BR-7, BR-8: a missing tool removes the container at once, with S344 before S345', async () => {
    const [noGit, neither] = await Promise.all([
      sceneOf(short => (short === 'exec git' ? exited(1) : undefined)),
      sceneOf(short =>
        short === 'exec git' || short === 'exec docker'
          ? exited(127)
          : undefined,
      ),
    ]);
    deepStrictEqual(
      [
        noGit.outcome,
        noGit.calls.at(-1),
        noGit.logLines.at(-1),
        neither.outcome,
      ],
      [
        {kind: 'missingTool', reason: 'S345'},
        'rm --force',
        'the bootstrap container was removed',
        {kind: 'missingTool', reason: 'S344'},
      ],
    );
  });

  it('an engine that can’t run the check fails the start and removes the container, logging a failed removal', async () => {
    const scene = await sceneOf(short => {
      if (short === 'exec node') {
        return {kind: 'failed', detail: 'spawn docker ENOENT'};
      }
      return short === 'rm --force' ? exited(1, '', 'busy') : undefined;
    });
    deepStrictEqual(
      [scene.outcome, scene.calls.slice(-2), scene.logLines],
      [
        {kind: 'engineFailed', detail: 'spawn docker ENOENT'},
        ['exec node', 'rm --force'],
        [
          'the volume r-1 exists already',
          'the bootstrap container could not be removed: busy',
        ],
      ],
    );
  });

  it('a failed build still disposes of its context, and nothing runs after it', async () => {
    const scene = await sceneOf(short =>
      short === 'build --tag' ? exited(1, '', 'no space left') : undefined,
    );
    deepStrictEqual(
      [scene.outcome, scene.calls, scene.context],
      [
        {kind: 'engineFailed', detail: 'no space left'},
        ['volume inspect', 'build --tag'],
        ['written', 'disposed'],
      ],
    );
  });

  it('a volume that can’t be created, or a container that can’t start, fails the start; a silent failure names the step', async () => {
    const [noVolume, noContainer] = await Promise.all([
      sceneOf(short =>
        short === 'volume create' ? exited(1) : absentVolume(short),
      ),
      sceneOf(short =>
        short === 'run --detach'
          ? {kind: 'failed', detail: 'spawn docker EACCES'}
          : undefined,
      ),
    ]);
    deepStrictEqual(
      [noVolume.outcome, noVolume.calls.length, noContainer.outcome],
      [
        {kind: 'engineFailed', detail: 'docker volume exited with 1'},
        2,
        {kind: 'engineFailed', detail: 'spawn docker EACCES'},
      ],
    );
  });
});
