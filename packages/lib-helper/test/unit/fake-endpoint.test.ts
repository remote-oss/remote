import {deepStrictEqual, rejects} from 'node:assert';
import {FakeEndpointPort} from '../../src/testing/fake-endpoint.ts';

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('FakeEndpointPort', () => {
  it('delivers a copy of each message to the other end', async () => {
    const port = new FakeEndpointPort();
    const received: unknown[] = [];
    await port.listen('/e', connection => {
      connection.onMessage(message => received.push(message));
    });
    const client = await port.connect('/e');
    client.send({list: [1, 2]});
    await settled();
    deepStrictEqual(received, [{list: [1, 2]}]);
  });

  it('delivers nothing after either end closed', async () => {
    const port = new FakeEndpointPort();
    const received: unknown[] = [];
    let helperSide: {send(message: unknown): void} | undefined;
    await port.listen('/e', connection => {
      helperSide = connection;
      connection.onMessage(message => received.push(message));
    });
    const client = await port.connect('/e');
    client.send('in flight');
    client.close();
    client.send('after close');
    helperSide?.send('to a closed client');
    await settled();
    deepStrictEqual(received, []);
  });

  it('reports a close once to each end', async () => {
    const port = new FakeEndpointPort();
    const closes: string[] = [];
    await port.listen('/e', connection => {
      connection.onClose(() => closes.push('helper'));
    });
    const client = await port.connect('/e');
    client.onClose(() => closes.push('client'));
    client.close();
    client.close();
    deepStrictEqual(closes, ['client', 'helper']);
  });

  it('rejects a connection when nothing listens', async () => {
    await rejects(new FakeEndpointPort().connect('/none'), {
      message: 'nothing listens on /none',
    });
  });
});
