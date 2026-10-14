import {deepStrictEqual} from 'node:assert';
import {recordingResolverEditor} from 'lib-authority/testing/recording-resolver-editor';
import type {Connected, Failed} from 'lib-authority';
import type {CommandHost} from 'lib-identifiers';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type ConnectSurfaces,
  connectAssemblyOf,
} from '../../src/connect-ports.ts';
import type {SshTarget} from 'lib-ssh';
import type {MaintenanceRun} from '../../src/maintenance/maintenance-run.ts';
import {registerConnect} from '../../src/register-connect.ts';
import {nodeMachineOf} from '../../src/node-machine.ts';
import {PROFILE, surfacesOf} from './server-steps.fixture.ts';

/** What the fakes saw. */
interface Seen {
  events: string[];
  commands: Map<string, (...given: unknown[]) => unknown>;
  disposed: string[];
  labels: number;
  portsViews: number;
  revealed: number;
  opened: string[];
  killed: string[];
  /** The actions run on a host and its target's host, in order. */
  maintained: string[];
  /** The notices shown: message and buttons. */
  notices: Array<[string, readonly string[]]>;
  /** The button a notice is answered with. */
  noticeAnswer?: string;
  remote: Array<[string, string]>;
  inputs: number;
}

/** The registration over fakes; the connector's server port is `serverPort`. */
async function registered(
  resolversGranted: boolean,
  serverPort: number | 'none' = 'none',
  surfaces?: ConnectSurfaces,
  connectResult?: Connected | Failed,
  /** The host the window holds in default mode, and whether the switch to a local window rejects. */
  own?: {switchFails: boolean},
): Promise<{
  seen: Seen;
  registration: Awaited<ReturnType<typeof registerConnect>>;
  recording: ReturnType<typeof recordingResolverEditor>;
  state: Array<[string, undefined]>;
  sink: MemorySink;
}> {
  const seen: Seen = {
    events: [],
    commands: new Map(),
    disposed: [],
    labels: 0,
    portsViews: 0,
    revealed: 0,
    opened: [],
    killed: [],
    maintained: [],
    notices: [],
    remote: [],
    inputs: 0,
  };
  const surfacesInUse =
    surfaces ??
    surfacesOf(
      {inspectSetting: () => ({})},
      template => template,
      () => {
        seen.revealed += 1;
      },
    );
  const state: Array<[string, undefined]> = [];
  const sink = new MemorySink();
  const logger = createLogger(sink, {minimumLevel: (): Level => 'info'});
  const machine = nodeMachineOf(
    {
      extensionFolder: '/extension',
      storageFolder: '/storage',
      runtime: '/editor/code',
      profile: PROFILE,
      httpGet: () => Promise.reject(new Error('no request in a unit test')),
    },
    {
      platform: 'linux',
      environment: {},
      homeFolder: '/home/alex',
      temporaryFolder: '/tmp',
    },
  );
  const assembly = connectAssemblyOf(surfacesInUse, machine, logger);
  const connector = {
    ...assembly.connector,
    serverPort: () => serverPort,
    ...(own === undefined
      ? {}
      : {heldHost: () => ({target: {host: 'dev'}, terminalMode: false})}),
  };
  function killLocalServer(hostString: string): Promise<void> {
    seen.killed.push(hostString);
    return Promise.resolve();
  }
  function maintain(
    action: 'kill' | 'uninstall',
    target: SshTarget,
  ): Promise<MaintenanceRun> {
    seen.maintained.push(`${action} ${target.host}`);
    return Promise.resolve({result: 'stepRan', cause: ''});
  }
  const commands: CommandHost = {
    registerCommand: (commandId, callback) => {
      seen.commands.set(commandId, callback);
      return {
        dispose: () => {
          seen.disposed.push(commandId);
        },
      };
    },
    showOutOfContext: () => undefined,
  };
  const recording = recordingResolverEditor(seen.events);
  const registration = await registerConnect(
    {
      resolverEditor: recording.editor,
      labels: {
        registerResourceLabelFormatter: () => {
          seen.labels += 1;
          return {dispose: () => undefined};
        },
      },
      portsView: {
        enablePortsView: () => {
          seen.portsViews += 1;
          return Promise.resolve();
        },
      },
      commands,
      connectEditor: {
        listHosts: () => ({hosts: [{name: 'dev', file: '/f'}]}),
        pickHost: () =>
          Promise.resolve({kind: 'host', label: 'dev', keepVisible: false}),
        openRemote: (authority, window) => {
          seen.remote.push([authority, window]);
          return Promise.resolve();
        },
        runCommand: () => Promise.resolve(),
        switchToLocalWindow: () =>
          own?.switchFails === true
            ? Promise.reject(new Error('no window'))
            : Promise.resolve(),
        remoteName: () => 'ssh-remote',
      },
      openExternal: address => {
        seen.opened.push(address);
        return Promise.resolve(true);
      },
      translate: template => template,
      globalState: {
        update: (key, value) => {
          state.push([key, value]);
          return Promise.resolve();
        },
      },
      logger,
      notice: {
        showInformation: (message, buttons) => {
          seen.notices.push([message, buttons]);
          return Promise.resolve(seen.noticeAnswer);
        },
        showWarning: () => Promise.resolve(undefined),
        showError: () => Promise.resolve(undefined),
      },
      addHost: {
        editor: {
          pickFile: () => Promise.resolve(undefined),
          open: file => Promise.resolve({file}),
        },
        input: {
          showInputBox: () => {
            seen.inputs += 1;
            return Promise.resolve(undefined);
          },
        },
        files: {
          exists: () => Promise.resolve(false),
          missingFolders: () => Promise.resolve([]),
          makeFolder: () => Promise.resolve(),
          createFile: () => Promise.resolve(),
          read: () => Promise.resolve(''),
          write: () => Promise.resolve(),
        },
        places: {
          homeFolder: '/home/alex',
          platform: 'linux',
          userFile: '/home/alex/.ssh/config',
          systemFile: '/etc/ssh/ssh_config',
        },
        configFile: () => '',
      },
    },
    {
      ...assembly,
      options:
        connectResult === undefined
          ? assembly.options
          : {
              ...assembly.options,
              connector: {
                ...assembly.options.connector,
                connect: () => Promise.resolve(connectResult),
              },
            },
      connector,
      killLocalServer,
      maintain,
    },
    resolversGranted,
  );
  return {seen, registration, recording, state, sink};
}

