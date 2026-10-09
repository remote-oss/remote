import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import type {HelperControl, PlainData} from 'lib-helper';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {
  ConnectionHandler,
  type ConnectionHandlerOptions,
} from '../../src/index.ts';
import {ScriptedSpawner, startError} from './fake-client-process.ts';

const INVOCATION = {
  program: 'ssh',
  arguments: ['-v', '-D', '127.0.0.1:41000', 'host'],
  environment: {},
};
const RECORD = {
  remotePort: 41001,
  operatingSystem: 'linux',
  architecture: 'x64',
  temporaryFolder: '/tmp',
  connectionToken: 'token-value',
};
const AUTHENTICATED =
  'Authenticated to 192.0.2.10 ([192.0.2.10]:22) using "publickey".\n';

async function settled(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await Promise.resolve();
  }
}

describe('connection handler (contracts §4 S9)', () => {
  let clock: FakeClock;
  let spawner: ScriptedSpawner;
  let handler: ConnectionHandler;
  let events: PlainData[];
  let stops: number;
  let logged: string[];

  function create(changes: Partial<ConnectionHandlerOptions> = {}): void {
    handler = new ConnectionHandler({
      invocation: INVOCATION,
      socksPort: 41000,
      spawner: spawner.spawn,
      askpassEnvironment: {},
      editorEnvironment: {},
      waitSettings: {connectTimeoutSeconds: 10, unboundedWaitSeconds: 120},
      scheduler: clock.scheduler(),
      logLine: line => logged.push(line),
      ...changes,
    });
    const control: HelperControl = {
      broadcast: body => events.push(body),
      stop: () => {
        stops += 1;
      },
    };
    handler.attach(control);
  }

  function send(lease: number, body: PlainData): Promise<PlainData> {
    return handler.onRequest(body, {lease, broadcast: () => undefined});
  }

  function wasKilled(): boolean {
    return spawner.started[0]?.killed === true;
  }

  function eventTypes(): unknown[] {
    return events.map(event => (event as {type: string}).type);
  }

  beforeEach(() => {
    clock = new FakeClock();
    spawner = new ScriptedSpawner(() => undefined);
    events = [];
    stops = 0;
    logged = [];
    create();
  });

  describe('login ownership', () => {
    it('tells the windows who owns the login as leases come and go', () => {
      handler.onLeasesChanged([1, 2]);
      handler.onLeasesChanged([2]);
      deepStrictEqual(events, [
        {type: 'ownerChanged', owner: 1},
        {type: 'ownerChanged', owner: 2},
      ]);
    });

    it('refuses a connect from a window that is not the owner, and starts nothing', async () => {
      handler.onLeasesChanged([1, 2]);
      const reply = await send(2, {type: 'connect'});
      deepStrictEqual(
        [reply, spawner.started.length],
        [{type: 'refused', reason: 'notOwner'}, 0],
      );
    });
  });

  describe('connect', () => {
    beforeEach(() => {
      handler.onLeasesChanged([1, 2]);
      events.length = 0;
    });

    it('starts ssh once, with the invocation, for the owner', async () => {
      const reply = await send(1, {type: 'connect'});
      deepStrictEqual(
        [
          reply,
          spawner.started.map(started => [
            started.specification.program,
            started.specification.programArguments,
          ]),
        ],
        [{type: 'accepted'}, [['ssh', INVOCATION.arguments]]],
      );
    });

    it('refuses a second connect while the first is under way', async () => {
      await send(1, {type: 'connect'});
      deepStrictEqual(await send(1, {type: 'connect'}), {
        type: 'refused',
        reason: 'alreadyConnecting',
      });
    });

    it('reports the SOCKS port at the authentication line, even when pieces split it', async () => {
      await send(1, {type: 'connect'});
      const client = spawner.started[0];
      client?.error('debug1: Server accepts key\nAuthenticated to 192.0.2.10');
      const before = [...events];
      client?.error(' ([192.0.2.10]:22) using "publickey".\n');
      deepStrictEqual(
        [before, events],
        [[], [{type: 'connected', socksPort: 41000}]],
      );
    });

    it('refuses a connect once the connection is set up, and ignores the lines after it', async () => {
      await send(1, {type: 'connect'});
      spawner.started[0]?.error(AUTHENTICATED);
      spawner.started[0]?.error('debug1: Entering interactive session.\n');
      const reply = await send(2, {type: 'connect'});
      deepStrictEqual(
        [reply, eventTypes()],
        [{type: 'refused', reason: 'alreadyConnected'}, ['connected']],
      );
    });

    it('keeps the login with the owner once the connection is set up', async () => {
      await send(1, {type: 'connect'});
      spawner.started[0]?.error(AUTHENTICATED);
      handler.onLeasesChanged([2]);
      deepStrictEqual(eventTypes(), ['connected']);
    });
  });

  describe('a login that fails', () => {
    beforeEach(async () => {
      handler.onLeasesChanged([1, 2]);
      events.length = 0;
      await send(1, {type: 'connect'});
    });

    it('is classified, and the next window takes the login', async () => {
      spawner.started[0]?.error('dev@host: Permission denied (publickey).\r\n');
      spawner.started[0]?.exit(255);
      await settled();
      deepStrictEqual(events, [
        {
          type: 'loginFailed',
          kind: 'authentication',
          reason: {text: 'Permission denied (publickey).'},
          hints: [
            {
              status: 'PermissionDenied',
              message: 'Error: PermissionDenied',
              details: {text: 'Permission denied (publickey).'},
              mitigations: [],
              resources: [],
            },
          ],
        },
        {type: 'ownerChanged', owner: 2},
      ]);
    });

    it('lets the new owner connect again with a new ssh', async () => {
      spawner.started[0]?.exit(255);
      await settled();
      const reply = await send(2, {type: 'connect'});
      deepStrictEqual([reply, spawner.started.length], [{type: 'accepted'}, 2]);
    });

    it('is a timeout when the wait runs out, and ssh is ended', async () => {
      clock.advance(11999);
      const early = wasKilled();
      clock.advance(1);
      await settled();
      deepStrictEqual(
        [early, wasKilled(), (events[0] as {kind: string}).kind],
        [false, true, 'timeout'],
      );
    });

    it('keeps the kind the text gives when the wait ran out on a known failure', async () => {
      spawner.started[0]?.error(
        'ssh: connect to host h port 22: Could not resolve hostname h: Name or service not known\n',
      );
      clock.advance(12000);
      await settled();
      strictEqual((events[0] as {kind: string}).kind, 'unreachable');
    });

    it('reads the last line of ssh when it ended without a line end', async () => {
      spawner.started[0]?.error('dev@host: Permission denied (password).');
      spawner.started[0]?.exit(255);
      await settled();
      strictEqual((events[0] as {kind: string}).kind, 'authentication');
    });

    it('does not time out after the setup report', () => {
      spawner.started[0]?.error(AUTHENTICATED);
      clock.advance(60000);
      deepStrictEqual(
        [spawner.started[0]?.killed, eventTypes()],
        [false, ['connected']],
      );
    });
  });

  describe('ssh that cannot start', () => {
    it('is a failed login of an unknown kind and is logged', async () => {
      spawner = new ScriptedSpawner(startError('ENOENT', 'spawn ssh ENOENT'));
      create();
      handler.onLeasesChanged([1, 2]);
      events.length = 0;
      const reply = await send(1, {type: 'connect'});
      deepStrictEqual(
        [reply, events, logged],
        [
          {type: 'accepted'},
          [
            {type: 'loginFailed', kind: 'unknown', hints: []},
            {type: 'ownerChanged', owner: 2},
          ],
          ['ssh did not start: clientVanished'],
        ],
      );
    });
  });

  describe('a connection that was set up', () => {
    beforeEach(async () => {
      handler.onLeasesChanged([1]);
      await send(1, {type: 'connect'});
      spawner.started[0]?.error(AUTHENTICATED);
      events.length = 0;
    });

    it('tells the windows when ssh ends, and ends the helper', async () => {
      spawner.started[0]?.exit(255);
      await settled();
      deepStrictEqual([events, stops], [[{type: 'transportLost'}], 1]);
    });
  });

  describe('kill', () => {
    beforeEach(() => {
      handler.onLeasesChanged([1]);
      events.length = 0;
    });

    it('ends ssh and the helper without an event, also while the login is under way', async () => {
      await send(1, {type: 'connect'});
      const reply = await send(1, {type: 'kill'});
      await settled();
      deepStrictEqual(
        [reply, wasKilled(), events, stops],
        [{type: 'accepted'}, true, [], 1],
      );
    });

    it('ends ssh without a lost-connection event after the connection was set up', async () => {
      await send(1, {type: 'connect'});
      spawner.started[0]?.error(AUTHENTICATED);
      events.length = 0;
      await send(1, {type: 'kill'});
      await settled();
      deepStrictEqual([events, stops], [[], 1]);
    });

    it('ends the helper when nothing runs', async () => {
      const reply = await send(1, {type: 'kill'});
      deepStrictEqual([reply, events, stops], [{type: 'accepted'}, [], 1]);
    });

    it('ends an ssh that started after the kill', async () => {
      let start: (() => void) | undefined;
      const slow = new ScriptedSpawner(() => undefined);
      create({
        spawner: specification =>
          new Promise((resolve, reject) => {
            start = () => {
              slow.spawn(specification).then(resolve, reject);
            };
          }),
      });
      handler.onLeasesChanged([1]);
      events.length = 0;
      const connecting = send(1, {type: 'connect'});
      await send(1, {type: 'kill'});
      start?.();
      await connecting;
      deepStrictEqual([slow.started[0]?.killed, events, stops], [true, [], 1]);
    });
  });

  describe('the shared record', () => {
    it('is empty before one is set', async () => {
      deepStrictEqual(await send(1, {type: 'sharedRecord'}), {
        type: 'sharedRecord',
        record: null,
      });
    });

    it('cannot be set before the connection is set up', async () => {
      handler.onLeasesChanged([1]);
      await rejects(
        send(1, {type: 'setSharedRecord', record: RECORD}),
        /not set up/,
      );
    });

    it('is kept in memory once set, and given to a later window', async () => {
      handler.onLeasesChanged([1]);
      await send(1, {type: 'connect'});
      spawner.started[0]?.error(AUTHENTICATED);
      const stored = await send(1, {type: 'setSharedRecord', record: RECORD});
      const shared = await send(2, {type: 'sharedRecord'});
      deepStrictEqual(
        [stored, shared],
        [{type: 'accepted'}, {type: 'sharedRecord', record: RECORD}],
      );
    });
  });

  describe('other requests', () => {
    it('answers no question, since none is open', async () => {
      deepStrictEqual(await send(1, {type: 'answer', promptId: 1, text: 'x'}), {
        type: 'answered',
        accepted: false,
      });
    });

    it('fails a body that is no request', async () => {
      await rejects(send(1, {type: 'dance'}), /not a connection request/);
    });

    it('has no end action', async () => {
      await handler.runAction();
    });
  });
});
