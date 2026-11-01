import {deepStrictEqual} from 'node:assert';
import {closeWindow, onHost, openWindow} from '../windows/harness.ts';
import {greetingOf} from './greeting.ts';

/** The port the host listener answers on, and the greeting it gives. */
const HOST_PORT = 8632;
const GREETING = 'dflt-8632';

/** The local ports tried, the first being the one the setting asks for. */
const LOCAL_PORTS = Array.from({length: 11}, (unused, index) => 18632 + index);

/** Polls the local ports every 500 ms for up to 15 s, and gives the first greeting. */
async function greetingWithin15Seconds(): Promise<string | undefined> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    for (const port of LOCAL_PORTS) {
      const greeting = await greetingOf(port);
      if (greeting !== undefined) {
        return greeting;
      }
    }
    if (Date.now() > deadline) {
      return undefined;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

describe('the default forwarded ports of a launch (card connect-40)', function () {
  this.timeout(120000);

  before(async () => {
    await onHost(
      'sh',
      '-c',
      `nc -lk -p ${String(HOST_PORT)} -s 127.0.0.1 -e /bin/echo ${GREETING} >/dev/null 2>&1 &`,
    );
  });

  after(async () => {
    await onHost(
      'sh',
      '-c',
      `pkill -f 'n[c] -lk -p ${String(HOST_PORT)}'; true`,
    );
  });

  it('F-2507 AC-2: a default forwarded port listens after the window connects', async () => {
    await openWindow('harness', 'dp1');
    try {
      deepStrictEqual(await greetingWithin15Seconds(), GREETING);
    } finally {
      // An open window keeps its forwards, and the rows after this one read the same local ports.
      await closeWindow('dp1');
    }
  });
});
