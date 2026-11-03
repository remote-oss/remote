/**
 * @fileoverview What the Remotes view and the picker of Connect to Host leave in a fresh profile (card coverage-102,
 * #1809, part 3f). The file sorts first in its launch, so no row has written to the profile before it.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {closePick, pickShown} from '../windows/explorer-home.ts';
import {connectedTo} from '../windows/explorer-folders.ts';
import {
  closeWindow,
  inWindow,
  nextEmptyWindow,
  startInWindow,
  userSettingsFile,
  variable,
} from '../windows/harness.ts';
import {
  allQuickPickRows,
  chooseQuickPickRow,
  rememberPage,
  viewRows,
} from '../windows/renderer.ts';
import {VIEW} from '../windows/explorer-rows.ts';

const LOCAL = 'local';

/** The command of the picker of Connect to Host. */
const CONNECT = 'opensshremotes.openEmptyWindow';

/** The host the row connects from the list. */
const HOST = 'harness';

/** What names the extensions of the family in a folder or in a key. */
const FAMILY = 'remote-oss.remote-';

/** What a fresh profile is checked for: the user's SSH folder and the settings file, global storage, and state keys. */
function traces(): unknown {
  const home = path.join(variable('HARNESS_RUN_FOLDER'), 'home');
  const userData = variable('HARNESS_USER_DATA');
  const storage = path.join(userData, 'User', 'globalStorage');
  const database = path.join(storage, 'state.vscdb');
  const opened = existsSync(database)
    ? new DatabaseSync(database, {readOnly: true})
    : undefined;
  try {
    return {
      sshFolder: existsSync(path.join(home, '.ssh')),
      settings: existsSync(userSettingsFile())
        ? readFileSync(userSettingsFile(), 'utf8')
        : undefined,
      storage: existsSync(storage)
        ? readdirSync(storage).filter(entry => entry.includes(FAMILY))
        : [],
      keys:
        opened
          ?.prepare('SELECT key FROM ItemTable WHERE key LIKE ?')
          .all(`%${FAMILY}%`)
          .map(entry => String(entry.key)) ?? [],
    };
  } finally {
    opened?.close();
  }
}

/** The labels of the picker of Connect to Host in the launch's window, closed again. */
async function pickerLabels(): Promise<string[]> {
  await startInWindow(LOCAL, CONNECT);
  await pickShown(LOCAL);
  const labels = (await allQuickPickRows(LOCAL)).map(entry =>
    entry.label.trim(),
  );
  await closePick(LOCAL);
  return labels;
}

describe('the view and the picker in a fresh profile (card coverage-102, part 3f)', function () {
  this.timeout(300_000);

  before(() => rememberPage(LOCAL));

  it('F-2202 AC-23 (fresh): opening the Remotes view and the picker writes no file or setting and creates no global storage folder or state entry of the extensions, and after a host is connected from the list the picker’s order is unchanged', async () => {
    const before = traces();
    await inWindow(LOCAL, 'workbench.view.remote');
    const rows = await viewRows(LOCAL, VIEW);
    const first = await pickerLabels();
    const afterOpening = traces();
    const connected = await nextEmptyWindow(async () => {
      await startInWindow(LOCAL, CONNECT);
      await pickShown(LOCAL);
      await chooseQuickPickRow(LOCAL, HOST);
    });
    try {
      await connectedTo(connected, HOST);
    } finally {
      await closeWindow(connected);
    }
    deepStrictEqual(
      [rows !== undefined, afterOpening, await pickerLabels()],
      [true, before, first],
    );
  });
});
