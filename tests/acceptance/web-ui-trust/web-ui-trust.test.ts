import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectionLog,
  isTrusted,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {closeAllButLocal, openConnected} from '../windows/maintenance.ts';
import {paletteRows, paletteRun} from '../windows/renderer.ts';
import {
  installBrowser,
  openedUrls,
  serverPortOf,
  setWebAccess,
} from '../windows/web-ui-support.ts';

describe('Open Web UI in Restricted Mode (card coverage-48)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    installBrowser();
    await closeAllButLocal();
  });

  after(async () => {
    restoreUserSettings(saved);
    await userSettings({});
    await closeAllButLocal();
  });

  it('F-2509 AC-15 (restricted): in a window in Restricted Mode it is listed and runs as it does otherwise', async () => {
    await setWebAccess(true);
    await openConnected('wt1');
    const port = serverPortOf(connectionLog());
    const opened = openedUrls().length;
    const trusted = await isTrusted('wt1');
    const rows = await paletteRows('wt1', 'Open Web UI');
    await paletteRun('wt1', 'Open Web UI');
    await new Promise(resolve => setTimeout(resolve, 3000));
    const urls = openedUrls().slice(opened);
    await closeWindow('wt1');
    deepStrictEqual(
      [trusted, rows[0], urls],
      [false, 'Remote-SSH: Open Web UI', [`http://localhost:${String(port)}/`]],
    );
  });
});
