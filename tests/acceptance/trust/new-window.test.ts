import {deepStrictEqual} from 'node:assert';
import {
  acceptedKeyLogins,
  closeWindow,
  connectedWithin,
  inWindow,
  isTrusted,
  nextEmptyWindow,
  openWindow,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS, setting} from '../windows/maintenance.ts';
import {
  answerDialog,
  pageText,
  rememberPage,
  waitForDialog,
} from '../windows/renderer.ts';

describe('New Window on Active Host with a window with no folder untrusted (card coverage-98)', function () {
  this.timeout(300_000);

  before(() => rememberPage('local'));

  it('card coverage-98 (nw27-restricted): with emptyWindow false the new window opens untrusted in Restricted Mode, already connected with no new login', async () => {
    await setting('security.workspace.trust.emptyWindow', false);
    await openWindow('harness', 'nw27');
    try {
      await waitForDialog('nw27');
      await answerDialog('nw27', 'Yes, I trust the authors');
      await connectedWithin('nw27', INSTALL_MILLISECONDS);
      await rememberPage('nw27');
      const since = new Date().toISOString();
      const name = await nextEmptyWindow(() =>
        inWindow('nw27', 'opensshremotes.openEmptyWindowOnCurrentHost'),
      );
      await rememberPage(name);
      await waitFor(
        `${name} to be connected`,
        async () => (await windowState(name)).remoteAuthority !== null,
        INSTALL_MILLISECONDS,
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      deepStrictEqual(
        {
          trusted: await isTrusted(name),
          restricted: (await pageText(name)).includes('Restricted Mode'),
          logins: await acceptedKeyLogins(since),
        },
        {trusted: false, restricted: true, logins: 0},
      );
      await closeWindow(name);
    } finally {
      await closeWindow('nw27').catch(() => undefined);
      await setting('security.workspace.trust.emptyWindow', undefined);
    }
  });
});
