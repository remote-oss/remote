import {deepStrictEqual} from 'node:assert';
import {once} from 'node:events';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {connect} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PassThrough, Duplex} from 'node:stream';
import {DataSocket} from '../../src/data-socket.ts';

/** A stream the proxy would hand out, and the bytes the window wrote into it. */
function promised(): {
  stream: Duplex;
  written: PassThrough;
  answer: PassThrough;
} {
  const written = new PassThrough();
  const answer = new PassThrough();
  return {
    stream: Duplex.from({readable: answer, writable: written}),
    written,
    answer,
  };
}

describe("the proxy's data socket", () => {
  let folder: string;
  let socket: DataSocket;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'rtd-'));
    socket = await DataSocket.listen(
      path.join(folder, 'rtd-test.sock'),
      process.platform,
    );
  });

  afterEach(async () => {
    await socket.close();
    await rm(folder, {recursive: true, force: true});
  });

  it('is a socket only its owner may use', async () => {
    deepStrictEqual((await stat(socket.address)).mode & 0o777, 0o600);
  });

  it('joins a connection that writes a live ticket to its stream both ways, bytes after the ticket included', async () => {
    const {stream, written, answer} = promised();
    const ticket = socket.issue(stream);
    const window = connect(socket.address);
    window.write(`${ticket}\nhello`);
    const [first] = (await once(written, 'data')) as [Buffer];
    answer.write('back');
    const [second] = (await once(window, 'data')) as [Buffer];
    window.destroy();
    deepStrictEqual([first.toString(), second.toString()], ['hello', 'back']);
  });

  it('closes a connection whose ticket is unknown, used already, or too long a line', async () => {
    const {stream} = promised();
    const ticket = socket.issue(stream);
    const used = connect(socket.address);
    used.write(`${ticket}\n`);
    await once(used, 'connect');
    const ends: boolean[] = [];
    for (const line of [
      `${'ab'.repeat(32)}\n`,
      `${ticket}\n`,
      'x'.repeat(70),
    ]) {
      const window = connect(socket.address);
      window.write(line);
      await once(window, 'close');
      ends.push(true);
    }
    used.destroy();
    deepStrictEqual(ends, [true, true, true]);
  });

  it('destroys a stream whose ticket lapses unused, and its ticket then serves nobody', async () => {
    const quick = await DataSocket.listen(
      path.join(folder, 'rtd-quick.sock'),
      process.platform,
      50,
    );
    const {stream} = promised();
    const ticket = quick.issue(stream);
    await new Promise(resolve => setTimeout(resolve, 150));
    const window = connect(quick.address);
    window.write(`${ticket}\n`);
    await once(window, 'close');
    await quick.close();
    deepStrictEqual(stream.destroyed, true);
  });

  it('destroys the streams still waiting when it closes', async () => {
    const {stream} = promised();
    socket.issue(stream);
    await socket.close();
    socket = await DataSocket.listen(
      path.join(folder, 'rtd-again.sock'),
      process.platform,
    );
    deepStrictEqual(stream.destroyed, true);
  });
});
