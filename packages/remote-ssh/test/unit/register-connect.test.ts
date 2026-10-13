import {deepStrictEqual} from 'node:assert';
import {recordingResolverEditor} from 'lib-authority/testing/recording-resolver-editor';
import type {CommandHost} from 'lib-identifiers';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type ConnectSurfaces,
  connectAssemblyOf,
} from '../../src/connect-ports.ts';
import {registerConnect} from '../../src/register-connect.ts';
import {nodeMachineOf} from '../../src/node-machine.ts';
import {PROFILE, surfacesOf} from './server-steps.fixture.ts';

/** What the fakes saw. */
interface Seen {
  events: string[];
  commands: Map<string, (...given: unknown[]) => unknown>;
  disposed: string[];
  labels: number;
  revealed: number;
  opened: string[];
  killed: string[];
  remote: Array<[string, string]>;
}

/** The registration over fakes; the connector's server port is `serverPort`. */
async function registered(
  resolversGranted: boolean,
  serverPort: number | 'none' = 'none',
  surfaces?: ConnectSurfaces,
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
    revealed: 0,
    opened: [],
    killed: [],
    remote: [],
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
  const connector = {...assembly.connector, serverPort: () => serverPort};
  function killLocalServer(hostString: string): Promise<void> {
    seen.killed.push(hostString);
    return Promise.resolve();
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
    },
    {...assembly, connector, killLocalServer},
    resolversGranted,
  );
  return {seen, registration, recording, state, sink};
}

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

  it('connect-21: the four connect commands are registered with the resolver', async () => {
    const {seen} = await registered(true);
    deepStrictEqual(
      [...seen.commands.keys()]
        .filter(
          command => command.includes('Empty') || command.includes('clean'),
        )
        .sort(),
      [
        'opensshremotes.cleanLocalServer',
        'opensshremotes.openEmptyWindow',
        'opensshremotes.openEmptyWindowInCurrentWindow',
        'opensshremotes.openEmptyWindowOnCurrentHost',
      ],
    );
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
