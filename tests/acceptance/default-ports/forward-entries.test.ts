import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectionLog,
  inWindow,
  nextEmptyWindow,
  onHost,
  openWindow,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  tunnelsOf,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  notificationCentre,
  portRowActions,
  portRowAction,
  portsColumns,
  portsRows,
} from '../windows/renderer.ts';
import {connectingPrograms, holdOpen} from '../windows/forward-support.ts';
import {DATA_FOLDER} from '../windows/maintenance.ts';
import {
  holdLocal,
  listenHoldingOnHost,
  listenOnHost,
  localPortOf,
  showPorts,
  tunnelFor,
} from './forward-support.ts';
import {greetingOf} from './greeting.ts';

const execFileAsync = promisify(execFile);

/** The setting the rows change. */
const ENTRIES = 'remote.SSH.defaultForwardedPorts';

describe('the default forwarded ports of an SSH window (card coverage-83)', function () {
  this.timeout(300_000);

  let settingsBefore: string | undefined;

  before(() => {
    settingsBefore = readUserSettings();
  });

  afterEach(async () => {
    restoreUserSettings(settingsBefore);
    await onHost('sh', '-c', "pkill -f 'n[c] -lk -p 86[0-9][0-9]'; true");
  });

  it('F-2507 AC-4 (c83-held-local): an entry whose local port another local process holds goes to the next free higher port, with no prompt and no notification', async () => {
    await listenOnHost(8641, 'c83-8641');
    const release = await holdLocal(18641);
    await userSettings({
      [ENTRIES]: [{name: 'held', remotePort: 8641, localPort: 18641}],
    });
    try {
      await openWindow('harness', 'c83-a4');
      const tunnel = await tunnelFor('c83-a4', 8641);
      const local = localPortOf(tunnel);
      deepStrictEqual(
        {
          higher: local > 18641 && local < 18700,
          greeting: await greetingOf(local),
          held: await greetingOf(18641),
          dialog: await dialogOf('c83-a4'),
          notices: await notificationCentre('c83-a4'),
        },
        {
          higher: true,
          greeting: 'c83-8641',
          held: undefined,
          dialog: undefined,
          notices: [],
        },
      );
    } finally {
      await release();
      await closeWindow('c83-a4');
    }
  });

  it('F-2507 AC-5 (c83-privileged-local): an entry whose local port is privileged, for a client user that is not root, gets a free high port with no prompt and no notification', async () => {
    await listenOnHost(8642, 'c83-8642');
    await userSettings({
      [ENTRIES]: [{name: 'low', remotePort: 8642, localPort: 81}],
    });
    try {
      await openWindow('harness', 'c83-a5');
      const tunnel = await tunnelFor('c83-a5', 8642);
      const local = localPortOf(tunnel);
      deepStrictEqual(
        {
          high: local >= 1024,
          greeting: await greetingOf(local),
          dialog: await dialogOf('c83-a5'),
          notices: await notificationCentre('c83-a5'),
        },
        {high: true, greeting: 'c83-8642', dialog: undefined, notices: []},
      );
    } finally {
      await closeWindow('c83-a5');
    }
  });

  it('F-2507 AC-9, AC-37 (c83-stop-reload): a default row offers Set Port Label, Stop Forwarding Port, Copy Local Address, Open in Browser and Preview in Editor; stopped it has no listener and no row, until the next reload forwards it again', async () => {
    await listenOnHost(8643, 'c83-8643');
    await userSettings({
      [ENTRIES]: [{name: 'stop', remotePort: 8643, localPort: 18643}],
    });
    try {
      await openWindow('harness', 'c83-a9');
      await tunnelFor('c83-a9', 8643);
      await showPorts('c83-a9');
      await waitFor(
        'the row',
        async () =>
          (await portsRows('c83-a9').catch(() => [])).some(entry =>
            entry.port.includes('8643'),
          ),
        30_000,
      );
      const rowName = (await portsRows('c83-a9')).find(entry =>
        entry.port.includes('8643'),
      )?.port;
      const actions = await portRowActions('c83-a9', rowName ?? '8643');
      await portRowAction('c83-a9', rowName ?? '8643', 'Stop Forwarding Port');
      await waitFor(
        'the forward to stop',
        async () => (await greetingOf(18643)) === undefined,
        30_000,
      );
      // The row leaves the view a moment after the listener goes.
      await waitFor(
        'the row to leave',
        async () =>
          !(await portsRows('c83-a9').catch(() => [])).some(entry =>
            entry.port.includes('8643'),
          ),
        30_000,
      ).catch(() => undefined);
      const stopped = {
        listed: (await portsRows('c83-a9').catch(() => [])).some(entry =>
          entry.port.includes('8643'),
        ),
        listener: await greetingOf(18643),
      };
      await reloadWindow('c83-a9');
      await tunnelFor('c83-a9', 8643);
      deepStrictEqual(
        {
          inline: actions.inline,
          stopped,
          after: await greetingOf(18643),
        },
        {
          inline: [
            'Set Port Label',
            'Stop Forwarding Port',
            'Copy Local Address',
            'Open in Browser',
            'Preview in Editor',
          ],
          stopped: {listed: false, listener: undefined},
          after: 'c83-8643',
        },
      );
    } finally {
      await closeWindow('c83-a9');
    }
  });

  it('F-2507 AC-10 (c83-change-setting): changing the setting forwards and stops nothing until the next reload, after which only the new value is forwarded', async () => {
    await listenOnHost(8644, 'c83-8644');
    await listenOnHost(8645, 'c83-8645');
    await userSettings({
      [ENTRIES]: [{name: 'old', remotePort: 8644, localPort: 18644}],
    });
    try {
      await openWindow('harness', 'c83-a10');
      await tunnelFor('c83-a10', 8644);
      await userSettings({
        [ENTRIES]: [{name: 'new', remotePort: 8645, localPort: 18645}],
      });
      await new Promise(resolve => setTimeout(resolve, 10_000));
      const before = {
        previous: await greetingOf(18644),
        added: await greetingOf(18645),
      };
      await reloadWindow('c83-a10');
      await tunnelFor('c83-a10', 8645);
      await new Promise(resolve => setTimeout(resolve, 3000));
      deepStrictEqual(
        {
          before,
          after: {
            previous: await greetingOf(18644),
            added: await greetingOf(18645),
          },
        },
        {
          before: {previous: 'c83-8644', added: undefined},
          after: {previous: undefined, added: 'c83-8645'},
        },
      );
    } finally {
      await closeWindow('c83-a10');
    }
  });

  it('F-2507 AC-16 (c83-no-listener): an entry whose remote port has no listener keeps its row when a client connects to its local port, and the window shows no message', async () => {
    await userSettings({
      [ENTRIES]: [{name: 'quiet', remotePort: 8646, localPort: 18646}],
    });
    try {
      await openWindow('harness', 'c83-a16');
      await tunnelFor('c83-a16', 8646);
      await showPorts('c83-a16');
      const used = await greetingOf(18646);
      await new Promise(resolve => setTimeout(resolve, 3000));
      deepStrictEqual(
        {
          used,
          listed: (await portsRows('c83-a16')).some(entry =>
            entry.port.includes('8646'),
          ),
          dialog: await dialogOf('c83-a16'),
          notices: await notificationCentre('c83-a16'),
        },
        {used: undefined, listed: true, dialog: undefined, notices: []},
      );
    } finally {
      await closeWindow('c83-a16');
    }
  });

  it('F-2507 AC-11 (c83-folder-settings): a value in the remote folder’s .vscode/settings.json wins over the user value, and only its entry is forwarded', async () => {
    await listenOnHost(8647, 'c83-8647');
    await listenOnHost(8648, 'c83-8648');
    await userSettings({
      [ENTRIES]: [{name: 'user', remotePort: 8647, localPort: 18647}],
    });
    await onHost(
      'sh',
      '-c',
      `mkdir -p /home/harness/c83-a11/.vscode && printf '%s' '{"${ENTRIES}":[{"remotePort":8648,"localPort":18648}]}' > /home/harness/c83-a11/.vscode/settings.json`,
    );
    try {
      await openWindow('harness', 'c83-a11');
      await tunnelFor('c83-a11', 8648);
      await new Promise(resolve => setTimeout(resolve, 8000));
      deepStrictEqual(
        {
          remotePorts: (await tunnelsOf('c83-a11')).map(
            tunnel => tunnel.remotePort,
          ),
          folder: await greetingOf(18648),
          user: await greetingOf(18647),
        },
        {remotePorts: [8648], folder: 'c83-8648', user: undefined},
      );
    } finally {
      await closeWindow('c83-a11');
    }
  });

  it('F-2507 AC-12 (c83-machine-settings): a value in the remote machine settings wins over the user value, and only its entry is forwarded', async () => {
    const machine = `${DATA_FOLDER}/data/Machine/settings.json`;
    await listenOnHost(8649, 'c83-8649');
    await listenOnHost(8650, 'c83-8650');
    await userSettings({
      [ENTRIES]: [{name: 'user', remotePort: 8649, localPort: 18649}],
    });
    const before = await onHost('sh', '-c', `cat ${machine} 2>/dev/null; true`);
    await onHost(
      'sh',
      '-c',
      `mkdir -p ${DATA_FOLDER}/data/Machine && printf '%s' '{"${ENTRIES}":[{"remotePort":8650,"localPort":18650}]}' > ${machine}`,
    );
    try {
      await openWindow('harness', 'c83-a12');
      await tunnelFor('c83-a12', 8650);
      await new Promise(resolve => setTimeout(resolve, 8000));
      deepStrictEqual(
        {
          remotePorts: (await tunnelsOf('c83-a12')).map(
            tunnel => tunnel.remotePort,
          ),
          machine: await greetingOf(18650),
          user: await greetingOf(18649),
        },
        {remotePorts: [8650], machine: 'c83-8650', user: undefined},
      );
    } finally {
      await closeWindow('c83-a12');
      await onHost(
        'sh',
        '-c',
        before === ''
          ? `rm -f ${machine}`
          : `printf '%s' '${before}' > ${machine}`,
      );
    }
  });

  // Skipped: the editor's shared tunnel service hands a second window of the host the first window's tunnel for the same
  // remote port (18652 for both), which dies with the first window; ruled on #1626 (connect-98): AC-29 stays todo.
  it.skip('F-2507 AC-29 (c83-new-window): New Window on Active Host forwards the same entry to another local port in the new window, and both work', async () => {
    await listenOnHost(8652, 'c83-8652');
    await userSettings({
      [ENTRIES]: [{name: 'twin', remotePort: 8652, localPort: 18652}],
    });
    let second: string | undefined;
    try {
      await openWindow('harness', 'c83-a29');
      await tunnelFor('c83-a29', 8652);
      second = await nextEmptyWindow(() =>
        inWindow('c83-a29', 'opensshremotes.openEmptyWindowOnCurrentHost'),
      );
      const tunnel = await tunnelFor(second, 8652);
      const local = localPortOf(tunnel);
      deepStrictEqual(
        {
          other: local !== 18652 && local > 18652 && local < 18700,
          first: await greetingOf(18652),
          next: await greetingOf(local),
        },
        {other: true, first: 'c83-8652', next: 'c83-8652'},
      );
    } finally {
      if (second !== undefined) {
        await closeWindow(second);
      }
      await closeWindow('c83-a29');
    }
  });

  it('F-2507 AC-19 (c83-menu): a forwarded row’s context menu has no Change Port Visibility, the Ports view has no Visibility column, and a privileged remote port forwarded shows no prompt', async () => {
    await listenOnHost(8653, 'c83-8653');
    await userSettings({
      [ENTRIES]: [{name: 'menu', remotePort: 8653, localPort: 18653}],
    });
    try {
      await openWindow('harness', 'c83-a19');
      await tunnelFor('c83-a19', 8653);
      await showPorts('c83-a19');
      await waitFor(
        'the row',
        async () =>
          (await portsRows('c83-a19').catch(() => [])).some(entry =>
            entry.port.includes('8653'),
          ),
        30_000,
      );
      const name = (await portsRows('c83-a19')).find(entry =>
        entry.port.includes('8653'),
      )?.port;
      const actions = await portRowActions('c83-a19', name ?? '8653');
      const columns = await portsColumns('c83-a19');
      await inWindow('c83-a19', 'acceptance.agent.forwardPort', 81);
      await new Promise(resolve => setTimeout(resolve, 4000));
      deepStrictEqual(
        {
          visibilityItem: actions.menu.includes('Change Port Visibility'),
          visibilityColumn: columns.some(title => /visib/i.test(title)),
          dialog: await dialogOf('c83-a19'),
          notices: await notificationCentre('c83-a19'),
        },
        {
          visibilityItem: false,
          visibilityColumn: false,
          dialog: undefined,
          notices: [],
        },
      );
    } finally {
      await closeWindow('c83-a19');
    }
  });

  it('F-2507 AC-8 (c83-reload-time): after a reload the default listens again within about five seconds of the resolver returning', async () => {
    await listenOnHost(8654, 'c83-8654');
    await userSettings({
      [ENTRIES]: [{name: 'reload', remotePort: 8654, localPort: 18654}],
    });
    try {
      await openWindow('harness', 'c83-a8');
      await tunnelFor('c83-a8', 8654);
      const mark = connectionLog().length;
      await reloadWindow('c83-a8');
      function resolved(): boolean {
        return connectionLog()
          .slice(mark)
          .some(entry => entry.startsWith('Resolved ssh-remote+harness'));
      }
      await waitFor('the resolver to return', () => resolved(), 120_000);
      const began = Date.now();
      let listening = false;
      while (!listening && Date.now() - began < 20_000) {
        listening = (await greetingOf(18654)) === 'c83-8654';
        if (!listening) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      const seconds = (Date.now() - began) / 1000;
      deepStrictEqual([listening, seconds <= 7], [true, true]);
    } finally {
      await closeWindow('c83-a8');
    }
  });

  it('F-2507 AC-17 (c83-no-new-ssh): using a forwarded port starts no further ssh process and asks for no login, and on the host the connection to the application port comes from a node process', async () => {
    await listenHoldingOnHost(8655, 'c83-8655');
    await userSettings({
      [ENTRIES]: [{name: 'use', remotePort: 8655, localPort: 18655}],
    });
    async function sshProcesses(): Promise<string> {
      return (
        await execFileAsync('pgrep', ['-x', 'ssh']).catch(() => ({stdout: ''}))
      ).stdout;
    }
    try {
      await openWindow('harness', 'c83-a17');
      await tunnelFor('c83-a17', 8655);
      const before = await sshProcesses();
      const held = await holdOpen(18655);
      const programs = await connectingPrograms(8655);
      held.release();
      await greetingOf(18655);
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        {
          greeting: held.greeting,
          sameProcesses: (await sshProcesses()) === before,
          hostSide: [
            programs.length > 0,
            programs.every(name => name.includes('node')),
          ],
          dialog: await dialogOf('c83-a17'),
          notices: await notificationCentre('c83-a17'),
        },
        {
          greeting: 'c83-8655',
          sameProcesses: true,
          hostSide: [true, true],
          dialog: undefined,
          notices: [],
        },
      );
    } finally {
      await closeWindow('c83-a17');
    }
  });

  it('F-2507 AC-32 (c83-writes-nothing): connecting, forwarding, stopping and reloading write no settings file and no SSH configuration file', async () => {
    await listenOnHost(8656, 'c83-8656');
    await userSettings({
      [ENTRIES]: [{name: 'quiet', remotePort: 8656, localPort: 18656}],
    });
    const configuration = variable('HARNESS_SSH_CONFIG');
    const machine = `${DATA_FOLDER}/data/Machine/settings.json`;
    const settingsBefore = readUserSettings();
    const configurationBefore = readFileSync(configuration, 'utf8');
    const machineBefore = await onHost(
      'sh',
      '-c',
      `cat ${machine} 2>/dev/null; true`,
    );
    try {
      await openWindow('harness', 'c83-a32');
      await tunnelFor('c83-a32', 8656);
      await showPorts('c83-a32');
      await waitFor(
        'the row',
        async () =>
          (await portsRows('c83-a32').catch(() => [])).some(entry =>
            entry.port.includes('8656'),
          ),
        30_000,
      );
      const name = (await portsRows('c83-a32')).find(entry =>
        entry.port.includes('8656'),
      )?.port;
      await portRowAction('c83-a32', name ?? '8656', 'Stop Forwarding Port');
      await reloadWindow('c83-a32');
      await tunnelFor('c83-a32', 8656);
      deepStrictEqual(
        {
          user: readUserSettings() === settingsBefore,
          configuration:
            readFileSync(configuration, 'utf8') === configurationBefore,
          machine:
            (await onHost('sh', '-c', `cat ${machine} 2>/dev/null; true`)) ===
            machineBefore,
          folder: await onHost(
            'sh',
            '-c',
            'ls /home/harness/c83-a32/.vscode 2>/dev/null; true',
          ),
          configurationFile: existsSync(configuration),
        },
        {
          user: true,
          configuration: true,
          machine: true,
          folder: '',
          configurationFile: true,
        },
      );
    } finally {
      await closeWindow('c83-a32');
    }
  });
});
