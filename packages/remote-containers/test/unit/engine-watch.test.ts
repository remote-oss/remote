import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type EngineWatchPorts,
  engineWatchOf,
} from '../../src/engine/engine-watch.ts';

/** One folder watch the fake machine made. */
interface FolderWatch {
  folder: string;
  recursive: boolean;
  listener: (name: string | undefined) => void;
  disposed: boolean;
}

/** One timer the fake machine holds. */
interface Timer {
  milliseconds: number;
  callback: () => void;
  stopped: boolean;
}

/** The fake machine, and what the watch did with it. */
interface Scene {
  key: string | undefined;
  reads: number;
  hold: Promise<void> | undefined;
  unwatchable: boolean;
  signatures: Map<string, string>;
  watches: FolderWatch[];
  timers: Timer[];
  lines: string[];
  ports: EngineWatchPorts;
}

const CONFIG = '/home/me/.docker';

function sceneOf(key: string | undefined = 'ctx-a'): Scene {
  const sink = new MemorySink();
  const scene: Scene = {
    key,
    reads: 0,
    hold: undefined,
    unwatchable: false,
    signatures: new Map(),
    watches: [],
    timers: [],
    lines: [],
    ports: undefined as unknown as EngineWatchPorts,
  };
  scene.ports = {
    configFolder: () => CONFIG,
    watchFolder: (folder, recursive, listener) => {
      if (scene.unwatchable) {
        return undefined;
      }
      const watch: FolderWatch = {folder, recursive, listener, disposed: false};
      scene.watches.push(watch);
      return {
        dispose: () => {
          watch.disposed = true;
        },
      };
    },
    signature: file => Promise.resolve(scene.signatures.get(file) ?? 'missing'),
    engineKey: async () => {
      scene.reads += 1;
      await scene.hold;
      return scene.key;
    },
    setTimer: (milliseconds, callback) => {
      const timer: Timer = {milliseconds, callback, stopped: false};
      scene.timers.push(timer);
      return () => {
        timer.stopped = true;
      };
    },
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  };
  Object.defineProperty(scene, 'lines', {
    get: () => sink.lines.map(line => `${line.level}: ${line.message}`),
  });
  return scene;
}

