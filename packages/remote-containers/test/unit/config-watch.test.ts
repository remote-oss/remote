import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  ACKNOWLEDGMENT_KEY,
  readAcknowledgment,
} from '../../src/config-watch/acknowledgment.ts';
import {
  CONFIG_WATCH_TEMPLATES,
  type ConfigWatch,
  configWatchOf,
} from '../../src/config-watch/config-watch.ts';
import {
  bytesFingerprint,
  configurationFingerprint,
} from '../../src/config-watch/fingerprint.ts';

const FOLDER = '/w/.devcontainer';
const CONFIG = `${FOLDER}/devcontainer.json`;
const DOCKERFILE = `${FOLDER}/Dockerfile`;
function MESSAGE(names: string): string {
  return `Configuration file(s) changed: ${names}. The container might need to be rebuilt to apply the changes.`;
}

const IMAGE = '{"image":"a"}';
const BUILD = '{"build":{"dockerfile":"Dockerfile"}}';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function configHash(text: string): string {
  return configurationFingerprint(bytesOf(text));
}

function fileHash(text: string): string {
  return bytesFingerprint(bytesOf(text));
}

/** A notification the fake showed, and the way to answer it. */
interface Shown {
  message: string;
  buttons: readonly string[];
  answer(button: string | undefined): void;
}

/** What a row steers and what the fakes recorded. */
interface Scene {
  files: Map<string, string>;
  stored: unknown;
  writes: unknown[];
  shown: Shown[];
  rebuilds: number;
  rebuildFails: boolean | 'text';
  watching: boolean;
  watches: Array<{
    folder: string;
    listener: (name: string | undefined) => void;
    failed: () => void;
    disposed: boolean;
  }>;
  timers: Array<{dueAt: number; callback: () => void; cancelled: boolean}>;
  now: number;
  /** While set, no read answers. */
  gate: Promise<void> | undefined;
  sink: MemorySink;
  watch: ConfigWatch;
  /** Changes the file as the editor or another process would. */
  change(file: string, text: string | undefined): void;
  /** Saves the configuration, and lets the watcher's settle time pass. */
  edit(text: string | undefined): Promise<void>;
  /** Tells the folder watcher about a changed entry. */
  event(name: string | undefined): void;
  /** Moves the clock, running the timers that fall due. */
  advance(milliseconds: number): Promise<void>;
  /** Lets every pending promise settle. */
  settle(): Promise<void>;
  /** The messages shown, without their buttons. */
  messages(): string[];
  /** The stored fingerprints. */
  hashes(): Array<[string, string]>;
}

