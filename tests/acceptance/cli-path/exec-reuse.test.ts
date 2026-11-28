/**
 * @fileoverview The exec-server mode on the CLI-source editor across windows and modes (F-2103, card #3028): a second
 * window of a connected host, a new connection to a host whose server already runs, and the switch of the mode in a
 * connected window followed by its reload.
 */

import {
  acceptedKeyLogins,
  closeWindow,
  connected,
  connectedWithin,
  inWindow,
  nextEmptyWindow,
  openWindow,
  recordLines,
  reloadWindow,
  userSettings,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {dialogOf, notifications} from '../windows/renderer.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';
import {
  cliProcessLines,
  execFacts,
  execServerPids,
  freshExecHost,
  sameOrTell,
} from './exec-layout.ts';
import {stamped} from './stamped-steps.ts';

/** The stage of the setup's notification that a window that found the server running must not show. */
const DOWNLOADING = 'Downloading VS Code Server';

/** The stages window `name` showed of the setup's notification, in order, each once. */
function stagesOf(name: string): string[] {
  const shown = recordLines(undefined, name)
    .filter(line => line.surface === 'progress')
    .map(line => line.question);
  return shown.filter((stage, index) => shown.indexOf(stage) === index);
}

describe('the exec-server mode across windows and modes (card #3028, F-2103)', function () {
  this.timeout(900_000);

  it('F-2103 AC-10 (c3028-second-window): New Window on Active Host in an exec-mode window opens a second window that connects with no new login, and the host still runs one server and one CLI', async () => {
    await keepingSettings(async () => {
      const rowName = 'c3028-second-window';
      await stamped(rowName, 'the host is made fresh', 120_000, freshExecHost);
      await userSettings({...PLATFORMS});
      await stamped(rowName, 'the first window opens', 60_000, () =>
        openWindow('harness', 'c3028-sw-first'),
      );
      let second = '';
      try {
        await stamped(rowName, 'the first connect', 130_000, () =>
          connectedWithin('c3028-sw-first', 120_000),
        );
        const since = new Date().toISOString();
        const before = {
          servers: await execServerPids(),
          facts: await execFacts(),
        };
        second = await nextEmptyWindow(() =>
          inWindow(
            'c3028-sw-first',
            'opensshremotes.openEmptyWindowOnCurrentHost',
          ),
        );
        await stamped(
          rowName,
          'the second window connects',
          60_000,
          async () => {
            await waitFor(
              `${second} to be connected`,
              async () =>
                (await windowState(second).catch(() => undefined))
                  ?.remoteAuthority != null,
              50_000,
            );
          },
        );
        const after = {
          servers: await execServerPids(),
          facts: await execFacts(),
        };
        await sameOrTell(
          {
            logins: await acceptedKeyLogins(since),
            sameServers: after.servers,
            oneServer: after.servers.length,
            cliProcesses: after.facts.cliProcesses,
          },
          {
            logins: 0,
            sameServers: before.servers,
            oneServer: 1,
            cliProcesses: 1,
          },
          async () =>
            `the CLI processes (pid, parent, command): ${JSON.stringify(await cliProcessLines())}`,
        );
      } finally {
        for (const window of [second, 'c3028-sw-first']) {
          if (window !== '') {
            await closeWindow(window).catch(() => undefined);
          }
        }
      }
    });
  });

  it('F-2103 AC-11 (c3028-reuse): the first window on a fresh host shows the download; a window that connects over a new ssh to the host whose server already runs reuses that server process and shows no download', async () => {
    await keepingSettings(async () => {
      const rowName = 'c3028-reuse';
      await stamped(rowName, 'the host is made fresh', 120_000, freshExecHost);
      await userSettings({...PLATFORMS});
      await stamped(rowName, 'the first window opens', 60_000, () =>
        openWindow('harness', 'c3028-reuse-first'),
      );
      let servers: number[];
      let firstStages: string[];
      try {
        await stamped(rowName, 'the first connect', 130_000, () =>
          connectedWithin('c3028-reuse-first', 120_000),
        );
        servers = await execServerPids();
        firstStages = stagesOf('c3028-reuse-first');
      } finally {
        await closeWindow('c3028-reuse-first').catch(() => undefined);
      }
      // The first window's ssh ends with its connection server, which a new window then starts again.
      await stamped(rowName, 'no helper is left', 120_000, closeAllButLocal);
      await stamped(rowName, 'the second window opens', 60_000, () =>
        openWindow('harness', 'c3028-reuse-second'),
      );
      try {
        await stamped(rowName, 'the second connect', 130_000, () =>
          connectedWithin('c3028-reuse-second', 120_000),
        );
        await sameOrTell(
          {
            first: servers.length,
            firstDownloads: firstStages.includes(DOWNLOADING),
            same: await execServerPids(),
            downloads: stagesOf('c3028-reuse-second').includes(DOWNLOADING),
            tunnel: stagesOf('c3028-reuse-second').includes(
              'Setting up SSH tunnel',
            ),
          },
          {
            first: 1,
            firstDownloads: true,
            same: servers,
            downloads: false,
            tunnel: true,
          },
          `the first window's stages: ${JSON.stringify(firstStages)}; the second window's: ${JSON.stringify(stagesOf('c3028-reuse-second'))}`,
        );
      } finally {
        await closeWindow('c3028-reuse-second').catch(() => undefined);
      }
    });
  });

  it('F-2103 AC-6, AC-9 (c3028-switch): changing the setting in a connected window shows nothing and reloads nothing; the next reload installs the other mode beside the first, whose server still runs (the new ssh login of AC-6 is not asserted: the line stays todo)', async () => {
    await keepingSettings(async () => {
      const rowName = 'c3028-switch';
      const name = 'c3028-switch';
      await stamped(rowName, 'the host is made fresh', 120_000, freshExecHost);
      await userSettings({...PLATFORMS});
      await stamped(rowName, 'the window opens', 60_000, () =>
        openWindow('harness', name),
      );
      try {
        await stamped(rowName, 'the first connect', 130_000, () =>
          connectedWithin(name, 120_000),
        );
        const servers = await execServerPids();
        const recorded = recordLines(undefined, name).length;
        await userSettings({'remote.SSH.useExecServer': false});
        await new Promise(resolve => setTimeout(resolve, 5000));
        const quiet = {
          dialog: await dialogOf(name),
          notifications: await notifications(name),
          connected: await connected(name),
          prompts: recordLines(undefined, name)
            .slice(recorded)
            .filter(line => line.surface !== 'progress')
            .map(line => `${line.surface}: ${line.question}`),
        };
        const since = new Date().toISOString();
        await stamped(rowName, 'the window reloads', 60_000, () =>
          reloadWindow(name),
        );
        await stamped(rowName, 'the reloaded window connects', 130_000, () =>
          connectedWithin(name, 120_000),
        );
        const facts = await execFacts();
        await sameOrTell(
          {
            quiet,
            legacyInstalled: facts.binFolder,
            execKept: [facts.launcher, facts.server],
            firstServer: (await execServerPids()).filter(each =>
              servers.includes(each),
            ),
          },
          {
            quiet: {
              dialog: undefined,
              notifications: [],
              connected: true,
              prompts: [],
            },
            legacyInstalled: true,
            execKept: [true, true],
            firstServer: servers,
          },
          async () =>
            `the ssh logins sshd accepted since the reload: ${String(await acceptedKeyLogins(since))}`,
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });
});