/** A connect that succeeds. */
const CONNECTED: Connected = {
  address: {host: '127.0.0.1', port: 4321},
  connectionToken: 'token',
  extensionHostEnv: {},
  environmentTunnels: [],
  trusted: false,
};

describe("the connect's registration", () => {
  it('contracts §3.2: the resolver of ssh-remote is registered when the editor grants the proposal', async () => {
    const {seen, registration} = await registered(true);
    deepStrictEqual(
      [registration.registration, seen.events],
      ['registered', ['register ssh-remote']],
    );
  });

  it('F-3903 §5 rule 4: without the resolvers grant the registration reports the missing proposal', async () => {
    const {registration} = await registered(false);
    deepStrictEqual(registration.registration, 'proposalMissing');
  });

  it('F-3903 §5 rule 4: without the resolvers grant every served command is registered', async () => {
    const granted = await registered(true);
    const missing = await registered(false);
    deepStrictEqual(
      [...missing.seen.commands.keys()].sort(),
      [...granted.seen.commands.keys()].sort(),
    );
  });

  it('F-3903 §5 rule 4: without the resolvers grant Connect to Host still opens the window', async () => {
    const {seen} = await registered(false);
    await seen.commands.get('opensshremotes.openEmptyWindow')?.({host: 'dev'});
    deepStrictEqual(seen.remote, [['ssh-remote+dev', 'new']]);
  });

  it('F-3903 §5 rule 4: without the resolvers grant nothing of the resolver is registered', async () => {
    const {seen} = await registered(false);
    deepStrictEqual([seen.events, seen.labels], [[], 0]);
  });

  it('F-3903 §5 rule 4: without a resolver Open Web UI opens nothing', async () => {
    const {seen} = await registered(false, 4321);
    await seen.commands.get('opensshremotes.openWebUI')?.();
    deepStrictEqual(seen.opened, []);
  });

  it('F-3903 §5 rule 4: without a resolver Show Details does nothing', async () => {
    const {seen} = await registered(false);
    seen.commands.get('opensshremotes.showDetails')?.();
    deepStrictEqual(seen.revealed, 0);
  });

  it('F-3903 §5 rule 4: without a resolver the active-host command opens nothing', async () => {
    const {seen} = await registered(false);
    await seen.commands.get('opensshremotes.openEmptyWindowOnCurrentHost')?.();
    deepStrictEqual(seen.remote, []);
  });

  it('F-2304, F-2405, F-2605: Open Web UI, Clear and the details command are registered with the resolver', async () => {
    const {seen} = await registered(true);
    deepStrictEqual(
      [...seen.commands.keys()].filter(command =>
        [
          'opensshremotes.openWebUI',
          'opensshremotes.clearAllSessionHints',
          'opensshremotes.showDetails',
        ].includes(command),
      ),
      [
        'opensshremotes.openWebUI',
        'opensshremotes.clearAllSessionHints',
        'opensshremotes.showDetails',
      ],
    );
  });

  it('connect-21, connect-23: the connect and maintenance commands are registered with the resolver', async () => {
    const {seen} = await registered(true);
    deepStrictEqual(
      [...seen.commands.keys()]
        .filter(
          command => command.includes('Empty') || command.includes('clean'),
        )
        .sort(),
      [
        'opensshremotes.cleanCurrentRemoteServer',
        'opensshremotes.cleanDevBox',
        'opensshremotes.cleanLocalServer',
        'opensshremotes.cleanRemoteServer',
        'opensshremotes.openEmptyWindow',
        'opensshremotes.openEmptyWindowInCurrentWindow',
        'opensshremotes.openEmptyWindowOnCurrentHost',
      ],
    );
  });

  it('connect-22: Add New SSH Host... asks for the connection command', async () => {
    const {seen} = await registered(true);
    await seen.commands.get('opensshremotes.addNewSshHost')?.();
    deepStrictEqual(seen.inputs, 1);
  });

  it('connect-22: Add New SSH Host... asks for the connection command without the resolvers grant', async () => {
    const {seen} = await registered(false);
    await seen.commands.get('opensshremotes.addNewSshHost')?.();
    deepStrictEqual(seen.inputs, 1);
  });

  it('connect-21: Connect to Host... picks a host and opens it in a new window', async () => {
    const {seen} = await registered(true);
    await seen.commands.get('opensshremotes.openEmptyWindow')?.();
    deepStrictEqual(seen.remote, [['ssh-remote+dev', 'new']]);
  });

  it('connect-21: Kill Local Connection Server ends the server of the picked host', async () => {
    const {seen} = await registered(true);
    await seen.commands.get('opensshremotes.cleanLocalServer')?.();
    deepStrictEqual(seen.killed, ['dev']);
  });

  it('F-2411.AC-5: Kill VS Code Server on Host... runs the kill on the picked host and says it was killed', async () => {
    const {seen} = await registered(true);
    await seen.commands.get('opensshremotes.cleanRemoteServer')?.();
    deepStrictEqual(
      [seen.maintained, seen.notices],
      [['kill dev'], [['Killed VS Code Server on dev.', ['Open Logs']]]],
    );
  });

  it('F-2411 POST-3: the kill ends the local connection server of the host through the registration', async () => {
    const {seen} = await registered(true);
    await seen.commands.get('opensshremotes.cleanRemoteServer')?.();
    deepStrictEqual(seen.killed, ['dev']);
  });

  it('F-2411.AC-8: Open Logs on the notice reveals the log', async () => {
    const {seen} = await registered(true);
    seen.noticeAnswer = 'Open Logs';
    await seen.commands.get('opensshremotes.cleanRemoteServer')?.();
    deepStrictEqual(seen.revealed, 1);
  });

  it('F-2412.AC-4: Uninstall VS Code Server from Host... runs the uninstall on the picked host and shows nothing', async () => {
    const {seen} = await registered(true);
    await seen.commands.get('opensshremotes.cleanDevBox')?.();
    deepStrictEqual([seen.maintained, seen.notices], [['uninstall dev'], []]);
  });

  /** What a resolve of the window ends in after the own-host uninstall: the events it left. */
  async function eventsOfResolveAfterUninstall(
    switchFails: boolean,
  ): Promise<string[]> {
    const {seen, recording} = await registered(
      true,
      'none',
      undefined,
      undefined,
      {switchFails},
    );
    await Promise.resolve(
      seen.commands.get('opensshremotes.cleanDevBox')?.(),
    ).catch(() => undefined);
    seen.events.length = 0;
    await recording
      .registered()
      ?.resolve('ssh-remote+dev', {resolveAttempt: 1})
      .catch(() => undefined);
    return seen.events;
  }

  it('F-2412 AC-17: after the own-host uninstall the window’s resolves end handled with no progress', async () => {
    deepStrictEqual(await eventsOfResolveAfterUninstall(false), [
      'notAvailable undefined true',
    ]);
  });

  it('F-2412 AC-17: a switch that fails puts the resolver back, so the next resolve runs', async () => {
    deepStrictEqual(
      (await eventsOfResolveAfterUninstall(true)).some(event =>
        event.startsWith('progress'),
      ),
      true,
    );
  });

  it('connect-21: the active-host command opens nothing before the window has a connection', async () => {
    const {seen} = await registered(true);
    await seen.commands.get('opensshremotes.openEmptyWindowOnCurrentHost')?.();
    deepStrictEqual(seen.remote, []);
  });

  it('connect-21: the active-host command opens nothing while the connection is still resolving', async () => {
    const {seen, recording} = await registered(true);
    void recording
      .registered()
      ?.resolve('ssh-remote+alex@devbox:22', {resolveAttempt: 1})
      .catch(() => undefined);
    await Promise.resolve();
    await seen.commands.get('opensshremotes.openEmptyWindowOnCurrentHost')?.();
    deepStrictEqual(seen.remote, []);
  });

  it("F-2304: the details command reveals the connection's log", async () => {
    const {seen} = await registered(true);
    seen.commands.get('opensshremotes.showDetails')?.();
    deepStrictEqual(seen.revealed, 1);
  });

  it("F-2002: Open Web UI opens the server's address of the connection the window holds", async () => {
    const {seen} = await registered(true, 4321);
    await seen.commands.get('opensshremotes.openWebUI')?.();
    deepStrictEqual(seen.opened, ['http://localhost:4321/']);
  });

  it('F-2605.AC-20: the clear command shows nothing: no notification, dialog, pick or progress', async () => {
    const shown: string[] = [];
    const surfaces: ConnectSurfaces = {
      ...surfacesOf(
        {inspectSetting: () => ({})},
        template => template,
        () => undefined,
      ),
      prompts: {
        pick: () => {
          shown.push('pick');
          return Promise.resolve(undefined);
        },
        maskedInput: () => {
          shown.push('pick');
          return Promise.resolve(undefined);
        },
        translate: template => template,
      },
      presenter: {
        present: () => {
          shown.push('failure');
          return Promise.resolve('handled');
        },
      },
      downloadProgress: {
        show: () => {
          shown.push('progress');
          return {report: () => undefined, close: () => undefined};
        },
      },
    };
    const {seen} = await registered(true, 'none', surfaces);
    await seen.commands.get('opensshremotes.clearAllSessionHints')?.();
    deepStrictEqual(shown, []);
  });

  it('contracts §3.2: disposing undoes the commands and unregisters the resolver', async () => {
    const {seen, registration} = await registered(true);
    registration.dispose();
    deepStrictEqual(
      [[...seen.disposed].sort(), seen.events.at(-1)],
      [
        [
          'opensshremotes.showDetails',
          'opensshremotes.openWebUI',
          'opensshremotes.clearAllSessionHints',
          'opensshremotes.openEmptyWindow',
          'opensshremotes.openEmptyWindowInCurrentWindow',
          'opensshremotes.openEmptyWindowOnCurrentHost',
          'opensshremotes.cleanLocalServer',
          'opensshremotes.cleanRemoteServer',
          'opensshremotes.cleanDevBox',
          'opensshremotes.cleanCurrentRemoteServer',
          'opensshremotes.addNewSshHost',
        ].sort(),
        'unregister ssh-remote',
      ],
    );
  });

  it('F-3903 §5 rule 4: disposing the commands registered without a resolver ends each of them', async () => {
    const {seen, registration} = await registered(false);
    registration.dispose();
    deepStrictEqual(
      [...seen.disposed].sort(),
      [...seen.commands.keys()].sort(),
    );
  });

  it('connect-33: without a resolver the Ports view is never enabled', async () => {
    const {seen} = await registered(false);
    deepStrictEqual(seen.portsViews, 0);
  });

  it('contracts §3.2: the active connection is nothing before any resolve', async () => {
    const {registration} = await registered(true);
    deepStrictEqual(registration.activeConnection(), undefined);
  });

  it('contracts §3.2: the active connection after a resolve that succeeded names the host key and the success', async () => {
    const {registration, recording} = await registered(
      true,
      'none',
      undefined,
      CONNECTED,
    );
    await recording
      .registered()
      ?.resolve('ssh-remote+dev', {resolveAttempt: 1});
    deepStrictEqual(registration.activeConnection(), {
      hostKey: 'dev',
      lastResolve: 'succeeded',
    });
  });

  it('contracts §3.2: without the resolvers grant there is no active connection', async () => {
    const {registration} = await registered(false);
    deepStrictEqual(registration.activeConnection(), undefined);
  });

  it('F-2601: the window has no alias before its first resolve', async () => {
    const {registration} = await registered(true);
    deepStrictEqual(registration.currentAlias(), '');
  });

  it('F-2601: a registration without a resolver names no alias', async () => {
    const {registration} = await registered(false);
    deepStrictEqual(registration.currentAlias(), '');
  });

  it("F-2601: once a resolve starts, the alias is the window's host as the user wrote it", async () => {
    const {registration, recording} = await registered(true);
    void recording
      .registered()
      ?.resolve('ssh-remote+alex@devbox:22', {resolveAttempt: 1})
      .catch(() => undefined);
    await Promise.resolve();
    deepStrictEqual(registration.currentAlias(), 'devbox');
  });
});
