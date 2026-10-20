import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import {userInfo} from 'node:os';
import path from 'node:path';
import {
  acceptedKeyLogins,
  appendScript,
  closeWindow,
  connected,
  connectedWithin,
  connectionLog,
  connectionHelpers,
  cutHostNetwork,
  hexOf,
  hostConnections,
  hostPort,
  inWindow,
  isOpen,
  noHelperWithin,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
  restoreHostNetwork,
  restoreUserSettings,
  sshdLog,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from './harness.ts';
import {dismissals} from './maintenance.ts';

/** The windows the rows open, in the order their folders are named. */
const WINDOWS = ['a1', 'a2', 'a3', 'a4'];

/** The start title of a resolve for the host `harness`: every attempt leaves one progress line with this question. */
const START_TITLE = 'Setting up SSH Host';

/** The first failure dialog `window` showed from `mark` (a time in milliseconds) on, once it is shown. */
async function dialogOf(window: string, mark: number) {
  function shown() {
    return recordLines('failureDialog', window).filter(
      line => line.time >= mark,
    );
  }
  await waitFor(
    `the failure dialog of ${window}`,
    () => shown().length > 0,
    120_000,
  );
  return shown()[0];
}

/** Opens `window` on the authority payload `payload`, whose connect is to fail, and gives its first dialog. */
async function failedOn(payload: string, window = 'a1') {
  const mark = Date.now();
  appendScript([...dismissals(window)]);
  await openWindow(payload, window);
  return dialogOf(window, mark);
}

/** The time of the RFC 3339 form docker's `--since` takes. */
function now(): string {
  return new Date().toISOString();
}

/** The helpers and the key logins of a scenario that began at `since`, once `windows` are all connected. */
async function sharing(since: string, windows: readonly string[]) {
  for (const window of windows) {
    await connectedWithin(window, 90_000);
  }
  return {
    helpers: (await connectionHelpers()).length,
    logins: await acceptedKeyLogins(since),
  };
}

describe('the ssh-remote authorities of F-2501 (card coverage-19)', function () {
  this.timeout(300000);

  afterEach(async () => {
    restoreHostNetwork();
    for (const window of WINDOWS) {
      if (isOpen(window)) {
        await closeWindow(window);
      }
    }
    await noHelperWithin(60_000);
  });

  it('F-2501 AC-4: one login serves a window opened on the host alias, and the editor opens no connection of its own', async () => {
    const since = now();
    await openWindow('harness', 'a1');
    await connectedWithin('a1', 90_000);
    const connections = await hostConnections();
    deepStrictEqual(
      [
        await acceptedKeyLogins(since),
        connections.length > 0,
        connections.every(each => each.program === 'ssh'),
      ],
      [1, true, true],
    );
  });

  it('F-2501 AC-5: the hex of a target with a host name and a user connects', async () => {
    await openWindow(hexOf({hostName: '127.0.0.1', user: 'harness'}), 'a1');
    deepStrictEqual(await connected('a1'), true);
  });

  it('F-2501 AC-6: a port as a number and as a string is one connection', async () => {
    const since = now();
    const port = hostPort();
    await openWindow(
      hexOf({hostName: '127.0.0.1', user: 'harness', port}),
      'a1',
    );
    await openWindow(
      hexOf({hostName: '127.0.0.1', user: 'harness', port: String(port)}),
      'a2',
    );
    deepStrictEqual(await sharing(since, ['a1', 'a2']), {
      helpers: 1,
      logins: 1,
    });
  });

  it('F-2501 AC-7: the alias, the hex of its host name and the hex with a field of its own are one connection', async () => {
    const since = now();
    await openWindow('harness', 'a1');
    await openWindow(hexOf({hostName: 'harness'}), 'a2');
    await openWindow(hexOf({hostName: 'harness', unknownField: 'bar'}), 'a3');
    deepStrictEqual(await sharing(since, ['a1', 'a2', 'a3']), {
      helpers: 1,
      logins: 1,
    });
  });

  it('F-2501 AC-8: the hex and the plain spelling of one target share a connection, and a target without a port is another', async () => {
    const since = now();
    const port = hostPort();
    const mark = Date.now();
    await openWindow(
      hexOf({hostName: '127.0.0.1', user: 'harness', port}),
      'a1',
    );
    await openWindow(`harness@127.0.0.1:${String(port)}`, 'a2');
    await openWindow(hexOf({hostName: '127.0.0.1', user: 'harness'}), 'a3');
    await openWindow('harness@127.0.0.1', 'a4');
    deepStrictEqual(
      [
        await sharing(since, ['a1', 'a2', 'a3', 'a4']),
        recordLines('notice').filter(line => line.time >= mark),
      ],
      [{helpers: 2, logins: 2}, []],
    );
  });

  it('F-2501 AC-9: a host typed with a port connects as the configured user, and a name with no configured user is refused', async () => {
    const port = String(hostPort());
    const since = now();
    appendScript([...dismissals('a2')]);
    await openWindow(`127.0.0.1:${port}`, 'a1');
    await connectedWithin('a1', 90_000);
    const mark = Date.now();
    await openWindow(`127.0.0.2:${port}`, 'a2');
    const dialog = await dialogOf('a2', mark);
    deepStrictEqual(
      [
        dialog?.question,
        (await sshdLog(since)).some(line =>
          line.includes(`Invalid user ${userInfo().username}`),
        ),
      ],
      [
        'Could not establish connection to "127.0.0.2": Permission denied (publickey).',
        true,
      ],
    );
  });

  it('F-2501 AC-11: the alias opened twice is one connection', async () => {
    const since = now();
    await openWindow('harness', 'a1');
    await openWindow('harness', 'a2');
    deepStrictEqual(await sharing(since, ['a1', 'a2']), {
      helpers: 1,
      logins: 1,
    });
  });

  it('F-2501 AC-13: with the local server off, and with the server on a socket, the alias connects', async () => {
    const saved = readUserSettings();
    try {
      await userSettings({'remote.SSH.useLocalServer': false});
      appendScript([
        {
          surface: 'platformPick',
          match: 'Select the platform',
          answer: 'linux',
          window: 'a1',
        },
      ]);
      await openWindow('harness', 'a1');
      await connectedWithin('a1', 90_000);
      const first = (await windowState('a1')).remoteName;
      restoreUserSettings(saved);
      await userSettings({'remote.SSH.remoteServerListenOnSocket': true});
      await openWindow('harness', 'a2');
      await connectedWithin('a2', 90_000);
      deepStrictEqual(
        [first, (await windowState('a2')).remoteName],
        ['ssh-remote', 'ssh-remote'],
      );
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2501 AC-10: a reload of a connected window shows no question and keeps the helper and the login', async () => {
    const since = now();
    await openWindow('harness', 'a1');
    await connectedWithin('a1', 90_000);
    const helpers = await connectionHelpers();
    const logins = await acceptedKeyLogins(since);
    const mark = Date.now();
    await reloadWindow('a1');
    await connectedWithin('a1', 10_000);
    deepStrictEqual(
      [
        recordLines(undefined, 'a1')
          .filter(
            line =>
              line.time >= mark &&
              ['maskedInput', 'pick', 'progress'].includes(line.surface),
          )
          .map(line => line.surface),
        await connectionHelpers(),
        await acceptedKeyLogins(since),
      ],
      [[], helpers, logins],
    );
  });

  it('F-2501 AC-20: a reload of a window whose connect failed shows the failure dialog again', async () => {
    const mark = Date.now();
    appendScript([...dismissals('a1'), ...dismissals('a1')]);
    await openWindow('refused', 'a1');
    const first = await dialogOf('a1', mark);
    await reloadWindow('a1');
    await waitFor(
      'a second failure dialog',
      () =>
        recordLines('failureDialog', 'a1').filter(line => line.time >= mark)
          .length > 1,
      120_000,
    );
    deepStrictEqual(
      recordLines('failureDialog', 'a1').filter(line => line.time >= mark)[1]
        ?.question,
      first?.question,
    );
  });

  it('F-2501 AC-25: the alias and the hex of its host name share a connection, and the same host with a user and a port is another', async () => {
    const since = now();
    await openWindow('harness', 'a1');
    await openWindow(hexOf({hostName: 'harness'}), 'a2');
    await openWindow(`harness@127.0.0.1:${String(hostPort())}`, 'a3');
    deepStrictEqual(await sharing(since, ['a1', 'a2', 'a3']), {
      helpers: 2,
      logins: 2,
    });
  });

  it('F-2501 AC-14: a key the host does not accept fails with Permission denied and the three buttons', async () => {
    const dialog = await failedOn('badkey');
    deepStrictEqual(
      [dialog?.question, dialog?.buttons],
      [
        'Could not establish connection to "badkey": Permission denied (publickey).',
        ['Close Remote', 'Retry', 'More Actions...'],
      ],
    );
  });

  it('F-2501 AC-16: a host that does not resolve fails and says so', async () => {
    deepStrictEqual(
      (await failedOn('nowhere'))?.question,
      'Could not establish connection to "nowhere": Could not resolve hostname.',
    );
  });

  it('F-2501 AC-17: a closed port fails with the dialog and no reason', async () => {
    deepStrictEqual(
      (await failedOn('refused'))?.question,
      'Could not establish connection to "refused".',
    );
  });

  it("connect-64: a closed port logs ssh's exit status before the failure line, and the dialog is unchanged", async () => {
    const dialog = await failedOn('refused');
    const lines = connectionLog();
    const failure = lines.lastIndexOf('connect failed: unknown');
    deepStrictEqual(
      [dialog?.question, lines[failure - 1]],
      [
        'Could not establish connection to "refused".',
        'ssh exited with status 255',
      ],
    );
  });

  it('F-2501 AC-18: an address that is never routed fails as timed out after the connect timeout', async () => {
    const start = Date.now();
    const dialog = await failedOn('blackhole');
    const first = recordLines('progress', 'a1').find(
      line => line.time >= start,
    );
    const elapsed = (dialog?.time ?? 0) - (first?.time ?? 0);
    deepStrictEqual(
      [dialog?.question, elapsed >= 13_000 && elapsed <= 25_000],
      [
        'Could not establish connection to "blackhole": The connection timed out.',
        true,
      ],
    );
  });

  it('F-2501 AC-19: a host key that is not known and is not trusted fails with the plain dialog', async () => {
    appendScript([
      {
        surface: 'pick',
        match: 'fingerprint',
        answer: 'dismiss',
        window: 'a1',
      },
    ]);
    deepStrictEqual(
      (await failedOn('stranger'))?.question,
      'Could not establish connection to "stranger".',
    );
  });

  it('F-2501 AC-32: a user with an at sign is passed whole to the host, and the dialog names the host', async () => {
    const since = now();
    const dialog = await failedOn('a@b@127.0.0.1');
    deepStrictEqual(
      [
        (await sshdLog(since)).some(line => line.includes('Invalid user a@b')),
        dialog?.question.includes('127.0.0.1'),
      ],
      [true, true],
    );
  });

  it('F-2501 AC-33: a host name is not matched to an alias in another case', async () => {
    deepStrictEqual(
      (await failedOn('Harness'))?.question,
      'Could not establish connection to "Harness": Could not resolve hostname.',
    );
  });

  it('F-2501 AC-2: a window on a local folder is not on a remote and the extension has not activated', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'local-folder');
    mkdirSync(folder, {recursive: true});
    await inWindow('local', 'acceptance.agent.openWindow', `file://${folder}`);
    await waitFor(
      'the local folder window',
      () =>
        windowEvents('local-folder').some(each => each.event === 'activated'),
      60_000,
    );
    const state = await windowState('local-folder');
    await closeWindow('local-folder');
    deepStrictEqual([state.remoteName, state.remoteSshActive], [null, false]);
  });

  it('F-2501 AC-31: the internal command of the extension activates it in a local window and calls no resolver', async () => {
    const since = now();
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'a-internal');
    mkdirSync(folder, {recursive: true});
    await inWindow('local', 'acceptance.agent.openWindow', `file://${folder}`);
    await waitFor(
      'the internal window',
      () => windowEvents('a-internal').some(each => each.event === 'activated'),
      60_000,
    );
    const before = await windowState('a-internal');
    await inWindow('a-internal', 'remote-internal.getActiveSshRemote');
    const after = await windowState('a-internal');
    const progress = recordLines('progress', 'a-internal').length;
    const logins = await acceptedKeyLogins(since);
    await closeWindow('a-internal');
    deepStrictEqual(
      [
        before.remoteSshActive,
        after.remoteSshActive,
        after.remoteName,
        progress,
        logins,
      ],
      [false, true, null, 0, 0],
    );
  });

  it('F-2501 AC-12: a window whose network is lost tries again and reconnects without a reload when the network is back', async () => {
    await openWindow('harness', 'a1');
    await connectedWithin('a1', 90_000);
    const activations = windowEvents('a1').filter(
      each => each.event === 'activated',
    ).length;
    function starts(): number {
      return recordLines('progress', 'a1').filter(line =>
        line.question.startsWith(START_TITLE),
      ).length;
    }
    const startsBefore = starts();
    const dialogsBefore = recordLines('failureDialog', 'a1').length;
    cutHostNetwork();
    try {
      await waitFor(
        'two more attempts to resolve',
        () => starts() >= startsBefore + 2,
        180_000,
      );
    } finally {
      restoreHostNetwork();
    }
    const restored = now();
    await connectedWithin('a1', 120_000);
    deepStrictEqual(
      [
        recordLines('failureDialog', 'a1').length - dialogsBefore,
        (await acceptedKeyLogins(restored)) >= 1,
        windowEvents('a1').filter(each => each.event === 'activated').length -
          activations,
      ],
      [0, true, 0],
    );
  });
});