function sceneOf(
  files: Record<string, string>,
  stored?: Record<string, string>,
): Scene {
  const scene: Scene = {
    files: new Map(Object.entries(files)),
    stored:
      stored === undefined
        ? undefined
        : {configurationState: {contentHashes: stored}},
    writes: [],
    shown: [],
    rebuilds: 0,
    rebuildFails: false,
    watching: true,
    watches: [],
    timers: [],
    now: 0,
    gate: undefined,
    sink: new MemorySink(),
    watch: undefined as unknown as ConfigWatch,
    change: (file, text) => {
      if (text === undefined) {
        scene.files.delete(file);
      } else {
        scene.files.set(file, text);
      }
    },
    edit: async text => {
      scene.change(CONFIG, text);
      scene.event('devcontainer.json');
      await scene.advance(500);
    },
    event: name => {
      scene.watches.at(-1)?.listener(name);
    },
    advance: async milliseconds => {
      scene.now += milliseconds;
      for (;;) {
        const next = scene.timers
          .filter(each => !each.cancelled && each.dueAt <= scene.now)
          .sort((left, right) => left.dueAt - right.dueAt)[0];
        if (next === undefined) {
          break;
        }
        next.cancelled = true;
        next.callback();
        await scene.settle();
      }
      await scene.settle();
    },
    settle: async () => {
      for (let turn = 0; turn < 10; turn += 1) {
        await new Promise(resolve => setImmediate(resolve));
      }
    },
    messages: () => scene.shown.map(each => each.message),
    hashes: () => [...(readAcknowledgment(memento) ?? [])],
  };
  const memento = {
    get: (key: string) =>
      key === ACKNOWLEDGMENT_KEY ? scene.stored : undefined,
    update: (key: string, value: unknown) => {
      scene.writes.push([key, value]);
      scene.stored = value;
      return Promise.resolve();
    },
  };
  scene.watch = configWatchOf({
    readFile: async file => {
      await scene.gate;
      const text = scene.files.get(file);
      return text === undefined ? undefined : bytesOf(text);
    },
    watchFolder: (folder, listener, failed) => {
      if (!scene.watching) {
        return undefined;
      }
      const watch = {folder, listener, failed, disposed: false};
      scene.watches.push(watch);
      return {
        dispose: () => {
          watch.disposed = true;
        },
      };
    },
    setTimer: (callback, milliseconds) => {
      const timer = {
        dueAt: scene.now + milliseconds,
        callback,
        cancelled: false,
      };
      scene.timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    state: memento,
    show: (message, buttons) =>
      new Promise(resolve => {
        scene.shown.push({message, buttons, answer: resolve});
      }),
    rebuild: () =>
      scene.rebuildFails === 'text'
        ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the row feeds a rejection that is no Error
          Promise.reject('no space')
        : scene.rebuildFails
          ? Promise.reject(new Error('the build failed'))
          : Promise.resolve(++scene.rebuilds),
    translate: template => template,
    logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
  });
  return scene;
}

/** The scene of an image configuration whose fingerprint is stored. */
function acknowledgedImage(): Scene {
  return sceneOf({[CONFIG]: IMAGE}, {'devcontainer.json': configHash(IMAGE)});
}

/** The scene of a Dockerfile configuration with both fingerprints stored. */
function acknowledgedBuild(): Scene {
  return sceneOf(
    {[CONFIG]: BUILD, [DOCKERFILE]: 'FROM a\n'},
    {
      'devcontainer.json': configHash(BUILD),
      Dockerfile: fileHash('FROM a\n'),
    },
  );
}

/** Makes every read of the scene wait; gives the way to let them go on. */
function hold(scene: Scene): () => void {
  const gate: {release?: () => void} = {};
  scene.gate = new Promise<void>(resolve => {
    gate.release = resolve;
  });
  return () => {
    gate.release?.();
  };
}

/** A watch whose reads fail with `reason`, over a scene's logger. */
function failingWatch(scene: Scene, reason: unknown): ConfigWatch {
  return configWatchOf({
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the rows feed rejections that are no Error
    readFile: () => Promise.reject(reason),
    watchFolder: () => undefined,
    setTimer: () => () => undefined,
    state: {get: () => undefined, update: () => Promise.resolve()},
    show: () => Promise.resolve(undefined),
    rebuild: () => Promise.resolve(),
    translate: template => template,
    logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
  });
}

const FOUND = {configFile: CONFIG, created: false};
const CREATED = {configFile: CONFIG, created: true};

describe('the rebuild prompt when the configuration changes (card containers-141)', () => {
  it('F-0303 AC-12: a created container seeds every existing watched file and shows nothing', async () => {
    const scene = sceneOf({[CONFIG]: BUILD, [DOCKERFILE]: 'FROM a\n'});
    await scene.watch.activate(CREATED);
    deepStrictEqual(
      [
        scene.hashes(),
        scene.messages(),
        scene.sink.lines.map(line => line.message),
      ],
      [
        [
          ['devcontainer.json', configHash(BUILD)],
          ['Dockerfile', fileHash('FROM a\n')],
        ],
        [],
        ['seeded the acknowledgment of 2 configuration files'],
      ],
    );
  });

  it('F-0303 AC-12b: a found container with nothing stored seeds the edited content and shows nothing', async () => {
    const scene = sceneOf({[CONFIG]: IMAGE});
    await scene.watch.activate(FOUND);
    deepStrictEqual(
      [scene.hashes(), scene.messages()],
      [[['devcontainer.json', configHash(IMAGE)]], []],
    );
  });

  it('F-0303 AC-12c: a found container with a stored acknowledgment shows the edited configuration and writes nothing', async () => {
    const scene = sceneOf({[CONFIG]: IMAGE}, {'devcontainer.json': 'old'});
    await scene.watch.activate(FOUND);
    deepStrictEqual(
      [scene.messages(), scene.shown[0]?.buttons, scene.writes],
      [[MESSAGE('devcontainer.json')], ['Rebuild', 'Ignore'], []],
    );
  });

  it('F-0303 BR-9: a created container drops the entry of a file that is no longer watched', async () => {
    const scene = sceneOf(
      {[CONFIG]: IMAGE},
      {'devcontainer.json': 'old', Gone: 'x'},
    );
    await scene.watch.activate(CREATED);
    deepStrictEqual(scene.hashes(), [['devcontainer.json', configHash(IMAGE)]]);
  });

  it('F-0303 AC-19: a missing configuration shows nothing and writes nothing, and the watch still runs', async () => {
    const scene = sceneOf({}, {'devcontainer.json': 'old'});
    await scene.watch.activate(FOUND);
    await scene.edit(IMAGE);
    deepStrictEqual(
      [scene.writes, scene.messages()],
      [[], [MESSAGE('devcontainer.json')]],
    );
  });

  it('F-0303 AC-4: a Dockerfile changed since its stored fingerprint is named at the activation', async () => {
    const scene = acknowledgedBuild();
    scene.change(DOCKERFILE, 'FROM b\n');
    await scene.watch.activate(FOUND);
    deepStrictEqual(scene.messages(), [MESSAGE('Dockerfile')]);
  });

  it('F-0303 BR-12: a missing Dockerfile is not diverged and its stored fingerprint stays', async () => {
    const scene = acknowledgedBuild();
    scene.change(DOCKERFILE, undefined);
    await scene.watch.activate(FOUND);
    deepStrictEqual(
      [scene.messages(), scene.writes, scene.hashes().length],
      [[], [], 2],
    );
  });

  it('F-0303 AC-1: an event for the configuration shows the notification after 500 ms, and not before', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    scene.change(CONFIG, '{"image":"b"}');
    scene.event('devcontainer.json');
    await scene.advance(499);
    const early = scene.messages();
    await scene.advance(1);
    deepStrictEqual(
      [early, scene.messages(), scene.shown[0]?.buttons],
      [[], [MESSAGE('devcontainer.json')], ['Rebuild', 'Ignore']],
    );
  });

  it('F-0303 AC-8: an event for another name does nothing, and an event with no name evaluates', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    scene.change(CONFIG, '{"image":"b"}');
    scene.event('README.md');
    await scene.advance(1000);
    const other = scene.messages();
    scene.event(undefined);
    await scene.advance(500);
    deepStrictEqual(
      [other, scene.messages()],
      [[], [MESSAGE('devcontainer.json')]],
    );
  });

  it('F-0303 BR-1: two events within 500 ms give one evaluation', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    scene.change(CONFIG, '{"image":"b"}');
    scene.event('devcontainer.json');
    await scene.advance(300);
    scene.event('devcontainer.json');
    await scene.advance(300);
    const early = scene.messages();
    await scene.advance(200);
    deepStrictEqual([early, scene.messages().length], [[], 1]);
  });

  it('F-0303 BR-1: a Dockerfile edited after the activation is not named live, and is named at the next activation', async () => {
    const scene = acknowledgedBuild();
    await scene.watch.activate(FOUND);
    scene.change(DOCKERFILE, 'FROM b\n');
    await scene.edit(`${BUILD} `);
    const live = scene.messages();
    scene.change(CONFIG, '{"build":{"dockerfile":"Dockerfile"},"name":"n"}');
    await scene.watch.activate(FOUND);
    deepStrictEqual(
      [live, scene.messages()],
      [[], [MESSAGE('Dockerfile, devcontainer.json')]],
    );
  });

  it('F-0303 AC-5: with the Dockerfile’s notification pending, a configuration change shows a second one naming both, beside the first', async () => {
    const scene = acknowledgedBuild();
    scene.change(DOCKERFILE, 'FROM b\n');
    await scene.watch.activate(FOUND);
    await scene.edit('{"build":{"dockerfile":"Dockerfile"},"name":"n"}');
    deepStrictEqual(scene.messages(), [
      MESSAGE('Dockerfile'),
      MESSAGE('Dockerfile, devcontainer.json'),
    ]);
  });

  it('F-0303 AC-7, AC-7b: the same combination again shows nothing in the activation, also after a dismissal, and the next activation shows it again', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    await scene.edit('{"image":"b"}');
    scene.event('devcontainer.json');
    await scene.advance(500);
    scene.shown[0]?.answer(undefined);
    await scene.settle();
    scene.event('devcontainer.json');
    await scene.advance(500);
    const sameActivation = scene.messages().length;
    await scene.watch.activate(FOUND);
    deepStrictEqual([sameActivation, scene.messages().length], [1, 2]);
  });

  it('F-0303 AC-14: a configuration that is not valid JSON is still told', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    await scene.edit('{"image": ');
    deepStrictEqual(scene.messages(), [MESSAGE('devcontainer.json')]);
  });

  it('F-0303 AC-3, AC-11: Ignore acknowledges the content the notification was computed from and leaves a file it does not name', async () => {
    const scene = acknowledgedBuild();
    await scene.watch.activate(FOUND);
    scene.change(DOCKERFILE, 'FROM b\n');
    const edited = '{"build":{"dockerfile":"Dockerfile"},"name":"n"}';
    await scene.edit(edited);
    scene.shown[0]?.answer('Ignore');
    await scene.settle();
    const after = scene.hashes();
    await scene.watch.activate(FOUND);
    deepStrictEqual(
      [
        after,
        scene.messages(),
        scene.sink.lines
          .map(line => line.message)
          .includes('acknowledged devcontainer.json'),
      ],
      [
        [
          ['devcontainer.json', configHash(edited)],
          ['Dockerfile', fileHash('FROM a\n')],
        ],
        [MESSAGE('devcontainer.json'), MESSAGE('Dockerfile')],
        true,
      ],
    );
  });

  it('F-0405 AC-9: after Ignore, a change back to the earlier content shows again', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    await scene.edit('{"image":"b"}');
    scene.shown[0]?.answer('Ignore');
    await scene.settle();
    await scene.edit(IMAGE);
    deepStrictEqual(scene.messages(), [
      MESSAGE('devcontainer.json'),
      MESSAGE('devcontainer.json'),
    ]);
  });

  it('F-0303 AC-2, AC-11: Rebuild calls the rebuild and writes nothing, and the connect that follows seeds every file', async () => {
    const scene = acknowledgedBuild();
    await scene.watch.activate(FOUND);
    await scene.edit('{"build":{"dockerfile":"Dockerfile"},"name":"n"}');
    scene.shown[0]?.answer('Rebuild');
    await scene.settle();
    const during = [scene.rebuilds, scene.writes.length];
    scene.change(DOCKERFILE, 'FROM c\n');
    await scene.watch.activate(CREATED);
    deepStrictEqual(
      [during, scene.messages().length, scene.hashes().map(([name]) => name)],
      [[1, 0], 1, ['devcontainer.json', 'Dockerfile']],
    );
  });

  it('F-0303 AC-13: a rebuild that fails changes nothing stored, and the failure is logged', async () => {
    const scene = acknowledgedImage();
    scene.rebuildFails = true;
    await scene.watch.activate(FOUND);
    await scene.edit('{"image":"b"}');
    scene.shown[0]?.answer('Rebuild');
    await scene.settle();
    deepStrictEqual(
      [
        scene.writes,
        scene.sink.lines
          .map(line => line.message)
          .includes('the rebuild failed: the build failed'),
      ],
      [[], true],
    );
  });

  it('F-0303 AC-13: a rebuild that fails with a text is logged as that text', async () => {
    const scene = acknowledgedImage();
    scene.rebuildFails = 'text';
    await scene.watch.activate(FOUND);
    await scene.edit('{"image":"b"}');
    scene.shown[0]?.answer('Rebuild');
    await scene.settle();
    deepStrictEqual(
      scene.sink.lines
        .map(line => line.message)
        .includes('the rebuild failed: no space'),
      true,
    );
  });

  it('F-0303 BR-9a: a configuration that appears while nothing is stored is told, and Ignore stores it', async () => {
    const scene = sceneOf({});
    await scene.watch.activate(FOUND);
    await scene.edit(IMAGE);
    scene.shown[0]?.answer('Ignore');
    await scene.settle();
    deepStrictEqual(
      [scene.messages(), scene.hashes()],
      [
        [MESSAGE('devcontainer.json')],
        [['devcontainer.json', configHash(IMAGE)]],
      ],
    );
  });

  it('F-0303 6.4: an answer that is neither button does nothing', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    await scene.edit('{"image":"b"}');
    scene.shown[0]?.answer('Other');
    await scene.settle();
    deepStrictEqual([scene.writes, scene.rebuilds], [[], 0]);
  });

  it('F-0303 BR-11, AC-16: naming another Dockerfile tells the old one, the new one and the configuration; the old entry goes when it is acted on', async () => {
    const scene = acknowledgedBuild();
    await scene.watch.activate(FOUND);
    const second = '{"build":{"dockerfile":"Dockerfile2"}}';
    scene.change(`${DOCKERFILE}2`, 'FROM z\n');
    await scene.edit(second);
    await scene.watch.activate(FOUND);
    scene.shown[1]?.answer('Ignore');
    await scene.settle();
    const entries = scene.hashes().map(([name]) => name);
    scene.change(DOCKERFILE, 'FROM changed\n');
    await scene.watch.activate(FOUND);
    deepStrictEqual(
      [scene.messages().slice(0, 2), entries, scene.messages().length],
      [
        [
          MESSAGE('Dockerfile, Dockerfile2, devcontainer.json'),
          MESSAGE('Dockerfile, Dockerfile2, devcontainer.json'),
        ],
        ['devcontainer.json', 'Dockerfile2'],
        2,
      ],
    );
  });

  it('F-0303 AC-17: a Dockerfile outside the folder is told by its written path, in code unit order', async () => {
    const scene = sceneOf(
      {[CONFIG]: '{"build":{"dockerfile":"../OutsideDockerfile"}}'},
      {'devcontainer.json': 'old'},
    );
    scene.change('/w/OutsideDockerfile', 'FROM a\n');
    await scene.watch.activate(FOUND);
    deepStrictEqual(scene.messages(), [
      MESSAGE('../OutsideDockerfile, devcontainer.json'),
    ]);
  });

  it('F-0303 AC-28: a root .devcontainer.json is told with its dot, before the Dockerfile', async () => {
    const scene = sceneOf(
      {
        '/w/.devcontainer.json': BUILD,
        '/w/Dockerfile': 'FROM a\n',
      },
      {'.devcontainer.json': 'old', Dockerfile: 'old'},
    );
    await scene.watch.activate({
      configFile: '/w/.devcontainer.json',
      created: false,
    });
    deepStrictEqual(scene.messages(), [
      MESSAGE('.devcontainer.json, Dockerfile'),
    ]);
  });

  it('F-0303 AC-19, AC-20: a deletion shows nothing, an identical recreation shows nothing, a different one shows', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    await scene.edit(undefined);
    await scene.edit(IMAGE);
    const identical = scene.messages();
    await scene.edit('{"image":"b"}');
    deepStrictEqual(
      [identical, scene.messages()],
      [[], [MESSAGE('devcontainer.json')]],
    );
  });

  it('F-0303 7.E5: with no watcher, a change is seen at the next 2 s tick, an unchanged tick evaluates nothing, and the log says so once', async () => {
    const scene = acknowledgedImage();
    scene.watching = false;
    await scene.watch.activate(FOUND);
    await scene.advance(2000);
    const unchanged = scene.messages();
    scene.change(CONFIG, '{"image":"b"}');
    await scene.advance(2000);
    const changed = scene.messages().length;
    await scene.advance(2000);
    deepStrictEqual(
      [
        unchanged,
        [changed, scene.messages().length],
        scene.sink.lines.filter(line =>
          line.message.includes("can't be watched"),
        ).length,
      ],
      [[], [1, 1], 1],
    );
  });

  it('F-0303 7.E5: a watcher that fails later switches to the poll, and a poll that finds the file missing shows nothing', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    scene.watches[0]?.failed();
    scene.change(CONFIG, undefined);
    await scene.advance(2000);
    const missing = scene.messages();
    scene.change(CONFIG, '{"image":"b"}');
    await scene.advance(2000);
    deepStrictEqual(
      [missing, scene.messages()],
      [[], [MESSAGE('devcontainer.json')]],
    );
  });

  it('F-0303 7.E2: a pause cancels a pending timer and the poll, and the next activation watches again', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    scene.change(CONFIG, '{"image":"b"}');
    scene.event('devcontainer.json');
    scene.watch.pause();
    await scene.advance(5000);
    const paused = scene.messages();
    scene.watches[0]?.failed();
    await scene.advance(5000);
    await scene.watch.activate(FOUND);
    deepStrictEqual(
      [paused, scene.watches[0]?.disposed, scene.messages().length],
      [[], true, 1],
    );
  });

  it('F-0303 7.E2: an evaluation queued behind a read that a pause overtakes does nothing, for the watch and for the poll', async () => {
    const scene = acknowledgedImage();
    const release = hold(scene);
    const activating = scene.watch.activate(FOUND);
    await scene.edit('{"image":"b"}');
    scene.watches[0]?.failed();
    await scene.advance(2000);
    scene.watch.pause();
    release();
    await activating;
    await scene.settle();
    deepStrictEqual([scene.messages(), scene.writes], [[], []]);
  });

  it('F-0303 7.E2: an evaluation whose read is overtaken by a pause shows nothing', async () => {
    const scene = acknowledgedImage();
    await scene.watch.activate(FOUND);
    scene.change(CONFIG, '{"image":"b"}');
    const release = hold(scene);
    scene.event('devcontainer.json');
    await scene.advance(500);
    scene.watch.pause();
    release();
    await scene.settle();
    deepStrictEqual(scene.messages(), []);
  });

  it('F-0303 7.E2: a dispose ends the watcher and the poll', async () => {
    const scene = acknowledgedImage();
    scene.watching = false;
    await scene.watch.activate(FOUND);
    scene.watch.dispose();
    scene.change(CONFIG, '{"image":"b"}');
    await scene.advance(10_000);
    deepStrictEqual(scene.messages(), []);
  });

  it('F-0303 BR-4: a failure of the evaluation is logged and the watch goes on', async () => {
    const broken = sceneOf({});
    await failingWatch(broken, new Error('no disk')).activate(FOUND);
    await failingWatch(broken, 'text').activate(FOUND);
    deepStrictEqual(
      broken.sink.lines
        .map(line => line.message)
        .filter(message =>
          message.startsWith('the configuration watch failed'),
        ),
      [
        'the configuration watch failed: no disk',
        'the configuration watch failed: text',
      ],
    );
  });

  it('F-0303 7.E3: a notification whose show is refused is forgotten and the watch goes on', async () => {
    const scene = acknowledgedImage();
    const refusing = configWatchOf({
      readFile: file =>
        Promise.resolve(file === CONFIG ? bytesOf('{"image":"b"}') : undefined),
      watchFolder: () => ({dispose: () => undefined}),
      setTimer: () => () => undefined,
      state:
        scene.stored === undefined
          ? {get: () => undefined, update: () => Promise.resolve()}
          : {
              get: () => scene.stored,
              update: () => Promise.resolve(),
            },
      show: () => Promise.reject(new Error('refused')),
      rebuild: () => Promise.resolve(),
      translate: template => template,
      logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
    });
    await refusing.activate(FOUND);
    await scene.settle();
    deepStrictEqual(
      scene.sink.lines.map(line => line.message),
      ['the configuration changed: devcontainer.json'],
    );
  });

  it('F-0303 §7: every text of the notification is a key of the default bundle', () => {
    const bundle = JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, '..', '..', 'l10n', 'bundle.l10n.json'),
        'utf8',
      ),
    ) as Record<string, string>;
    deepStrictEqual(
      Object.values(CONFIG_WATCH_TEMPLATES).filter(text => !(text in bundle)),
      [],
    );
  });
});
