import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {devContainerTargetOf} from '../../src/authority/payload.ts';
import type {CliFailure, ConfigurationResult} from '../../src/cli/cli-lines.ts';
import {reopenInContainer} from '../../src/open/reopen.ts';
import type {ReopenPorts} from '../../src/open/reopen-ports.ts';

const FOLDER = '/w/p';
const CONFIG = '/w/p/.devcontainer/devcontainer.json';
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
  remoteName: string | undefined;
  folders: Array<{scheme: string; fsPath: string}>;
  trusted: boolean;
  rejects: string | undefined;
  dockerPath: unknown;
  waitOnCheck: Promise<void>;
  targets: unknown[];
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
    remoteName: undefined,
    folders: [{scheme: 'file', fsPath: FOLDER}],
    trusted: true,
    rejects: undefined,
    dockerPath: 'docker',
    waitOnCheck: Promise.resolve(),
    targets: [],
  };
}

/** The ports over a setup; each call that reaches a port is recorded in `calls`. */
function portsOf(state: Setup): {ports: ReopenPorts; sink: MemorySink} {
  const sink = new MemorySink();
  const ports: ReopenPorts = {
    window: {
      remoteName: () => state.remoteName,
      folders: () => state.folders,
      isTrusted: () => state.trusted,
      serializedFile: file => ({
        $mid: 1,
        fsPath: file,
        external: `file://${file}`,
        path: file,
        scheme: 'file',
      }),
    },
    files: {
      isFile: file => {
        state.calls.push(`isFile ${file}`);
        return Promise.resolve(state.existing.includes(file));
      },
      subfolders: () => Promise.resolve([]),
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

/** Runs the command once. */
async function reopened(state: Setup) {
  const {ports, sink} = portsOf(state);
  await reopenInContainer(ports)();
  return {lines: linesOf(sink)};
}

describe('Reopen in Container', () => {
  it('F-0401 BR-1: a local trusted window reloads on the dev-container authority of its folder, in the order of the flow', async () => {
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
        state.calls.filter(call => !call.startsWith('isFile')),
        state.commands.map(each => each.command),
        authority.startsWith('dev-container+'),
        (state.commands[0]?.parameters[0] as {path: string}).path,
        state.commands[0]?.parameters[1],
        'hostPath' in target ? target.hostPath : target,
        'localDocker' in target ? target.localDocker : target,
        state.targets,
      ],
      [
        ['firstCheck /w/p', 'readConfiguration /w/p', 'currentContext'],
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
    const authority = (state.commands[0]?.parameters[0] as {authority: string})
      .authority;
    const target = devContainerTargetOf(
      authority.slice('dev-container+'.length),
    );
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

  it('F-0401 PRE-7: an untrusted window does nothing and opens nothing, until the trust request is built', async () => {
    const state = setup();
    state.trusted = false;
    const {lines} = await reopened(state);
    deepStrictEqual(
      [state.calls, state.commands, lines],
      [
        [],
        [],
        [
          "info: the folder isn't trusted; Reopen in Container needs workspace trust",
        ],
      ],
    );
  });

  it('F-0201 5.0: a first check that stopped ends the command before any lookup', async () => {
    const state = setup();
    state.check = 'stopped';
    await reopened(state);
    deepStrictEqual([state.calls, state.commands], [['firstCheck /w/p'], []]);
  });

  it('F-0301 5.0: no configuration opens nothing and says so in the log', async () => {
    const state = setup();
    state.existing = [];
    const {lines} = await reopened(state);
    deepStrictEqual(
      [state.commands, lines],
      [
        [],
        [
          'info: Reopen in Container found no dev container configuration in /w/p',
        ],
      ],
    );
  });

  it('F-0301 5.0: two configurations open nothing and the log names them', async () => {
    const state = setup();
    state.existing = [CONFIG, '/w/p/.devcontainer.json'];
    const {lines} = await reopened(state);
    deepStrictEqual(
      [state.commands, lines],
      [
        [],
        [
          `info: Reopen in Container found 2 dev container configurations in /w/p: /w/p/.devcontainer.json, ${CONFIG}`,
        ],
      ],
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
          'warn: Reopen in Container could not read the configuration: buildFailed: no build',
        ],
      ],
    );
  });

  it('contracts §6: a CLI failure with no message is logged with its kind', async () => {
    const state = setup();
    state.read = {kind: 'cancelled'};
    const {lines} = await reopened(state);
    deepStrictEqual(lines, [
      'warn: Reopen in Container could not read the configuration: cancelled',
    ]);
  });

  it('F-0401 BR-1: an editor that refuses the open is logged with its reason', async () => {
    const state = setup();
    state.rejects = 'x';
    const {lines} = await reopened(state);
    deepStrictEqual(lines, ['warn: Reopen in Container was refused: x']);
  });

  it('F-0401 BR-7a: a call while another waits on the first check returns at once, and a call after the first ends runs again', async () => {
    const state = setup();
    const release: Array<() => void> = [];
    state.waitOnCheck = new Promise<void>(resolve => {
      release.push(resolve);
    });
    const {ports, sink} = portsOf(state);
    const handler = reopenInContainer(ports);
    const first = handler();
    await handler();
    const during = [...state.calls];
    release.forEach(each => {
      each();
    });
    await first;
    await handler();
    deepStrictEqual(
      [
        during,
        linesOf(sink).filter(line => line.includes('already running')),
        state.commands.length,
      ],
      [
        ['firstCheck /w/p'],
        ['info: Reopen in Container is already running'],
        2,
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
