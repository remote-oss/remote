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
    {...assembly, connector},
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

  it('F-3903: nothing is registered when the editor does not grant the resolvers proposal', async () => {
    const {seen, registration} = await registered(false);
    deepStrictEqual(
      [registration.registration, seen.events, [...seen.commands.keys()]],
      ['proposalMissing', [], []],
    );
  });

  it('F-2304, F-2405, F-2605: Open Web UI, Clear and the details command are registered with the resolver', async () => {
    const {seen} = await registered(true);
    deepStrictEqual(
      [...seen.commands.keys()],
      [
        'opensshremotes.openWebUI',
        'opensshremotes.clearAllSessionHints',
        'opensshremotes.showDetails',
      ],
    );
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
      [seen.disposed, seen.events.at(-1)],
      [
        [
          'opensshremotes.showDetails',
          'opensshremotes.openWebUI',
          'opensshremotes.clearAllSessionHints',
        ],
        'unregister ssh-remote',
      ],
    );
  });

  it('contracts §3.2: disposing a registration that registered nothing does nothing', async () => {
    const {seen, registration} = await registered(false);
    registration.dispose();
    deepStrictEqual(seen.disposed, []);
  });

  it('F-2601: the window has no alias before its first resolve', async () => {
    const {registration} = await registered(true);
    deepStrictEqual(registration.currentAlias(), '');
  });

  it('F-2601: a registration that registered nothing names no alias', async () => {
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
