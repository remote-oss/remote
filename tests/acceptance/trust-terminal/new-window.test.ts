import {deepStrictEqual} from 'node:assert';
import {
  acceptedKeyLogins,
  closeWindow,
  connectedWithin,
  inWindow,
  nextEmptyWindow,
  openWindow,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS, setting} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
  rememberPage,
  waitForDialog,
} from '../windows/renderer.ts';

/** The question of core's trust request for a window with no folder, and its buttons in the order the page holds them. */
const WORKSPACE_QUESTION =
  'Do you trust the authors of the files in this workspace?';
const WORKSPACE_BUTTONS = ['Manage', 'Cancel', 'Trust Workspace & Continue'];

/** The setting that decides whether a window with no folder is trusted. */
const EMPTY_WINDOW_TRUST = 'security.workspace.trust.emptyWindow';

/** Opens a window on the host, trusts its folder when core asks, and waits for its connection. */
async function trustedWindow(name: string): Promise<void> {
  await openWindow('harness', name);
  await waitForDialog(name);
  await answerDialog(name, 'Trust Folder & Continue');
  await connectedWithin(name, INSTALL_MILLISECONDS);
}

/** Waits for the empty window `name` to be resolved on an authority. */
async function connectedEmpty(name: string): Promise<void> {
  await waitFor(
    `${name} to be connected`,
    async () => {
      try {
        return (await windowState(name)).remoteAuthority !== null;
      } catch {
        return false;
      }
    },
    INSTALL_MILLISECONDS,
  );
}

describe('New Window on Active Host in terminal mode with core’s trust defaults (card coverage-98)', function () {
  this.timeout(300_000);

  before(() => rememberPage('local'));

  it('F-2303 AC-24 (nw24): from a trusted folder window the new window shows no trust dialog and connects with one more login', async () => {
    await trustedWindow('nw24');
    await rememberPage('nw24');
    try {
      const since = new Date().toISOString();
      const name = await nextEmptyWindow(() =>
        inWindow('nw24', 'opensshremotes.openEmptyWindowOnCurrentHost'),
      );
      await rememberPage(name);
      await connectedEmpty(name);
      await new Promise(resolve => setTimeout(resolve, 3000));
      deepStrictEqual(
        {
          dialog: await dialogOf(name),
          logins: await acceptedKeyLogins(since),
          first: (await windowState('nw24')).remoteName,
        },
        {dialog: undefined, logins: 1, first: 'ssh-remote'},
      );
      await closeWindow(name);
    } finally {
      await closeWindow('nw24').catch(() => undefined);
    }
  });

  it('F-2303 AC-25 (nw25): with emptyWindow false only the new window shows core’s trust dialog, and after Trust Workspace & Continue it connects while the first window stays connected', async () => {
    await setting(EMPTY_WINDOW_TRUST, false);
    await trustedWindow('nw25');
    await rememberPage('nw25');
    try {
      const name = await nextEmptyWindow(() =>
        inWindow('nw25', 'opensshremotes.openEmptyWindowOnCurrentHost'),
      );
      await rememberPage(name);
      const asked = await waitForDialog(name);
      const first = await dialogOf('nw25');
      await answerDialog(name, 'Trust Workspace & Continue');
      await connectedEmpty(name);
      deepStrictEqual(
        {
          asked: [asked.message, asked.buttons],
          first,
          firstConnected: (await windowState('nw25')).remoteName,
        },
        {
          asked: [WORKSPACE_QUESTION, WORKSPACE_BUTTONS],
          first: undefined,
          firstConnected: 'ssh-remote',
        },
      );
      await closeWindow(name);
    } finally {
      await closeWindow('nw25').catch(() => undefined);
      await setting(EMPTY_WINDOW_TRUST, undefined);
    }
  });
});
