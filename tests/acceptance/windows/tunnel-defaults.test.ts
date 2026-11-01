import {deepStrictEqual} from 'node:assert';
import {connect} from 'node:net';
import {
  acceptedPasswords,
  closeWindow,
  inWindow,
  nextEmptyWindow,
  onHost,
  windowEvents,
  recordLines,
  reloadWindow,
  userSettings,
  windowState,
} from './harness.ts';
import {closeAllButLocal} from './maintenance.ts';
import {
  connectedWith,
  keepingSettings,
  listeners,
  addedSince,
} from './tunnel-support.ts';

/** The ports of the listeners held by `program`. */
function portsOf(
  held: ReadonlyArray<{program: string; port: number}>,
  program: string,
): number[] {
  return held.filter(each => each.program === program).map(each => each.port);
}

/** The port on the host that the listener answers on, and what it says to a connection. */
const REMOTE_PORT = 8631;
const GREETING = 'forwarded-8631';
const GREETER = '/tmp/c79-greeter.sh';

/** The greeting a connection to the local `port` is given, over 127.0.0.1. */
function greetedAt(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('data', (chunk: Buffer) => {
      resolve(chunk.toString('utf8').trim());
      socket.destroy();
    });
    socket.on('error', reject);
  });
}

/** The local port a `forwarded` event of window `name` names. */
function forwardedPortOf(name: string): number {
  const address = windowEvents(name).find(
    each => each.event === 'forwarded',
  )?.localAddress;
  if (address === undefined) {
    throw new Error('the window reported no forwarded port');
  }
  return typeof address === 'string'
    ? Number(address.slice(address.lastIndexOf(':') + 1))
    : address.port;
}

