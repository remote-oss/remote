import {deepStrictEqual} from 'node:assert';
import {recordingResolverEditor} from 'lib-authority/testing/recording-resolver-editor';
import type {CommandHost} from 'lib-identifiers';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {connectAssemblyOf} from '../../src/connect-ports.ts';
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
): Promise<{
  seen: Seen;
  registration: Awaited<ReturnType<typeof registerConnect>>;
  recording: ReturnType<typeof recordingResolverEditor>;
}> {
  const seen: Seen = {
    events: [],
    commands: new Map(),
    disposed: [],
    labels: 0,
    revealed: 0,
    opened: [],
  };
  const surfaces = surfacesOf(
    {inspectSetting: () => ({})},
    template => template,
    () => {
      seen.revealed += 1;
    },
  );
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
  const assembly = connectAssemblyOf(
    surfaces,
    machine,
    createLogger(new MemorySink(), {minimumLevel: (): Level => 'info'}),
  );
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
    },
    {...assembly, connector},
    resolversGranted,
  );
  return {seen, registration, recording};
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

  it('F-2304, F-2405: Open Web UI and the details command are registered with the resolver', async () => {
    const {seen} = await registered(true);
    deepStrictEqual(
      [...seen.commands.keys()],
      ['opensshremotes.openWebUI', 'opensshremotes.showDetails'],
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

  it('contracts §3.2: disposing undoes the commands and unregisters the resolver', async () => {
    const {seen, registration} = await registered(true);
    registration.dispose();
    deepStrictEqual(
      [seen.disposed, seen.events.at(-1)],
      [
        ['opensshremotes.showDetails', 'opensshremotes.openWebUI'],
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
