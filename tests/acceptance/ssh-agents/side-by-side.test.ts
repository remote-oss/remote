/**
 * @fileoverview Remote - SSH beside core's agent hosts, from outside (F-2008 AC-4, AC-5, AC-7 and AC-8): the same
 * connection with AI features off and on, no `remoteAgentHost.*` key in the application storage, a configuration file
 * of the user's own that the host picker follows and never rewrites, and core's agent-host keys left as they are.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {
  closeWindow,
  connectedWithin,
  openWindow,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  userSettings,
  userSettingsFile,
} from '../windows/harness.ts';
import {runFromPalette} from '../windows/palette.ts';
import {
  notifications,
  pressEscape,
  quickPickOf,
  statusBarText,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';
import {
  CUSTOM_ONLY,
  fingerprint,
  storageKeys,
  writeAgentFiles,
  type AgentFiles,
} from './support.ts';

/** What the window shows of its connection: the indicator, the title and the notifications. */
async function shownBy(window: string) {
  return {
    indicator: await statusBarText(window, 'status.host'),
    title: await windowTitle(window),
    notifications: await notifications(window),
  };
}

describe('Remote - SSH beside core’s agent hosts, from outside (card #2500, F-2008)', function () {
  this.timeout(300_000);
  let saved: string | undefined;
  let files: AgentFiles;

  before(() => {
    saved = readUserSettings();
    files = writeAgentFiles();
  });

  afterEach(() => {
    restoreUserSettings(saved);
  });

  after(async () => {
    await reloadWindow('local');
  });

  it('F-2008 AC-4 (c2500-same-connection): a connection to the host shows the same title, indicator and no notification with AI features off and on', async () => {
    const shown: Array<Awaited<ReturnType<typeof shownBy>>> = [];
    for (const [enabled, window] of [
      [false, 'f2008-ai-off'],
      [true, 'f2008-ai-on'],
    ] as const) {
      await userSettings({'chat.disableAIFeatures': !enabled});
      await reloadWindow('local');
      await openWindow('harness', window);
      try {
        await connectedWithin(window, 90_000);
        const shownNow = await shownBy(window);
        shown.push({
          ...shownNow,
          title: shownNow.title.replace(window, '<folder>'),
        });
      } finally {
        await closeWindow(window);
      }
    }
    const wanted = {...shown[0], notifications: []};
    deepStrictEqual(
      {without: shown[0], with: shown[1]},
      {without: wanted, with: wanted},
    );
  });

  it('F-2008 AC-5 (c2500-no-storage): three Remote-SSH connections leave no remoteAgentHost.* key in the application storage', async () => {
    for (const window of ['f2008-s1', 'f2008-s2', 'f2008-s3']) {
      await openWindow('harness', window);
      await connectedWithin(window, 90_000);
      await closeWindow(window);
    }
    deepStrictEqual(
      storageKeys().filter(key => key.startsWith('remoteAgentHost.')),
      [],
    );
  });

  it('F-2008 AC-7 (c2500-config-file): with remote.SSH.configFile naming one host, Connect to Host lists only that host and the two footer items, and ~/.ssh/config is unchanged', async () => {
    await userSettings({'remote.SSH.configFile': files.customOnly});
    const before = fingerprint(files.config);
    await runFromPalette('local', 'Remote-SSH: Connect to Host...');
    await waitForQuickPick('local', 30_000);
    const items = (await quickPickOf('local'))?.items ?? [];
    await pressEscape('local');
    deepStrictEqual(
      {
        hosts: items.filter(item => item.includes(CUSTOM_ONLY)).length,
        others: items.filter(item => item.includes('harness')).length,
        count: items.length,
        unchanged: fingerprint(files.config) === before,
      },
      {hosts: 1, others: 0, count: 3, unchanged: true},
    );
  });

  it('F-2008 AC-8 (c2500-keys-kept): core’s agent-host keys in the user settings are not read or rewritten by a connect and a reload, and the connection is the one of AC-12', async () => {
    const before = readFileSync(userSettingsFile(), 'utf8');
    await openWindow('harness', 'f2008-keys');
    let shown: Awaited<ReturnType<typeof shownBy>>;
    try {
      await connectedWithin('f2008-keys', 90_000);
      shown = await shownBy('f2008-keys');
      await reloadWindow('f2008-keys');
      await connectedWithin('f2008-keys', 90_000);
    } finally {
      await closeWindow('f2008-keys');
    }
    deepStrictEqual(
      {
        unchanged: readFileSync(userSettingsFile(), 'utf8') === before,
        keys: ['chat.remoteAgentHostsEnabled', 'chat.remoteAgentHosts'].every(
          key => before.includes(key),
        ),
        indicator: shown.indicator.includes('SSH: harness'),
        title: shown.title.includes('[SSH: harness]'),
      },
      {unchanged: true, keys: true, indicator: true, title: true},
    );
  });
});
