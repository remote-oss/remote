import {deepStrictEqual} from 'node:assert';
import type {ShutdownReply} from '../../src/shutdown/protocol.ts';
import {
  CHECK_MILLISECONDS,
  createShutdownRegistry,
  type DockerResult,
  LOOKUP_ATTEMPTS,
  type ShutdownRegistry,
} from '../../src/shutdown/registry.ts';

const ENGINE = {dockerPath: 'docker', environment: {}};
const IDENTITY = {
  hostPath: '/home/user/proj',
  configFile: '/home/user/proj/.devcontainer/devcontainer.json',
};
const OTHER_IDENTITY = {
  hostPath: '/home/user/other',
  configFile: '/home/user/other/.devcontainer/devcontainer.json',
};

/** The registry over a fake clock and a fake docker, with what it ran and what it logged. */
function scene(
  answer: (argv: readonly string[]) => DockerResult = () => ({
    status: 0,
    stdout: '',
  }),
) {
  let now = 0;
  const timers: Array<{dueAt: number; callback: () => void; live: boolean}> =
    [];
  const runs: string[] = [];
  const logs: string[] = [];
  const registry: ShutdownRegistry = createShutdownRegistry({
    runDocker: (engine, argv) => {
      runs.push(`${String(now / 1000)}s ${argv.join(' ')}`);
      return Promise.resolve(answer(argv));
    },
    setTimer: (milliseconds, callback) => {
      const timer = {dueAt: now + milliseconds, callback, live: true};
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    logLine: line => logs.push(line),
  });
  /** Moves the clock on by `milliseconds`, firing each timer at its time and letting what it starts finish. */
  async function advance(milliseconds: number): Promise<void> {
    const target = now + milliseconds;
    for (;;) {
      const next = timers
        .filter(timer => timer.live && timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (next === undefined) {
        break;
      }
      next.live = false;
      now = Math.max(now, next.dueAt);
      next.callback();
      await new Promise(resolve => setImmediate(resolve));
    }
    now = target;
  }
  return {registry, advance, runs, logs, now: () => now};
}

/** Registers connection `connectionId` of lease `leaseId` for `identity`, and tells where its container is. */
function connect(
  registry: ShutdownRegistry,
  leaseId: number,
  connectionId: string,
  identity = IDENTITY,
  container?: {containerId: string; action: 'stop' | 'none'},
): void {
  registry.register(leaseId, {
    type: 'register',
    connectionId,
    identity,
    engine: ENGINE,
  });
  if (container !== undefined) {
    registry.setContainer({type: 'container', connectionId, ...container});
  }
}

const STOP = {containerId: 'c0ffee', action: 'stop'} as const;

describe('the shutdown registry (card containers-68)', () => {
  it('F-0417 AC-1, BR-3: a connection that ends stops its container at exactly ten seconds, with one docker stop', async () => {
    const {registry, advance, runs} = scene();
    connect(registry, 1, 'a', IDENTITY, STOP);
    registry.leasesChanged([]);
    await advance(CHECK_MILLISECONDS - 1);
    const before = [...runs];
    await advance(1);
    deepStrictEqual([before, runs], [[], ['10s stop c0ffee']]);
  });

  it('F-0417 AC-4, BR-12: an action of none issues no docker command at all', async () => {
    const {registry, advance, runs} = scene();
    connect(registry, 1, 'a', IDENTITY, {
      containerId: 'c0ffee',
      action: 'none',
    });
    registry.leasesChanged([]);
    await advance(10 * CHECK_MILLISECONDS);
    deepStrictEqual(runs, []);
  });

  it('F-0417 AC-24: a reload that registers the same identity within the ten seconds keeps the container running, and its own end stops it', async () => {
    const {registry, advance, runs} = scene();
    connect(registry, 1, 'before', IDENTITY, STOP);
    registry.leasesChanged([]);
    await advance(3000);
    connect(registry, 2, 'after', IDENTITY);
    await advance(CHECK_MILLISECONDS);
    const whileReloaded = [...runs];
    registry.setContainer({type: 'container', connectionId: 'after', ...STOP});
    registry.leasesChanged([]);
    await advance(CHECK_MILLISECONDS);
    deepStrictEqual([whileReloaded, runs], [[], ['23s stop c0ffee']]);
  });

  it('F-0417 AC-60: a reload that registers only after the check does not stop it, and one that ends before the check leaves the stop to happen', async () => {
    const late = scene();
    connect(late.registry, 1, 'before', IDENTITY, STOP);
    late.registry.leasesChanged([]);
    await late.advance(CHECK_MILLISECONDS + 1000);
    connect(late.registry, 2, 'after', IDENTITY);
    await late.advance(CHECK_MILLISECONDS);
    const failing = scene();
    connect(failing.registry, 1, 'before', IDENTITY, STOP);
    failing.registry.leasesChanged([]);
    await failing.advance(2000);
    connect(failing.registry, 2, 'after', IDENTITY);
    failing.registry.leave({type: 'leave', connectionId: 'after'});
    await failing.advance(CHECK_MILLISECONDS);
    deepStrictEqual(
      [late.runs, failing.runs.slice(0, 1)],
      [['10s stop c0ffee'], ['10s stop c0ffee']],
    );
  });

  it('F-0417 BR-5: another live connection with the same container id keeps it running, and the check leaves a line in the log', async () => {
    const {registry, advance, runs, logs} = scene();
    connect(registry, 1, 'a', IDENTITY, STOP);
    connect(registry, 2, 'b', OTHER_IDENTITY, STOP);
    registry.leasesChanged([2]);
    await advance(CHECK_MILLISECONDS);
    deepStrictEqual(
      [runs, logs],
      [[], ['container c0ffee is in use and stays running']],
    );
  });

  it('F-0417 AC-27, AC-28, BR-11: a stop that fails, because the container is gone or docker is not there, is logged once and never retried', async () => {
    const gone = scene(() => ({status: 1, stdout: ''}));
    connect(gone.registry, 1, 'a', IDENTITY, STOP);
    gone.registry.leasesChanged([]);
    await gone.advance(10 * CHECK_MILLISECONDS);
    const missing = scene(() => ({status: undefined, stdout: ''}));
    connect(missing.registry, 1, 'a', IDENTITY, STOP);
    missing.registry.leasesChanged([]);
    await missing.advance(10 * CHECK_MILLISECONDS);
    deepStrictEqual(
      [gone.runs, gone.logs, missing.runs, missing.logs],
      [
        ['10s stop c0ffee'],
        ['docker stop c0ffee failed with status 1'],
        ['10s stop c0ffee'],
        ['docker stop c0ffee failed with status undefined'],
      ],
    );
  });

  it('F-0417 AC-46: a container that was stopped by hand during the delay costs one docker stop and no more', async () => {
    const {registry, advance, runs} = scene(() => ({
      status: 0,
      stdout: 'c0ffee',
    }));
    connect(registry, 1, 'a', IDENTITY, STOP);
    registry.leasesChanged([]);
    await advance(10 * CHECK_MILLISECONDS);
    deepStrictEqual(runs, ['10s stop c0ffee']);
  });

  it('F-0417 AC-57: a connection that ends before its container is known looks it up by its labels after ten seconds, and stops what it finds', async () => {
    const {registry, advance, runs} = scene(argv =>
      argv[0] === 'ps'
        ? {status: 0, stdout: 'c0ffee\n'}
        : {status: 0, stdout: ''},
    );
    connect(registry, 1, 'a');
    registry.leasesChanged([]);
    await advance(CHECK_MILLISECONDS);
    deepStrictEqual(runs, [
      `10s ps -q --filter label=devcontainer.local_folder=${IDENTITY.hostPath} --filter label=devcontainer.config_file=${IDENTITY.configFile}`,
      '10s stop c0ffee',
    ]);
  });

  it('F-0417 AC-58: the lookup repeats every ten seconds until the container runs, and gives up after twelve looks', async () => {
    let looks = 0;
    const found = scene(argv => {
      if (argv[0] === 'ps') {
        looks += 1;
        return {status: 0, stdout: looks === 3 ? 'c0ffee\n' : ''};
      }
      return {status: 0, stdout: ''};
    });
    connect(found.registry, 1, 'a');
    found.registry.leasesChanged([]);
    await found.advance(10 * CHECK_MILLISECONDS);
    const never = scene();
    connect(never.registry, 1, 'a');
    never.registry.leasesChanged([]);
    await never.advance(20 * CHECK_MILLISECONDS);
    deepStrictEqual(
      [
        found.runs.map(command => command.split(' ')[0]),
        found.runs.at(-1),
        never.runs.length,
        never.runs.at(-1)?.split(' ')[0],
        never.logs,
      ],
      [
        ['10s', '20s', '30s', '30s'],
        '30s stop c0ffee',
        LOOKUP_ATTEMPTS,
        '120s',
        [`no running container for ${IDENTITY.hostPath}; the lookup ends`],
      ],
    );
  });

  it('F-0417 BR-11: a lookup that fails ends there, and a container found while another connection holds the folder is left running', async () => {
    const failing = scene(() => ({status: 1, stdout: ''}));
    connect(failing.registry, 1, 'a');
    failing.registry.leasesChanged([]);
    await failing.advance(5 * CHECK_MILLISECONDS);
    const held = scene(() => ({status: 0, stdout: 'c0ffee'}));
    connect(held.registry, 1, 'a');
    connect(held.registry, 2, 'b');
    held.registry.leasesChanged([2]);
    await held.advance(5 * CHECK_MILLISECONDS);
    deepStrictEqual(
      [failing.runs.length, failing.logs, held.runs.length, held.logs],
      [
        1,
        ['docker ps failed with status 1; the lookup ends'],
        1,
        ['container c0ffee is in use and stays running'],
      ],
    );
  });

  it('F-0417 BR-8: a leave ends the connection once, and the close of its lease afterwards changes nothing more', async () => {
    const {registry, advance, runs} = scene();
    connect(registry, 1, 'a', IDENTITY, STOP);
    const first = registry.leave({type: 'leave', connectionId: 'a'});
    const second = registry.leave({type: 'leave', connectionId: 'a'});
    registry.leasesChanged([]);
    await advance(10 * CHECK_MILLISECONDS);
    deepStrictEqual(
      [first, second, runs],
      [{accepted: true}, {accepted: true}, ['10s stop c0ffee']],
    );
  });

  it('F-0417 AC-23, AC-50: the close of a lease ends every connection it holds, and no other', async () => {
    const {registry, advance, runs} = scene();
    connect(registry, 1, 'a', IDENTITY, STOP);
    connect(registry, 1, 'b', OTHER_IDENTITY, {
      containerId: 'beef',
      action: 'stop',
    });
    connect(
      registry,
      2,
      'c',
      {hostPath: '/third', configFile: '/third/c.json'},
      {containerId: 'f00d', action: 'stop'},
    );
    registry.leasesChanged([2]);
    await advance(CHECK_MILLISECONDS);
    deepStrictEqual(runs.sort(), ['10s stop beef', '10s stop c0ffee']);
  });

  it('F-0417 BR-8: a lease change that keeps every lease alive ends nothing', async () => {
    const {registry, advance, runs} = scene();
    connect(registry, 1, 'a', IDENTITY, STOP);
    registry.leasesChanged([1, 2]);
    await advance(10 * CHECK_MILLISECONDS);
    deepStrictEqual(runs, []);
  });

  it('F-0417 BR-11: a request about a connection nobody registered is answered and changes nothing, and so is a second register', () => {
    const {registry} = scene();
    connect(registry, 1, 'a');
    const replies: ShutdownReply[] = [
      registry.setContainer({
        type: 'container',
        connectionId: 'nobody',
        ...STOP,
      }),
      registry.leave({type: 'leave', connectionId: 'nobody'}),
      registry.register(1, {
        type: 'register',
        connectionId: 'a',
        identity: IDENTITY,
        engine: ENGINE,
      }),
    ];
    deepStrictEqual(replies, [
      {accepted: false, problem: 'unknown connection'},
      {accepted: false, problem: 'unknown connection'},
      {accepted: false, problem: 'connection already registered'},
    ]);
  });

  it('F-0417 BR-3: drain resolves only when every pending check and lookup is done', async () => {
    const {registry, advance} = scene();
    connect(registry, 1, 'a');
    registry.leasesChanged([]);
    let drained = false;
    const draining = registry.drain().then(() => {
      drained = true;
    });
    await advance(5 * CHECK_MILLISECONDS);
    const midway = drained;
    await advance(20 * CHECK_MILLISECONDS);
    await draining;
    deepStrictEqual([midway, drained], [false, true]);
  });
});

/** A Compose project's containers as the engine holds them: `running` by service, and what `kill` removed. */
function project(services: ReadonlyArray<readonly [string, string]>) {
  const running = new Map<string, string>(services);
  return {
    answer: (argv: readonly string[]): DockerResult => {
      if (argv[0] === 'ps') {
        return {
          status: 0,
          stdout: [...running]
            .map(([service, container]) => `${container}\t${service}`)
            .join('\n'),
        };
      }
      for (const [service, container] of running) {
        if (argv[0] === 'kill' && argv[1] === container) {
          running.delete(service);
        }
      }
      return {status: 0, stdout: ''};
    },
    running: () => [...running.keys()].sort(),
    recreate: (service: string, container: string) =>
      running.set(service, container),
  };
}

/** Registers connection `connectionId` of lease `leaseId` as a Compose one of project `proj` with `scope`, primary service `service`. */
function composeConnect(
  registry: ShutdownRegistry,
  leaseId: number,
  connectionId: string,
  scope: readonly string[],
  options: {
    action?: 'stop' | 'none';
    engine?: typeof ENGINE;
    containerId?: string;
  } = {},
): void {
  registry.register(leaseId, {
    type: 'register',
    connectionId,
    identity: {
      hostPath: `/home/user/${connectionId}`,
      configFile: `/home/user/${connectionId}/devcontainer.json`,
    },
    engine: options.engine ?? ENGINE,
  });
  registry.setCompose({
    type: 'compose',
    connectionId,
    compose: {project: 'proj', service: scope[0] ?? 'app', scope},
  });
  if (options.containerId !== undefined) {
    registry.setContainer({
      type: 'container',
      connectionId,
      containerId: options.containerId,
      action: options.action ?? 'stop',
    });
  }
}

/** Services `app` and `db`, whose containers are `a1` and `d1`. */
const APP_AND_DB = [
  ['app', 'a1'],
  ['db', 'd1'],
] as const;

/**
 * The services running after each of the lease lists in `steps` is the live set and ten seconds have passed, for
 * connections of the project that `connections` describe (lease 1, 2, ... in order).
 */
async function runningAfter(
  services: ReadonlyArray<readonly [string, string]>,
  connections: ReadonlyArray<readonly string[]>,
  steps: ReadonlyArray<readonly number[]>,
): Promise<string[][]> {
  const world = project(services);
  const {registry, advance} = scene(world.answer);
  connections.forEach((scope, position) => {
    composeConnect(
      registry,
      position + 1,
      `conn${String(position + 1)}`,
      scope,
    );
  });
  const seen: string[][] = [];
  for (const live of steps) {
    registry.leasesChanged(live);
    await advance(CHECK_MILLISECONDS);
    seen.push(world.running());
  }
  return seen;
}

describe('the shutdown registry, the Compose stop (card containers-144)', () => {
  it('F-0417 AC-10, AC-11: a Compose connection that ends kills the running containers of its scope at ten seconds, with docker kill and no Compose call', async () => {
    const world = project(APP_AND_DB);
    const {registry, advance, runs} = scene(world.answer);
    composeConnect(registry, 1, 'a', ['app', 'db'], {containerId: 'a1'});
    registry.leasesChanged([]);
    await advance(CHECK_MILLISECONDS);
    deepStrictEqual(
      [runs, world.running()],
      [
        [
          '10s ps --filter label=com.docker.compose.project=proj --format {{.ID}}\t{{.Label "com.docker.compose.service"}}',
          '10s kill a1',
          '10s kill d1',
        ],
        [],
      ],
    );
  });

  it('F-0417 AC-4, BR-12: a Compose connection whose action is none runs no docker command', async () => {
    const world = project([['app', 'a1']]);
    const {registry, advance, runs} = scene(world.answer);
    composeConnect(registry, 1, 'a', ['app'], {
      containerId: 'a1',
      action: 'none',
    });
    registry.leasesChanged([]);
    await advance(10 * CHECK_MILLISECONDS);
    deepStrictEqual(runs, []);
  });

  it('F-0417 AC-13, AC-63, AC-59: a service outside the scope, a depends_on one or one started by hand, stays running', async () => {
    deepStrictEqual(
      await runningAfter(
        [
          ['app', 'a1'],
          ['db', 'd1'],
          ['hand', 'h1'],
        ],
        [['app']],
        [[]],
      ),
      [['db', 'hand']],
    );
  });

  it('F-0417 AC-16, AC-38: the close of one of two connections of a project stops nothing, and the last close stops every container', async () => {
    deepStrictEqual(
      await runningAfter(
        APP_AND_DB,
        [
          ['app', 'db'],
          ['app', 'db'],
        ],
        [[1], []],
      ),
      [['app', 'db'], []],
    );
  });

  it('F-0417 AC-39, AC-40: with disjoint scopes each close stops its own service only', async () => {
    deepStrictEqual(
      await runningAfter(APP_AND_DB, [['app'], ['db']], [[2], []]),
      [['db'], []],
    );
  });

  /** Three services, a window of all three and one of two of them, closed in the order of `steps`. */
  function threeServices(steps: ReadonlyArray<readonly number[]>) {
    return runningAfter(
      [
        ['py', 'p1'],
        ['node', 'n1'],
        ['db', 'd1'],
      ],
      [
        ['py', 'node', 'db'],
        ['py', 'node'],
      ],
      steps,
    );
  }

  it('F-0417 AC-48: the first close stops the service only it ran, and the last close stops what the first one skipped', async () => {
    deepStrictEqual(await threeServices([[2], []]), [['node', 'py'], []]);
  });

  it('F-0417 AC-49: when the smaller scope closes first nothing stops, and the last close stops all three', async () => {
    deepStrictEqual(await threeServices([[1], []]), [['db', 'node', 'py'], []]);
  });

  it('F-0417 AC-53: a container an attach window holds stays up through both closes, and the last close stops it with the rest', async () => {
    const world = project([
      ['app', 'a1'],
      ['db', 'd1'],
      ['web', 'w1'],
    ]);
    const {registry, advance} = scene(world.answer);
    composeConnect(registry, 1, 'a', ['app', 'db']);
    composeConnect(registry, 2, 'b', ['web', 'app']);
    connect(registry, 3, 'attached', OTHER_IDENTITY, {
      containerId: 'd1',
      action: 'none',
    });
    const seen: string[][] = [];
    for (const live of [[2, 3], [2], []]) {
      registry.leasesChanged(live);
      await advance(CHECK_MILLISECONDS);
      seen.push(world.running());
    }
    deepStrictEqual(seen, [['app', 'db', 'web'], ['app', 'db', 'web'], []]);
  });

  it('F-0417 AC-18: a connection whose action is none still counts as using its services', async () => {
    const world = project([['app', 'a1']]);
    const {registry, advance} = scene(world.answer);
    composeConnect(registry, 1, 'a', ['app'], {
      containerId: 'a1',
      action: 'none',
    });
    composeConnect(registry, 2, 'b', ['app'], {containerId: 'a1'});
    registry.leasesChanged([1]);
    await advance(3 * CHECK_MILLISECONDS);
    deepStrictEqual(world.running(), ['app']);
  });

  it('F-0417 AC-52, BR-8: a connection that ended does not count, and its own obligation runs at its end', async () => {
    const world = project(APP_AND_DB);
    const {registry, advance} = scene(world.answer);
    composeConnect(registry, 1, 'a', ['app', 'db']);
    composeConnect(registry, 2, 'b', ['app', 'db']);
    registry.leave({type: 'leave', connectionId: 'b'});
    await advance(CHECK_MILLISECONDS);
    const afterLost = world.running();
    registry.leasesChanged([]);
    await advance(CHECK_MILLISECONDS);
    deepStrictEqual([afterLost, world.running()], [['app', 'db'], []]);
  });

  it('F-0417 BR-7: a service a close skipped is stopped at the last close even when its container was recreated, and a project of another engine does not count', async () => {
    const world = project(APP_AND_DB);
    const {registry, advance} = scene(world.answer);
    composeConnect(registry, 1, 'a', ['app', 'db']);
    composeConnect(registry, 2, 'b', ['app'], {
      engine: {dockerPath: 'docker', environment: {DOCKER_HOST: 'ssh://far'}},
    });
    composeConnect(registry, 3, 'c', ['db']);
    registry.leasesChanged([1, 3]);
    await advance(CHECK_MILLISECONDS);
    const afterB = world.running();
    world.recreate('db', 'd2');
    registry.leasesChanged([1]);
    await advance(CHECK_MILLISECONDS);
    const afterC = world.running();
    registry.leasesChanged([]);
    await advance(CHECK_MILLISECONDS);
    deepStrictEqual([afterB, afterC, world.running()], [['db'], ['db'], []]);
  });

  it('F-0417 BR-10, BR-11, AC-64: a failing listing or kill is one log line each and is not tried again', async () => {
    const failing = scene(argv =>
      argv[0] === 'ps' ? {status: 1, stdout: ''} : {status: 0, stdout: ''},
    );
    composeConnect(failing.registry, 1, 'a', ['app']);
    failing.registry.leasesChanged([]);
    await failing.advance(10 * CHECK_MILLISECONDS);
    const killing = scene(argv =>
      argv[0] === 'ps'
        ? {status: 0, stdout: 'a1\tapp'}
        : {status: 125, stdout: ''},
    );
    composeConnect(killing.registry, 1, 'a', ['app']);
    killing.registry.leasesChanged([]);
    await killing.advance(10 * CHECK_MILLISECONDS);
    deepStrictEqual(
      [failing.logs, failing.runs.length, killing.logs, killing.runs.length],
      [
        ['docker ps for the project proj failed with status 1'],
        1,
        ['docker kill a1 failed with status 125'],
        2,
      ],
    );
  });

  it('F-0417 AC-9, BR-4: an image connection still stops with docker stop, and a Compose message for an unknown connection is refused', async () => {
    const {registry, advance, runs} = scene();
    connect(registry, 1, 'a', IDENTITY, STOP);
    registry.leasesChanged([]);
    await advance(CHECK_MILLISECONDS);
    deepStrictEqual(
      [
        runs,
        registry.setCompose({
          type: 'compose',
          connectionId: 'nobody',
          compose: {project: 'proj', service: 'app', scope: ['app']},
        }),
      ],
      [['10s stop c0ffee'], {accepted: false, problem: 'unknown connection'}],
    );
  });
});
