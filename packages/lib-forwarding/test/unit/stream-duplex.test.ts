import {deepStrictEqual} from 'node:assert';
import {PassThrough} from 'node:stream';
import {streamDuplex} from '../../src/index.ts';

/** A connection over two pass-through streams, with the end told by the test. */
function connection() {
  const readable = new PassThrough();
  const writable = new PassThrough({highWaterMark: 1});
  let end: (() => void) | undefined;
  const events: string[] = [];
  const duplex = streamDuplex({
    readable,
    writable,
    whenEnded: listener => {
      end = listener;
    },
    destroy: () => {
      events.push('destroyed');
    },
  });
  return {
    readable,
    writable,
    duplex,
    events,
    end: () => {
      end?.();
    },
  };
}

describe('streamDuplex', () => {
  it('contracts: bytes that arrive before the first data listener are held and delivered to it', async () => {
    const {readable, duplex} = connection();
    readable.write(Buffer.from('abc'));
    const heard: string[] = [];
    duplex.onData(chunk => heard.push(Buffer.from(chunk).toString()));
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(heard, ['abc']);
  });

  it('contracts: pause holds the bytes until resume', async () => {
    const {readable, duplex} = connection();
    const heard: string[] = [];
    duplex.onData(chunk => heard.push(Buffer.from(chunk).toString()));
    duplex.pause();
    readable.write(Buffer.from('x'));
    const whilePaused = [...heard];
    await new Promise(resolve => setImmediate(resolve));
    const afterWait = [...heard];
    duplex.resume();
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual([whilePaused, afterWait, heard], [[], [], ['x']]);
  });

  it('contracts: a send that fills the stream says false, and onDrain tells when it can take bytes again', async () => {
    const {writable, duplex} = connection();
    let drained = 0;
    duplex.onDrain(() => {
      drained += 1;
    });
    const full = duplex.send(new Uint8Array(10));
    writable.resume();
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual([full, drained], [false, 1]);
  });

  it('contracts: the end is told to a listener added before it, and to one added after it', async () => {
    const {duplex, end} = connection();
    const told: string[] = [];
    duplex.onClose(() => told.push('before'));
    end();
    duplex.onClose(() => told.push('after'));
    await Promise.resolve();
    deepStrictEqual(told, ['before', 'after']);
  });

  it('contracts: close ends the connection', () => {
    const {duplex, events} = connection();
    duplex.close();
    deepStrictEqual(events, ['destroyed']);
  });
});
