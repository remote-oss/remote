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
const S427 =
  'Workspace contains a Dev Container configuration file. Reopen workspace to develop in a container ([learn more](https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md)).';
const FOLLOW_UP_WORKSPACE =
  "Don't show again for the current workspace or for any workspace?";
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
  configuration: 'none' | 'folder' | 'external';
  /** The kind of a root that differs from `configuration`, by path. */
  rootKinds: Record<string, 'none' | 'folder' | 'external'>;
  /** What each `show` answers, in order. */
  answers: Array<string | undefined>;
  shown: Array<[string, readonly string[]]>;
  reopened: number;
  asked: string[];
  /** The remote a folder can be cloned from, when the host offers a clone; none for a Linux host. */
  cloning?: {remote: string | undefined};
  cloned: string[];
  remoteAsked: string[];
  sink: MemorySink;
}

function sceneOf(): Scene {
  return {
    global: mementoOf(),
    workspace: mementoOf(),
    window: {
      remote: false,
      workspace: 'none',
      folders: [{scheme: 'file', fsPath: '/w/p'}],
    },
    configuration: 'folder',
    rootKinds: {},
    answers: [],
    shown: [],
    reopened: 0,
    asked: [],
    cloned: [],
    remoteAsked: [],
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
      ...(scene.cloning === undefined
        ? {}
        : {
            cloning: {
              remoteOf: folder => {
                scene.remoteAsked.push(folder);
                return Promise.resolve(scene.cloning?.remote);
              },
              start: remote => {
                scene.cloned.push(remote);
                return Promise.resolve();
              },
            },
          }),
      configurationKind: folder => {
        scene.asked.push(folder);
        return Promise.resolve(scene.rootKinds[folder] ?? scene.configuration);
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

const S427_S368 =
  'There is a [Dev Container configuration](command:remote-containers.openDevContainerFile) available for this repository. Reopen workspace to develop in a container ([learn more](https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md)).';

describe('the reopen notification (card containers-23, F-0402)', () => {
  it('F-0402 AC-1: a local folder with a configuration shows S426 with S186 and the two buttons', async () => {
    const scene = sceneOf();
    await offered(scene);
    deepStrictEqual(scene.shown, [[S426, [REOPEN, SUPPRESS]]]);
  });

  it('F-0708 6.4: a Git folder with a remote on a host that is not Linux has the clone sentence and the Clone in Volume button, and the button starts the clone of that remote', async () => {
    const scene = sceneOf();
    scene.cloning = {remote: 'https://example.com/a/b.git'};
    scene.answers = ['Clone in Volume'];
    await offered(scene);
    deepStrictEqual(
      [scene.shown, scene.remoteAsked, scene.cloned, scene.reopened],
      [
        [
          [
            `${S426} Or: Clone repository in Docker volume for [better I/O performance](https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md#mount-performance-and-container-volumes).`,
            [REOPEN, 'Clone in Volume', SUPPRESS],
          ],
        ],
        ['/w/p'],
        ['https://example.com/a/b.git'],
        0,
      ],
    );
  });

  it('F-0708 6.4: no remote, a Linux host, or a window with a workspace file shows the plain notification and asks for no remote where it must not', async () => {
    const withoutRemote = sceneOf();
    withoutRemote.cloning = {remote: undefined};
    await offered(withoutRemote);
    const linux = sceneOf();
    await offered(linux);
    const saved = sceneOf();
    saved.window = {...saved.window, workspace: 'saved'};
    saved.cloning = {remote: 'https://example.com/a/b.git'};
    await offered(saved);
    deepStrictEqual(
      [
        withoutRemote.shown,
        linux.shown,
        saved.shown.map(each => each[1]),
        saved.remoteAsked,
      ],
      [
        [[S426, [REOPEN, SUPPRESS]]],
        [[S426, [REOPEN, SUPPRESS]]],
        [[REOPEN, SUPPRESS]],
        [],
      ],
    );
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
    scene.configuration = 'external';
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
      workspace: 'none',
      folders: [{scheme: 'vscode-remote', fsPath: '/workspaces/p'}],
    };
    await offered(scene, 1000, 'folder');
    deepStrictEqual([scene.shown, scene.asked], [[], []]);
  });

  it('brief: two folders in a window with no workspace file, no folder, a folder that is not a file one, a root of another scheme and an untitled workspace of one folder show nothing', async () => {
    const windows: Array<ReopenNotificationPorts['window']> = [
      {
        remote: false,
        workspace: 'none',
        folders: [
          {scheme: 'file', fsPath: '/w/p'},
          {scheme: 'file', fsPath: '/w/q'},
        ],
      },
      {remote: false, workspace: 'none', folders: []},
      {
        remote: false,
        workspace: 'none',
        folders: [{scheme: 'memfs', fsPath: '/m'}],
      },
      {
        remote: false,
        workspace: 'saved',
        folders: [
          {scheme: 'file', fsPath: '/w/p'},
          {scheme: 'memfs', fsPath: '/m'},
        ],
      },
      {
        remote: false,
        workspace: 'untitled',
        folders: [{scheme: 'file', fsPath: '/w/p'}],
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
      [0, 0],
    ]);
  });

  /** A scene of a window with a workspace of the given kind and roots `/w/p`, `/w/q`, as many as `count`. */
  function workspaceScene(
    workspace: 'saved' | 'untitled',
    count: number,
  ): Scene {
    const scene = sceneOf();
    scene.window = {
      remote: false,
      workspace,
      folders: ['/w/p', '/w/q']
        .slice(0, count)
        .map(fsPath => ({scheme: 'file', fsPath})),
    };
    return scene;
  }

  it('F-0402 6.2, BR-1: a saved workspace, of one root or of two, with a root that has a configuration shows S427 with S405 and the two buttons', async () => {
    const seen = [];
    for (const count of [1, 2]) {
      const scene = workspaceScene('saved', count);
      scene.configuration = 'none';
      scene.rootKinds = {'/w/p': 'folder'};
      await offered(scene);
      seen.push([scene.shown, scene.asked]);
    }
    const expected = [[[S427, [REOPEN, SUPPRESS]]]];
    deepStrictEqual(seen, [
      [expected[0], ['/w/p']],
      [expected[0], ['/w/p', '/w/q']],
    ]);
  });

  it('F-0402 BR-1: a saved workspace whose only configuration is a stored one shows S427 with S368', async () => {
    const scene = workspaceScene('saved', 2);
    scene.configuration = 'none';
    scene.rootKinds = {'/w/q': 'external'};
    await offered(scene);
    deepStrictEqual(scene.shown, [[S427_S368, [REOPEN, SUPPRESS]]]);
  });

  it('F-0301 6.5 step 4: a saved workspace with no root that has a configuration shows nothing, whatever sits beside its file', async () => {
    const scene = workspaceScene('saved', 2);
    scene.configuration = 'none';
    await offered(scene);
    deepStrictEqual([scene.shown, lines(scene)], [[], []]);
  });

  it('F-0402 6.2: in a saved workspace Don’t Show Again... asks S152, Any Workspace writes the global slot and Current Workspace the workspace state', async () => {
    const global = workspaceScene('saved', 2);
    global.answers = [SUPPRESS, 'Any Workspace'];
    const current = workspaceScene('saved', 2);
    current.answers = [SUPPRESS, 'Current Workspace'];
    for (const scene of [global, current]) {
      await offered(scene);
    }
    deepStrictEqual(
      [global, current].map(scene => [
        scene.shown.map(([message, buttons]) => [message, buttons]).at(-1),
        scene.global.writes,
        scene.workspace.writes,
        lines(scene),
      ]),
      [
        [
          [FOLLOW_UP_WORKSPACE, ['Any Workspace', 'Current Workspace']],
          [[REOPEN_NOTIFICATION_KEY, {suppressedAt: 1000}]],
          [],
          ['info: the reopen notification: suppressed for any workspace'],
        ],
        [
          [FOLLOW_UP_WORKSPACE, ['Any Workspace', 'Current Workspace']],
          [],
          [[REOPEN_NOTIFICATION_KEY, {suppressedAt: 1000}]],
          ['info: the reopen notification: suppressed for this workspace'],
        ],
      ],
    );
  });

  it('F-0402 6.5 steps 2 and 3: an untitled workspace with one root of two that has a configuration shows S426 with S368, never S186 or the workspace wording', async () => {
    const scene = workspaceScene('untitled', 2);
    scene.configuration = 'none';
    scene.rootKinds = {'/w/q': 'folder'};
    await offered(scene);
    deepStrictEqual(
      [scene.shown, scene.asked],
      [[[S368, [REOPEN, SUPPRESS]]], ['/w/p', '/w/q']],
    );
  });

  it('F-0402 6.5 step 8: an untitled workspace with no root that has a configuration shows nothing', async () => {
    const scene = workspaceScene('untitled', 2);
    scene.configuration = 'none';
    await offered(scene);
    deepStrictEqual(scene.shown, []);
  });

  it('F-0402 6.5 steps 5 and 6: in an untitled workspace Don’t Show Again... asks S151, Any Folder writes the global slot and Current Folder the workspace state', async () => {
    const global = workspaceScene('untitled', 2);
    global.answers = [SUPPRESS, 'Any Folder'];
    const current = workspaceScene('untitled', 2);
    current.answers = [SUPPRESS, 'Current Folder'];
    for (const scene of [global, current]) {
      await offered(scene);
    }
    deepStrictEqual(
      [global, current].map(scene => [
        scene.shown.at(-1),
        scene.global.writes,
        scene.workspace.writes,
      ]),
      [
        [
          [FOLLOW_UP, ['Any Folder', 'Current Folder']],
          [[REOPEN_NOTIFICATION_KEY, {suppressedAt: 1000}]],
          [],
        ],
        [
          [FOLLOW_UP, ['Any Folder', 'Current Folder']],
          [],
          [[REOPEN_NOTIFICATION_KEY, {suppressedAt: 1000}]],
        ],
      ],
    );
  });

  it('F-0402 BR-15: a saved or untitled workspace is suppressed by its own state or by the global slot, and by nothing else', async () => {
    const seen = [];
    for (const workspace of ['saved', 'untitled'] as const) {
      const byWorkspace = workspaceScene(workspace, 2);
      byWorkspace.workspace = mementoOf({suppressedAt: 10});
      const byGlobal = workspaceScene(workspace, 2);
      byGlobal.global = mementoOf({suppressedAt: 10});
      const neither = workspaceScene(workspace, 2);
      for (const scene of [byWorkspace, byGlobal, neither]) {
        await offered(scene);
      }
      seen.push(
        [byWorkspace, byGlobal, neither].map(scene => scene.shown.length),
      );
    }
    deepStrictEqual(seen, [
      [0, 0, 1],
      [0, 0, 1],
    ]);
  });

  it('F-0302 AC-5: the user data variant is for a window with one folder: a workspace window gets nothing from it', async () => {
    const scene = workspaceScene('saved', 1);
    await offered(scene, 1000, 'userData');
    deepStrictEqual([scene.shown, scene.asked], [[], []]);
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
