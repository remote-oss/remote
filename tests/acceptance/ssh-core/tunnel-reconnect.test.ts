import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  hostAnswer,
  kill,
  onHost,
  openWindow,
  recordLines,
  relaunch,
  reloadWindow,
  signal,
  userSettings,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  forwardByHand,
  listenOnHost,
  localPortOf,
  showPorts,
  tunnelFor,
} from '../windows/forward-support.ts';
import {closeAllButLocal, password} from '../windows/maintenance.ts';
import {paletteItems} from '../windows/palette.ts';
import {portsRows, statusItem} from '../windows/renderer.ts';
import {
  connectedWith,
  greetedAt,
  keepingSettings,
  PLATFORMS,
} from '../windows/tunnel-support.ts';

/** The remote ports of the two listeners the rows forward, and what each says to a connection. */
const FIRST_PORT = 8691;
const SECOND_PORT = 8692;

/** Ends the listeners of both ports. */
async function stopListeners(): Promise<void> {
  await onHost('sh', '-c', 'pkill -f "[n]c -lk -p 869[0-9]" || true');
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

/** What the listener of `port` says through the tunnel window `name` has for it. */
async function greetingThrough(name: string, port: number): Promise<string> {
  return greetedAt(localPortOf(await tunnelFor(name, port)));
}

describe('the tunnel of a window across reconnects (card coverage-79)', function () {
  this.timeout(900_000);

  beforeEach(closeAllButLocal);

  /** Forwards `FIRST_PORT` by hand in a window, brings the window back with `bringBack`, and gives what it then shows. */
  async function afterwards(
    name: string,
    bringBack: () => Promise<void>,
  ): Promise<[string, number, string]> {
    await connectedWith(name, 'harness', {});
    await forwardByHand(name, FIRST_PORT);
    // The Ports view is open, as for a user who forwards a port, before the window comes back.
    await addressesOf(name, FIRST_PORT);
    const before = await greetingThrough(name, FIRST_PORT);
    await bringBack();
    await connectedWithin(name, 120_000);
    const listed = await addressesOf(name, FIRST_PORT);
    const after = await greetingThrough(name, FIRST_PORT);
    await closeWindow(name);
    deepStrictEqual(before, after);
    return [before, listed.length, after];
  }

  it('F-2104 AC-31 (c79-reload-forward): a port forwarded by hand that answers is listed in the Ports view again after the window is reloaded, and answers', async () => {
    await listenOnHost(FIRST_PORT, 'c79-first');
    try {
      await keepingSettings(async () => {
        deepStrictEqual(
          await afterwards('c79-reload-port', () =>
            reloadWindow('c79-reload-port'),
          ),
          ['c79-first', 1, 'c79-first'],
        );
      });
    } finally {
      await stopListeners();
    }
  });

  it('F-2104 AC-31 (c79-restart-forward): a port forwarded by hand that answers is listed in the Ports view again after the editor is restarted, and answers', async () => {
    await listenOnHost(FIRST_PORT, 'c79-first');
    try {
      await keepingSettings(async () => {
        deepStrictEqual(
          await afterwards('c79-restart-port', () =>
            relaunch('c79-restart-port', {environment: {}}),
          ),
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
        const later = await greetingThrough(name, SECOND_PORT);
        await closeWindow(name);
        deepStrictEqual([earlier.length, later], [1, 'c79-second']);
      });
    } finally {
      await stopListeners();
    }
  });

  it('F-2104 AC-33 (c79-second-password): a wrong password at the second prompt asks the same input again, and Escape ends the connect without success, with the Command Palette still opening', async () => {
    await keepingSettings(async () => {
      await userSettings({
        ...PLATFORMS,
        'remote.SSH.useLocalServer': false,
        'remote.SSH.enableDynamicForwarding': false,
      });
      const name = 'c79-pw-wrong';
      appendScript([
        {...password(), window: name},
        {
          surface: 'maskedInput',
          match: 'Enter password',
          answer: {text: 'not-the-password'},
          window: name,
        },
        {
          surface: 'maskedInput',
          match: 'Enter password',
          answer: 'dismiss',
          window: name,
        },
        {
          surface: 'failureDialog',
          match: 'Could not establish',
          answer: 'dismiss',
          window: name,
          after: 'c79-pw-wrong-end',
        },
      ]);
      // The alias asks again after a wrong password, as ssh does by default: three prompts.
      await openWindow('password-retry', name);
      await waitFor(
        'the end of the connect',
        () => recordLines('progressEnd', name).length > 0,
        180_000,
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      const result = {
        inputs: recordLines('maskedInput', name).map(line => line.answer),
        indicator: (await statusItem(name, 'status.host')).text,
        palette: (await paletteItems(name, 'Remote-SSH:')).length > 0,
      };
      signal('c79-pw-wrong-end');
      await closeWindow(name).catch(() => undefined);
      deepStrictEqual(result, {
        inputs: ['<supplied>', '<supplied>', 'dismiss'],
        indicator: 'Disconnected from SSH: password-retry',
        palette: true,
      });
    });
  });
});
