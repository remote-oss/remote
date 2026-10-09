import {deepStrictEqual, strictEqual} from 'node:assert';
import type {EndpointConnection} from '../../src/endpoint/protocol.ts';
import type {EndPolicy} from '../../src/index.ts';
import {
  type MessageHandler,
  serve,
  type ServeEnd,
} from '../../src/runtime/serve.ts';
import {FakeClock} from '../../src/testing/fake-clock.ts';
import {FakeEndpointPort} from '../../src/testing/fake-endpoint.ts';

const ENDPOINT = '/run/rh-0123456789abcdef.sock';
const NONCE = 'nonce-1';
const GRACE: EndPolicy = {kind: 'graceAfterLastLease', milliseconds: 3000};

/** A client end that collects what the helper sends and whether it was closed. */
interface TestClient {
  connection: EndpointConnection;
  received: unknown[];
  closed: boolean;
}

async function settled(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await Promise.resolve();
  }
}

describe('serve', () => {
  let port: FakeEndpointPort;
  let clock: FakeClock;
  let logged: string[];
  let actions: string[];
  let ending: Promise<ServeEnd>;
  let handler: MessageHandler;

  function start(policy: EndPolicy = GRACE): void {
    ending = serve({
      endpoint: ENDPOINT,
      nonce: NONCE,
      payload: {port: 49152},
      policy,
      handler,
      port,
      clock: () => clock.now(),
      scheduler: clock.scheduler(),
      helloLimitMilliseconds: 500,
      logLine: line => logged.push(line),
    });
  }

  async function connect(nonce: string | null = NONCE): Promise<TestClient> {
    await settled();
    const client: TestClient = {
      connection: await port.connect(ENDPOINT),
      received: [],
      closed: false,
    };
    client.connection.onMessage(message => client.received.push(message));
    client.connection.onClose(() => {
      client.closed = true;
    });
    if (nonce !== null) {
      client.connection.send({type: 'hello', nonce});
    }
    await settled();
    return client;
  }

  beforeEach(() => {
    port = new FakeEndpointPort();
    clock = new FakeClock();
    logged = [];
    actions = [];
    handler = {
      onRequest: (body, context) => {
        if (body === 'fail') {
          return Promise.reject(new Error('cannot do that'));
        }
        if (body === 'fail with text') {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a handler that breaks its contract, on purpose
          return Promise.reject('plain text');
        }
        if (body === 'shout') {
          context.broadcast(`lease ${String(context.lease)} shouts`);
        }
        return Promise.resolve({echo: body, lease: context.lease});
      },
      runAction: action => {
        actions.push(action);
        return Promise.resolve();
      },
    };
  });

  it('welcomes a hello with the nonce: lease 1, the live leases and the payload', async () => {
    start();
    const client = await connect();
    deepStrictEqual(client.received, [
      {type: 'welcome', lease: 1, leases: [1], payload: {port: 49152}},
    ]);
  });

  it('refuses a hello with another nonce and closes the connection', async () => {
    start();
    const client = await connect('wrong');
    deepStrictEqual([client.received, client.closed], [[], true]);
  });

  it('refuses a first message that is not a hello', async () => {
    start();
    const client = await connect(null);
    client.connection.send({type: 'stop'});
    await settled();
    strictEqual(client.closed, true);
  });

  it('closes a connection that does not say hello in time', async () => {
    start();
    const client = await connect(null);
    clock.advance(500);
    await settled();
    deepStrictEqual(
      [client.closed, logged],
      [true, ['a connection did not say hello in time']],
    );
  });

  it('numbers leases in arrival order and tells the earlier leases', async () => {
    start();
    const first = await connect();
    const second = await connect();
    deepStrictEqual(
      [first.received.at(-1), second.received[0]],
      [
        {type: 'leaseListChanged', leases: [1, 2]},
        {type: 'welcome', lease: 2, leases: [1, 2], payload: {port: 49152}},
      ],
    );
  });

  it('treats a closed connection as a released lease', async () => {
    start();
    const first = await connect();
    const second = await connect();
    first.connection.close();
    await settled();
    deepStrictEqual(second.received.at(-1), {
      type: 'leaseListChanged',
      leases: [2],
    });
  });

  it("answers a request with the handler's reply", async () => {
    start();
    const client = await connect();
    client.connection.send({type: 'request', requestId: 7, body: 'ping'});
    await settled();
    deepStrictEqual(client.received.at(-1), {
      type: 'reply',
      requestId: 7,
      body: {echo: 'ping', lease: 1},
    });
  });

  it('answers a request the handler rejects with a failed reply', async () => {
    start();
    const client = await connect();
    client.connection.send({type: 'request', requestId: 8, body: 'fail'});
    await settled();
    deepStrictEqual(client.received.at(-1), {
      type: 'failed',
      requestId: 8,
      reason: 'cannot do that',
    });
  });

  it('names a rejection that is not an Error by its text', async () => {
    start();
    const client = await connect();
    client.connection.send({
      type: 'request',
      requestId: 9,
      body: 'fail with text',
    });
    await settled();
    deepStrictEqual(client.received.at(-1), {
      type: 'failed',
      requestId: 9,
      reason: 'plain text',
    });
  });

  it("delivers the handler's broadcast to every lease", async () => {
    start();
    const first = await connect();
    const second = await connect();
    second.connection.send({type: 'request', requestId: 1, body: 'shout'});
    await settled();
    deepStrictEqual(first.received.at(-1), {
      type: 'message',
      body: 'lease 2 shouts',
    });
  });

  it('ignores a message that is not a request, and says so in its log', async () => {
    start();
    const client = await connect();
    client.connection.send({type: 'hello', nonce: NONCE});
    await settled();
    deepStrictEqual(
      [client.received.length, logged],
      [1, ['a message that is not a request was ignored']],
    );
  });

  it('ends on stop, closing every connection and the endpoint', async () => {
    start();
    const client = await connect();
    client.connection.send({type: 'stop'});
    deepStrictEqual(
      [await ending, client.closed, port.isListening(ENDPOINT)],
      ['stopped', true, false],
    );
  });

  it('ends by the grace policy after the last lease closes', async () => {
    start();
    const client = await connect();
    client.connection.close();
    await settled();
    clock.advance(3000);
    deepStrictEqual(
      [await ending, port.isListening(ENDPOINT)],
      ['policy', false],
    );
  });

  it('ends by its policy when no lease ever opens', async () => {
    start();
    await settled();
    clock.advance(3000);
    deepStrictEqual(
      [await ending, port.isListening(ENDPOINT)],
      ['policy', false],
    );
  });

  async function endByDelayedCheck(): Promise<ServeEnd> {
    start({
      kind: 'delayedCheckAfterLastLease',
      milliseconds: 10000,
      action: 'stopContainers',
    });
    const client = await connect();
    client.connection.close();
    await settled();
    clock.advance(10000);
    return ending;
  }

  it("runs the delayed check's action before it ends", async () => {
    deepStrictEqual(
      [await endByDelayedCheck(), actions],
      ['policy', ['stopContainers']],
    );
  });

  it('ends even when the action fails, and logs the failure', async () => {
    handler.runAction = () => Promise.reject(new Error('docker gone'));
    deepStrictEqual(
      [await endByDelayedCheck(), logged],
      ['policy', ['the end action failed: docker gone']],
    );
  });

  it('never starts without a usable policy', async () => {
    start({kind: 'graceAfterLastLease', milliseconds: 0});
    const outcome = await ending.then(
      () => 'resolved',
      () => 'rejected',
    );
    deepStrictEqual([outcome, port.isListening(ENDPOINT)], ['rejected', false]);
  });
});
