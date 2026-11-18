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
import {terminalRows, type TerminalRow} from '../windows/renderer.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';
import {
  cellsOf,
  failedOn,
  wholeTableOf,
} from '../windows/troubleshooting-support.ts';

const CLEAR = 'opensshremotes.clearAllSessionHints';

/** The link at the end of the terminal. */
const OUTPUT_LOG_LINK = 'Output Log...';

/** The setting that names the install folder. */
const SETTING = 'remote.SSH.serverInstallPath';

/** `text` without its white space (the terminal draws a space as a no-break space): the width of the table decides where a cell wraps, so the rows compare what is written. */
function squeezed(text: string): string {
  return text.replaceAll(/\s/gu, '');
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

/** The characters that start a line of the table's frame. */
const FRAME = /^\s*[║╔╟╚]/u;

/** What is underlined in `rows`: the runs inside the table, which are pieces of the setting's key, and the text outside it. */
function underlinedIn(rows: readonly TerminalRow[]) {
  const inTable = rows
    .filter(entry => FRAME.test(entry.text))
    .flatMap(entry => entry.underlined)
    .map(piece => squeezed(piece))
    .filter(piece => piece !== '');
  return {
    pieces: inTable.every(piece => SETTING.includes(piece)),
    length: inTable.join('').length,
    outside: rows
      .filter(entry => !FRAME.test(entry.text))
      .flatMap(entry => entry.underlined)
      .map(piece => squeezed(piece))
      .filter(piece => piece !== ''),
  };
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
          linked: underlinedIn(rows),
          unchanged: readUserSettings() === before,
        },
        {
          header: ['Status', 'Message', 'Mitigations'],
          first: true,
          // The key of the explanation and the key of the first mitigation, inside the table, and the link at the end of the terminal.
          linked: {
            pieces: true,
            length: 2 * SETTING.length,
            outside: [squeezed(OUTPUT_LOG_LINK)],
          },
          unchanged: true,
        },
      );
    });
  });

  it('F-2407 AC-9 (c2712-invalid-path): an install folder that is not a plain absolute path gives the row InvalidCustomServerPath, its message with the value as written, and the four mitigations in order', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS, [SETTING]: {harness: '~x'}});
      const {table} = await failedTable('c2712-invalid-path');
      deepStrictEqual(
        {
          header: cellsOf(table[1]),
          status: columnOf(table, 0).join(''),
          message: squeezed(columnOf(table, 1).join('')),
          mitigations: columnOf(table, 2)
            .join(' ')
            .split('•')
            .map(squeezed)
            .filter(text => text !== ''),
        },
        {
          header: ['Status', 'Message', 'Mitigations'],
          status: 'InvalidCustomServerPath',
          message: squeezed(
            'The provided custom server path is invalid (Provided: "~x")',
          ),
          mitigations: [
            'Ensure the provide path is an absolute path',
            `Edit setting ${SETTING} to an absolute path on the remote server`,
            `Do not use variables, double quotes, or other non-path characters when setting ${SETTING}`,
            'Delete the setting for this host to use the default path in the user home directory',
          ].map(squeezed),
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
