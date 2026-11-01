import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  isSuppressed,
  type NotificationVariant,
  offerReopen,
  REOPEN_NOTIFICATION_KEY,
  type ReopenNotificationPorts,
  resetReopenNotification,
} from '../../src/open/reopen-notification.ts';

const S426 =
  'Folder contains a Dev Container configuration file. Reopen folder to develop in a container ([learn more](https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md)).';
const REOPEN = 'Reopen in Container';
const SUPPRESS = "Don't Show Again...";
const FOLLOW_UP = "Don't show again for the current folder or for any folder?";

/** A memento that records its writes. */
interface RecordingMemento {
  stored: unknown;
  writes: unknown[];
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

function mementoOf(stored?: unknown): RecordingMemento {
  const memento: RecordingMemento = {
    stored,
    writes: [],
    get: key => (key === REOPEN_NOTIFICATION_KEY ? memento.stored : undefined),
    update: (key, value) => {
      memento.writes.push([key, value]);
      memento.stored = value;
      return Promise.resolve();
    },
  };
  return memento;
}

/** What a row steers, and what the fakes recorded. */
interface Scene {
  global: RecordingMemento;
  workspace: RecordingMemento;
  window: ReopenNotificationPorts['window'];
  configuration: 'none' | 'folder' | 'stored';
  /** What each `show` answers, in order. */
  answers: Array<string | undefined>;
  shown: Array<[string, readonly string[]]>;
  reopened: number;
  asked: string[];
  sink: MemorySink;
}

function sceneOf(): Scene {
  return {
    global: mementoOf(),
    workspace: mementoOf(),
    window: {
      remote: false,
      workspaceFile: false,
      folders: [{scheme: 'file', fsPath: '/w/p'}],
    },
    configuration: 'folder',
    answers: [],
    shown: [],
    reopened: 0,
    asked: [],
    sink: new MemorySink(),
  };
}

async function offered(
  scene: Scene,
  now = 1000,
  variant?: NotificationVariant,
): Promise<void> {
  await offerReopen(
    {
      window: scene.window,
      global: scene.global,
      workspace: scene.workspace,
      configurationKind: folder => {
        scene.asked.push(folder);
        return Promise.resolve(scene.configuration);
      },
      show: (message, buttons) => {
        scene.shown.push([message, buttons]);
        return Promise.resolve(scene.answers.shift());
      },
      reopen: () => {
        scene.reopened += 1;
        return Promise.resolve();
      },
      now: () => now,
      translate: template => template,
      logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
    },
    variant,
  );
}

function lines(scene: Scene): string[] {
  return scene.sink.lines.map(line => `${line.level}: ${line.message}`);
}

const S368 =
  'There is a [Dev Container configuration](command:remote-containers.openDevContainerFile) available for this repository. Reopen folder to develop in a container ([learn more](https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md)).';

describe('the reopen notification (card containers-23, F-0402)', () => {
  it('F-0402 AC-1: a local folder with a configuration shows S426 with S186 and the two buttons', async () => {
    const scene = sceneOf();
    await offered(scene);
    deepStrictEqual(scene.shown, [[S426, [REOPEN, SUPPRESS]]]);
  });

  it('F-0302 AC-5: the user data variant shows S368 with the same buttons, without asking the folder for a configuration', async () => {
    const scene = sceneOf();
    scene.configuration = 'none';
    await offered(scene, 1000, 'userData');
    deepStrictEqual(
      [scene.shown, scene.asked],
      [[[S368, [REOPEN, SUPPRESS]]], []],
    );
  });

  it('F-0302 BR-4: a folder with a stored configuration shows the S368 variant, whether or not its own files hold one too', async () => {
    const scene = sceneOf();
    scene.configuration = 'stored';
    await offered(scene);
    deepStrictEqual(
      [scene.shown, scene.asked],
      [[[S368, [REOPEN, SUPPRESS]]], ['/w/p']],
    );
  });

  it('F-0302 AC-5: the user data variant is suppressed like the folder one', async () => {
    const scene = sceneOf();
    scene.workspace = mementoOf({suppressedAt: 500});
    await offered(scene, 1000, 'userData');
    deepStrictEqual(scene.shown, []);
  });

  it('F-0402 AC-2: Reopen in Container runs the reopen command and stores nothing', async () => {
    const scene = sceneOf();
    scene.answers = [REOPEN];
    await offered(scene);
    deepStrictEqual(
      [scene.reopened, scene.global.writes, scene.workspace.writes],
      [1, [], []],
    );
  });

  it('F-0402 AC-3: Don’t Show Again... shows the follow-up', async () => {
    const scene = sceneOf();
    scene.answers = [SUPPRESS];
    await offered(scene);
    deepStrictEqual(scene.shown[1], [
      FOLLOW_UP,
      ['Any Folder', 'Current Folder'],
    ]);
  });

  it('F-0402 AC-4: Current Folder stores the time in the workspace state', async () => {
    const scene = sceneOf();
    scene.answers = [SUPPRESS, 'Current Folder'];
    await offered(scene);
    deepStrictEqual(
      [scene.workspace.writes, scene.global.writes],
      [[[REOPEN_NOTIFICATION_KEY, {suppressedAt: 1000}]], []],
    );
  });

  it('F-0402 AC-5: Any Folder stores the time in the global state and keeps the reset time', async () => {
    const scene = sceneOf();
    scene.global = mementoOf({resetAt: 5});
    scene.answers = [SUPPRESS, 'Any Folder'];
    await offered(scene);
    deepStrictEqual(scene.global.writes, [
      [REOPEN_NOTIFICATION_KEY, {resetAt: 5, suppressedAt: 1000}],
    ]);
  });

  it('F-0402 AC-12: a dismissed notification or follow-up stores nothing', async () => {
    const dismissed = sceneOf();
    await offered(dismissed);
    const followUp = sceneOf();
    followUp.answers = [SUPPRESS, undefined];
    await offered(followUp);
    deepStrictEqual(
      [dismissed, followUp].map(scene => [
        scene.global.writes,
        scene.workspace.writes,
      ]),
      [
        [[], []],
        [[], []],
      ],
    );
  });

  it('F-0402 7.E2: a suppressed window shows nothing, by the workspace or by the global state', async () => {
    const byWorkspace = sceneOf();
    byWorkspace.workspace = mementoOf({suppressedAt: 10});
    const byGlobal = sceneOf();
    byGlobal.global = mementoOf({suppressedAt: 10});
    await offered(byWorkspace);
    await offered(byGlobal);
    deepStrictEqual([byWorkspace.shown, byGlobal.shown], [[], []]);
  });

  it('F-0402 BR-6: a reset newer than the suppression shows it again, and a suppression after the reset suppresses again', async () => {
    const reset = sceneOf();
    reset.global = mementoOf({suppressedAt: 10, resetAt: 20});
    reset.workspace = mementoOf({suppressedAt: 15});
    const again = sceneOf();
    again.global = mementoOf({resetAt: 20});
    again.workspace = mementoOf({suppressedAt: 30});
    await offered(reset);
    await offered(again);
    deepStrictEqual([reset.shown.length, again.shown.length], [1, 0]);
  });

  it('F-0402 BR-6: equal times do not suppress', () => {
    deepStrictEqual(
      isSuppressed({suppressedAt: 20, resetAt: 20}, undefined),
      false,
    );
  });

  it('F-0402 BR-6: a stored value that is not an object, or a field that is not a finite number, counts as absent', () => {
    deepStrictEqual(
      [
        isSuppressed('x', undefined),
        isSuppressed(undefined, {suppressedAt: 'soon'}),
        isSuppressed({suppressedAt: Number.NaN}, undefined),
        isSuppressed(null, null),
        isSuppressed({suppressedAt: Infinity}, undefined),
      ],
      [false, false, false, false, false],
    );
  });

  it('F-0402 7.E1: a folder without a configuration shows nothing and logs nothing', async () => {
    const scene = sceneOf();
    scene.configuration = 'none';
    await offered(scene);
    deepStrictEqual(
      [scene.shown, lines(scene), scene.asked],
      [[], [], ['/w/p']],
    );
  });

  it('F-0402 AC-13: a remote window shows nothing, and the configuration is not looked for', async () => {
    const scene = sceneOf();
    scene.window = {...scene.window, remote: true};
    await offered(scene);
    deepStrictEqual([scene.shown, scene.asked], [[], []]);
  });

  it('F-0801 AC-14: in a dev container window a configuration written to the workspace is not offered for reopening', async () => {
    const scene = sceneOf();
    scene.window = {
      remote: true,
      workspaceFile: false,
      folders: [{scheme: 'vscode-remote', fsPath: '/workspaces/p'}],
    };
    await offered(scene, 1000, 'folder');
    deepStrictEqual([scene.shown, scene.asked], [[], []]);
  });

  it('brief: a .code-workspace, two folders, no folder and a folder that is not a file one show nothing', async () => {
    const windows: Array<ReopenNotificationPorts['window']> = [
      {
        remote: false,
        workspaceFile: true,
        folders: [{scheme: 'file', fsPath: '/w/p'}],
      },
      {
        remote: false,
        workspaceFile: false,
        folders: [
          {scheme: 'file', fsPath: '/w/p'},
          {scheme: 'file', fsPath: '/w/q'},
        ],
      },
      {remote: false, workspaceFile: false, folders: []},
      {
        remote: false,
        workspaceFile: false,
        folders: [{scheme: 'memfs', fsPath: '/m'}],
      },
    ];
    const seen = [];
    for (const window of windows) {
      const scene = sceneOf();
      scene.window = window;
      await offered(scene);
      seen.push([scene.shown.length, scene.asked.length]);
    }
    deepStrictEqual(seen, [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it('F-0402 AC-11: trust is not read: the module has no trust port, and a window shows the notification', async () => {
    const scene = sceneOf();
    await offered(scene);
    deepStrictEqual(scene.shown.length, 1);
  });

  it('F-0402 AC-8: the reset writes a newer reset time and deletes nothing, and over a malformed value it starts a fresh object', async () => {
    const kept = mementoOf({suppressedAt: 10});
    await resetReopenNotification(kept, 50);
    const malformed = mementoOf(7);
    await resetReopenNotification(malformed, 50);
    deepStrictEqual(
      [kept.stored, malformed.stored],
      [{suppressedAt: 10, resetAt: 50}, {resetAt: 50}],
    );
  });

  it('F-0402 AC-14: each chosen outcome logs one line, and nothing else logs', async () => {
    const reopen = sceneOf();
    reopen.answers = [REOPEN];
    const anyFolder = sceneOf();
    anyFolder.answers = [SUPPRESS, 'Any Folder'];
    const currentFolder = sceneOf();
    currentFolder.answers = [SUPPRESS, 'Current Folder'];
    const dismissed = sceneOf();
    for (const scene of [reopen, anyFolder, currentFolder, dismissed]) {
      await offered(scene);
    }
    deepStrictEqual([reopen, anyFolder, currentFolder, dismissed].map(lines), [
      ['info: the reopen notification: reopen'],
      ['info: the reopen notification: suppressed for any folder'],
      ['info: the reopen notification: suppressed for this folder'],
      [],
    ]);
  });
});
