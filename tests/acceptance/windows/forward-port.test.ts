import {deepStrictEqual} from 'node:assert';
import {connect} from 'node:net';
import {inWindow, onHost, openWindow, windowEvents} from './harness.ts';

/** The port on the host that the listener answers on. */
const REMOTE_PORT = 8613;

/** What the listener says to a connection. */
const GREETING = 'forwarded-8613';

/** The listener's program on the host: it greets, then keeps the connection open for a while. */
const GREETER = '/tmp/forward-greeter.sh';

/** A connection through a forward that has been greeted, and is held open until `release`. */
interface Held {
  greeting: string;
  release(): void;
}

/** Connects to a local port and gives the listener's greeting, keeping the connection open. */
function holdOpen(port: number): Promise<Held> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('data', (chunk: Buffer) => {
      resolve({
        greeting: chunk.toString('utf8').trim(),
        release: () => {
          socket.destroy();
        },
      });
    });
    socket.on('error', reject);
  });
}

/** The program column of each host connection to the listener's port, from the side that opened it. */
async function connectingPrograms(): Promise<string[]> {
  const table = await onHost('netstat', '-tnp');
  return table
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(
      columns =>
        columns.includes('ESTABLISHED') &&
        columns[4] === `127.0.0.1:${String(REMOTE_PORT)}`,
    )
    .map(columns => columns.slice(6).join(' '));
}

/** The local port a `forwarded` event of window `name` names, whatever shape the editor gives the address in. */
function localPortOf(name: string): number {
  const event = windowEvents(name).find(each => each.event === 'forwarded');
  const address = event?.localAddress;
  if (address === undefined) {
    throw new Error('the window reported no forwarded port');
  }
  if (typeof address === 'string') {
    return Number(address.slice(address.lastIndexOf(':') + 1));
  }
  return address.port;
}

describe('a port forwarded in a connected window (card connect-34)', function () {
  this.timeout(240000);

  before(async () => {
    await onHost(
      'sh',
      '-c',
      `printf '#!/bin/sh\\necho ${GREETING}\\nsleep 30\\n' > ${GREETER} && chmod 755 ${GREETER}`,
    );
    await onHost(
      'sh',
      '-c',
      `nohup nc -lk -p ${String(REMOTE_PORT)} -s 127.0.0.1 -e ${GREETER} >/dev/null 2>&1 &`,
    );
    await openWindow('harness', 'f1');
    await inWindow('f1', 'acceptance.agent.forwardPort', REMOTE_PORT);
  });

  after(async () => {
    await onHost(
      'sh',
      '-c',
      `pkill -f "[n]c -lk -p ${String(REMOTE_PORT)}" || true; pkill -f "[f]orward-greeter" || true`,
    );
  });

  it("F-2507 AC-18: a port forwarded in a connected window reaches the host's port", async () => {
    const held = await holdOpen(localPortOf('f1'));
    held.release();
    deepStrictEqual(held.greeting, GREETING);
  });

  it('F-2507 AC-18 (host side): the connection to the port is opened by the VS Code Server, not by sshd', async () => {
    const held = await holdOpen(localPortOf('f1'));
    const programs = await connectingPrograms();
    held.release();
    deepStrictEqual(
      [programs.length > 0, programs.every(name => name.includes('node'))],
      [true, true],
    );
  });
});
