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
  hold: 'waitOnCheck' | 'waitOnTrust',
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
          'currentContext',
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

  it('F-0301 6.2: no configuration opens nothing, shows the notice of ours once, and says so in the log', async () => {
    const state = setup();
    state.existing = [];
    const {lines} = await reopened(state);
    deepStrictEqual(
      [state.commands, state.shown.length, lines],
      [
        [],
        1,
        [
          'info: no dev container configuration in /w/p',
          'info: Reopen in Container found no configuration in /w/p',
        ],
      ],
    );
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
        ['warn: the configuration could not be read: buildFailed: no build'],
        1,
      ],
    );
  });

  it('contracts §6: a CLI failure with no message is logged with its kind', async () => {
    const state = setup();
    state.read = {kind: 'noResult', status: 1};
    const {lines} = await reopened(state);
    deepStrictEqual(lines, [
      'warn: the configuration could not be read: noResult',
    ]);
  });

  it('contracts §6: a read the CLI was cancelled in opens nothing and logs nothing', async () => {
    const state = setup();
    state.read = {kind: 'cancelled'};
    const {lines} = await reopened(state);
    deepStrictEqual([state.commands, lines], [[], []]);
  });

  it('F-0401 BR-1: an editor that refuses the open is logged with its reason', async () => {
    const state = setup();
    state.rejects = 'x';
    const {lines} = await reopened(state);
    deepStrictEqual(lines, ['warn: Reopen in Container was refused: x']);
  });

  it('F-0401 BR-7a: a call while another waits on the first check returns at once, and a call after the first ends runs again', async () => {
    const state = setup();
    const {during, lines} = await reentered(state, 'waitOnCheck');
    deepStrictEqual(
      [
        during,
        lines.filter(line => line.includes('already running')),
        state.commands.length,
      ],
      [
        ['ensureTrusted', 'firstCheck /w/p', 'readConfiguration /w/p'],
        ['info: Reopen in Container is already running'],
        2,
      ],
    );
  });

  it('F-0401 BR-7a: a call while the trust request is open calls nothing, and after a decline a third call asks again', async () => {
    const state = setup();
    state.trust = 'declined';
    const {during, lines} = await reentered(state, 'waitOnTrust');
    deepStrictEqual(
      [
        during,
        state.calls,
        lines.filter(line => line.includes('already running')),
      ],
      [
        ['ensureTrusted'],
        ['ensureTrusted', 'ensureTrusted'],
        ['info: Reopen in Container is already running'],
      ],
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
          'currentContext',
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
      [[], ['warn: the rebuild intent could not be stored: disk']],
      [[], ['warn: the rebuild intent could not be stored: gone']],
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
    const {lines} = await reentered(state, 'waitOnCheck', {buildNoCache: true});
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
    state.waitOnCheck = release.promise;
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
});