describe('the tunnel of a window under the default settings and their combinations (card coverage-79)', function () {
  this.timeout(900_000);

  beforeEach(closeAllButLocal);

  it('F-2104 AC-3 (socks-loopback): a window on a key host reaches SSH: <host>, the window port and the SOCKS forward are held on 127.0.0.1 only', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-loopback', 'harness', {});
      const state = await windowState('c79-loopback');
      await closeWindow('c79-loopback');
      deepStrictEqual(
        [
          state.remoteName,
          [...new Set(connected.added.map(each => each.address))],
          [...new Set(connected.added.map(each => each.program))].sort(),
        ],
        ['ssh-remote', ['127.0.0.1'], ['editor', 'ssh']],
      );
    });
  });

  it('F-2104 AC-4, AC-5 (c79-password-reload): a password host is asked once and logs in once, and the reloaded window asks nothing, logs in no more, and reconnects through new editor ports and the same SOCKS port', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-reload', 'password', {});
      const editorBefore = portsOf(listeners(), 'editor');
      const socksBefore = portsOf(connected.added, 'ssh');
      const loginsBefore = await acceptedPasswords();
      const recordBefore = recordLines(undefined, 'c79-reload').length;
      await reloadWindow('c79-reload');
      await new Promise(resolve => setTimeout(resolve, 8000));
      const after = listeners();
      const answered = recordLines('maskedInput', 'c79-reload').filter(
        line => line.answer === '<supplied>',
      ).length;
      deepStrictEqual(
        {
          first: [connected.prompts, connected.logins],
          reload: [
            answered,
            (await acceptedPasswords()) - loginsBefore,
            portsOf(after, 'ssh'),
            portsOf(after, 'editor').some(port => !editorBefore.includes(port)),
            editorBefore.some(port => portsOf(after, 'editor').includes(port)),
            recordLines(undefined, 'c79-reload').length >= recordBefore,
          ],
        },
        {
          first: [1, 1],
          reload: [1, 0, socksBefore, true, false, true],
        },
      );
    });
  });

  it('F-2104 AC-7 (c79-terminal-no-socks): with the local server and dynamic forwarding off a password host is asked twice, the second while the progress says Setting up SSH tunnel, and an ssh process holds the window port', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-two', 'password', {
        'remote.SSH.useLocalServer': false,
        'remote.SSH.enableDynamicForwarding': false,
      });
      const second = connected.sequence
        .map((entry, index) => [entry, index] as const)
        .filter(([entry]) => entry.startsWith('maskedInput:'))[1]?.[1];
      const tunnel = connected.sequence.indexOf(
        'progress:Setting up SSH tunnel',
      );
      deepStrictEqual(
        [
          connected.prompts,
          connected.logins,
          tunnel >= 0 && second !== undefined && second > tunnel,
          connected.sequence.at(-2),
          portsOf(connected.added, 'ssh').length,
        ],
        [2, 2, true, 'progress:Waiting for port forwarding to be ready', 1],
      );
    });
  });

  it('F-2104 AC-8 (c79-terminal-socks): with the local server off and dynamic forwarding on a password host is asked once and logs in once', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-one', 'password', {
        'remote.SSH.useLocalServer': false,
        'remote.SSH.enableDynamicForwarding': true,
      });
      deepStrictEqual([connected.prompts, connected.logins], [1, 1]);
    });
  });

  it('F-2104 AC-9 (c79-local-no-dynamic): with the local server on and dynamic forwarding off a password host behaves as under the defaults: one question, one login, and a SOCKS forward', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-local', 'password', {
        'remote.SSH.useLocalServer': true,
        'remote.SSH.enableDynamicForwarding': false,
      });
      deepStrictEqual(
        [
          connected.prompts,
          connected.logins,
          portsOf(connected.added, 'ssh').length,
        ],
        [1, 1, 1],
      );
    });
  });

  it('F-2104 AC-45 (c79-second-window): a second window on the same host connects with no question and no login, on another window port, through the same SOCKS port', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-first', 'password', {});
      const socks = portsOf(connected.added, 'ssh');
      const editorBefore = portsOf(listeners(), 'editor');
      const loginsBefore = await acceptedPasswords();
      const next = await nextEmptyWindow(() =>
        inWindow('c79-first', 'opensshremotes.openEmptyWindowOnCurrentHost'),
      );
      await new Promise(resolve => setTimeout(resolve, 8000));
      const after = listeners();
      const added = addedSince(
        editorBefore.map(port => ({address: '', port, program: 'editor'})),
        after.filter(each => each.program === 'editor'),
      );
      deepStrictEqual(
        [
          recordLines('maskedInput', next).length,
          (await acceptedPasswords()) - loginsBefore,
          added.length > 0,
          portsOf(after, 'ssh'),
        ],
        [0, 0, true, socks],
      );
      await closeWindow(next);
    });
  });

  it('F-2104 AC-46 (c79-dynamic-off-reload): turning dynamic forwarding off and reloading asks no password and leaves the SOCKS listener of the local server', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-off', 'password', {});
      const socks = portsOf(connected.added, 'ssh');
      const answeredBefore = recordLines('maskedInput', 'c79-off').length;
      const loginsBefore = await acceptedPasswords();
      await userSettings({'remote.SSH.enableDynamicForwarding': false});
      await reloadWindow('c79-off');
      await new Promise(resolve => setTimeout(resolve, 8000));
      deepStrictEqual(
        [
          recordLines('maskedInput', 'c79-off').length - answeredBefore,
          (await acceptedPasswords()) - loginsBefore,
          portsOf(listeners(), 'ssh'),
        ],
        [0, 0, socks],
      );
    });
  });
  it('F-2104 AC-6 (c79-forward-any-mode): in every combination of the local server and dynamic forwarding a port forwarded with Forward a Port works locally, with no password asked and no new login', async () => {
    await onHost(
      'sh',
      '-c',
      `printf '#!/bin/sh\\necho ${GREETING}\\nsleep 30\\n' > ${GREETER} && chmod 755 ${GREETER}; nohup nc -lk -p ${String(REMOTE_PORT)} -s 127.0.0.1 -e ${GREETER} >/dev/null 2>&1 &`,
    );
    const seen: Array<[boolean, boolean, string, number, number]> = [];
    try {
      for (const [local, dynamic] of [
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ] as const) {
        await closeAllButLocal();
        await keepingSettings(async () => {
          const name = `c79-forward-${String(local)}-${String(dynamic)}`;
          await connectedWith(name, 'password', {
            'remote.SSH.useLocalServer': local,
            'remote.SSH.enableDynamicForwarding': dynamic,
          });
          const answered = recordLines('maskedInput', name).length;
          const loginsBefore = await acceptedPasswords();
          await inWindow(name, 'acceptance.agent.forwardPort', REMOTE_PORT);
          const greeting = await greetedAt(forwardedPortOf(name));
          seen.push([
            local,
            dynamic,
            greeting,
            recordLines('maskedInput', name).length - answered,
            (await acceptedPasswords()) - loginsBefore,
          ]);
          await closeWindow(name);
        });
      }
    } finally {
      await onHost(
        'sh',
        '-c',
        `pkill -f "[n]c -lk -p ${String(REMOTE_PORT)}" || true; pkill -f "[c]79-greeter" || true`,
      );
    }
    deepStrictEqual(seen, [
      [true, true, GREETING, 0, 0],
      [true, false, GREETING, 0, 0],
      [false, true, GREETING, 0, 0],
      [false, false, GREETING, 0, 0],
    ]);
  });
});
