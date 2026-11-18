import {
  closeWindow,
  connectedWithin,
  inWindow,
  isOpen,
  onHostAs,
  openWindow,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  answerFolderDialog,
  folderDialogFacts,
  folderDialogOpen,
  statusBarText,
} from '../windows/renderer.ts';

const HOME = '/home/harness';

describe('what a folder typed with a closing slash opens (card #2756, throwaway)', function () {
  this.timeout(600_000);

  beforeEach(closeAllButLocal);

  for (const slash of ['', '/']) {
    it(`typed with ${slash === '' ? 'no' : 'a'} closing slash`, async () => {
      const sub = `zz-slash-sub${slash === '' ? 'a' : 'b'}`;
      const home = `zz-slash-host${slash === '' ? 'a' : 'b'}`;
      await onHostAs(
        'harness',
        'mkdir',
        '-p',
        `${HOME}/${home}`,
        `${HOME}/${sub}`,
      );
      await openWindow('harness', home);
      await connectedWithin(home, 120_000);
      void inWindow(home, 'workbench.action.files.openFolder');
      await waitFor('the dialog', () => folderDialogOpen(home), 30_000);
      await waitFor(
        'the home entries',
        async () => (await folderDialogFacts(home)).rows.includes('.ssh'),
        30_000,
      );
      await answerFolderDialog(home, `${HOME}/${sub}${slash}`);
      await waitFor(
        `${sub} to show SSH: harness`,
        async () =>
          isOpen(sub) &&
          (await statusBarText(sub, 'status.host').catch(() => '')) ===
            'SSH: harness',
        120_000,
      );
      const state = await windowState(sub);
      process.stdout.write(
        `OPENED ${JSON.stringify({slash, windows: windowNames().filter(isOpen), folders: state.folders, folderCount: state.folders.length})}\n`,
      );
      await closeWindow(sub).catch(() => undefined);
    });
  }
});
