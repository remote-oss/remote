import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  hostAnswer,
  inWindow,
  kill,
  onHost,
  reloadWindow,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {answerInputBox, portsRows, statusItem} from '../windows/renderer.ts';
import {
  connectedWith,
  greetedAt,
  keepingSettings,
} from '../windows/tunnel-support.ts';

/** The remote ports of the two listeners the rows forward, and what each says to a connection. */
const FIRST_PORT = 8691;
const SECOND_PORT = 8692;

/** Starts a listener on the host's loopback `port` that answers with `greeting`, outside the editor. */
async function listenOnHost(port: number, greeting: string): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `nohup nc -lk -p ${String(port)} -s 127.0.0.1 -e /bin/echo ${greeting} >/dev/null 2>&1 &`,
  );
}

/** Ends the listeners of both ports. */
async function stopListeners(): Promise<void> {
  await onHost('sh', '-c', `pkill -f "[n]c -lk -p 869[0-9]" || true`);
}

/** Forwards `port` of window `name` by hand, as a user does with Forward a Port. */
async function forwardByHand(name: string, port: number): Promise<void> {
  const forwarding = inWindow(name, 'remote.tunnel.forwardCommandPalette');
  await answerInputBox(name, String(port));
  await forwarding;
}

/** Shows core's Ports view in window `name`, which core registers a little after the window connects. */
async function showPorts(name: string): Promise<void> {
  await waitFor(
    'core to register the Ports view',
    () =>
      inWindow(name, '~remote.forwardedPorts.focus').then(
        () => true,
        () => false,
      ),
    30_000,
  );
}

/** The forwarded addresses of the Ports view's rows for the remote `port`, once there are some. */
async function addressesOf(name: string, port: number): Promise<string[]> {
  await showPorts(name);
  await waitFor(
    `the Ports view to list ${String(port)}`,
    async () =>
      (await portsRows(name).catch(() => [])).some(
        entry => entry.port === String(port),
      ),
    60_000,
  );
  return (await portsRows(name))
    .filter(entry => entry.port === String(port))
    .map(entry => entry.forwardedAddress);
}

/** The local port a forwarded address `localhost:NNNN` names. */
function localPortOf(address: string | undefined): number {
  return Number(address?.slice(address.lastIndexOf(':') + 1));
}

describe('the tunnel of a window across reconnects (card coverage-79)', function () {
  this.timeout(900_000);

  beforeEach(closeAllButLocal);

  it('F-2104 AC-31 (c79-reload-forward): a port forwarded by hand that answers is listed in the Ports view again after the window is reloaded, and answers', async () => {
    await listenOnHost(FIRST_PORT, 'c79-first');
    try {
      await keepingSettings(async () => {
        const name = 'c79-reload-port';
        await connectedWith(name, 'harness', {});
        await forwardByHand(name, FIRST_PORT);
        const before = await greetedAt(
          localPortOf((await addressesOf(name, FIRST_PORT))[0]),
        );
        await reloadWindow(name);
        await connectedWithin(name, 60_000);
        const addresses = await addressesOf(name, FIRST_PORT);
        const after = await greetedAt(localPortOf(addresses[0]));
        await closeWindow(name);
        deepStrictEqual(
          [before, addresses.length, after],
          ['c79-first', 1, 'c79-first'],
        );
      });
    } finally {
      await stopListeners();
    }
  });

  it('F-2104 AC-32 (c79-kill-local-forward): Kill Local Connection Server For Host reconnects the window, the earlier port stays listed and a port forwarded after it answers', async () => {
    await listenOnHost(FIRST_PORT, 'c79-first');
    await listenOnHost(SECOND_PORT, 'c79-second');
    try {
      await keepingSettings(async () => {
        const name = 'c79-kill-forward';
        await connectedWith(name, 'harness', {});
        await forwardByHand(name, FIRST_PORT);
        await addressesOf(name, FIRST_PORT);
        appendScript([hostAnswer(name, {label: 'harness'})]);
        await kill(name);
        await waitFor(
          'the window to be connected again',
          async () =>
            (await statusItem(name, 'status.host').catch(() => ({text: ''})))
              .text === 'SSH: harness' &&
            (await windowState(name).catch(() => undefined))?.remoteName ===
              'ssh-remote',
          120_000,
        );
        const earlier = await addressesOf(name, FIRST_PORT);
        await forwardByHand(name, SECOND_PORT);
        const later = await greetedAt(
          localPortOf((await addressesOf(name, SECOND_PORT))[0]),
        );
        await closeWindow(name);
        deepStrictEqual([earlier.length, later], [1, 'c79-second']);
      });
    } finally {
      await stopListeners();
    }
  });
});
