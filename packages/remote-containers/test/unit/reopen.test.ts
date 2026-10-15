import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {devContainerTargetOf} from '../../src/authority/payload.ts';
import type {CliFailure, ConfigurationResult} from '../../src/cli/cli-lines.ts';
import {reopenInContainer} from '../../src/open/reopen.ts';
import type {PickerAnswer} from '../../src/config/choose-configuration.ts';
import type {ReopenPorts} from '../../src/open/reopen-ports.ts';
import type {TrustOutcome} from '../../src/trust/trust-gate.ts';
import {pendingOf, settled} from './pending.ts';

const FOLDER = '/w/p';
const CONFIG = '/w/p/.devcontainer/devcontainer.json';
const START =
  '[Connecting to Dev Container (show log)](command:remote-containers.revealLogTerminal)';
const CONFIGURATION: ConfigurationResult = {
  kind: 'configuration',
  configuration: {},
  workspaceFolder: '/workspaces/p',
  workspaceMount: undefined,
  mergedConfiguration: undefined,
};

/** The pieces a row steers, and what the fakes recorded. */
interface Setup {
  calls: string[];
  commands: Array<{command: string; parameters: unknown[]}>;
  lines: string[];
  read: ConfigurationResult | CliFailure;
  check: 'proceed' | 'stopped';
  context: string | undefined;
  existing: string[];
  /** What the picker answers, and what the notices and dialogs showed. */
  pick: PickerAnswer;
  shown: string[];
  contents: Record<string, string>;
  remoteName: string | undefined;
  folders: Array<{scheme: string; fsPath: string}>;
  trust: TrustOutcome;
  waitOnTrust: Promise<void>;
  rejects: string | undefined;
  dockerPath: unknown;
  waitOnCheck: Promise<void>;
  targets: unknown[];
  /** The order of the progress and the open, as far as the rows on them look. */
  order: string[];
  /** What the progress asked the clock for. */
  timers: Array<{milliseconds: number; callback: () => void}>;
}

function setup(): Setup {
  return {
    calls: [],
    commands: [],
    lines: [],
    read: CONFIGURATION,
    check: 'proceed',
    context: undefined,
    existing: [CONFIG],
    pick: {kind: 'picked', index: 0},
    shown: [],
    contents: {},
    remoteName: undefined,
    folders: [{scheme: 'file', fsPath: FOLDER}],
    trust: 'trusted',
    waitOnTrust: Promise.resolve(),
    rejects: undefined,
    dockerPath: 'docker',
    waitOnCheck: Promise.resolve(),
    targets: [],
    order: [],
    timers: [],
  };
}

