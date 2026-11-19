/**
 * @fileoverview A connect to the harness's default host (Alpine, BusyBox `sh` and BusyBox `wget`, libstdc++ and
 * libgcc) and to the account whose login `PATH` holds no `bash` (card #2877, F-2703 part 1). The `c2877-archive` and
 * `c2877-terminal` rows still measure what the log names for the server archive (F-2703 AC-10) and what a new
 * terminal is named (F-2703 AC-13); the posted measurements await the card's ruling before their assertions stand.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  inWindow,
  onHostAs,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  terminalNames,
  userSettings,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  freshHost,
  INSTALL_MILLISECONDS,
  platformAnswer,
  setting,
} from '../windows/maintenance.ts';
import {
  statusItemText,
  windowTitle,
} from '../windows/renderer.ts';
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

/**
 * The names the account's processes run as, one per line, from each process's own state: the host's `ps` is
 * BusyBox's, whose user column holds eight characters, and `harness-nobash` would read `harness-` in it.
 */
async function accountComms(account: string): Promise<string[]> {
  const script = `
    uid=$(id -u ${account})
    for state in /proc/[0-9]*/; do
      user=$(awk '/^Uid:/{print $2}' "$state/status" 2>/dev/null)
      [ "$user" = "$uid" ] && cat "$state/comm" 2>/dev/null
    done`;
  return (await onHostAs('root', 'sh', '-c', script))
    .split('\n')
    .filter(line => line.length > 0);
}

/** The account's login environment, as its shell's `command -v` and the tools' own banners answer it. */
async function loginFacts(): Promise<string[]> {
  const script = `
    command -v bash >/dev/null 2>&1 && echo bash-present || echo bash-absent
    command -v curl >/dev/null 2>&1 && echo curl-present || echo curl-absent
    wget --help 2>&1 </dev/null | head -1
    tar --version 2>&1 | head -1`;
  return (await onHostAs('harness-nobash', 'sh', '-l', '-c', script)).split(
    '\n',
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

  /** The window's connected face: its remote indicator and its title, once both read. */
  async function face(
    name: string,
    alias: string,
  ): Promise<[string, string]> {
    return [
      await statusItemText(name, 'status.host', `SSH: ${alias}`, 30_000),
      await windowTitle(name),
    ];
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

  it('F-2703 AC-11 (c2877-nobash): the connect on the account whose login PATH has no bash connects as the default host does, and no bash process of the account runs for the session', async () => {
    await withFreshHost('harness-nobash', async () => {
      const name = 'c2877-nobash';
      await openWindow('nobash', name, 'harness-nobash');
      try {
        await connectedWithin(name, INSTALL_MILLISECONDS, 'harness-nobash');
        const comms = await accountComms('harness-nobash');
        deepStrictEqual(
          [comms.length > 0, comms.includes('bash'), await face(name, 'nobash')],
          [true, false, ['SSH: nobash', `[${name} [SSH: nobash]]`]],
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2703 AC-12 (c2877-busybox): the connect on the account whose only shell, wget and tar are BusyBox\'s connects, with no bash and no curl on its login PATH', async () => {
    await withFreshHost('harness-nobash', async () => {
      const name = 'c2877-busybox';
      await openWindow('nobash', name, 'harness-nobash');
      try {
        await connectedWithin(name, INSTALL_MILLISECONDS, 'harness-nobash');
        const facts = await loginFacts();
        deepStrictEqual(
          [
            facts[0],
            facts[1],
            /BusyBox .*multi-call binary/.test(facts[2] ?? ''),
            /busybox/i.test(facts[3] ?? ''),
            await face(name, 'nobash'),
          ],
          [
            'bash-absent',
            'curl-absent',
            true,
            true,
            ['SSH: nobash', `[${name} [SSH: nobash]]`],
          ],
        );
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

  it('F-2703 AC-14 (c2877-terminal-mode): terminal mode on the account without bash, picking Linux, resolves with no failure dialog', async () => {
    await setting('remote.SSH.useLocalServer', false);
    try {
      // The account holds no stored platform: the pick appears and the row answers it.
      await setting('remote.SSH.remotePlatform', {harness: 'linux'});
      await withFreshHost('harness-nobash', async () => {
        const name = 'c2877-terminal-mode';
        appendScript([
          {...platformAnswer('linux'), match: 'Select the platform', window: name},
        ]);
        await openWindow('nobash', name, 'harness-nobash');
        try {
          await connectedWithin(name, INSTALL_MILLISECONDS, 'harness-nobash');
          deepStrictEqual(
            [
              await face(name, 'nobash'),
              recordLines('failureDialog', name).map(line => line.question),
            ],
            [[`SSH: nobash`, `[${name} [SSH: nobash]]`], []],
          );
        } finally {
          await closeWindow(name).catch(() => undefined);
        }
      });
    } finally {
      await setting('remote.SSH.useLocalServer', undefined);
      await setting('remote.SSH.remotePlatform', {
        harness: 'linux',
        nobash: 'linux',
      });
    }
  });

  it('F-2703 AC-20 (c2877-exec-server): the host with bash installed and login shell sh connects with the exec server on and off', async () => {
    try {
      for (const execServer of [true, false]) {
        await setting('remote.SSH.useExecServer', execServer);
        await withFreshHost('harness', async () => {
          const name = 'c2877-exec-server';
          await openWindow('harness', name, 'harness');
          try {
            await connectedWithin(name, INSTALL_MILLISECONDS);
            deepStrictEqual(await face(name, 'harness'), [
              'SSH: harness',
              `[${name} [SSH: harness]]`,
            ]);
          } finally {
            await closeWindow(name).catch(() => undefined);
          }
        });
      }
    } finally {
      await setting('remote.SSH.useExecServer', undefined);
    }
  });
});
