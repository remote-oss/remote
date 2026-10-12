import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import type {EndpointConnection, HelperControl, PlainData} from 'lib-helper';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
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
const ASKPASS_NONCE = 'askpass-nonce';
const ASKPASS_ENDPOINT = '/run/ra-0123456789abcdef.sock';
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
  let markers: number;
  let notices: PlainData[];

  function create(changes: Partial<ConnectionHandlerOptions> = {}): void {
    handler = new ConnectionHandler({
      invocation: INVOCATION,
      socksPort: 41000,
      spawner: spawner.spawn,
      askpassEnvironment: {},
      editorEnvironment: {},
      waitSettings: {
        connectTimeoutSeconds: 10,
        fromHost: false,
        unboundedWaitSeconds: 120,
      },
      scheduler: clock.scheduler(),
      askpass: {
        nonce: ASKPASS_NONCE,
        displayHost: 'h.invalid',
        firstMessageMilliseconds: 5000,
      },
      newMarker: () => {
        markers += 1;
        return `m${String(markers)}`;
      },
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
    return handler.onRequest(body, {
      lease,
      broadcast: () => undefined,
      notify: notice => notices.push(notice),
    });
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
    markers = 0;
    notices = [];
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
    it('is told to the windows as a failed start, and logged', async () => {
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
            {
              type: 'spawnFailed',
              cause: 'clientVanished',
              detail: 'spawn ssh ENOENT',
            },
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

  describe('the questions of ssh', () => {
    const QUESTION = "dev@h.invalid's password: ";
    let port: FakeEndpointPort;
    let program: {
      connection: EndpointConnection;
      received: unknown[];
      closed: boolean;
    };

    /** The askpass program asks `text` over the askpass endpoint. */
    async function askQuestion(text = QUESTION): Promise<typeof program> {
      program = {
        connection: await port.connect(ASKPASS_ENDPOINT),
        received: [],
        closed: false,
      };
      program.connection.onMessage(message => program.received.push(message));
      program.connection.onClose(() => {
        program.closed = true;
      });
      program.connection.send({type: 'ask', nonce: ASKPASS_NONCE, text});
      await settled();
      return program;
    }

    beforeEach(async () => {
      port = new FakeEndpointPort();
      await port.listen(ASKPASS_ENDPOINT, connection => {
        handler.acceptAskpass(connection);
      });
      handler.onLeasesChanged([1, 2]);
      await send(1, {type: 'connect'});
      events.length = 0;
    });

    it('goes to the windows as a prompt', async () => {
      await askQuestion();
      deepStrictEqual(events, [
        {type: 'prompt', promptId: 1, surface: 'maskedInput', text: QUESTION},
      ]);
    });

    it("passes the first window's answer to ssh and closes the question for the others", async () => {
      await askQuestion();
      const reply = await send(2, {
        type: 'answer',
        promptId: 1,
        text: 'secret',
      });
      await settled();
      deepStrictEqual(
        [reply, program.received, events.slice(1)],
        [
          {type: 'answered', accepted: true},
          [{type: 'answer', text: 'secret'}],
          [{type: 'promptClosed', promptId: 1}],
        ],
      );
    });

    it('refuses a second answer to the same question', async () => {
      await askQuestion();
      await send(1, {type: 'answer', promptId: 1, text: 'first'});
      deepStrictEqual(
        await send(2, {type: 'answer', promptId: 1, text: 'second'}),
        {type: 'answered', accepted: false},
      );
    });

    it('closes the question when ssh drops it', async () => {
      await askQuestion();
      program.connection.close();
      await settled();
      deepStrictEqual(events.slice(1), [{type: 'promptClosed', promptId: 1}]);
    });

    it('stops the connect wait while a question is open', async () => {
      await askQuestion();
      clock.advance(60000);
      deepStrictEqual(wasKilled(), false);
    });

    it('starts the whole connect wait over once the question is answered', async () => {
      await askQuestion();
      clock.advance(60000);
      await send(1, {type: 'answer', promptId: 1, text: 'secret'});
      clock.advance(11999);
      const early = wasKilled();
      clock.advance(1);
      deepStrictEqual([early, wasKilled()], [false, true]);
    });

    it('resumes the connect wait when ssh drops the question', async () => {
      await askQuestion();
      program.connection.close();
      await settled();
      clock.advance(12000);
      deepStrictEqual(wasKilled(), true);
    });

    it('shows an open question again to a window that joins, and not to one that leaves', async () => {
      await askQuestion();
      handler.onLeasesChanged([1, 2, 3]);
      handler.onLeasesChanged([1, 2]);
      deepStrictEqual(
        events.map(event => (event as {type: string}).type),
        ['prompt', 'prompt'],
      );
    });

    it('closes the open question before the login is reported failed', async () => {
      await askQuestion();
      spawner.started[0]?.exit(255);
      await settled();
      deepStrictEqual(
        events.slice(1, 3).map(event => (event as {type: string}).type),
        ['promptClosed', 'loginFailed'],
      );
    });

    it('closes the connection of the program when the login ends', async () => {
      await askQuestion();
      let closed = false;
      program.connection.onClose(() => {
        closed = true;
      });
      spawner.started[0]?.exit(255);
      await settled();
      deepStrictEqual(closed, true);
    });

    it('closes the open question when the server is killed', async () => {
      await askQuestion();
      await send(1, {type: 'kill'});
      deepStrictEqual(
        events.slice(1).map(event => (event as {type: string}).type),
        ['promptClosed'],
      );
    });

    it('ignores a question whose program does not know the nonce', async () => {
      const stranger = await port.connect(ASKPASS_ENDPOINT);
      stranger.send({type: 'ask', nonce: 'other', text: QUESTION});
      await settled();
      deepStrictEqual(events, []);
    });
    it("closes the owner's question on its refuse, with the promptClosed", async () => {
      const asked = await askQuestion();
      const reply = await send(1, {type: 'refuse', promptId: 1});
      deepStrictEqual(
        [reply, asked.closed, eventTypes()],
        [
          {type: 'questionRefused', accepted: true},
          true,
          ['prompt', 'promptClosed'],
        ],
      );
    });

    it('refuses a question that is not open', async () => {
      const asked = await askQuestion();
      const first = await send(1, {type: 'refuse', promptId: 1});
      const second = await send(1, {type: 'refuse', promptId: 2});
      deepStrictEqual(
        [first, second, asked.closed, eventTypes()],
        [
          {type: 'questionRefused', accepted: true},
          {type: 'questionRefused', accepted: false},
          true,
          ['prompt', 'promptClosed'],
        ],
      );
    });

    it('keeps the rest of the refused run silent: no prompt, the program closes at once', async () => {
      const first = await askQuestion();
      await send(1, {type: 'refuse', promptId: 1});
      const second = await askQuestion();
      deepStrictEqual(
        [first.closed, second.closed, eventTypes()],
        [true, true, ['prompt', 'promptClosed']],
      );
    });

    it('asks a new run after the run the refusal belonged to has failed', async () => {
      const first = await askQuestion();
      await send(1, {type: 'refuse', promptId: 1});
      spawner.started[0]?.exit(255);
      await settled();
      await send(2, {type: 'connect'});
      const second = await askQuestion('a second question');
      deepStrictEqual(
        [first.closed, second.closed, events.at(-1)],
        [
          true,
          false,
          {
            type: 'prompt',
            promptId: 2,
            surface: 'maskedInput',
            text: 'a second question',
          },
        ],
      );
    });

    it('answers the refuse of a window that is not the owner, and keeps the question open', async () => {
      const asked = await askQuestion();
      const reply = await send(2, {type: 'refuse', promptId: 1});
      deepStrictEqual(
        [reply, asked.closed, eventTypes()],
        [{type: 'questionRefused', accepted: false}, false, ['prompt']],
      );
    });

    it('refuses an answer that comes after the refuse of its question', async () => {
      const asked = await askQuestion();
      await send(1, {type: 'refuse', promptId: 1});
      const reply = await send(1, {type: 'answer', promptId: 1, text: 'late'});
      deepStrictEqual(
        [reply, asked.closed, eventTypes()],
        [{type: 'answered', accepted: false}, true, ['prompt', 'promptClosed']],
      );
    });
  });

  describe('scripts on the session', () => {
    const RUN_REQUEST = {
      type: 'runScript',
      runId: 7,
      script: 'echo hello',
      inputBase64: null,
      deadlineMilliseconds: 1000,
    } as const;

    async function connected(): Promise<void> {
      handler.onLeasesChanged([1, 2]);
      await send(1, {type: 'connect'});
      spawner.started[0]?.error(AUTHENTICATED);
      events.length = 0;
    }

    it('are refused before the connection is set up', async () => {
      handler.onLeasesChanged([1]);
      deepStrictEqual(await send(1, RUN_REQUEST), {
        type: 'scriptFailed',
        reason: 'notConnected',
        detail: 'the connection is not set up',
      });
    });

    it('are written to the standard input of the ssh session', async () => {
      await connected();
      void send(1, RUN_REQUEST);
      await settled();
      deepStrictEqual(
        spawner.started[0]?.inputText(),
        "printf '%s%s\\n' 'm1:st' 'art'\nsh -c 'echo hello' </dev/null\nprintf '%s%s %s\\n' 'm1:e' 'nd' \"$?\"\n",
      );
    });

    it('send their lines to the asking lease alone, and end with the exit status', async () => {
      await connected();
      const reply = send(1, RUN_REQUEST);
      await settled();
      spawner.started[0]?.output('motd\nm1:start\nhello\nm1:end 4\n');
      deepStrictEqual(
        [await reply, notices, events],
        [
          {type: 'scriptEnded', status: 4},
          [{type: 'scriptLine', runId: 7, line: 'hello'}],
          [],
        ],
      );
    });

    it('fail as a closed channel, and the windows hear of the lost connection, when ssh ends during a run', async () => {
      await connected();
      const reply = send(1, RUN_REQUEST);
      await settled();
      spawner.started[0]?.exit(255);
      deepStrictEqual(
        [await reply, eventTypes()],
        [
          {
            type: 'scriptFailed',
            reason: 'channelClosed',
            detail: 'the session ended',
          },
          ['transportLost'],
        ],
      );
    });

    it('fail as a timeout, and end the session, when the script does not end in time', async () => {
      await connected();
      const reply = send(1, RUN_REQUEST);
      await settled();
      clock.advance(1000);
      deepStrictEqual(
        [await reply, wasKilled()],
        [
          {
            type: 'scriptFailed',
            reason: 'timeout',
            detail: 'no end within 1000 ms',
          },
          true,
        ],
      );
    });

    it('wait for the one before them', async () => {
      await connected();
      void send(1, RUN_REQUEST);
      void send(2, {...RUN_REQUEST, runId: 8});
      await settled();
      const text = spawner.started[0]?.inputText() ?? '';
      deepStrictEqual(
        [text.includes('m1:st'), text.includes('m2:st')],
        [true, false],
      );
    });
  });

  describe('close', () => {
    it('ends ssh without an event when the helper ends', async () => {
      handler.onLeasesChanged([1]);
      await send(1, {type: 'connect'});
      events.length = 0;
      handler.close();
      await settled();
      deepStrictEqual([wasKilled(), events], [true, []]);
    });

    it('is harmless when nothing runs', () => {
      handler.close();
      deepStrictEqual(events, []);
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