/** The ports over a setup; each call that reaches a port is recorded in `calls`. */
function portsOf(state: Setup): {ports: ReopenPorts; sink: MemorySink} {
  const sink = new MemorySink();
  const ports: ReopenPorts = {
    window: {
      remoteName: () => state.remoteName,
      folders: () => state.folders,
      serializedFile: file => ({
        $mid: 1,
        fsPath: file,
        external: `file://${file}`,
        path: file,
        scheme: 'file',
      }),
    },
    ensureTrusted: async () => {
      state.calls.push('ensureTrusted');
      await state.waitOnTrust;
      return state.trust;
    },
    config: {
      files: {
        list: folder => {
          const entries = new Map<string, 'file' | 'folder'>();
          for (const file of state.existing) {
            const relative = file.slice(FOLDER.length + 1).split('/');
            const parent = [FOLDER, ...relative.slice(0, -1)].join('/');
            if (parent === folder) {
              entries.set(relative.at(-1) ?? '', 'file');
            }
            for (let depth = 1; depth < relative.length; depth += 1) {
              const above = [FOLDER, ...relative.slice(0, depth - 1)].join('/');
              if (above === folder) {
                entries.set(relative[depth - 1] ?? '', 'folder');
              }
            }
          }
          return Promise.resolve(
            [...entries].map(([name, kind]) => ({name, kind})),
          );
        },
        read: file =>
          Promise.resolve(Buffer.from(state.contents[file] ?? '{"image":"i"}')),
      },
      surfaces: {
        pick: rows => {
          state.shown.push(`pick ${String(rows.length)}`);
          return Promise.resolve(state.pick);
        },
        dialogs: {
          showError: (message, detail) => {
            state.shown.push(`error ${message}${detail}`);
            return Promise.resolve(undefined);
          },
          revealLog: () => undefined,
        },
        showWarning: () => Promise.resolve(undefined),
        openPreview: () => Promise.resolve(),
        showInformation: message => {
          state.shown.push(`info ${message}`);
        },
      },
      compare: (left, right) => left.localeCompare(right, 'en'),
      translate: template => template,
    },
    settings: {dockerPath: () => state.dockerPath},
    engine: {
      firstCheck: async base => {
        state.calls.push(`firstCheck ${String(base)}`);
        await state.waitOnCheck;
        return state.check;
      },
      currentContext: () => {
        state.calls.push('currentContext');
        return Promise.resolve(state.context);
      },
    },
    dialogs: {
      showError: () => Promise.resolve(undefined),
      openExternal: () => Promise.resolve(undefined),
      revealLog: () => undefined,
    },
    progress: {
      showProgress: (title, until) => {
        state.order.push(`progress shown ${title}`);
        void until.then(() => {
          state.order.push('progress closed');
        });
      },
      setTimer: (milliseconds, callback) => {
        state.timers.push({milliseconds, callback});
        return () => undefined;
      },
      translate: template => template,
    },
    bridge: {
      readConfiguration: target => {
        state.targets.push(target);
        state.calls.push(`readConfiguration ${target.workspaceFolder}`);
        return Promise.resolve(state.read);
      },
    },
    opener: {
      executeCommand: (command, ...parameters) => {
        state.commands.push({command, parameters});
        queueMicrotask(() => {
          state.order.push('open');
        });
        return state.rejects === undefined
          ? Promise.resolve(undefined)
          : Promise.reject(new Error(state.rejects));
      },
      addressOf: parts => parts,
    },
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  };
  return {ports, sink};
}

/** The messages a sink saw, with their levels. */
function linesOf(sink: MemorySink): string[] {
  return sink.lines.map(line => `${line.level}: ${line.message}`);
}

/** The target the first open went to. */
function openedTarget(state: Setup): ReturnType<typeof devContainerTargetOf> {
  const {authority} = state.commands[0]?.parameters[0] as {authority: string};
  return devContainerTargetOf(authority.slice('dev-container+'.length));
}

/** Runs the command once. */
async function reopened(state: Setup) {
  const {ports, sink} = portsOf(state);
  await reopenInContainer(ports)();
  await settled();
  return {lines: linesOf(sink)};
}

/** Runs the command with the progress shown while the first check waits, and gives the order of what followed. */
async function reopenedSlowly(state: Setup): Promise<string[]> {
  const release = pendingOf<undefined>();
  state.waitOnCheck = release.promise;
  const {ports} = portsOf(state);
  const running = reopenInContainer(ports)();
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
): Promise<{during: string[]; lines: string[]}> {
  const release = pendingOf<undefined>();
  state[hold] = release.promise;
  const {ports, sink} = portsOf(state);
  const handler = reopenInContainer(ports);
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
            mounts: [],
            logLevel: 'info',
          },
        ],
      ],
    );
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
      [[`progress shown ${START}`, 'progress closed', 'open'], [500]],
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
    await reopenInContainer({
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

  it('contracts §6: a CLI failure that has a message opens nothing and is logged with its kind and message', async () => {
    const state = setup();
    state.read = {kind: 'buildFailed', message: 'no build'};
    const {lines} = await reopened(state);
    deepStrictEqual(
      [state.commands, lines],
      [
        [],
        [
          'warn: the configuration could not be read: buildFailed',
          'warn: Reopen in Container could not read the configuration: buildFailed: no build',
        ],
      ],
    );
  });

  it('contracts §6: a CLI failure with no message is logged with its kind', async () => {
    const state = setup();
    state.read = {kind: 'noResult', status: 1};
    const {lines} = await reopened(state);
    deepStrictEqual(lines, [
      'warn: the configuration could not be read: noResult',
      'warn: Reopen in Container could not read the configuration: noResult',
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

  it('contracts §6 (R-26): the opener receives no value that looks like a token', async () => {
    const state = setup();
    await reopened(state);
    deepStrictEqual(
      /token|secret|password/i.test(JSON.stringify(state.commands)),
      false,
    );
  });
});
