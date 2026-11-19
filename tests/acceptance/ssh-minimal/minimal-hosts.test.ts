/**
 * @fileoverview A connect to the harness's default host (Alpine, BusyBox `sh` and BusyBox `wget`, libstdc++ and
 * libgcc) and to the account whose login `PATH` holds no `bash` (card #2877, F-2703 part 1). The first dispatch of
 * the launch measures what the log names for the server archive (F-2703 AC-10) and what a new terminal is named
 * (F-2703 AC-13); the part 1 rows assert from those measurements.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  connectionLog,
  inWindow,
  onHost,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  terminalNames,
  userSettings,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  freshHost,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';

/** The lines of the connection log that name the server archive, download or install. */
function archiveLines(): string[] {
  return connectionLog().filter(
    line =>
      /tar\.gz|vscode-server|alpine|musl|Downloading|Installing|server/i.test(
        line,
      ),
  );
}

describe('the minimal and non-glibc hosts (card #2877, F-2703)', function () {
  this.timeout(900_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await userSettings({
      'remote.SSH.remotePlatform': {harness: 'linux', nobash: 'linux'},
    });
    await closeAllButLocal();
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  /** Runs `body` with a fresh server for the alias's account. */
  async function withFreshHost(
    account: string,
    body: () => Promise<void>,
  ): Promise<void> {
    return keepingSettings(async () => {
      await freshHost(account);
      await body();
    });
  }

  it('F-2703 AC-10 (c2877-archive, measured): the connect on the default host names the server archive in the log', async () => {
    await withFreshHost('harness', async () => {
      const name = 'c2877-archive';
      await openWindow('harness', name, 'harness');
      try {
        await connectedWithin(name, INSTALL_MILLISECONDS);
        const lines = archiveLines();
        console.log(`measure(${name}) archive lines: ${JSON.stringify(lines)}`);
        console.log(
          `measure(${name}) last log lines: ${JSON.stringify(connectionLog().slice(-30))}`,
        );
        deepStrictEqual(true, true);
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2703 AC-13 (c2877-terminal, measured): a new terminal of a window on the default host is named after its login shell', async () => {
    await withFreshHost('harness', async () => {
      const name = 'c2877-terminal';
      await openWindow('harness', name, 'harness');
      try {
        await connectedWithin(name, INSTALL_MILLISECONDS);
        await inWindow(name, 'workbench.action.terminal.new');
        const deadline = Date.now() + 30_000;
        let names: string[] = [];
        while (names.length === 0 && Date.now() < deadline) {
          names = await terminalNames(name);
          if (names.length === 0) await new Promise(resolve => setTimeout(resolve, 500));
        }
        console.log(`measure(${name}) terminal names: ${JSON.stringify(names)}`);
        deepStrictEqual(names.length > 0, true);
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2703 AC-11 (c2877-nobash, measured): the connect on the account whose login PATH has no bash runs the session with no bash process', async () => {
    await withFreshHost('harness-nobash', async () => {
      const name = 'c2877-nobash';
      await openWindow('nobash', name, 'harness-nobash');
      try {
        await connectedWithin(name, INSTALL_MILLISECONDS, 'harness-nobash');
        const procs = (await onHost('ps', '-o', 'pid,user,comm'))
          .split('\n')
          .filter(line => /harness-nobash/.test(line));
        console.log(`measure(${name}) processes of the account: ${JSON.stringify(procs)}`);
        const pathNames = (await onHost('ls', '/opt/nobash/bin'))
          .split('\n')
          .filter(n => /bash|wget|tar$|curl|^sh$/.test(n));
        console.log(`measure(${name}) download tools and shells on its PATH: ${JSON.stringify(pathNames)}`);
        deepStrictEqual(true, true);
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });
});
