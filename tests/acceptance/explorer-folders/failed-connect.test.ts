/**
 * @fileoverview The explorer beside a connection that fails (card coverage-102, part 3c, F-5001 AC-12): a window
 * opened on a host that cannot be resolved, and on one whose port refuses the connection.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  editorLogsFolder,
  inWindow,
  openEmptyWindows,
  openWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  notifications,
  rememberPage,
  viewRows,
  waitForDialog,
} from '../windows/renderer.ts';
import {HOST} from '../windows/explorer-commands.ts';
import {connectedTo} from '../windows/explorer-folders.ts';
import {VIEW} from '../windows/explorer-rows.ts';

const EXPLORER = 'remote-oss.remote-explorer';

/** The host that no resolver knows. */
const UNKNOWN_HOST = 'nowhere-f5001.invalid';

/** The alias of a host whose port refuses the connection. */
const REFUSING_HOST = 'refusing-f5001';

/** The folder the windows open, whose name titles them. */
const FOLDER = 'f5001';

/** The folder of the window that connects. */
const CONNECTED_FOLDER = 'f5001-connected';

/** The start of the progress notification that the companion leaves in the window. */
const COMPANION_PROGRESS = 'Setting up SSH Host';

/** The hosts the rows open, each with what the companion says of its failure. */
const FAILING_HOSTS = [
  [UNKNOWN_HOST, ': Could not resolve hostname.'],
  [REFUSING_HOST, '.'],
] as const;

/** The extension host logs under the editor's logs, one per window. */
function extensionHostLogs(): string[] {
  return readdirSync(editorLogsFolder(), {
    recursive: true,
    encoding: 'utf8',
  })
    .filter(file => path.basename(file) === 'exthost.log')
    .map(file => path.join(editorLogsFolder(), file));
}

/** Whether the log holds the line the editor writes when it activates the explorer. */
function activates(file: string): boolean {
  return readFileSync(file, 'utf8').includes(
    `_doActivateExtension ${EXPLORER}`,
  );
}

/** The extension host logs that are not `known` and show the explorer activated, once there is one. */
async function activatedLogs(known: Set<string>): Promise<string[]> {
  let logs: string[] = [];
  await waitFor(
    'the explorer to be activated in a new window',
    () => {
      logs = extensionHostLogs().filter(
        file => !known.has(file) && activates(file),
      );
      return Promise.resolve(logs.length > 0);
    },
    60_000,
  ).catch(() => undefined);
  return logs;
}

/** The SSH configuration of the run, which the launch's setting names. */
function configFile(): string {
  return variable('HARNESS_SSH_CONFIG');
}

describe('the explorer beside a failing connection (card coverage-102, part 3c)', function () {
  this.timeout(300_000);
  let configBefore = '';

  before(async () => {
    await rememberPage('local');
    configBefore = readFileSync(configFile(), 'utf8');
    appendFileSync(
      configFile(),
      `\nHost ${REFUSING_HOST}\n  HostName 127.0.0.1\n  Port 1\n  User harness\n`,
    );
  });

  after(() => {
    writeFileSync(configFile(), configBefore);
  });

  for (const [host, reason] of FAILING_HOSTS) {
    it(`F-5001 AC-12 (failed-connect): a window on ${host} fails with the companion's dialog alone, and the explorer is active in it`, async () => {
      const known = new Set(extensionHostLogs());
      const emptyBefore = openEmptyWindows();
      await inWindow(
        'local',
        'acceptance.agent.openWindow',
        `vscode-remote://ssh-remote+${host}/home/harness/${FOLDER}`,
      );
      try {
        const dialog = await waitForDialog(FOLDER, 120_000);
        const logs = await activatedLogs(known);
        deepStrictEqual(
          [
            logs.length,
            dialog.details,
            dialog.buttons,
            (await notifications(FOLDER)).filter(
              text => !text.startsWith(COMPANION_PROGRESS),
            ),
          ],
          [
            1,
            `Could not establish connection to "${host}"${reason}`,
            ['Retry', 'More Actions...', 'Close Remote'],
            [],
          ],
        );
      } finally {
        await answerDialog(FOLDER, 'Close Remote');
        let left = '';
        await waitFor(
          'the empty local window that Close Remote leaves',
          () => {
            left =
              openEmptyWindows().find(each => !emptyBefore.includes(each)) ??
              '';
            return Promise.resolve(left !== '');
          },
          60_000,
        );
        await closeWindow(left);
      }
    });
  }

  it('F-5001 AC-5 (ssh-window): a window opened on an SSH host activates the explorer in the local extension host before any view is shown', async () => {
    const known = new Set(extensionHostLogs());
    await openWindow(HOST, CONNECTED_FOLDER);
    try {
      await connectedTo(CONNECTED_FOLDER, HOST);
      const logs = await activatedLogs(known);
      deepStrictEqual(
        [logs.length, await viewRows(CONNECTED_FOLDER, VIEW)],
        [1, undefined],
      );
    } finally {
      await closeWindow(CONNECTED_FOLDER);
    }
  });
});
