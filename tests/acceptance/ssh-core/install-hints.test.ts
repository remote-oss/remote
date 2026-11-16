/**
 * @fileoverview The troubleshooting table of an install folder the host cannot create and of a download the client
 * cannot make (F-2602 AC-14, AC-17, AC-18): what the table's columns and first mitigation say, and that the setting
 * they name keeps its value.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  dismissals,
  freshHost,
} from '../windows/maintenance.ts';
import {terminalRows} from '../windows/renderer.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';
import {
  cellsOf,
  failedOn,
  wholeTableOf,
} from '../windows/troubleshooting-support.ts';

const CLEAR = 'opensshremotes.clearAllSessionHints';

/** The setting that names the install folder. */
const SETTING = 'remote.SSH.serverInstallPath';

/** `text` without its spaces: the width of the table decides where a cell wraps, so the rows compare what is written. */
function squeezed(text: string): string {
  return text.replaceAll(' ', '');
}

/** The cells of column `column` of the data rows of `table`, one per line. */
function columnOf(table: readonly string[], column: number): string[] {
  const end = table.findIndex(
    (line, index) => index > 2 && line.startsWith('╚'),
  );
  return table
    .slice(3, end)
    .map(line => cellsOf(line)[column] ?? '')
    .filter(cell => cell !== '');
}

/** Opens window `name` on `harness`, fails it, and gives the whole table of its terminal. */
async function failedTable(name: string) {
  await inWindow('local', CLEAR);
  appendScript(dismissals(name));
  await failedOn('harness', name);
  try {
    return {table: await wholeTableOf(name), rows: await terminalRows(name)};
  } finally {
    await closeWindow(name).catch(() => undefined);
  }
}

describe('the hints of an install folder and a download that fail (card #2708)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await userSettings({
      'terminal.integrated.tabs.hideCondition': 'never',
      'terminal.integrated.fontSize': 6,
    });
    await closeAllButLocal();
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2602 AC-14, AC-18 (c2708-install-path): an install folder the remote user cannot create gives a Mitigations column that starts with removing or editing the setting, its key drawn as a link, and no Resources column, and the setting keeps its value', async () => {
    await keepingSettings(async () => {
      await freshHost();
      const value = {harness: '/proc/nope/dir'};
      await userSettings({...PLATFORMS, [SETTING]: value});
      const before = readUserSettings();
      const {table, rows} = await failedTable('c2708-install-path');
      deepStrictEqual(
        {
          header: cellsOf(table[1]),
          first: squeezed(columnOf(table, 2).join('')).startsWith(
            squeezed(`•Remove or edit setting ${SETTING}`),
          ),
          linked: squeezed(rows.flatMap(entry => entry.underlined).join(''))
            .length,
          unchanged: readUserSettings() === before,
        },
        {
          header: ['Status', 'Message', 'Mitigations'],
          first: true,
          // The key of the explanation and the key of the first mitigation.
          linked: 2 * SETTING.length,
          unchanged: true,
        },
      );
    });
  });

  it('F-2602 AC-17 (c2708-proxy): a local download through a refused proxy gives exactly the columns Status and Message', async () => {
    await keepingSettings(async () => {
      await freshHost();
      await userSettings({
        ...PLATFORMS,
        'remote.SSH.localServerDownload': 'always',
        'http.proxy': 'http://127.0.0.1:1',
        'remote.SSH.serverDownloadUrlTemplate':
          'http://downloads.invalid/ok/${os}-${arch}/${commit}',
      });
      const {table} = await failedTable('c2708-proxy');
      deepStrictEqual(
        {
          header: cellsOf(table[1]),
          status: columnOf(table, 0).join(''),
          message: columnOf(table, 1).join(' '),
        },
        {
          header: ['Status', 'Message'],
          status: 'LocalDownloadFailed',
          message:
            'Error: LocalDownloadFailed (Failed to download VS Code Server (Failed to fetch))',
        },
      );
    });
  });
});