/** Lets every promise that can run, run. */
async function settled(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

/** Runs the timers of `milliseconds` that are armed and not stopped, once each. */
async function fire(scene: Scene, milliseconds: number): Promise<void> {
  const waiting = scene.timers.filter(
    timer => timer.milliseconds === milliseconds && !timer.stopped,
  );
  for (const timer of waiting) {
    timer.stopped = true;
    timer.callback();
  }
  await settled();
}

/** Does nothing; the start of a gate that is not open yet. */
function nothing(): void {
  return;
}

/** A watch with one listener that counts its calls. */
function listening(scene: Scene): {
  subscription: {dispose(): void};
  calls: () => number;
} {
  let count = 0;
  const subscription = engineWatchOf(scene.ports).onEngineChange(() => {
    count += 1;
  });
  return {subscription, calls: () => count};
}

/** Holds the reads of the key until the returned function is called. */
function holdReads(scene: Scene): () => void {
  let release: () => void = nothing;
  scene.hold = new Promise<void>(resolve => {
    release = resolve;
  });
  return release;
}

describe('the engine watch (card containers-142, F-0205 AC-39, BR-17)', () => {
  it('a context switch fires once after 250 ms, and the key becomes the baseline', async () => {
    const scene = sceneOf('a');
    let calls = 0;
    const watch = engineWatchOf(scene.ports);
    watch.onEngineChange(() => {
      calls += 1;
    });
    await settled();
    scene.key = 'b';
    scene.watches[0]?.listener('config.json');
    const armed = scene.timers.map(timer => timer.milliseconds);
    await fire(scene, 250);
    scene.watches[1]?.listener('meta.json');
    await fire(scene, 250);
    deepStrictEqual([armed, calls, scene.reads], [[250], 1, 3]);
  });

  it('a burst of events fires once', async () => {
    const scene = sceneOf('a');
    let calls = 0;
    engineWatchOf(scene.ports).onEngineChange(() => {
      calls += 1;
    });
    await settled();
    scene.key = 'b';
    scene.watches[0]?.listener(undefined);
    scene.watches[1]?.listener('x');
    scene.watches[1]?.listener('y');
    const stopped = scene.timers.map(timer => timer.stopped);
    await fire(scene, 250);
    deepStrictEqual([stopped, calls], [[true, true, false], 1]);
  });

  it('events of other files of the configuration folder start nothing, and an unchanged key fires nothing', async () => {
    const scene = sceneOf('a');
    let calls = 0;
    engineWatchOf(scene.ports).onEngineChange(() => {
      calls += 1;
    });
    await settled();
    scene.watches[0]?.listener('other.json');
    const none = scene.timers.length;
    scene.watches[0]?.listener('config.json');
    await fire(scene, 250);
    deepStrictEqual([none, calls, scene.reads], [0, 0, 2]);
  });

  it('it watches the configuration folder and, recursively, its contexts', async () => {
    const scene = sceneOf('a');
    engineWatchOf(scene.ports).onEngineChange(() => undefined);
    await settled();
    deepStrictEqual(
      scene.watches.map(watch => [watch.folder, watch.recursive]),
      [
        [CONFIG, false],
        [`${CONFIG}/contexts`, true],
      ],
    );
  });

  it('an engine without contexts watches nothing and never fires', async () => {
    const scene = sceneOf('noContexts');
    let calls = 0;
    engineWatchOf(scene.ports).onEngineChange(() => {
      calls += 1;
    });
    await settled();
    deepStrictEqual(
      [scene.watches.length, scene.timers.length, calls],
      [0, 0, 0],
    );
  });

  it('with no folder to watch the poll every 2 s sees a change of the files and fires once', async () => {
    const scene = sceneOf('a');
    scene.unwatchable = true;
    let calls = 0;
    engineWatchOf(scene.ports).onEngineChange(() => {
      calls += 1;
    });
    await settled();
    await fire(scene, 2000);
    const quiet = scene.timers.filter(
      timer => timer.milliseconds === 250,
    ).length;
    scene.key = 'b';
    scene.signatures.set(`${CONFIG}/config.json`, '10:5');
    await fire(scene, 2000);
    await fire(scene, 250);
    deepStrictEqual([quiet, calls], [0, 1]);
  });

  it('a key that cannot be read keeps the last one: nothing fires, and the same key after it fires nothing', async () => {
    const scene = sceneOf('a');
    let calls = 0;
    engineWatchOf(scene.ports).onEngineChange(() => {
      calls += 1;
    });
    await settled();
    scene.key = undefined;
    scene.watches[0]?.listener(undefined);
    await fire(scene, 250);
    scene.key = 'a';
    scene.watches[0]?.listener(undefined);
    await fire(scene, 250);
    deepStrictEqual(calls, 0);
  });

  it('a first key that cannot be read is no baseline: the first one read after it fires nothing, the next change does', async () => {
    const scene = sceneOf();
    scene.key = undefined;
    let calls = 0;
    engineWatchOf(scene.ports).onEngineChange(() => {
      calls += 1;
    });
    await settled();
    scene.key = 'a';
    scene.watches[0]?.listener(undefined);
    await fire(scene, 250);
    const first = calls;
    scene.key = 'b';
    scene.watches[0]?.listener(undefined);
    await fire(scene, 250);
    deepStrictEqual([first, calls], [0, 1]);
  });

  it('the last stop ends the watches, the poll and a waiting read, and a watch without listeners reads nothing', async () => {
    const scene = sceneOf('a');
    scene.unwatchable = false;
    const first = engineWatchOf(scene.ports).onEngineChange(() => undefined);
    await settled();
    scene.watches[0]?.listener(undefined);
    first.dispose();
    const stopped = [
      scene.watches.map(watch => watch.disposed),
      scene.timers.map(timer => timer.stopped),
    ];
    await fire(scene, 250);
    deepStrictEqual([stopped, scene.reads], [[[true, true], [true]], 1]);
  });

  it('the poll ends with the last stop, and a poll that answers after it arms nothing', async () => {
    const scene = sceneOf('a');
    scene.unwatchable = true;
    const subscription = engineWatchOf(scene.ports).onEngineChange(
      () => undefined,
    );
    await settled();
    const armed = scene.timers.length;
    subscription.dispose();
    await fire(scene, 2000);
    deepStrictEqual(
      [armed, scene.timers.map(timer => timer.stopped)],
      [1, [true]],
    );
  });

  it('a poll look that ends after the stop changes nothing', async () => {
    const scene = sceneOf('a');
    scene.unwatchable = true;
    let release: () => void = nothing;
    const slow = new Promise<void>(resolve => {
      release = resolve;
    });
    let calls = 0;
    const subscription = engineWatchOf({
      ...scene.ports,
      signature: file =>
        calls++ < 2 ? Promise.resolve('x') : slow.then(() => file),
    }).onEngineChange(() => undefined);
    await settled();
    await fire(scene, 2000);
    subscription.dispose();
    release();
    await settled();
    deepStrictEqual(
      scene.timers.map(timer => timer.stopped),
      [true],
    );
  });

  it('a start that ends after the stop makes no watch', async () => {
    const scene = sceneOf('a');
    const release = holdReads(scene);
    const subscription = engineWatchOf(scene.ports).onEngineChange(
      () => undefined,
    );
    subscription.dispose();
    release();
    await settled();
    deepStrictEqual(scene.watches.length, 0);
  });

  it('a read that ends after the stop tells no one', async () => {
    const scene = sceneOf('a');
    const {subscription, calls} = listening(scene);
    await settled();
    const release = holdReads(scene);
    scene.key = 'b';
    scene.watches[0]?.listener(undefined);
    await fire(scene, 250);
    subscription.dispose();
    release();
    await settled();
    deepStrictEqual(calls(), 0);
  });

  it('a trigger during a read runs one more read, and one change is told once', async () => {
    const scene = sceneOf('a');
    const {calls} = listening(scene);
    await settled();
    const release = holdReads(scene);
    scene.key = 'b';
    scene.watches[0]?.listener(undefined);
    await fire(scene, 250);
    scene.watches[0]?.listener(undefined);
    await fire(scene, 250);
    scene.hold = undefined;
    release();
    await settled();
    await settled();
    deepStrictEqual([calls(), scene.reads], [1, 3]);
  });

  it('two listeners share one watch and both are told; the watch ends with the second stop', async () => {
    const scene = sceneOf('a');
    const told: string[] = [];
    const watch = engineWatchOf(scene.ports);
    const first = watch.onEngineChange(() => {
      told.push('first');
    });
    const second = watch.onEngineChange(() => {
      told.push('second');
    });
    await settled();
    scene.key = 'b';
    scene.watches[0]?.listener(undefined);
    await fire(scene, 250);
    first.dispose();
    const kept = scene.watches.map(each => each.disposed);
    second.dispose();
    deepStrictEqual(
      [
        told,
        scene.watches.length,
        kept,
        scene.watches.map(each => each.disposed),
      ],
      [['first', 'second'], 2, [false, false], [true, true]],
    );
  });

  it('a second stop of the same listener ends nothing twice', async () => {
    const scene = sceneOf('a');
    const subscription = engineWatchOf(scene.ports).onEngineChange(
      () => undefined,
    );
    await settled();
    subscription.dispose();
    subscription.dispose();
    deepStrictEqual(
      scene.watches.map(watch => watch.disposed),
      [true, true],
    );
  });

  it('a change is logged with its key, and a folder that cannot be watched is logged once', async () => {
    const scene = sceneOf('a');
    scene.unwatchable = true;
    engineWatchOf(scene.ports).onEngineChange(() => undefined);
    await settled();
    scene.key = 'b';
    scene.signatures.set(`${CONFIG}/config.json`, 'changed');
    await fire(scene, 2000);
    await fire(scene, 2000);
    await fire(scene, 250);
    deepStrictEqual(scene.lines, [
      "info: the Docker configuration can't be watched; checking it every 2 s",
      'info: the Docker engine changed: b',
    ]);
  });
});
