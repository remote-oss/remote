import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {EngineHost} from '../../src/engine/engine-host.ts';
import {
  EVENT_QUIET_MILLISECONDS,
  EVENTS_ARGUMENTS,
  sharedContainerEvents,
  watchContainerEvents,
} from '../../src/explorer/targets-events.ts';
import {fakeEngine, type FakeEngine, type SpawnPlan} from './fake-engine.ts';
import {pendingOf, settled} from './pending.ts';

/** What a row steers, and what the fakes recorded. */
interface Scene {
  engine: FakeEngine;
  watched: EngineHost | undefined;
  rebuilds: number;
  /** What a rebuild waits for; none lets it end at once. */
  hold: (() => Promise<unknown>) | undefined;
  failure: unknown;
  timers: Array<{milliseconds: number; callback: () => void; stopped: boolean}>;
  sink: MemorySink;
}

function sceneOf(...plans: SpawnPlan[]): Scene {
  const engine = fakeEngine(...plans);
  return {
    engine,
    watched: engine,
    rebuilds: 0,
    hold: undefined,
    failure: undefined,
    timers: [],
    sink: new MemorySink(),
  };
}

/** The timers of the scene: each wait is recorded, and the function that stops it marks it stopped. */
function timerOf(
  scene: Scene,
): (milliseconds: number, callback: () => void) => () => void {
  return (milliseconds, callback) => {
    const timer = {milliseconds, callback, stopped: false};
    scene.timers.push(timer);
    return () => {
      timer.stopped = true;
    };
  };
}

function watcherOf(scene: Scene): ReturnType<typeof watchContainerEvents> {
  return watchContainerEvents({
    engine: () => scene.watched,
    rebuild: async () => {
      scene.rebuilds += 1;
      await scene.hold?.();
      if (scene.failure !== undefined) {
        // The row on a rejection that is not an error needs exactly that.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw scene.failure;
      }
    },
    setTimer: timerOf(scene),
    logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
  });
}

/** The timers that still wait. */
function waiting(scene: Scene): Array<() => void> {
  return scene.timers
    .filter(timer => !timer.stopped)
    .map(timer => timer.callback);
}

function lines(scene: Scene): string[] {
  return scene.sink.lines.map(line => `${line.level}: ${line.message}`);
}

const EVENT = '{"Type":"container","Action":"start"}\n';

/** Starts the watcher and takes it through one event and the rebuild that follows. */
async function firstRebuild(scene: Scene): Promise<void> {
  watcherOf(scene).start();
  await settled();
  scene.engine.processes[0]?.print(EVENT);
  await settled();
  waiting(scene)[0]?.();
  await settled();
}

