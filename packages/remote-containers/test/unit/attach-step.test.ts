import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type AttachedStep,
  type AttachedStepPorts,
  attachedContainerStep,
} from '../../src/attach/connect-step.ts';
import type {IdRecord} from '../../src/attach/find.ts';
import type {AttachedCliTarget} from '../../src/cli/cli-arguments.ts';
import type {CliBridge} from '../../src/cli/cli-bridge.ts';
import type {SetUpResult, CliFailure} from '../../src/cli/cli-lines.ts';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';

const TARGET = {containerName: '/web'};

function inspectedJson(state: string): string {
  return JSON.stringify([
    {
      // eslint-disable-next-line id-length -- the engine's own member is named Id
      Id: 'a1',
      Name: '/web',
      Created: '2026-11-03T10:00:00Z',
      Config: {Image: 'alpine:latest'},
      State: {Status: state},
    },
  ]);
}

function exits(status: number, stdout = ''): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr: ''};
}

/** The step over an engine whose container is in `state` (none: unknown), a set-up that gives `setUp`, and an Alpine answer. */
function sceneOf(options: {
  state?: string;
  setUp?: SetUpResult | CliFailure;
  alpine?: 'notAlpine' | 'failed';
  file?: string;
  aborted?: boolean;
  engine?: AttachedStepPorts['engineCoordinates'];
}) {
  const setUps: AttachedCliTarget[] = [];
  const commands: string[] = [];
  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      const command = argv.join(' ');
      commands.push(command);
      if (command.startsWith('inspect')) {
        return Promise.resolve(
          options.state === undefined
            ? exits(1)
            : exits(0, inspectedJson(options.state)),
        );
      }
      if (command.includes('grep')) {
        return Promise.resolve(exits(options.alpine === 'failed' ? 0 : 1));
      }
      return Promise.resolve(exits(1));
    },
    spawn: () => Promise.reject(new Error('never spawned')),
  };
  const bridge = {
    setUp: (target: AttachedCliTarget) => {
      setUps.push(target);
      return Promise.resolve(
        options.setUp ?? {
          kind: 'setUp',
          mergedConfiguration: {remoteUser: 'u'},
        },
      );
    },
  } as unknown as CliBridge;
  const record: IdRecord = {
    read: () => undefined,
    write: () => Promise.resolve(),
  };
  const ports: AttachedStepPorts = {
    engine,
    bridge,
    record,
    configFileOf: () => Promise.resolve(options.file),
    cliTarget: {dockerPath: 'docker', logLevel: 'info'},
    engineCoordinates: options.engine ?? {},
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    onCliEvent: () => undefined,
  };
  const cancellation = new AbortController();
  if (options.aborted === true) {
    cancellation.abort();
  }
  return {
    setUps,
    commands,
    executed: (): Promise<AttachedStep> =>
      attachedContainerStep(ports, '7b7d', TARGET, cancellation.signal),
  };
}

describe('the container step of an attached connect (card containers-163, part A)', () => {
  it('F-0601 AC-15: a running container is set up with its attach file and the Alpine step runs after it', async () => {
    const scene = sceneOf({
      state: 'running',
      file: '/store/nameConfigs/web.json',
    });
    const step = await scene.executed();
    deepStrictEqual(
      [
        step.kind === 'ready' && [
          step.container.id,
          step.viaRecord,
          step.configFile,
        ],
        scene.setUps[0]?.containerId,
        scene.setUps[0]?.configFile,
        scene.commands.at(-1)?.includes('grep'),
      ],
      [
        ['a1', false, '/store/nameConfigs/web.json'],
        'a1',
        '/store/nameConfigs/web.json',
        true,
      ],
    );
  });

  it('F-0601 AC-13: a container that neither the name nor the record resolves gives S053 with its slashed name and no container', async () => {
    const step = await sceneOf({}).executed();
    deepStrictEqual(
      step.kind === 'failed' && [
        step.failure.kind,
        step.failure.reason,
        step.container,
      ],
      ['attachedNotFound', {id: 'S053', values: ['/web']}, undefined],
    );
  });

  it('F-0601 AC-11, AC-69: a container that is not running gives S054 with the engine’s suffix, sets nothing up, and hands over the container', async () => {
    const scene = sceneOf({state: 'exited', engine: {context: 'ctx'}});
    const step = await scene.executed();
    deepStrictEqual(
      [
        step.kind === 'failed' && [
          step.failure.kind,
          step.failure.reason,
          step.container?.id,
        ],
        scene.setUps.length,
      ],
      [
        [
          'attachedNotRunning',
          {id: 'S054', values: ['alpine:latest', 'web', ' @ ctx']},
          'a1',
        ],
        0,
      ],
    );
  });

  it('F-0601 AC-24: a paused container is not running either', async () => {
    const step = await sceneOf({state: 'paused'}).executed();
    deepStrictEqual(
      step.kind === 'failed' && step.failure.kind,
      'attachedNotRunning',
    );
  });

  it('F-0601 AC-17: a set-up that fails gives S033, keeping the container, and the Alpine step does not run', async () => {
    const scene = sceneOf({
      state: 'running',
      setUp: {
        kind: 'setupFailed',
        message: 'no user',
        description: '',
        containerId: 'a1',
      },
    });
    const step = await scene.executed();
    deepStrictEqual(
      [
        step.kind === 'failed' && [step.failure.kind, step.container?.id],
        scene.commands.some(command => command.includes('grep')),
      ],
      [['attachFailed', 'a1'], false],
    );
  });

  it('F-0601 AC-52: a failing Alpine step gives S033', async () => {
    const step = await sceneOf({state: 'running', alpine: 'failed'}).executed();
    deepStrictEqual(
      step.kind === 'failed' && step.failure.kind,
      'attachFailed',
    );
  });

  it('F-0601 BR-5: a cancelled set-up, and a cancel before the search ends, end the step as cancelled', async () => {
    deepStrictEqual(
      [
        (
          await sceneOf({
            state: 'running',
            setUp: {kind: 'cancelled'},
          }).executed()
        ).kind,
        (await sceneOf({state: 'running', aborted: true}).executed()).kind,
      ],
      ['cancelled', 'cancelled'],
    );
  });
});
