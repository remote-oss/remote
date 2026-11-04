import {deepStrictEqual} from 'node:assert';
import {devContainerTargetOf} from '../../src/authority/payload.ts';
import {reopenHandlersOf} from '../../src/open/reopen.ts';
import {
  REBUILD_INTENTS_KEY,
  type RebuildOptions,
} from '../../src/open/rebuild-intent.ts';
import type {ReopenPorts} from '../../src/open/reopen-ports.ts';
import {pendingOf, settled} from './pending.ts';
import {
  CONFIG,
  CONFIGURATION,
  linesOf,
  portsOf,
  setup,
  START,
  type Setup,
  WRITTEN_IN_FOLDER,
} from './reopen.fixture.ts';

/** The target the first open went to. */
function openedTarget(state: Setup): ReturnType<typeof devContainerTargetOf> {
  const {authority} = state.commands[0]?.parameters[0] as {authority: string};
  return devContainerTargetOf(authority.slice('dev-container+'.length));
}

/** The handler of the command, or of its rebuild variant. */
function handlerOf(
  ports: ReopenPorts,
  rebuild?: RebuildOptions,
): () => Promise<void> {
  return reopenHandlersOf(ports)(rebuild);
}

/** Runs the command once, or its rebuild variant. */
async function reopened(state: Setup, rebuild?: RebuildOptions) {
  const {ports, sink} = portsOf(state);
  await handlerOf(ports, rebuild)();
  await settled();
  return {lines: linesOf(sink)};
}

/** Runs the command with the progress shown while the first check waits, and gives the order of what followed. */
async function reopenedSlowly(state: Setup): Promise<string[]> {
  const release = pendingOf<undefined>();
  state.waitOnCheck = release.promise;
  const {ports} = portsOf(state);
  const running = handlerOf(ports)();
  await settled();
  state.timers[0]?.callback();
  release.resolve(undefined);
  await running;
  await settled();
  return state.order;
}

/**
 * Calls the command, calls it again while the first call is held on `hold`, lets the first end, and calls it a third
 * time; gives the calls the ports saw while the first was held, and the log.
 */
async function reentered(
  state: Setup,
  hold: 'waitOnRead',
  rebuild?: RebuildOptions,
): Promise<{during: string[]; lines: string[]}> {
  const release = pendingOf<undefined>();
  state[hold] = release.promise;
  const {ports, sink} = portsOf(state);
  const handler = handlerOf(ports, rebuild);
  const first = handler();
  await handler();
  await settled();
  const during = [...state.calls];
  release.resolve(undefined);
  await first;
  await handler();
  return {during, lines: linesOf(sink)};
}

/** The lines the log holds around the configuration's reading before a reload. */
const READING = [
  'info: Reading configuration',
  'info: Reading configuration: 0 ms',
];

/** The host path the dev-container authority of the first open command names. */
function hostPathOpened(state: Setup): string | undefined {
  const authority = (state.commands[0]?.parameters[0] as {authority: string})
    .authority;
  const target = devContainerTargetOf(authority.slice('dev-container+'.length));
  return 'hostPath' in target ? target.hostPath : undefined;
}

