import {deepStrictEqual} from 'node:assert';
import {once} from 'node:events';
import {FakeProxy} from '../../src/testing/fake-proxy.ts';

describe('the fake local proxy for rows', () => {
  it('opens a stream whose far end reads what the window writes and answers it', async () => {
    const proxy = new FakeProxy();
    const outcome = await proxy.open('my-box', 31545);
    if (outcome.kind !== 'opened') {
      throw new Error('the fake did not open');
    }
    const [farEnd] = proxy.opened;
    outcome.stream.write('hello');
    const [received] = (await once(
      farEnd?.received ?? outcome.stream,
      'data',
    )) as [Buffer];
    farEnd?.send.write('back');
    const [answer] = (await once(outcome.stream, 'data')) as [Buffer];
    deepStrictEqual(
      [
        farEnd?.tunnelName,
        farEnd?.port,
        received.toString(),
        answer.toString(),
      ],
      ['my-box', 31545, 'hello', 'back'],
    );
  });

  it('fails an open as its script says', async () => {
    const proxy = new FakeProxy(() => ({reason: 'limit', detail: 'ten ports'}));
    deepStrictEqual(
      [await proxy.open('my-box', 8000), proxy.opened.length],
      [{kind: 'failed', reason: 'limit', detail: 'ten ports'}, 0],
    );
  });

  it('keeps the first serve result of a tunnel and refuses a second, and counts its releases', async () => {
    const proxy = new FakeProxy();
    const before = await proxy.serveKept('my-box');
    const first = await proxy.keepServe('my-box', {port: 8000});
    const second = await proxy.keepServe('my-box', {port: 9000});
    proxy.release();
    deepStrictEqual(
      [before, first, second, await proxy.serveKept('my-box'), proxy.releases],
      [null, true, false, {port: 8000}, 1],
    );
  });
});