describe('the container events of the Dev Containers view (card containers-31)', () => {
  it('F-0901 6.21, ADR-0010 rule 2: the process is docker events with Docker’s own type filter and the JSON format, spawned with arguments and no shell', async () => {
    const scene = sceneOf();
    watcherOf(scene).start();
    await settled();
    deepStrictEqual(
      [scene.engine.processes.map(process => process.argv), EVENTS_ARGUMENTS],
      [
        [['events', '--filter', 'type=container', '--format', '{{json .}}']],
        ['events', '--filter', 'type=container', '--format', '{{json .}}'],
      ],
    );
  });

  it('F-0901 §16: starting twice runs one process, and stopping ends it once and does nothing the second time', async () => {
    const scene = sceneOf();
    const watcher = watcherOf(scene);
    watcher.start();
    watcher.start();
    await settled();
    watcher.stop();
    watcher.stop();
    await settled();
    deepStrictEqual(
      [scene.engine.processes.length, scene.engine.processes[0]?.killed],
      [1, true],
    );
  });

  it('F-0901 §16: three events 100 ms apart make one rebuild, 300 ms after the last', async () => {
    const scene = sceneOf();
    watcherOf(scene).start();
    await settled();
    for (let event = 0; event < 3; event += 1) {
      scene.engine.processes[0]?.print(EVENT);
      await settled();
    }
    const delays = scene.timers.map(timer => timer.milliseconds);
    const pending = waiting(scene).length;
    waiting(scene)[0]?.();
    await settled();
    deepStrictEqual(
      [delays, pending, scene.rebuilds, EVENT_QUIET_MILLISECONDS],
      [[300, 300, 300], 1, 1, 300],
    );
  });

  it('F-0901 §16: an event while a rebuild runs makes exactly one more rebuild, however many came', async () => {
    const scene = sceneOf();
    const release = pendingOf<undefined>();
    scene.hold = () => release.promise;
    await firstRebuild(scene);
    for (let event = 0; event < 2; event += 1) {
      scene.engine.processes[0]?.print(EVENT);
      await settled();
      waiting(scene)[0]?.();
      await settled();
    }
    const during = scene.rebuilds;
    scene.hold = undefined;
    release.resolve(undefined);
    await settled();
    deepStrictEqual([during, scene.rebuilds], [1, 2]);
  });

  it('F-0901 §16: a line that is not JSON is ignored, and a line split between two chunks is one event', async () => {
    const scene = sceneOf();
    watcherOf(scene).start();
    await settled();
    scene.engine.processes[0]?.print('not json\n');
    await settled();
    const ignored = scene.timers.length;
    scene.engine.processes[0]?.print('{"Type":"cont');
    scene.engine.processes[0]?.print('ainer"}\n');
    await settled();
    deepStrictEqual([ignored, scene.timers.length], [0, 1]);
  });

  it('F-0901 §16: the last line of a process that ends without a line end still counts', async () => {
    const scene = sceneOf();
    watcherOf(scene).start();
    await settled();
    scene.engine.processes[0]?.print('{"Type":"container"}');
    scene.engine.processes[0]?.exit(0);
    await settled();
    deepStrictEqual(scene.timers.length, 1);
  });

  it('F-0901 §16: a process that ends is not started again, with its status in the log, until start is called', async () => {
    const scene = sceneOf();
    const watcher = watcherOf(scene);
    watcher.start();
    await settled();
    scene.engine.processes[0]?.exit(1);
    await settled();
    const after = scene.engine.processes.length;
    watcher.start();
    await settled();
    scene.engine.processes[1]?.exit(undefined);
    await settled();
    deepStrictEqual(
      [after, scene.engine.processes.length, lines(scene)],
      [
        1,
        2,
        [
          'info: the Docker events process ended (1)',
          'info: the Docker events process ended (signal)',
        ],
      ],
    );
  });

  it('F-0901 §16: a spawn that fails is logged with its detail and leaves the next start free to try again', async () => {
    const scene = sceneOf({failure: 'spawn docker ENOENT'});
    const watcher = watcherOf(scene);
    watcher.start();
    await settled();
    watcher.start();
    await settled();
    deepStrictEqual(
      [scene.engine.processes.length, lines(scene)],
      [
        1,
        ['info: the Docker events process did not start: spawn docker ENOENT'],
      ],
    );
  });

  it('F-0901 §16: a spawn that rejects is logged, and the next start tries again', async () => {
    const scene = sceneOf();
    let attempts = 0;
    scene.watched = {
      ...scene.engine,
      spawn: (argv, options) => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('no process'))
          : scene.engine.spawn(argv, options);
      },
    };
    const watcher = watcherOf(scene);
    watcher.start();
    await settled();
    watcher.start();
    await settled();
    deepStrictEqual(
      [attempts, scene.engine.processes.length, lines(scene)],
      [
        2,
        1,
        ['error: the Docker events process could not be started: no process'],
      ],
    );
  });

  it('F-0901 §16: a spawn that rejects with something that is not an error is logged by its text', async () => {
    const scene = sceneOf();
    const failing = pendingOf<never>();
    scene.watched = {...scene.engine, spawn: () => failing.promise};
    watcherOf(scene).start();
    failing.reject('plain');
    await settled();
    deepStrictEqual(lines(scene), [
      'error: the Docker events process could not be started: plain',
    ]);
  });

  it('F-0901 6.21: no engine means no process', async () => {
    const scene = sceneOf();
    scene.watched = undefined;
    watcherOf(scene).start();
    await settled();
    deepStrictEqual(scene.engine.processes.length, 0);
  });

  it('F-0901 §16: stopping drops the rebuild that waits for the events to be quiet, and an ending that follows says nothing', async () => {
    const scene = sceneOf();
    const watcher = watcherOf(scene);
    watcher.start();
    await settled();
    scene.engine.processes[0]?.print(EVENT);
    await settled();
    watcher.stop();
    await settled();
    deepStrictEqual(
      [waiting(scene).length, scene.rebuilds, lines(scene)],
      [0, 0, []],
    );
  });

  it('F-0901 §16: stopping while a rebuild runs and another waits drops the second', async () => {
    const scene = sceneOf();
    const release = pendingOf<undefined>();
    scene.hold = () => release.promise;
    const watcher = watcherOf(scene);
    watcher.start();
    await settled();
    scene.engine.processes[0]?.print(EVENT);
    await settled();
    waiting(scene)[0]?.();
    await settled();
    scene.engine.processes[0]?.print(EVENT);
    await settled();
    waiting(scene)[0]?.();
    watcher.stop();
    scene.hold = undefined;
    release.resolve(undefined);
    await settled();
    deepStrictEqual(scene.rebuilds, 1);
  });

  it('F-0901 §16: a rebuild that fails is logged and the next event still rebuilds, whatever it threw', async () => {
    const scene = sceneOf();
    scene.failure = new Error('no read');
    await firstRebuild(scene);
    scene.failure = 'plain';
    scene.engine.processes[0]?.print(EVENT);
    await settled();
    waiting(scene)[0]?.();
    await settled();
    deepStrictEqual(
      [scene.rebuilds, lines(scene)],
      [
        2,
        [
          'error: the Dev Containers view could not be rebuilt: no read',
          'error: the Dev Containers view could not be rebuilt: plain',
        ],
      ],
    );
  });

  it('F-0901 AC-40: nothing rebuilds by itself: with no event the watcher asks the clock for nothing', async () => {
    const scene = sceneOf();
    watcherOf(scene).start();
    await settled();
    deepStrictEqual([scene.timers.length, scene.rebuilds], [0, 0]);
  });

  it('#1001: two views watching through the source run one process, and an event rebuilds each view that is started', async () => {
    const scene = sceneOf();
    const source = sharedContainerEvents({
      engine: () => scene.watched,
      setTimer: timerOf(scene),
      logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
    });
    const rebuilt: string[] = [];
    const first = source.watch(() => {
      rebuilt.push('first');
      return Promise.resolve();
    });
    const second = source.watch(() => {
      rebuilt.push('second');
      return Promise.resolve();
    });
    const idle = source.watch(() => {
      rebuilt.push('idle');
      return Promise.resolve();
    });
    first.start();
    second.start();
    await settled();
    scene.engine.processes[0]?.print(EVENT);
    await settled();
    waiting(scene)[0]?.();
    await settled();
    idle.stop();
    deepStrictEqual(
      [
        scene.engine.processes.length,
        rebuilt.sort(),
        scene.engine.processes[0]?.killed,
      ],
      [1, ['first', 'second'], false],
    );
  });

  it('#1001: the process ends when the last started view stops, and not before', async () => {
    const scene = sceneOf();
    const source = sharedContainerEvents({
      engine: () => scene.watched,
      setTimer: () => () => undefined,
      logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
    });
    const first = source.watch(() => Promise.resolve());
    const second = source.watch(() => Promise.resolve());
    first.start();
    second.start();
    await settled();
    first.stop();
    const afterFirst = scene.engine.processes[0]?.killed;
    second.stop();
    deepStrictEqual(
      [afterFirst, scene.engine.processes[0]?.killed],
      [false, true],
    );
  });
});
