import {deepStrictEqual} from 'node:assert';
import {cleanUpCommandsOf} from '../../src/explorer/clean-up-commands.ts';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';

/** The JSON `docker inspect` gives for a container. */
function containerJson(
  containerId: string,
  state: string,
  labels: Record<string, string>,
  volumes: string[] = [],
): unknown {
  return {
    // eslint-disable-next-line id-length -- Docker's name for the field
    Id: containerId,
    Name: `/${containerId}`,
    Created: '2026-01-01T00:00:00Z',
    State: {Status: state},
    Config: {Image: 'alpine:latest', Labels: labels},
    Mounts: volumes.map(name => ({Type: 'volume', Name: name})),
  };
}

/** A world of the engine: the answers by command, and the commands it was given. */
interface World {
  answers: Record<string, EngineRunOutcome>;
  commands: string[];
}

function ranWith(stdout: string): EngineRunOutcome {
  return {kind: 'ran', status: 0, stdout, stderr: ''};
}

function hostWorld(world: World): EngineHost {
  return {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      const command = argv.join(' ');
      world.commands.push(command);
      return Promise.resolve(
        world.answers[command] ?? {
          kind: 'ran',
          status: 1,
          stdout: '',
          stderr: '',
        },
      );
    },
    spawn: () => Promise.resolve({kind: 'failed', detail: 'no'}),
  };
}

/** The scene: one stopped dev container, one unused clone volume, and the editor's answers. */
function scene(overrides: Record<string, EngineRunOutcome> = {}): {
  world: World;
  events: string[];
  commands: ReturnType<typeof cleanUpCommandsOf>;
} {
  const world: World = {
    commands: [],
    answers: {
      'ps -a -q --no-trunc': ranWith('c1\n'),
      'inspect --type container c1': ranWith(
        JSON.stringify([
          containerJson('c1', 'exited', {
            'devcontainer.local_folder': '/h/proj',
          }),
        ]),
      ),
      'volume ls -q': ranWith('v1\n'),
      'volume inspect -- v1': ranWith(
        JSON.stringify([
          {Name: 'v1', Labels: {'dev.container.volume': 'true'}},
        ]),
      ),
      'rm c1': ranWith(''),
      'volume rm v1': ranWith(''),
      ...overrides,
    },
  };
  const events: string[] = [];
  const commands = cleanUpCommandsOf({
    engine: () => hostWorld(world),
    program: () => 'docker',
    pickMany: (placeholder, items) => {
      events.push(
        `pick ${placeholder}: ${items.map(item => item.label).join(',')}`,
      );
      return Promise.resolve([...items.keys()]);
    },
    showDone: detail => {
      events.push(`done ${detail}`);
      return Promise.resolve();
    },
    refresh: () => {
      events.push('refresh');
      return Promise.resolve();
    },
    report: line => {
      events.push(`log ${line}`);
    },
    translate: template => template,
    cancellation: new AbortController().signal,
  });
  return {world, events, commands};
}

describe('the Clean Up commands over the engine (card containers-168)', () => {
  it('F-0905 5.0, 6.6: Clean Up Dev Containers lists the stopped container, removes the checked one in one command, refreshes the view and chains the volumes picker', async () => {
    const {world, events, commands} = scene();
    await commands.devContainers();
    deepStrictEqual(
      [events, world.commands.filter(command => command.startsWith('rm'))],
      [
        [
          'pick Select stopped dev containers to delete: proj',
          'refresh',
          'pick Select unused dev volumes to delete: v1',
        ],
        ['rm c1'],
      ],
    );
  });

  it('F-0905 6.1: Clean Up Dev Volumes lists the unused volume with the containers that mount volumes in mind, and removes the checked one', async () => {
    const {world, events, commands} = scene();
    await commands.volumes();
    deepStrictEqual(
      [events, world.commands.at(-1)],
      [['pick Select unused dev volumes to delete: v1'], 'volume rm v1'],
    );
  });

  it('F-0905 BR-2: a volume a container mounts is not offered, and with none left Clean Up Dev Volumes says so', async () => {
    const {events, commands} = scene({
      'inspect --type container c1': ranWith(
        JSON.stringify([containerJson('c1', 'exited', {}, ['v1'])]),
      ),
    });
    await commands.volumes();
    deepStrictEqual(events, [
      'done There are no unused dev volumes to delete.',
    ]);
  });

  it('F-0905 7.E1: a Docker command that fails rejects with the command, and one that cannot start with the system’s message', async () => {
    const failed = scene({
      'rm c1': {kind: 'ran', status: 1, stdout: '', stderr: ''},
    });
    const unstarted = scene({
      'ps -a -q --no-trunc': {kind: 'failed', detail: 'spawn docker ENOENT'},
    });
    const messages: string[] = [];
    for (const each of [failed, unstarted]) {
      await each.commands.devContainers().catch((caught: unknown) => {
        messages.push(
          caught instanceof Error ? caught.message : String(caught),
        );
      });
    }
    deepStrictEqual(messages, [
      'Command failed: docker rm c1',
      'spawn docker ENOENT',
    ]);
  });

  it('F-0905 7.E2: Clean Up Dev Volumes logs an engine that cannot be asked and shows nothing', async () => {
    const {events, commands} = scene({
      'volume ls -q': {kind: 'failed', detail: 'spawn docker ENOENT'},
    });
    await commands.volumes();
    deepStrictEqual(events, [
      'log the unused volumes could not be listed: spawn docker ENOENT',
    ]);
  });

  it('F-0905 6.3: with no container and no volume the completion dialog shows at once', async () => {
    const {events, commands} = scene({
      'ps -a -q --no-trunc': ranWith(''),
      'volume ls -q': ranWith(''),
    });
    await commands.devContainers();
    deepStrictEqual(events, [
      'done There are no stopped dev containers or unused dev volumes to delete.',
    ]);
  });

  it('F-0905 AC-2: a containers picker that closes without a pick removes nothing, scans no volume and shows no dialog', async () => {
    const world: World = {commands: [], answers: scene().world.answers};
    const events: string[] = [];
    const commands = cleanUpCommandsOf({
      engine: () => hostWorld(world),
      program: () => 'docker',
      pickMany: () => Promise.resolve(undefined),
      showDone: detail => {
        events.push(`done ${detail}`);
        return Promise.resolve();
      },
      refresh: () => {
        events.push('refresh');
        return Promise.resolve();
      },
      report: line => {
        events.push(`log ${line}`);
      },
      translate: template => template,
      cancellation: new AbortController().signal,
    });
    await commands.devContainers();
    deepStrictEqual(
      [events, world.commands.some(command => command.startsWith('rm'))],
      [[], false],
    );
  });

  it('F-0905 7.E2: output that is not a list of containers or of volumes is a failed command', async () => {
    const containers = scene({'inspect --type container c1': ranWith('{}')});
    const volumes = scene({'volume inspect -- v1': ranWith('{}')});
    const messages: string[] = [];
    for (const command of [
      containers.commands.devContainers(),
      volumes.commands.devContainers(),
    ]) {
      await command.catch((caught: unknown) => {
        messages.push(
          caught instanceof Error ? caught.message : String(caught),
        );
      });
    }
    deepStrictEqual(messages, [
      'Command failed: docker inspect --type container c1',
      'Command failed: docker volume inspect -- v1',
    ]);
  });
});
