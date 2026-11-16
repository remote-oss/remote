/**
 * @fileoverview The columns of the session troubleshooting table by the failure that left it (F-2602 AC-16, AC-17):
 * the failures whose hints carry mitigations and resources, and the one whose hint has neither.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  inWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  dismissals,
  freshHost,
} from '../windows/maintenance.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';
import {
  cellsOf,
  failedOn,
  wholeTableOf,
} from '../windows/troubleshooting-support.ts';

const CLEAR = 'opensshremotes.clearAllSessionHints';

/** The one address the Resources column of a download failure holds, the reimplementation's own documentation. */
const DOCUMENTATION =
  'https://github.com/remote-oss/remote/tree/main/docs/remote-ssh';

/** The texts a flow of this feature never shows. */
const NEVER_SHOWN = ['More Info', 'in settings'];

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

/** Opens window `name` on `alias`, fails it, and gives every line of the table of its terminal. */
async function failedTable(alias: string, name: string): Promise<string[]> {
  await inWindow('local', CLEAR);
  appendScript(dismissals(name));
  await failedOn(alias, name);
  try {
    return await wholeTableOf(name);
  } finally {
    await closeWindow(name).catch(() => undefined);
  }
}

describe('the columns of the troubleshooting table (card #2700)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    // Core hides the tab list of a single terminal; the rows read what the panel lists.
    await userSettings({
      'terminal.integrated.tabs.hideCondition': 'never',
      // The smallest font shows the most of a table of many mitigations.
      'terminal.integrated.fontSize': 6,
    });
    await closeAllButLocal();
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2602 AC-16 (c2700-offline): an offline host with the local download off gives Mitigations and Resources columns, the latter one bare address that is the reimplementation’s own', async () => {
    await keepingSettings(async () => {
      await freshHost();
      await userSettings({
        ...PLATFORMS,
        'remote.SSH.localServerDownload': 'off',
        'remote.SSH.serverDownloadUrlTemplate':
          'http://downloads:1/x/${commit}',
      });
      const table = await failedTable('harness', 'c2700-offline');
      deepStrictEqual(
        [cellsOf(table[1]), columnOf(table, 3).join('').replaceAll(' ', '')],
        [
          ['Status', 'Message', 'Mitigations', 'Resources'],
          `•${DOCUMENTATION}`,
        ],
      );
    });
  });

  it('F-2602 AC-17 (c2700-nowhere): a host name that does not resolve gives exactly the columns Status and Message', async () => {
    const table = await failedTable('nowhere', 'c2700-nowhere');
    deepStrictEqual(
      [
        cellsOf(table[1]),
        table.some(line => /Mitigations|Resources/u.test(line)),
      ],
      [['Status', 'Message'], false],
    );
  });

  it('F-2602 AC-21 (c2700-no-more-info): no pick, dialog or notice of these failures offers More Info or a search in settings', () => {
    const shown = recordLines().flatMap(line => [
      line.question,
      ...(line.buttons ?? []),
      ...(line.items ?? []),
    ]);
    deepStrictEqual(
      shown.filter(text => NEVER_SHOWN.some(never => text.includes(never))),
      [],
    );
  });
});
