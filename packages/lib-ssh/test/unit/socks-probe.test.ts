import {deepStrictEqual} from 'node:assert';
import {createServer, type Server, type Socket} from 'node:net';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {socksProbeOver} from '../../src/index.ts';

/** The connections each server holds, for `closed` to end. */
const held = new WeakMap<Server, Set<Socket>>();

/** A SOCKS server on the loopback whose answers a row chooses; it gives the port it listens on and what each client sent. */
async function serving(
  behaviour: (socket: Socket, sent: Buffer[]) => void,
): Promise<{server: Server; port: number; sent: Buffer[]}> {
  const sent: Buffer[] = [];
  const server = createServer(socket => {
    held.get(server)?.add(socket);
    behaviour(socket, sent);
  });
  held.set(server, new Set());
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    port: typeof address === 'object' && address !== null ? address.port : 0,
    sent,
  };
}

/** Closes `server` and the connections it holds. */
async function closed(server: Server): Promise<void> {
  held.get(server)?.forEach(socket => {
    socket.destroy();
  });
  await new Promise<void>(resolve => {
    server.close(() => {
      resolve();
    });
  });
}

/** A SOCKS server that answers the greeting and then the connect with the reply `code`. */
function replyingWith(code: number) {
  return (socket: Socket, sent: Buffer[]): void => {
    let step = 0;
    socket.on('data', chunk => {
      sent.push(chunk);
      step += 1;
      socket.write(
        step === 1
          ? Buffer.from([5, 0])
          : Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]),
      );
    });
    socket.on('error', () => undefined);
  };
}

/** The probe of the forward at `port` for the host's `targetPort`, with a deadline of three seconds. */
function probedAt(
  clock: FakeClock,
  port: number,
  targetPort = 22,
): Promise<boolean> {
  return socksProbeOver(clock.scheduler())({
    socksPort: port,
    targetPort,
    deadlineMilliseconds: 3000,
  });
}

describe('the probe of the shared session over its SOCKS forward (card #2751)', () => {
  let clock: FakeClock;

  beforeEach(() => {
    clock = new FakeClock();
  });

  it('F-2505 AC-25: a connect that the host answers counts as alive, and the request names the server’s port on the loopback', async () => {
    const {server, port, sent} = await serving(replyingWith(0));
    const alive = await probedAt(clock, port, 41001);
    await closed(server);
    deepStrictEqual(
      [alive, [...(sent[0] ?? [])], [...(sent[1] ?? [])]],
      [true, [5, 1, 0], [5, 1, 0, 1, 127, 0, 0, 1, 160, 41]],
    );
  });

  it('F-2505 AC-25: a connect that the host refuses counts as alive too: the session carried the answer', async () => {
    const {server, port} = await serving(replyingWith(2));
    const alive = await probedAt(clock, port, 41001);
    await closed(server);
    deepStrictEqual(alive, true);
  });

  it('F-2505 AC-25: no reply to the connect within the deadline is not alive, and the socket is closed', async () => {
    let closedByProbe = false;
    const seen: Buffer[] = [];
    const {server, port} = await serving(socket => {
      socket.on('data', chunk => {
        seen.push(chunk);
        if (seen.length === 1) {
          socket.write(Buffer.from([5, 0]));
        }
      });
      socket.on('close', () => {
        closedByProbe = true;
      });
      socket.on('error', () => undefined);
    });
    const probing = probedAt(clock, port, 41001);
    await new Promise<void>(resolve => {
      const poll = setInterval(() => {
        if (seen.length === 2) {
          clearInterval(poll);
          resolve();
        }
      }, 5);
    });
    clock.advance(3000);
    const alive = await probing;
    await new Promise(resolve => setTimeout(resolve, 20));
    await closed(server);
    deepStrictEqual([alive, closedByProbe], [false, true]);
  });

  it('F-2505 AC-25: a reply to the connect with no banner behind it counts as alive: ssh gives it only once the host answered', async () => {
    const {server, port} = await serving(replyingWith(0));
    const alive = await probedAt(clock, port);
    await closed(server);
    deepStrictEqual(alive, true);
  });

  it('F-2505 AC-25: the banner of the host’s sshd behind the reply counts as alive', async () => {
    const {server, port} = await serving((socket, sent) => {
      socket.on('data', chunk => {
        sent.push(chunk);
        socket.write(
          sent.length === 1
            ? Buffer.from([5, 0])
            : Buffer.concat([
                Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
                Buffer.from('SSH-2.0-OpenSSH_9.6\r\n'),
              ]),
        );
      });
      socket.on('error', () => undefined);
    });
    const alive = await probedAt(clock, port);
    await closed(server);
    deepStrictEqual(alive, true);
  });

  it('F-2505 AC-25: a socket that ssh closes after the connect request, as it does when the host refuses the port, counts as alive', async () => {
    const {server, port} = await serving((socket, sent) => {
      socket.on('data', chunk => {
        sent.push(chunk);
        if (sent.length === 1) {
          socket.write(Buffer.from([5, 0]));
        } else {
          socket.destroy();
        }
      });
      socket.on('error', () => undefined);
    });
    const alive = await probedAt(clock, port);
    await closed(server);
    deepStrictEqual(alive, true);
  });

  it('F-2505 AC-25: a SOCKS port that refuses the connection is not alive', async () => {
    const {server, port} = await serving(() => undefined);
    await closed(server);
    deepStrictEqual(await probedAt(clock, port, 41001), false);
  });

  it('F-2505 AC-25: a forward that closes before it answers the greeting is not alive', async () => {
    const {server, port} = await serving(socket => {
      socket.destroy();
    });
    const alive = await probedAt(clock, port, 41001);
    await closed(server);
    deepStrictEqual(alive, false);
  });
});