describe('Reopen in Container', () => {
  it('F-0401 BR-1: a local window reloads on the dev-container authority of its folder, in the order of the flow', async () => {
    const state = setup();
    await reopened(state);
    const authority = (
      state.commands[0]?.parameters[0] as {authority: string; path: string}
    ).authority;
    const target = devContainerTargetOf(
      authority.slice('dev-container+'.length),
    );
    deepStrictEqual(
      [
        state.calls,
        state.commands.map(each => each.command),
        authority.startsWith('dev-container+'),
        (state.commands[0]?.parameters[0] as {path: string}).path,
        state.commands[0]?.parameters[1],
        'hostPath' in target ? target.hostPath : target,
        'localDocker' in target ? target.localDocker : target,
        state.targets,
      ],
      [
        [
          'ensureTrusted',
          'firstCheck /w/p',
          'readConfiguration /w/p',
          'pinnedEngine',
        ],
        ['vscode.openFolder'],
        true,
        '/workspaces/p',
        {forceNewWindow: false, forceReuseWindow: true},
        '/w/p',
        false,
        [
          {
            workspaceFolder: '/w/p',
            configFile: CONFIG,
            dockerPath: 'docker',
            idLabels: [],
            mountWorkspaceGitRoot: true,
            mountGitWorktreeCommonDir: false,
            features: {defaultFeatures: {}, lockfile: true},
            mounts: [],
            logLevel: 'info',
          },
        ],
      ],
    );
  });

  it('F-0417 BR-9: the window tells the shutdown helper that it leaves, once and just before the reload; a flow that stops before the reload tells nothing', async () => {
    const reloaded = setup();
    await reopened(reloaded);
    await settled();
    const stopped = setup();
    stopped.check = 'stopped';
    await reopened(stopped);
    deepStrictEqual(
      [
        [reloaded.left, reloaded.order.filter(step => step !== 'store')],
        [stopped.left, stopped.commands.length],
      ],
      [
        [1, ['leave', 'open']],
        [0, 0],
      ],
    );
  });

  it('F-0411 AC-35, AC-37: the worktree setting, as the boolean or as the string, reaches the read the window\u2019s folder comes from', async () => {
    const reads: unknown[] = [];
    for (const value of [undefined, true, 'true', 'false']) {
      const state = setup();
      state.mountGitWorktreeCommonDir = value;
      await reopened(state);
      reads.push(
        state.targets.map(
          target =>
            (target as {mountGitWorktreeCommonDir: boolean})
              .mountGitWorktreeCommonDir,
        ),
      );
    }
    deepStrictEqual(reads, [[false], [true], [true], [false]]);
  });

  it('F-0501 BR-2a: a Docker context other than the default is in the payload', async () => {
    const state = setup();
    state.context = 'ctx1';
    await reopened(state);
    const target = openedTarget(state);
    deepStrictEqual('context' in target ? target.context : target, 'ctx1');
  });

  it('F-0401 6.5: a saved workspace, of one root or of two, reopens on the configuration beside its file, mounted from that folder, at the workspace file inside the mount', async () => {
    const seen = [];
    for (const roots of [1, 2]) {
      const state = setup();
      state.workspaceFile = {
        scheme: 'file',
        fsPath: '/w/p/team.code-workspace',
      };
      state.folders = ['/w/p/a', '/w/p/b']
        .slice(0, roots)
        .map(fsPath => ({scheme: 'file', fsPath}));
      await reopened(state);
      seen.push([
        state.calls,
        state.commands.map(each => each.command),
        (state.commands[0]?.parameters[0] as {path: string}).path,
        hostPathOpened(state),
        state.modals,
      ]);
    }
    const expected = [
      [
        'ensureTrusted',
        'firstCheck /w/p',
        'readConfiguration /w/p',
        'pinnedEngine',
      ],
      ['vscode.openFolder'],
      '/workspaces/p/team.code-workspace',
      '/w/p',
      [],
    ];
    deepStrictEqual(seen, [expected, expected]);
  });

  it('F-0401 6.5: the folder of a workspace file in a subfolder is that subfolder, and its configuration is the one found there', async () => {
    const state = setup();
    state.workspaceFile = {
      scheme: 'file',
      fsPath: '/w/p/ws/team.code-workspace',
    };
    state.folders = [{scheme: 'file', fsPath: '/w/p/ws/a'}];
    state.existing = ['/w/p/ws/.devcontainer/devcontainer.json'];
    state.read = {...CONFIGURATION, workspaceFolder: '/workspaces/ws'};
    await reopened(state);
    deepStrictEqual(
      [state.calls, (state.commands[0]?.parameters[0] as {path: string}).path],
      [
        [
          'ensureTrusted',
          'firstCheck /w/p/ws',
          'readConfiguration /w/p/ws',
          'pinnedEngine',
        ],
        '/workspaces/ws/team.code-workspace',
      ],
    );
  });

  it('F-0301 AC-22, F-0106 AC-44: the configurations of the roots are not consulted: roots that have one and a workspace folder that has none give the wizard', async () => {
    const state = setup();
    state.workspaceFile = {scheme: 'file', fsPath: '/w/p/team.code-workspace'};
    state.folders = [
      {scheme: 'file', fsPath: '/w/p/a'},
      {scheme: 'file', fsPath: '/w/p/b'},
    ];
    state.existing = [
      '/w/p/a/.devcontainer/devcontainer.json',
      '/w/p/b/.devcontainer/devcontainer.json',
    ];
    await reopened(state);
    deepStrictEqual(
      [state.calls, state.commands],
      [['ensureTrusted', 'firstCheck /w/p', 'wizard /w/p'], []],
    );
  });

  it('F-0301 5.0 step 4: two configurations beside the workspace file show the picker, and the one picked is what the workspace reloads on', async () => {
    const state = setup();
    state.workspaceFile = {scheme: 'file', fsPath: '/w/p/team.code-workspace'};
    state.folders = [{scheme: 'file', fsPath: '/w/p/a'}];
    state.existing = [CONFIG, '/w/p/.devcontainer/other/devcontainer.json'];
    state.pick = {kind: 'picked', index: 1};
    await reopened(state);
    deepStrictEqual(
      [
        state.shown,
        state.targets.map(each => (each as {configFile: string}).configFile),
        (state.commands[0]?.parameters[0] as {path: string}).path,
      ],
      [
        ['pick 2'],
        ['/w/p/.devcontainer/other/devcontainer.json'],
        '/workspaces/p/team.code-workspace',
      ],
    );
  });

  /** The outcome of Reopen in Container in a saved workspace whose file reads as `text`, the user answering `proceed`. */
  async function savedWorkspaceReopened(text: string, proceed: boolean) {
    const state = setup();
    state.workspaceFile = {scheme: 'file', fsPath: '/w/p/team.code-workspace'};
    state.folders = [{scheme: 'file', fsPath: '/w/p/a'}];
    state.workspaceRead = {kind: 'text', text};
    state.continueAnswer = proceed;
    await reopened(state);
    return {
      confirms: state.confirms,
      opened: state.commands.map(each => each.command),
      checked: state.calls.includes('firstCheck /w/p'),
    };
  }

  it('F-0404 7.E2, 7.E1: a saved workspace with a folder list that has a problem shows S363 with the first one, and Cancel stops before the engine check and the open', async () => {
    deepStrictEqual(
      await savedWorkspaceReopened(
        '{"folders": [{"path": "/abs/folder"}, {"path": "../sibling"}]}',
        false,
      ),
      {
        confirms: [
          "The workspace could fail to open in a container: Workspace contains an absolute folder path '/abs/folder'.",
        ],
        opened: [],
        checked: false,
      },
    );
  });

  it('F-0404 7.E1: Continue goes on as if the list had no problem: the engine is checked and the workspace is opened', async () => {
    deepStrictEqual(
      await savedWorkspaceReopened(
        '{"folders": [{"path": "../sibling"}]}',
        true,
      ),
      {
        confirms: [
          "The workspace could fail to open in a container: Folder '/w/sibling' is not a subfolder of shared root folder '/w/p'.",
        ],
        opened: ['vscode.openFolder'],
        checked: true,
      },
    );
  });

  it('F-0404 BR-3: a valid folder list shows no dialog', async () => {
    deepStrictEqual(
      await savedWorkspaceReopened(
        '{"folders": [{"path": "."}, {"path": "sub"}]}',
        false,
      ),
      {confirms: [], opened: ['vscode.openFolder'], checked: true},
    );
  });

  it('F-0401 6.5 step 1, 7.E3: an unsaved workspace shows S415 in a modal and the command stops there: no trust request, no check, no open', async () => {
    const state = setup();
    state.workspaceFile = {scheme: 'untitled', fsPath: '/Untitled-1'};
    state.folders = [
      {scheme: 'file', fsPath: '/w/p/a'},
      {scheme: 'file', fsPath: '/w/p/b'},
    ];
    const {lines} = await reopened(state);
    deepStrictEqual(
      [state.modals, state.calls, state.commands, lines],
      [
        [
          'You need to first save your workspace in a folder containing all its workspace folders.',
        ],
        [],
        [],
        [],
      ],
    );
  });

  it('F-0405 AC-35: a saved or an unsaved workspace with a root that is not a local folder does nothing and shows nothing', async () => {
    const seen = [];
    for (const workspaceFile of [
      {scheme: 'file', fsPath: '/w/p/team.code-workspace'},
      {scheme: 'untitled', fsPath: '/Untitled-1'},
    ]) {
      const state = setup();
      state.workspaceFile = workspaceFile;
      state.folders = [{scheme: 'memfs', fsPath: '/'}];
      const {lines} = await reopened(state);
      seen.push([state.modals, state.calls, state.commands, lines]);
    }
    const nothing = [
      [],
      [],
      [],
      ['info: Reopen in Container does nothing in this window'],
    ];
    deepStrictEqual(seen, [nothing, nothing]);
  });

  it('F-0401 6.5: a remote window with a workspace file does nothing and shows nothing', async () => {
    const state = setup();
    state.remoteName = 'dev-container';
    state.workspaceFile = {scheme: 'file', fsPath: '/w/p/team.code-workspace'};
    const {lines} = await reopened(state);
    deepStrictEqual(
      [state.modals, state.calls, state.commands, lines],
      [[], [], [], ['info: Reopen in Container does nothing in this window']],
    );
  });

  it('F-0401 AC-23: a remote window, a window without a folder, a window with two folders and a folder of another scheme do nothing and open nothing', async () => {
    const changes: Array<(state: Setup) => void> = [
      state => {
        state.remoteName = 'dev-container';
      },
      state => {
        state.remoteName = 'ssh-remote';
      },
      state => {
        state.folders = [];
      },
      state => {
        state.folders = [
          {scheme: 'file', fsPath: '/a'},
          {scheme: 'file', fsPath: '/b'},
        ];
      },
      state => {
        state.folders = [{scheme: 'memfs', fsPath: '/m'}];
      },
    ];
    const seen = [];
    for (const change of changes) {
      const state = setup();
      change(state);
      const {lines} = await reopened(state);
      seen.push([state.calls, state.commands, lines]);
    }
    deepStrictEqual(
      seen,
      changes.map(() => [
        [],
        [],
        ['info: Reopen in Container does nothing in this window'],
      ]),
    );
  });

  it('F-0101 AC-15: without resolvers or without workspaceTrust, Reopen calls nothing but setupAgain, and the window stays as it is (BR-9)', async () => {
    const seen = [];
    for (const proposal of ['resolvers', 'workspaceTrust']) {
      const state = setup();
      state.missing = [proposal];
      state.missingAfter = [proposal];
      const {lines} = await reopened(state);
      seen.push([state.calls, state.commands, lines]);
    }
    deepStrictEqual(
      seen,
      ['resolvers', 'workspaceTrust'].map(proposal => [
        ['setupAgain'],
        [],
        [
          `info: Reopen in Container needs the proposed API: ${proposal}; the window stays as it is`,
        ],
      ]),
    );
  });

  it('F-0101 AC-15: a proposal the new probe finds granted lets Reopen go on, and a missing contribViewsRemote holds nothing back (BR-9)', async () => {
    const granted = setup();
    granted.missing = ['resolvers'];
    await reopened(granted);
    const views = setup();
    views.missing = ['contribViewsRemote'];
    await reopened(views);
    deepStrictEqual(
      [
        granted.calls[0],
        granted.commands.length,
        views.calls[0],
        views.commands.length,
      ],
      ['setupAgain', 1, 'ensureTrusted', 1],
    );
  });

  it('F-0106 AC-7, F-0401 AC-21: a declined trust request and an unavailable one stop before the engine check, the read and the open (6.4)', async () => {
    const seen = [];
    for (const trust of ['declined', 'unavailable'] as const) {
      const state = setup();
      state.trust = trust;
      await reopened(state);
      seen.push([state.calls, state.commands]);
    }
    deepStrictEqual(seen, [
      [['ensureTrusted'], []],
      [['ensureTrusted'], []],
    ]);
  });

  it('F-0106 AC-1: a folder with no configuration asks for trust first, and a declined request shows nothing', async () => {
    const state = setup();
    state.existing = [];
    state.trust = 'declined';
    await reopened(state);
    deepStrictEqual([state.calls, state.shown], [['ensureTrusted'], []]);
  });

  it('F-0201 5.0, ruling (c): a first check that stopped ends the command with no reload and no lookup of the Docker context', async () => {
    const state = setup();
    state.check = 'stopped';
    await reopened(state);
    deepStrictEqual(
      [state.calls, state.commands],
      [['ensureTrusted', 'firstCheck /w/p', 'readConfiguration /w/p'], []],
    );
  });

  it('ruling (c): the progress closes before the reload', async () => {
    const state = setup();
    deepStrictEqual(
      [
        await reopenedSlowly(state),
        state.timers.map(timer => timer.milliseconds),
      ],
      [[`progress shown ${START}`, 'leave', 'progress closed', 'open'], [500]],
    );
  });

  it('F-0408 AC-7: Cancel on the progress ends Reopen with no reload, no other notification and a line in the log', async () => {
    const state = setup();
    const release = pendingOf<undefined>();
    state.waitOnCheck = release.promise;
    const {ports, sink} = portsOf(state);
    const running = handlerOf(ports)();
    await settled();
    state.timers[0]?.callback();
    state.cancels[0]?.();
    release.resolve(undefined);
    await running;
    await settled();
    deepStrictEqual(
      [
        state.order,
        state.commands,
        state.shown,
        linesOf(sink).filter(line => line.includes('was cancelled')),
      ],
      [
        [`progress shown ${START}`, 'progress closed'],
        [],
        [],
        ['info: the command was cancelled while reading the configuration'],
      ],
    );
  });

  it('ruling (c): the progress closes in the end of every other answer, and nothing opens', async () => {
    const answers: Array<(state: Setup) => void> = [
      state => {
        state.check = 'stopped';
      },
      state => {
        state.read = {kind: 'buildFailed', message: 'no build'};
      },
      state => {
        state.read = {kind: 'cancelled'};
      },
    ];
    const seen = [];
    for (const answer of answers) {
      const state = setup();
      answer(state);
      seen.push(await reopenedSlowly(state));
    }
    deepStrictEqual(
      seen,
      answers.map(() => [`progress shown ${START}`, 'progress closed']),
    );
  });

  it('F-0301 6.2: no configuration opens nothing, runs the wizard once after the trust check, and says so in the log', async () => {
    const state = setup();
    state.existing = [];
    const {lines} = await reopened(state);
    deepStrictEqual(
      [
        state.commands,
        state.calls.filter(call => /^(ensureTrusted|wizard)/.test(call)),
        lines,
      ],
      [
        [],
        ['ensureTrusted', 'wizard /w/p'],
        [
          'info: Reading configuration',
          'info: no dev container configuration in /w/p',
          'info: Reading configuration: 0 ms',
          'info: Reopen in Container found no configuration in /w/p',
        ],
      ],
    );
  });

  it('F-0401 AC-8: a written configuration is chosen again and the window reopens on it, after the trust check', async () => {
    const state = setup();
    state.existing = [];
    state.wizard = WRITTEN_IN_FOLDER;
    state.wizardLeaves = [CONFIG];
    await reopened(state);
    const target = openedTarget(state);
    deepStrictEqual(
      [
        state.calls.filter(call => /^(ensureTrusted|wizard)/.test(call)),
        'configFile' in target ? target.configFile.fsPath : target,
      ],
      [['ensureTrusted', 'wizard /w/p'], CONFIG],
    );
  });

  it('F-0405 AC-13: a wizard that failed reopens nothing', async () => {
    const state = setup();
    state.existing = [];
    state.wizard = {kind: 'failed', detail: 'read-only'};
    await reopened(state);
    deepStrictEqual(state.commands, []);
  });

  it('F-0301 5.0 step 4: two configurations show the picker, and the one picked is what the window reloads on', async () => {
    const state = setup();
    state.existing = [CONFIG, '/w/p/.devcontainer.json'];
    state.pick = {kind: 'picked', index: 1};
    await reopened(state);
    const target = openedTarget(state);
    deepStrictEqual(
      [state.shown, 'configFile' in target ? target.configFile.fsPath : target],
      [['pick 2'], CONFIG],
    );
  });

  it('F-0301 AC-8: a picker closed opens nothing and the CLI is not asked (6.3)', async () => {
    const state = setup();
    state.existing = [CONFIG, '/w/p/.devcontainer.json'];
    state.pick = {kind: 'dismissed'};
    await reopened(state);
    deepStrictEqual(
      [state.commands, state.calls.includes('readConfiguration /w/p')],
      [[], false],
    );
  });

  it('F-0301 7.E1: a configuration that cannot be read shows its dialog and opens nothing', async () => {
    const state = setup();
    state.contents[CONFIG] = '';
    await reopened(state);
    deepStrictEqual(
      [
        state.commands,
        state.shown.length,
        state.calls.includes('readConfiguration /w/p'),
      ],
      [[], 1, false],
    );
  });

  it('F-0201 5.0: a relative Docker path in the setting is resolved against the folder', async () => {
    const state = setup();
    state.dockerPath = 'bin/docker';
    const files: string[] = [];
    const {ports} = portsOf(state);
    await handlerOf({
      ...ports,
      bridge: {
        readConfiguration: target => {
          files.push(target.dockerPath);
          return Promise.resolve(CONFIGURATION);
        },
      },
    })();
    deepStrictEqual(files, ['/w/p/bin/docker']);
  });

  it('F-0301 7.E1: a CLI failure that has a message opens no window, shows S181 with the file opened, and is logged with its kind and message', async () => {
    const state = setup();
    state.read = {kind: 'buildFailed', message: 'no build'};
    const {lines} = await reopened(state);
    deepStrictEqual(
      [state.commands, lines, state.shown.length],
      [
        [],
        [
          'info: Reading configuration',
          'warn: the configuration could not be read: buildFailed: no build',
          'info: Reading configuration: 0 ms',
        ],
        1,
      ],
    );
  });

  it('contracts §6: a CLI failure with no message is logged with its kind', async () => {
    const state = setup();
    state.read = {kind: 'noResult', status: 1};
    const {lines} = await reopened(state);
    deepStrictEqual(lines, [
      'info: Reading configuration',
      'warn: the configuration could not be read: noResult',
      'info: Reading configuration: 0 ms',
    ]);
  });

  it('contracts §6: a read the CLI was cancelled in opens nothing and logs only the reading step', async () => {
    const state = setup();
    state.read = {kind: 'cancelled'};
    const {lines} = await reopened(state);
    deepStrictEqual(
      [state.commands, lines],
      [
        [],
        ['info: Reading configuration', 'info: Reading configuration: 0 ms'],
      ],
    );
  });

  it('F-0401 BR-1: an editor that refuses the open is logged with its reason', async () => {
    const state = setup();
    state.rejects = 'x';
    const {lines} = await reopened(state);
    deepStrictEqual(lines, [
      'info: Reading configuration',
      'info: Reading configuration: 0 ms',
      'warn: Reopen in Container was refused: x',
    ]);
  });

  it('F-0202 AC-45, AC-51: a call while another is past its check runs its own check and is absorbed, and a call after the first ends runs again', async () => {
    const state = setup();
    const {during, lines} = await reentered(state, 'waitOnRead');
    deepStrictEqual(
      [
        during,
        lines.filter(line => line.includes('already running')),
        state.commands.length,
      ],
      [
        [
          'ensureTrusted',
          'ensureTrusted',
          'firstCheck /w/p',
          'firstCheck /w/p',
          'readConfiguration /w/p',
          'readConfiguration /w/p',
        ],
        ['info: Reopen in Container is already running'],
        2,
      ],
    );
  });

  it('F-0202 AC-45: a call while the trust request is open asks again, as the check has not passed', async () => {
    const state = setup();
    state.trust = 'declined';
    const release = pendingOf<undefined>();
    state.waitOnTrust = release.promise;
    const {ports, sink} = portsOf(state);
    const handler = handlerOf(ports);
    const calls = [handler(), handler()];
    await settled();
    const during = [...state.calls];
    release.resolve(undefined);
    await Promise.all(calls);
    deepStrictEqual(
      [during, linesOf(sink).filter(line => line.includes('already running'))],
      [['ensureTrusted', 'ensureTrusted'], []],
    );
  });

  it('F-0405 BR-1, AC-8: a rebuild and reopen stores the intent for the payload right before the reload, after the whole flow', async () => {
    const state = setup();
    await reopened(state, {buildNoCache: false});
    const {authority} = state.commands[0]?.parameters[0] as {
      authority: string;
    };
    deepStrictEqual(
      [
        state.updates,
        state.calls,
        state.order.filter(entry => entry === 'store' || entry === 'open'),
      ],
      [
        [
          [
            REBUILD_INTENTS_KEY,
            {
              [authority.slice('dev-container+'.length)]: {
                storedAt: 1000,
                value: {removeExistingContainer: true, buildNoCache: false},
              },
            },
          ],
        ],
        [
          'ensureTrusted',
          'firstCheck /w/p',
          'readConfiguration /w/p',
          'pinnedEngine',
          'storeIntent',
        ],
        ['store', 'open'],
      ],
    );
  });

  it('F-0405 5.1: the no-cache variant stores buildNoCache, and an ordinary Reopen stores nothing', async () => {
    const noCache = setup();
    await reopened(noCache, {buildNoCache: true});
    const ordinary = setup();
    await reopened(ordinary);
    deepStrictEqual(
      [
        JSON.stringify(noCache.updates).includes('"buildNoCache":true'),
        ordinary.updates,
        ordinary.calls.includes('storeIntent'),
      ],
      [true, [], false],
    );
  });

  it('F-0106 AC-32, AC-33: the rebuild variants ask for trust under their own titles, and a decline stores nothing and opens nothing', async () => {
    const seen = [];
    for (const rebuild of [{buildNoCache: false}, {buildNoCache: true}]) {
      const state = setup();
      state.trust = 'declined';
      await reopened(state, rebuild);
      seen.push([state.titles, state.updates, state.commands]);
    }
    deepStrictEqual(seen, [
      [['Rebuild and Reopen in Container'], [], []],
      [['Rebuild Without Cache and Reopen in Container'], [], []],
    ]);
  });

  it('F-0405 BR-17: an intent that cannot be stored means no reload, and one warn line', async () => {
    const failures = [new Error('disk'), 'gone'];
    const seen = [];
    for (const failure of failures) {
      const state = setup();
      state.intentFailure = failure;
      const {lines} = await reopened(state, {buildNoCache: false});
      seen.push([state.commands, lines]);
    }
    deepStrictEqual(seen, [
      [[], [...READING, 'warn: the rebuild intent could not be stored: disk']],
      [[], [...READING, 'warn: the rebuild intent could not be stored: gone']],
    ]);
  });

  it('F-0405 AC-13: a rebuild stores nothing when the flow ends before the reload: no configuration, a stopped first check, a picker closed', async () => {
    const changes: Array<(state: Setup) => void> = [
      state => {
        state.existing = [];
      },
      state => {
        state.check = 'stopped';
      },
      state => {
        state.existing = [CONFIG, '/w/p/.devcontainer.json'];
        state.pick = {kind: 'dismissed'};
      },
    ];
    const seen = [];
    for (const change of changes) {
      const state = setup();
      change(state);
      await reopened(state, {buildNoCache: false});
      seen.push([state.updates, state.commands]);
    }
    deepStrictEqual(
      seen,
      changes.map(() => [[], []]),
    );
  });

  it('F-0405 AC-30: the rebuild variants name themselves in the log of a window they do nothing in, and of a second call', async () => {
    const away = setup();
    away.remoteName = 'dev-container';
    const {lines: awayLines} = await reopened(away, {buildNoCache: false});
    const state = setup();
    const {lines} = await reentered(state, 'waitOnRead', {buildNoCache: true});
    deepStrictEqual(
      [awayLines, lines.filter(line => line.includes('already running'))],
      [
        ['info: Rebuild and Reopen in Container does nothing in this window'],
        [
          'info: Rebuild Without Cache and Reopen in Container is already running',
        ],
      ],
    );
  });

  it('F-0405 BR-1: a Reopen and a rebuild and reopen never run at once in one window', async () => {
    const state = setup();
    const release = pendingOf<undefined>();
    state.waitOnRead = release.promise;
    const {ports, sink} = portsOf(state);
    const handlers = reopenHandlersOf(ports);
    const first = handlers()();
    await settled();
    await handlers({buildNoCache: false})();
    release.resolve(undefined);
    await first;
    deepStrictEqual(
      [
        linesOf(sink).filter(line => line.includes('already running')),
        state.updates,
      ],
      [['info: Rebuild and Reopen in Container is already running'], []],
    );
  });

  it('F-0101 AC-15: a rebuild and reopen without resolvers is held back under its own title, before the trust check', async () => {
    const state = setup();
    state.missing = ['resolvers'];
    state.missingAfter = ['resolvers'];
    const {lines} = await reopened(state, {buildNoCache: true});
    deepStrictEqual(
      [state.calls, state.updates, lines],
      [
        ['setupAgain'],
        [],
        [
          'info: Rebuild Without Cache and Reopen in Container needs the proposed API: resolvers; the window stays as it is',
        ],
      ],
    );
  });

  it('contracts §6 (R-26): the opener receives no value that looks like a token', async () => {
    const state = setup();
    await reopened(state);
    deepStrictEqual(
      /token|secret|password/i.test(JSON.stringify(state.commands)),
      false,
    );
  });

  describe('a Feature the control manifest disallows (card containers-94)', () => {
    const DISALLOWED = JSON.stringify({
      disallowedFeatures: [
        {
          featureIdPrefix: 'ghcr.io/o/features/bad',
          documentationURL: 'https://example.org/bad',
        },
        {featureIdPrefix: 'ghcr.io/o/features/worse'},
      ],
    });

    /** The configuration of the folder, asking for the Features `names`. */
    function askingFor(...names: string[]): typeof CONFIGURATION {
      return {
        ...CONFIGURATION,
        configuration: {
          features: Object.fromEntries(names.map(name => [name, {}])),
        },
      };
    }

    it('F-0414 AC-17: a requested Feature the manifest disallows is told with S059 and S275, Cancel and Learn More, and the window is not reloaded', async () => {
      const state = setup();
      state.manifest = DISALLOWED;
      state.read = askingFor('ghcr.io/o/features/bad:1');
      await reopened(state);
      deepStrictEqual(
        [state.commands, state.calls.filter(call => call.startsWith('warn'))],
        [
          [],
          [
            "warn Cannot use the 'ghcr.io/o/features/bad:1' feature since it was reported to be problematic.|Please remove this feature from your devcontainer.json and rebuild the dev container before continuing.|Learn More|Cancel",
          ],
        ],
      );
    });

    it('F-0414 AC-18: Learn More opens the entry’s address and still reloads nothing', async () => {
      const state = setup();
      state.manifest = DISALLOWED;
      state.warnAnswer = 'learnMore';
      state.read = askingFor('ghcr.io/o/features/bad');
      await reopened(state);
      deepStrictEqual(
        [state.commands, state.calls.filter(call => call.startsWith('open'))],
        [[], ['openExternal https://example.org/bad']],
      );
    });

    it('F-0414 7.E10: an entry with no address offers Cancel alone', async () => {
      const state = setup();
      state.manifest = DISALLOWED;
      state.read = askingFor('ghcr.io/o/features/worse@sha256:abc');
      await reopened(state);
      deepStrictEqual(
        state.calls
          .filter(call => call.startsWith('warn'))
          .map(call => call.split('|').slice(2)),
        [['no Learn More', 'Cancel']],
      );
    });

    it('F-0414 7.E10: a Feature that only starts like a disallowed one goes on to the reload', async () => {
      const state = setup();
      state.manifest = DISALLOWED;
      state.read = askingFor('ghcr.io/o/features/badge:1');
      await reopened(state);
      deepStrictEqual(
        [
          state.commands.length,
          state.calls.some(call => call.startsWith('warn')),
        ],
        [1, false],
      );
    });

    it('F-0414 AC-17: the always-installed Features are checked too', async () => {
      const state = setup();
      state.manifest = DISALLOWED;
      const {ports} = portsOf(state);
      await handlerOf({
        ...ports,
        settings: {
          ...ports.settings,
          defaultFeatures: () => ({'ghcr.io/o/features/bad:2': {}}),
        },
      })();
      deepStrictEqual(
        [
          state.commands,
          state.calls.filter(call => call.startsWith('warn')).length,
        ],
        [[], 1],
      );
    });

    it('F-0414 7.E11: a configuration that asks for no Feature downloads no manifest', async () => {
      const state = setup();
      await reopened(state);
      deepStrictEqual(
        state.calls.filter(call => call === 'downloadManifest'),
        [],
      );
    });
  });
});
