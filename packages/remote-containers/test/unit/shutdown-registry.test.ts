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
