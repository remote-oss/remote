import {deepStrictEqual} from 'node:assert';
import type {LastResolve, OpenerHost} from 'lib-authority';
import {
  createProtocol,
  SSH_ENDPOINTS,
  type Timers,
  type VersionMismatch,
  writeActiveRemote,
  writeEnvelope,
  writeHostnames,
} from 'lib-companion';
import {createRecordingFake} from 'lib-companion/testing/recording-fake';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {HostListResult} from 'lib-ssh';
import {windowlessLine} from '../../src/connect/windowless.ts';
import {
  hostListLine,
  mismatchLine,
  serveSliceEndpoints,
  type SliceEndpointPorts,
} from '../../src/companion/slice-endpoints.ts';

const HOSTS = SSH_ENDPOINTS.getConfiguredHostnames.commandId;
const ACTIVE = SSH_ENDPOINTS.getActiveSshRemote.commandId;
const OPEN = SSH_ENDPOINTS.openRemoteSshTarget.commandId;
const ENVELOPE = writeEnvelope();
const HEX_KEY =
  '7b22686f73744e616d65223a2231302e302e302e35222c2275736572223a226c6162227d';
const NO_TIMERS: Timers = {
  setTimer: () => undefined,
  clearTimer: () => undefined,
};

/** The world one row runs in: the ports with what they were asked, and the fake bus the endpoints are served on. */
interface World {
  fake: ReturnType<typeof createRecordingFake>;
  sink: MemorySink;
  listCalls: number;
  activeCalls: number;
  opened: unknown[][];
  hostList: () => HostListResult;
  hostSource: () => string;
  connection: () => {hostKey: string; lastResolve: LastResolve} | undefined;
  openerFailure: Error | undefined;
  mismatches: string[];
  /** Whether the editor grants `resolvers`. */
  resolversGranted: boolean;
}

function worldWith(changes: Partial<World> = {}): World {
  return {
    fake: createRecordingFake(),
    sink: new MemorySink(),
    listCalls: 0,
    activeCalls: 0,
    opened: [],
    hostList: () => ({hosts: []}),
    hostSource: () => '',
    connection: () => undefined,
    openerFailure: undefined,
    mismatches: [],
    resolversGranted: true,
    ...changes,
  };
}

function served(world: World) {
  const opener: OpenerHost = {
    executeCommand: (command, ...parameters) => {
      world.opened.push([command, ...parameters]);
      return world.openerFailure === undefined
        ? Promise.resolve()
        : Promise.reject(world.openerFailure);
    },
    addressOf: parts => parts,
  };
  const ports: SliceEndpointPorts = {
    listHosts: () => {
      world.listCalls += 1;
      return world.hostList();
    },
    hostSource: () => world.hostSource(),
    activeConnection: () => {
      world.activeCalls += 1;
      return world.connection();
    },
    opener,
    logger: createLogger(world.sink, {minimumLevel: () => 'trace'}),
    resolversGranted: world.resolversGranted,
  };
  const protocol = createProtocol({
    // eslint-disable-next-line id-length -- the protocol's option is named bus
    bus: world.fake,
    timers: NO_TIMERS,
    onVersionMismatch: (mismatch: VersionMismatch) => {
      world.mismatches.push(mismatchLine(mismatch));
    },
  });
  return serveSliceEndpoints(protocol, ports);
}

/** Calls a served command as the editor would, with the arguments given. */
function call(world: World, commandId: string, ...given: unknown[]): unknown {
  return world.fake.registered(commandId)?.(...given);
}

