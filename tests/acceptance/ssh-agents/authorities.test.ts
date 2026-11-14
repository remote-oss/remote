/**
 * @fileoverview The three authority forms core builds for "Open in Editor" (F-2008 AC-6, AC-12, AC-13, AC-14 and
 * AC-16): a window opened on `ssh-remote+<hex>`, `ssh-remote+<alias>` or `ssh-remote+<address>` connects as a typed
 * host does, shows the label of the host in the indicator and the title, and writes no file of its own.
 */

import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {
  connectedWithin,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {authorityHex} from './authority-hex.ts';
import {
  answerDialog,
  chooseQuickPickRow,
  quickPickOf,
  statusBarText,
  waitForDialog,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';
import {
  ALIAS,
  closeQuietly,
  fingerprint,
  harnessBlock,
  writeAgentFiles,
  type AgentFiles,
} from './support.ts';

/** What the window shows of its host: the remote indicator and the title. */
async function labelsOf(
  window: string,
): Promise<{indicator: string; title: string}> {
  return {
    indicator: await statusBarText(window, 'status.host'),
    title: await windowTitle(window),
  };
}

/** The lines of `file`. */
function linesOf(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line !== '');
}

describe('the authorities of core’s "Open in Editor" (card #2500, F-2008)', function () {
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

  it('F-2008 AC-12 (c2500-alias): a window on ssh-remote+<alias> connects with the alias’s settings and shows SSH: <alias> in the indicator and [SSH: <alias>] in the title', async () => {
    await userSettings({'remote.SSH.configFile': files.config});
    await openWindow(ALIAS, 'f2008-alias-window');
    try {
      await connectedWithin('f2008-alias-window', 90_000);
      const shown = await labelsOf('f2008-alias-window');
      deepStrictEqual(
        {
          indicator: shown.indicator.includes(`SSH: ${ALIAS}`),
          title: shown.title.includes(`[SSH: ${ALIAS}]`),
        },
        {indicator: true, title: true},
      );
    } finally {
      await closeQuietly('f2008-alias-window');
    }
  });

  it('F-2008 AC-6 (c2500-hex-alias): ssh-remote+<hex of hostName and user> connects, and the indicator and the title show the host name without a port', async () => {
    const block = harnessBlock();
    await openWindow(
      authorityHex({hostName: 'harness', user: block.user}),
      'f2008-hex-alias',
    );
    try {
      await connectedWithin('f2008-hex-alias', 90_000);
      const shown = await labelsOf('f2008-hex-alias');
      deepStrictEqual(
        {
          indicator: shown.indicator.includes('SSH: harness'),
          title: shown.title.includes('[SSH: harness]'),
        },
        {indicator: true, title: true},
      );
    } finally {
      await closeQuietly('f2008-hex-alias');
    }
  });

  it('F-2008 AC-6, AC-16 (c2500-hex-address): ssh-remote+<hex of address, user and port> asks the host key, connects after the accept, shows SSH: <address>:<port>, and leaves the key in known_hosts alone with no store of the extension', async () => {
    const block = harnessBlock();
    const label = `${block.hostName}:${String(block.port)}`;
    await userSettings({'remote.SSH.configFile': files.addressKey});
    const linesBefore = linesOf(files.knownHosts).length;
    await openWindow(
      authorityHex({
        hostName: block.hostName,
        user: block.user,
        port: block.port,
      }),
      'f2008-hex-address',
    );
    try {
      await waitForQuickPick('f2008-hex-address', 90_000);
      const items = (await quickPickOf('f2008-hex-address'))?.items ?? [];
      const accept = items.find(item =>
        /^(yes|continue|accept)/i.test(item.trim()),
      );
      if (accept === undefined) {
        throw new Error(`no accept item among ${JSON.stringify(items)}`);
      }
      await chooseQuickPickRow('f2008-hex-address', accept);
      await connectedWithin('f2008-hex-address', 90_000);
      const shown = await labelsOf('f2008-hex-address');
      const found = spawnSync(
        'ssh-keygen',
        [
          '-F',
          `[${block.hostName}]:${String(block.port)}`,
          '-f',
          files.knownHosts,
        ],
        {encoding: 'utf8'},
      );
      const storage = path.join(
        variable('HARNESS_USER_DATA'),
        'User/globalStorage/remote-oss.remote-ssh',
      );
      const stored = (() => {
        try {
          return readdirSync(storage).filter(name =>
            readFileSync(path.join(storage, name), 'utf8').includes(
              block.hostName,
            ),
          );
        } catch {
          return [];
        }
      })();
      deepStrictEqual(
        {
          indicator: shown.indicator.includes(`SSH: ${label}`),
          title: shown.title.includes(`[SSH: ${label}]`),
          newLines: linesOf(files.knownHosts).length - linesBefore,
          found: found.status,
          stored,
        },
        {indicator: true, title: true, newLines: 1, found: 0, stored: []},
      );
    } finally {
      await closeQuietly('f2008-hex-address');
    }
  });

  it('F-2008 AC-13 (c2500-bare-address): ssh-remote+<address> connects like a typed host with the port and user of the configuration and shows SSH: <address>', async () => {
    const block = harnessBlock();
    await userSettings({'remote.SSH.configFile': files.addressFull});
    await openWindow(block.hostName, 'f2008-bare-address');
    try {
      await connectedWithin('f2008-bare-address', 90_000);
      deepStrictEqual(
        (await statusBarText('f2008-bare-address', 'status.host')).includes(
          `SSH: ${block.hostName}`,
        ),
        true,
      );
    } finally {
      await closeQuietly('f2008-bare-address');
    }
  });

  it('F-2008 AC-14 (c2500-other-config): with a configFile that lacks the alias, ssh-remote+<alias> does not read ~/.ssh/config, shows the could-not-resolve modal, and writes none of the three files', async () => {
    await userSettings({'remote.SSH.configFile': files.customOnly});
    const before = [files.config, files.knownHosts, files.customOnly].map(
      fingerprint,
    );
    await openWindow(ALIAS, 'f2008-missing-alias');
    try {
      const dialog = await waitForDialog('f2008-missing-alias');
      await answerDialog('f2008-missing-alias', 'Close Remote');
      const unchanged =
        [files.config, files.knownHosts, files.customOnly]
          .map(fingerprint)
          .join() === before.join();
      deepStrictEqual(
        {details: dialog.details, unchanged},
        {
          details: `Could not establish connection to "${ALIAS}": Could not resolve hostname.`,
          unchanged: true,
        },
      );
    } finally {
      await closeQuietly('f2008-missing-alias');
    }
  });
});
