import {deepStrictEqual} from 'node:assert';
import {createServer} from 'node:net';
import {
  acceptedKeyLogins,
  appendScript,
  closeWindow,
  connectionLog,
  inWindow,
  openWindow,
  recordLines,
  signal,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {notifications, statusItem} from '../windows/renderer.ts';
import {
  addedSince,
  connectedWith,
  forwardedPortOf,
  GREETING,
  greetedAt,
  holdPorts,
  keepingSettings,
  listeners,
  REMOTE_PORT,
  startGreeter,
  stopGreeter,
  type Listener,
} from '../windows/tunnel-support.ts';

const FAILURE = 'Could not establish connection';
const BUTTONS = ['Close Remote', 'Retry', 'More Actions...'];
const SETTING = 'remote.SSH.preferredLocalPortRange';
const PLATFORM = {'remote.SSH.remotePlatform': {harness: 'linux'}};

/** The reason a window with no free port in `range` gives, as the dialog words it. */
function busyDialog(range: string): string {
  return `Could not establish connection to "harness": Error establishing tunnel (Failed to find a free local port: No free ports in specified range '${range}'.  Remove or update the 'Preferred Local Port Range' setting and try again.).`;
}

/** The ports of the editor's listeners among `added` on 127.0.0.1 that lie in `first`-`last`. */
function windowPorts(
  added: readonly Listener[],
  first: number,
  last: number,
): number[] {
  return added
    .filter(
      each =>
        each.program === 'editor' &&
        each.address === '127.0.0.1' &&
        each.port >= first &&
        each.port <= last,
    )
    .map(each => each.port);
}

/** The entries that answer a failing window's dialog with `button` and then its pick of actions with Escape. */
function dismissing(window: string, button: string) {
  return [
    {
      surface: 'failureDialog',
      match: FAILURE,
      answer: {button},
      window,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window,
    },
  ] as const;
}

/** Waits until window `name` has shown `count` failure dialogs and gives their texts. */
async function dialogsOf(name: string, count: number): Promise<string[]> {
  await waitFor(
    `${String(count)} failure dialogs of window ${name}`,
    () => recordLines('failureDialog', name).length >= count,
    300_000,
  );
  return recordLines('failureDialog', name).map(line => line.question);
}

/** The log lines that say the range was ignored for `reason`. */
function ignored(reason: string): string[] {
  return [`remote.SSH.preferredLocalPortRange is ignored: ${reason}`];
}

describe('the local port range of a window (card coverage-79)', function () {
  this.timeout(900_000);

  beforeEach(closeAllButLocal);

  it('F-2104 AC-10 (c79-range-skip): with the first two ports of the range held and answering, the window port is the third and the SOCKS port lies outside the range', async () => {
    await keepingSettings(async () => {
      const held = await holdPorts([41060, 41061], '127.0.0.1');
      try {
        const connected = await connectedWith('c79-skip', 'harness', {
          [SETTING]: '41060-41063',
        });
        await closeWindow('c79-skip');
        const socks = connected.added
          .filter(each => each.program === 'ssh')
          .map(each => each.port);
        deepStrictEqual(
          [
            windowPorts(connected.added, 41060, 41063),
            socks.length,
            socks.filter(port => port >= 41060 && port <= 41063),
          ],
          [[41062], 1, []],
        );
      } finally {
        await held.release();
      }
    });
  });

  it('F-2104 AC-11 (c79-range-single): the range N-N with N free gives the window port N', async () => {
    await keepingSettings(async () => {
      const connected = await connectedWith('c79-single', 'harness', {
        [SETTING]: '41065-41065',
      });
      await closeWindow('c79-single');
      deepStrictEqual(windowPorts(connected.added, 41065, 41065), [41065]);
    });
  });

  it('F-2104 AC-12 (c79-range-families): a range whose only port is held on ::1 alone connects with the port bound on 127.0.0.1, and held on 0.0.0.0 it gives the dialog of a full range', async () => {
    await keepingSettings(async () => {
      const loopback = await holdPorts([41067], '::1');
      let bound: number[] | undefined;
      try {
        const connected = await connectedWith('c79-six', 'harness', {
          [SETTING]: '41067-41067',
        });
        bound = windowPorts(connected.added, 41067, 41067);
        await closeWindow('c79-six');
      } finally {
        await loopback.release();
      }
      const wildcard = await holdPorts([41068], '0.0.0.0');
      try {
        await userSettings({[SETTING]: '41068-41068', ...PLATFORM});
        appendScript(dismissing('c79-wild', 'Close Remote'));
        await openWindow('harness', 'c79-wild');
        const dialogs = await dialogsOf('c79-wild', 1);
        await closeWindow('c79-wild');
        deepStrictEqual(
          [bound, dialogs],
          [[41067], [busyDialog('41068-41068')]],
        );
      } finally {
        await wildcard.release();
      }
    });
  });

  it('F-2104 AC-13 (c79-range-forward): a port forwarded in a window with a range keeps its own local number, outside the range', async () => {
    await startGreeter();
    try {
      await keepingSettings(async () => {
        await connectedWith('c79-range-forward', 'harness', {
          [SETTING]: '41040-41043',
        });
        await inWindow(
          'c79-range-forward',
          'acceptance.agent.forwardPort',
          REMOTE_PORT,
        );
        const local = forwardedPortOf('c79-range-forward');
        deepStrictEqual(
          [local, await greetedAt(local)],
          [REMOTE_PORT, GREETING],
        );
        await closeWindow('c79-range-forward');
      });
    } finally {
      await stopGreeter();
    }
  });

  it('F-2104 AC-14, AC-17, AC-41, AC-42 (c79-range-dialog): a range with every port held gives the dialog with its three buttons; Retry with the range still full gives it again, its progress reading the host alone until then; More Actions shows the five actions and Escape leaves the indicator Disconnected from SSH: harness', async () => {
    await keepingSettings(async () => {
      const held = await holdPorts([41070, 41071], '127.0.0.1');
      try {
        await userSettings({[SETTING]: '41070-41071', ...PLATFORM});
        const name = 'c79-full';
        appendScript([
          {
            surface: 'failureDialog',
            match: FAILURE,
            answer: {button: 'Retry'},
            window: name,
          },
          ...dismissing(name, 'More Actions...'),
        ]);
        await openWindow('harness', name);
        await waitFor(
          'the pick of actions',
          () => recordLines('mitigationPick', name).length > 0,
          300_000,
        );
        // Escape answered the pick: the record must not gain a dialog or a pick afterwards, as it would if they reopened.
        await new Promise(resolve => setTimeout(resolve, 5000));
        const lines = recordLines(undefined, name);
        const first = lines.findIndex(line => line.surface === 'failureDialog');
        const second = lines.findIndex(
          (line, index) => index > first && line.surface === 'failureDialog',
        );
        deepStrictEqual(
          {
            retryProgress: lines
              .slice(first + 1, second)
              .filter(line => line.surface === 'progress')
              .map(line => [line.question, line.details]),
            dialogs: lines
              .filter(line => line.surface === 'failureDialog')
              .map(line => [line.question, line.buttons]),
            pick: lines
              .filter(line => line.surface === 'mitigationPick')
              .map(line => [line.question, line.items]),
            indicator: (await statusItem(name, 'status.host')).text,
          },
          {
            retryProgress: [['Setting up SSH Host harness', undefined]],
            dialogs: [
              [busyDialog('41070-41071'), BUTTONS],
              [busyDialog('41070-41071'), BUTTONS],
            ],
            pick: [
              [
                'Pick an action to help resolve the problem.',
                [
                  'Reload Window',
                  'Open Recent...',
                  'Open Documentation',
                  'Open SSH Configuration File',
                  'Open Settings',
                ],
              ],
            ],
            indicator: 'Disconnected from SSH: harness',
          },
        );
        await closeWindow(name);
      } finally {
        await held.release();
      }
    });
  });

  it('F-2104 AC-16 (c79-range-retry): after the ports are freed, Retry connects the same window on the first port of the range', async () => {
    await keepingSettings(async () => {
      const held = await holdPorts([41075, 41076], '127.0.0.1');
      try {
        await userSettings({[SETTING]: '41075-41076', ...PLATFORM});
        const name = 'c79-retry';
        appendScript([
          {
            surface: 'failureDialog',
            match: FAILURE,
            answer: {button: 'Retry'},
            window: name,
            after: 'c79-freed',
          },
        ]);
        const before = listeners();
        await openWindow('harness', name);
        await dialogsOf(name, 1);
        await held.release();
        signal('c79-freed');
        await waitFor(
          'the connection on the first port',
          () =>
            windowPorts(addedSince(before, listeners()), 41075, 41076).length >
            0,
          120_000,
        );
        deepStrictEqual(
          windowPorts(addedSince(before, listeners()), 41075, 41076),
          [41075],
        );
        await closeWindow(name);
      } finally {
        await held.release().catch(() => undefined);
      }
    });
  });

  it('F-2104 AC-30 (c79-range-changed): the range changed in the settings while the dialog is open is the one Retry uses, with no restart', async () => {
    await keepingSettings(async () => {
      const held = await holdPorts([41080, 41081], '127.0.0.1');
      try {
        await userSettings({[SETTING]: '41080-41081', ...PLATFORM});
        const name = 'c79-changed';
        appendScript([
          {
            surface: 'failureDialog',
            match: FAILURE,
            answer: {button: 'Retry'},
            window: name,
            after: 'c79-changed-range',
          },
        ]);
        const before = listeners();
        await openWindow('harness', name);
        await dialogsOf(name, 1);
        await userSettings({[SETTING]: '41082-41083'});
        signal('c79-changed-range');
        await waitFor(
          'the connection on the new range',
          () =>
            windowPorts(addedSince(before, listeners()), 41080, 41083).length >
            0,
          120_000,
        );
        deepStrictEqual(
          windowPorts(addedSince(before, listeners()), 41080, 41083),
          [41082],
        );
        await closeWindow(name);
      } finally {
        await held.release();
      }
    });
  });

  it('F-2104 AC-15 (c79-range-terminal): with the local server off and a full range the install login happens, the dialog appears and no tunnel ssh process is started', async () => {
    await keepingSettings(async () => {
      const held = await holdPorts([41085, 41086], '127.0.0.1');
      try {
        await userSettings({
          [SETTING]: '41085-41086',
          'remote.SSH.useLocalServer': false,
          ...PLATFORM,
        });
        const name = 'c79-range-terminal';
        const since = new Date().toISOString();
        appendScript(dismissing(name, 'More Actions...'));
        await openWindow('harness', name);
        const dialogs = await dialogsOf(name, 1);
        await new Promise(resolve => setTimeout(resolve, 8000));
        const logins = await acceptedKeyLogins(since);
        await closeWindow(name);
        deepStrictEqual([dialogs, logins], [[busyDialog('41085-41086')], 1]);
      } finally {
        await held.release();
      }
    });
  });

  it('F-2104 AC-18 (c79-range-ignored-part): a range that is not of the form first-last, or reversed, or outside the ports is ignored: no notification or dialog, a random port, and the log says so', async () => {
    const seen: Array<[string, number, string[], string[]]> = [];
    for (const value of ['abc', '41090', '41091-41090', '70000-70010', '0-0']) {
      await closeAllButLocal();
      await keepingSettings(async () => {
        const name = 'c79-ignored';
        const mark = connectionLog().length;
        await connectedWith(name, 'harness', {[SETTING]: value});
        seen.push([
          value,
          recordLines('failureDialog', name).length,
          await notifications(name),
          connectionLog()
            .slice(mark)
            .filter(line => /range/i.test(line)),
        ]);
        await closeWindow(name);
      });
    }
    deepStrictEqual(seen, [
      ['abc', 0, [], ignored('badFormat')],
      ['41090', 0, [], ignored('badFormat')],
      ['41091-41090', 0, [], ignored('reversed')],
      ['70000-70010', 0, [], ignored('outOfBounds')],
      ['0-0', 0, [], ignored('outOfBounds')],
    ]);
  });

  it('F-2104 AC-19 (c79-range-unbindable): a range whose only port nobody listens on but the user cannot bind leaves the window at Setting up SSH tunnel, not connected', async () => {
    await keepingSettings(async () => {
      const refusal = await new Promise<string | undefined>(resolve => {
        const probe = createServer();
        probe.once('error', error => {
          resolve((error as NodeJS.ErrnoException).code);
        });
        probe.listen(80, '127.0.0.1', () => {
          probe.close();
          resolve(undefined);
        });
      });
      await userSettings({[SETTING]: '80-80', ...PLATFORM});
      const name = 'c79-unbindable';
      appendScript(dismissing(name, 'More Actions...'));
      await openWindow('harness', name);
      await dialogsOf(name, 1);
      const phases = recordLines('progress', name).map(line => line.question);
      const indicator = (await statusItem(name, 'status.host')).text;
      await closeWindow(name);
      deepStrictEqual(
        [refusal, phases.includes('Setting up SSH tunnel'), indicator],
        ['EACCES', true, 'Disconnected from SSH: harness'],
      );
    });
  });
});