/** The message a call was refused with. */
async function refusalOf(pending: unknown): Promise<string> {
  try {
    await pending;
    return 'not refused';
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

const OPEN_NEW = {...ENVELOPE, hostKey: 'harness', window: 'new'};

describe('the slice endpoints served to Remote Explorer (card ssh-provider-01)', () => {
  it('F-3906.5 rule 1: the three ids are served and the history ids are not, and disposing ends all of them', () => {
    const world = worldWith();
    const registration = served(world);
    const commandIds = [
      HOSTS,
      ACTIVE,
      OPEN,
      'remote-internal.getSshFoldersHistory',
      'remote-internal.deleteSshFolderFromHistory',
    ];
    const before = commandIds.map(
      commandId => typeof world.fake.registered(commandId),
    );
    registration.dispose();
    registration.dispose();
    deepStrictEqual(
      [before, commandIds.map(commandId => world.fake.registered(commandId))],
      [
        ['function', 'function', 'function', 'undefined', 'undefined'],
        [undefined, undefined, undefined, undefined, undefined],
      ],
    );
  });

  it('F-3906.5 rule 2: the host list answers the names in the order of the list, read once', () => {
    const world = worldWith({
      hostList: () => ({
        hosts: [
          {name: 'zeta', file: '/c'},
          {name: 'Alpha', file: '/c'},
          {name: 'two words', file: '/i'},
        ],
      }),
    });
    served(world);
    deepStrictEqual(
      [call(world, HOSTS, ENVELOPE), world.listCalls],
      [writeHostnames({hostnames: ['zeta', 'Alpha', 'two words']}), 1],
    );
  });

  it('F-5101.AC-14: F-3906.5 rule 2: a second call reads the list again', () => {
    const world = worldWith({
      hostList: () => ({hosts: [{name: 'one', file: '/c'}]}),
    });
    served(world);
    call(world, HOSTS, ENVELOPE);
    world.hostList = () => ({hosts: [{name: 'two', file: '/c'}]});
    deepStrictEqual(
      [call(world, HOSTS, ENVELOPE), world.listCalls],
      [writeHostnames({hostnames: ['two']}), 2],
    );
  });

  it('F-5102.AC-35: a re-read that fails answers the names last read from the same source, and logs the line once', () => {
    const world = worldWith({
      hostList: () => ({
        hosts: [
          {name: 'a', file: '/c'},
          {name: 'b', file: '/c'},
        ],
      }),
    });
    served(world);
    const first = call(world, HOSTS, ENVELOPE);
    world.hostList = () => ({parseError: {file: '/c', reason: 'bad line 3'}});
    const second = call(world, HOSTS, ENVELOPE);
    deepStrictEqual(
      [first, second, world.sink.lines.map(line => [line.level, line.message])],
      [
        writeHostnames({hostnames: ['a', 'b']}),
        writeHostnames({hostnames: ['a', 'b']}),
        [['warn', 'The Remotes view gets no hosts: /c: bad line 3']],
      ],
    );
  });

  it('F-5102.AC-35: a failure after the source changed rejects', async () => {
    const world = worldWith({
      hostList: () => ({hosts: [{name: 'keep', file: '/k'}]}),
    });
    served(world);
    call(world, HOSTS, ENVELOPE);
    world.hostSource = () => '/x/config';
    world.hostList = () => ({
      parseError: {file: '/x/config', reason: 'bad line 1'},
    });
    deepStrictEqual(
      await refusalOf(
        Promise.resolve().then(() => call(world, HOSTS, ENVELOPE)),
      ),
      '/x/config: bad line 1',
    );
  });

  it('F-5102.AC-35: a good read after a failure answers the new names', () => {
    const world = worldWith({
      hostList: () => ({hosts: [{name: 'a', file: '/c'}]}),
    });
    served(world);
    call(world, HOSTS, ENVELOPE);
    world.hostList = () => ({parseError: {file: '/c', reason: 'bad line 3'}});
    try {
      call(world, HOSTS, ENVELOPE);
    } catch {
      // The failure keeps the last good reading for the next read.
    }
    world.hostList = () => ({hosts: [{name: 'b', file: '/c'}]});
    deepStrictEqual(
      call(world, HOSTS, ENVELOPE),
      writeHostnames({hostnames: ['b']}),
    );
  });

  it('F-5101.AC-14: F-5902.5.failure: a host list that cannot be read rejects with the parser message', () => {
    const world = worldWith({
      hostList: () => ({parseError: {file: '/c', reason: 'bad line 3'}}),
    });
    served(world);
    let message = '';
    try {
      call(world, HOSTS, ENVELOPE);
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    deepStrictEqual(message, '/c: bad line 3');
  });

  it('F-5902.5.failure: a host list that cannot be read is told once, at warn', () => {
    const world = worldWith({
      hostList: () => ({parseError: {file: '/c', reason: 'bad line 3'}}),
    });
    served(world);
    try {
      call(world, HOSTS, ENVELOPE);
    } catch {
      // The call rejects, as the row before checks.
    }
    deepStrictEqual(
      world.sink.lines.map(line => [line.level, line.message]),
      [['warn', 'The Remotes view gets no hosts: /c: bad line 3']],
    );
  });

  for (const argument of [
    undefined,
    {interfaceVersion: {major: 2, minor: 0}},
  ]) {
    it(`F-5902.AC-13: F-5902.5.foreign: the argument ${JSON.stringify(argument)} gets the empty answers and reads nothing`, () => {
      const world = worldWith();
      served(world);
      deepStrictEqual(
        [
          call(world, HOSTS, argument),
          call(world, ACTIVE, argument),
          world.listCalls,
          world.activeCalls,
        ],
        [
          writeHostnames({hostnames: []}),
          writeActiveRemote({connected: false}),
          0,
          0,
        ],
      );
    });
  }

  it('F-5103.AC-29, AC-32, AC-35: F-2503.BR-9: a connection whose last resolve succeeded is the active remote, answered synchronously', () => {
    const world = worldWith({
      connection: () => ({hostKey: 'Build-Box', lastResolve: 'succeeded'}),
    });
    served(world);
    const answer = call(world, ACTIVE, ENVELOPE);
    deepStrictEqual(
      [answer, answer instanceof Promise],
      [writeActiveRemote({connected: true, hostKey: 'Build-Box'}), false],
    );
  });

  it('F-2503.BR-4: a hex host key is kept as it is', () => {
    const world = worldWith({
      connection: () => ({hostKey: HEX_KEY, lastResolve: 'succeeded'}),
    });
    served(world);
    deepStrictEqual(
      call(world, ACTIVE, ENVELOPE),
      writeActiveRemote({connected: true, hostKey: HEX_KEY}),
    );
  });

  const NOT_CONNECTED: Array<[string, World['connection']]> = [
    ['a local window', () => undefined],
    [
      'before the first success',
      () => ({hostKey: 'harness', lastResolve: 'none'}),
    ],
    [
      'after a failed resolve',
      () => ({hostKey: 'harness', lastResolve: 'failed'}),
    ],
  ];
  for (const [name, connection] of NOT_CONNECTED) {
    it(`F-5902.AC-8, AC-23: F-2503.BR-9: ${name} is not connected, with no host key and no host list read`, () => {
      const world = worldWith({connection});
      served(world);
      const answer = call(world, ACTIVE, ENVELOPE);
      deepStrictEqual(
        [
          answer,
          answer !== null && typeof answer === 'object' && 'hostKey' in answer,
          world.listCalls,
        ],
        [writeActiveRemote({connected: false}), false, 0],
      );
    });
  }

  it('F-5103.AC-24: F-3906.5 rule 6: a host opens in a new window and in the current one', async () => {
    const world = worldWith();
    served(world);
    const answers = [
      await call(world, OPEN, OPEN_NEW),
      await call(world, OPEN, {...OPEN_NEW, window: 'current'}),
    ];
    deepStrictEqual(
      [answers, world.opened],
      [
        [ENVELOPE, ENVELOPE],
        [
          [
            'vscode.newWindow',
            {remoteAuthority: 'ssh-remote+harness', reuseWindow: false},
          ],
          [
            'vscode.newWindow',
            {remoteAuthority: 'ssh-remote+harness', reuseWindow: true},
          ],
        ],
      ],
    );
  });

  it('F-3903 §5 rule 4: without the resolvers grant an open answers no change, opens no window and logs one line', async () => {
    const world = worldWith({resolversGranted: false});
    served(world);
    const answer = await call(world, OPEN, OPEN_NEW);
    deepStrictEqual(
      [
        answer,
        world.opened,
        world.sink.lines.map(line => [line.level, line.message]),
      ],
      [ENVELOPE, [], [['info', windowlessLine(OPEN)]]],
    );
  });

  it('F-3906.5 rule 6: a hex host key is the authority as it is', async () => {
    const world = worldWith();
    served(world);
    await call(world, OPEN, {...OPEN_NEW, hostKey: HEX_KEY});
    deepStrictEqual(world.opened, [
      [
        'vscode.newWindow',
        {remoteAuthority: `ssh-remote+${HEX_KEY}`, reuseWindow: false},
      ],
    ]);
  });

  for (const [name, path, kind] of [
    ['a folder', '/home/harness/f1', 'folder'],
    ['a workspace', '/home/harness/w.code-workspace', 'workspace'],
  ] as const) {
    it(`F-3906.5 rule 6: ${name} opens through the editor's open-folder command`, async () => {
      const world = worldWith();
      served(world);
      await call(world, OPEN, {...OPEN_NEW, path, kind});
      deepStrictEqual(world.opened, [
        [
          'vscode.openFolder',
          {scheme: 'vscode-remote', authority: 'ssh-remote+harness', path},
          {forceNewWindow: true, forceReuseWindow: false},
        ],
      ]);
    });
  }

  it('F-5902.5.contract: a kind without a path opens a window with no folder', async () => {
    const world = worldWith();
    served(world);
    const answer = await call(world, OPEN, {
      ...OPEN_NEW,
      kind: 'folder',
      window: 'current',
    });
    deepStrictEqual(
      [answer, world.opened],
      [
        ENVELOPE,
        [
          [
            'vscode.newWindow',
            {remoteAuthority: 'ssh-remote+harness', reuseWindow: true},
          ],
        ],
      ],
    );
  });

  it('F-5902.5.contract: a path without its kind is refused and opens nothing', async () => {
    const world = worldWith();
    served(world);
    const message = await refusalOf(
      call(world, OPEN, {...OPEN_NEW, path: '/p'}),
    );
    deepStrictEqual([message, world.opened], ['a path needs its kind', []]);
  });

  it('F-5902.5.contract: an empty host key is refused and opens nothing', async () => {
    const world = worldWith();
    served(world);
    const message = await refusalOf(
      call(world, OPEN, {...OPEN_NEW, hostKey: ''}),
    );
    deepStrictEqual([message, world.opened], ['the host key is empty', []]);
  });

  it('F-5902.5.failure: a refusal of the editor rejects the call with its reason', async () => {
    const world = worldWith({openerFailure: new Error('refused')});
    served(world);
    deepStrictEqual(await refusalOf(call(world, OPEN, OPEN_NEW)), 'refused');
  });

  it('F-3906.5 rule 9: the mismatch line names the command and both versions', () => {
    deepStrictEqual(
      mismatchLine({commandId: HOSTS, receivedMajor: 2, ownMajor: 1}),
      'remote-internal.getConfiguredHostnames: the other extension uses interface version 2, and Remote - SSH uses version 1. Update Remote - SSH and Remote Explorer to matching versions.',
    );
  });

  it('F-3906.5 rule 9: the hook is told once for a session of newer calls', () => {
    const world = worldWith();
    served(world);
    const newer = {interfaceVersion: {major: 2, minor: 0}};
    call(world, HOSTS, newer);
    call(world, ACTIVE, newer);
    call(world, HOSTS);
    deepStrictEqual(world.mismatches, [
      mismatchLine({commandId: HOSTS, receivedMajor: 2, ownMajor: 1}),
    ]);
  });

  it('F-3906.5 rule 6: the host list line is the one the view logs', () => {
    deepStrictEqual(
      hostListLine('/c', 'bad'),
      'The Remotes view gets no hosts: /c: bad',
    );
  });

  it('F-2503.BR-13: a served call logs nothing and sends no command of its own', async () => {
    const world = worldWith({
      connection: () => ({hostKey: 'harness', lastResolve: 'succeeded'}),
      hostList: () => ({hosts: [{name: 'one', file: '/c'}]}),
    });
    served(world);
    call(world, HOSTS, ENVELOPE);
    call(world, ACTIVE, ENVELOPE);
    await call(world, OPEN, OPEN_NEW);
    deepStrictEqual([world.sink.lines, world.fake.calls], [[], []]);
  });
});
