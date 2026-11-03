import {deepStrictEqual} from 'node:assert';
import {closeAllButLocal, freshHost} from '../windows/maintenance.ts';
import {dialogOf, statusItem} from '../windows/renderer.ts';
import {
  hasNoTty,
  hostSessions,
  ptyConnect,
  type PtyConnect,
  runSshArguments,
} from '../windows/pty-support.ts';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionHelpers,
  inWindow,
  openWindow,
  recordLines,
  reloadWindow,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';

/** The setting that lets the connection's ssh allocate a pseudo-terminal. */
const PERMIT = 'remote.SSH.permitPtyAllocation';

/** What a connect showed of its allocation: whether it connected, whether ssh carried -T, and the host's terminals. */
function summary(found: PtyConnect): [boolean, boolean[], string[]] {
  return [found.connected, found.commands.map(hasNoTty), found.sessions];
}

describe('F-2106: pseudo-terminal allocation', function () {
  this.timeout(900_000);
  beforeEach(closeAllButLocal);

  it('F-2106 AC-1 (c86-default): by default the ssh command carries -T, the host session has no terminal and the connection succeeds', async () => {
    await keepingSettings(async () => {
      deepStrictEqual(summary(await ptyConnect('c86-default', 'harness', {})), [
        true,
        [true],
        ['notty'],
      ]);
    });
  });

  it('F-2106 AC-2 (c86-off-force): with the setting off, a RequestTTY force in the host entry allocates no terminal in the shared, the terminal and the second-ssh modes', async () => {
    await keepingSettings(async () => {
      const seen: Array<ReturnType<typeof summary>> = [];
      for (const settings of [
        {},
        {'remote.SSH.useLocalServer': false},
        {'remote.SSH.useExecServer': false},
      ]) {
        await closeAllButLocal();
        seen.push(
          summary(await ptyConnect('c86-off-force', 'pty-force', settings)),
        );
      }
      deepStrictEqual(seen, [
        [true, [true], ['notty']],
        [true, [true], ['notty']],
        [true, [true], ['notty']],
      ]);
    });
  });

  it('F-2106 AC-3 (c86-on): with the setting on and no RequestTTY the new connection has no -T and the session has no terminal', async () => {
    await keepingSettings(async () => {
      deepStrictEqual(
        summary(await ptyConnect('c86-on', 'harness', {[PERMIT]: true})),
        [true, [false], ['notty']],
      );
    });
  });

  it('F-2106 AC-4 (c86-on-request): with the setting on, RequestTTY yes and RequestTTY no both leave the session without a terminal', async () => {
    await keepingSettings(async () => {
      const seen: Array<ReturnType<typeof summary>> = [];
      const commands: string[][] = [];
      for (const alias of ['pty-yes', 'pty-no']) {
        await closeAllButLocal();
        const found = await ptyConnect('c86-on-request', alias, {
          [PERMIT]: true,
        });
        seen.push(summary(found));
        commands.push(found.commands);
      }
      deepStrictEqual(
        seen,
        [
          [true, [false], ['notty']],
          [true, [false], ['notty']],
        ],
        `the ssh argument lists seen: ${JSON.stringify(commands)}`,
      );
    });
  });

  it('F-2106 AC-5 (c86-on-terminal): with the setting on and the local server off the command has no -T, the session no terminal, and it connects', async () => {
    await keepingSettings(async () => {
      deepStrictEqual(
        summary(
          await ptyConnect('c86-on-terminal', 'harness', {
            [PERMIT]: true,
            'remote.SSH.useLocalServer': false,
          }),
        ),
        [true, [false], ['notty']],
      );
    });
  });

  it('F-2106 AC-10 (c86-values): a value that is not a boolean acts by truthiness: "yes", "false" and 1 as on; "" and 0 as off', async () => {
    await keepingSettings(async () => {
      const seen: boolean[] = [];
      for (const value of ['yes', 'false', 1, '', 0]) {
        await closeAllButLocal();
        const found = await ptyConnect('c86-values', 'harness', {
          [PERMIT]: value,
        });
        seen.push(found.commands.some(hasNoTty));
      }
      deepStrictEqual(seen, [false, false, false, true, true]);
    });
  });

  it('F-2106 AC-14 (c86-warning): with the setting on and RequestTTY yes in the shared mode the ssh client’s own warning about the pseudo-terminal is in the log, unaltered', async () => {
    await keepingSettings(async () => {
      const found = await ptyConnect('c86-warning', 'pty-yes', {
        [PERMIT]: true,
      });
      deepStrictEqual(
        found.logged.filter(line => line.includes('Pseudo-terminal')),
        [
          '[ssh] Pseudo-terminal will not be allocated because stdin is not a terminal.',
        ],
      );
    });
  });

  it('F-2106 AC-6 (c86-kill): a reload with the setting turned on reaches the host with no new session and the connection keeps -T; after Kill Local Connection Server the reconnection has none', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      await freshHost();
      const name = 'c86-kill';
      await openWindow('harness', name);
      await connectedWithin(name, 90_000);
      const before = await hostSessions();
      await userSettings({...PLATFORMS, [PERMIT]: true});
      await reloadWindow(name);
      await connectedWithin(name, 90_000);
      await new Promise(resolve => setTimeout(resolve, 5000));
      const kept = runSshArguments().map(argv => argv.join(' '));
      const joined = (await hostSessions()).length;
      appendScript([
        {
          surface: 'hostPick',
          match: '',
          answer: {label: 'harness'},
          window: name,
        },
      ]);
      await inWindow(name, 'opensshremotes.cleanLocalServer');
      const later = new Set<string>();
      const end = Date.now() + 45_000;
      while (Date.now() < end) {
        for (const argv of runSshArguments()) {
          later.add(argv.join(' '));
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      deepStrictEqual(
        [
          joined === before.length,
          kept.length > 0 && kept.every(hasNoTty),
          [...later].some(command => !hasNoTty(command)),
        ],
        [true, true, true],
      );
      await closeWindow(name).catch(() => undefined);
    });
  });

  it('F-2106 AC-16 (c86-changed): a value changed while the local server runs applies to the new connection once that server has ended', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      await freshHost();
      const name = 'c86-changed';
      await openWindow('harness', name);
      await connectedWithin(name, 90_000);
      const first = runSshArguments().map(argv => hasNoTty(argv.join(' ')));
      await userSettings({...PLATFORMS, [PERMIT]: true});
      await closeWindow(name);
      await waitFor(
        'the local server to end',
        async () => (await connectionHelpers()).length === 0,
        120_000,
      );
      const again = await ptyConnect(name, 'harness', {[PERMIT]: true});
      deepStrictEqual([first, again.commands.map(hasNoTty)], [[true], [false]]);
    });
  });

  it('F-2106 AC-17 (c86-same): turning the setting on removes -T from the connection command and changes nothing else in it, and the client check is the same', async () => {
    await keepingSettings(async () => {
      const withoutSetting = await ptyConnect('c86-same', 'harness', {});
      const withSetting = await ptyConnect('c86-same', 'harness', {
        [PERMIT]: true,
      });
      function plain(command: string): string {
        return command
          .replace(/-D 127\.0\.0\.1:\d+/, '-D <port>')
          .replace(' -T', '');
      }
      function checkLines(found: PtyConnect): string[] {
        return found.logged.filter(line =>
          /^(Searched for ssh in|Checking ssh client|.*ssh client)/.test(line),
        );
      }
      deepStrictEqual(
        [
          withSetting.commands.map(plain),
          checkLines(withSetting).length > 0,
          checkLines(withSetting),
        ],
        [withoutSetting.commands.map(plain), true, checkLines(withoutSetting)],
      );
    });
  });

  it('F-2106 AC-14 (ruling-1606-no-tty-warning): with the setting on and no RequestTTY in the shared mode there is no -T, no warning, no terminal, and the window connects', async () => {
    await keepingSettings(async () => {
      const found = await ptyConnect('c86-no-warning', 'harness', {
        [PERMIT]: true,
      });
      deepStrictEqual(
        [
          found.connected,
          found.commands.map(hasNoTty),
          found.sessions,
          found.logged.filter(line => line.includes('Pseudo-terminal')),
        ],
        [true, [false], ['notty'], []],
      );
    });
  });

  it('F-2106 AC-7, AC-9 (c86-force): with the setting on and RequestTTY force a terminal is allocated, with the exec server and without it', async () => {
    await keepingSettings(async () => {
      const seen: unknown[] = [];
      for (const settings of [{}, {}, {'remote.SSH.useExecServer': false}]) {
        await closeAllButLocal();
        const found = await ptyConnect('c86-force', 'pty-force', {
          [PERMIT]: true,
          ...settings,
        });
        seen.push([
          found.connected,
          found.sessions.some(each => each.startsWith('pts')),
        ]);
      }
      deepStrictEqual(seen, [
        [true, true],
        [true, true],
        [true, true],
      ]);
    });
  });

  it('F-2106 AC-12 (c86-quiet): the feature shows no notification, progress text or status item of its own, and no failure message names the setting', async () => {
    await keepingSettings(async () => {
      for (const settings of [{}, {[PERMIT]: true}]) {
        await closeAllButLocal();
        await ptyConnect('c86-quiet', 'harness', settings);
      }
      deepStrictEqual(
        recordLines().filter(line =>
          /permitPtyAllocation|pseudo|allocat/i.test(
            `${line.question} ${line.answer}`,
          ),
        ),
        [],
      );
    });
  });

  it('F-2106 AC-14 (ruling-1779-terminal-pty): in the terminal mode with the setting on and RequestTTY yes there is no -T, the session is on a terminal, ssh writes no warning, and the window connects', async () => {
    await keepingSettings(async () => {
      const found = await ptyConnect('c86-terminal-yes', 'pty-yes', {
        [PERMIT]: true,
        'remote.SSH.useLocalServer': false,
      });
      deepStrictEqual(
        [
          found.connected,
          found.commands.map(hasNoTty),
          found.sessions.every(session => session.startsWith('pts/')),
          found.logged.filter(line => line.includes('Pseudo-terminal')),
        ],
        [true, [false], true, []],
      );
    });
  });

  it('F-2106 AC-15 (reading-1779-forced-pty): with the setting on and RequestTTY force the window connects on a terminal of the host with no failure dialog', async () => {
    await keepingSettings(async () => {
      const found = await ptyConnect('c86-force-dialog', 'pty-force', {
        [PERMIT]: true,
      });
      deepStrictEqual(
        [
          found.connected,
          found.sessions.some(each => each.startsWith('pts')),
          recordLines('failureDialog', 'c86-force-dialog').length,
        ],
        [true, true, 0],
      );
    });
  });

  it('F-2106 AC-8 (reading-1779-forced-pty): a window on RequestTTY force reconnects by itself after its connection is killed, on a terminal of the host, with no Cannot reconnect dialog and no failure dialog', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS, [PERMIT]: true});
      await freshHost();
      const name = 'c86-force-reconnect';
      await openWindow('pty-force', name);
      await connectedWithin(name, 90_000);
      appendScript([
        {
          surface: 'hostPick',
          match: '',
          answer: {label: 'pty-force'},
          window: name,
        },
      ]);
      await inWindow(name, 'opensshremotes.cleanLocalServer');
      await waitFor(
        'the sessions of the killed connection to end',
        async () => (await hostSessions()).length === 0,
        60_000,
      );
      await waitFor(
        'the window’s own reconnection to open a session on a terminal',
        async () =>
          (await hostSessions()).some(session => session.startsWith('pts')),
        120_000,
      );
      await connectedWithin(name, 120_000);
      await waitFor(
        'the indicator to read the host again',
        async () =>
          (await statusItem(name, 'status.host').catch(() => undefined))
            ?.text === 'SSH: pty-force',
        120_000,
      );
      deepStrictEqual(
        [
          (await dialogOf(name))?.details.includes('Cannot reconnect') ?? false,
          recordLines('failureDialog', name).length,
        ],
        [false, 0],
      );
      await closeWindow(name).catch(() => undefined);
    });
  });
});
