import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  dirtyDocumentsOf,
  inWindow,
  nextEmptyWindow,
  onHostAs,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  openWindow,
  recordLines,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  existsOnHost,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';
import {
  answerDialog,
  inputBoxOf,
  pressQuickPickOk,
  rememberPage,
  statusItem,
  waitForDialog,
} from '../windows/renderer.ts';

/** The text the untitled editor of each window holds. */
const UNSAVED = 'unsaved text of c100';

/** The notice of a kill that ran. */
const KILLED = 'Killed VS Code Server on harness.';

/** The file the Save outcome writes on the host: the window's folder and the name the Save As input offers. */
const SAVED_FILE = `/home/harness/k29c/${UNSAVED}`;

/** The notices window `name` showed. */
function notices(name: string): string[] {
  return recordLines('notice', name).map(line => line.question);
}

/** The process ids of the host's server: the main process that keeps running whichever window comes and goes. */
async function serverMain(): Promise<string[]> {
  const listing = await onHostAs('root', 'ps', '-o', 'pid,args');
  return listing
    .split('\n')
    .filter(
      line => line.includes('out/server-main.js') && !line.includes('grep'),
    )
    .map(line => line.trim().split(/\s+/)[0] ?? '');
}

/** Closes window `name` whose untitled editor still holds unsaved text, answering core's question with Don't Save. */
async function discard(name: string): Promise<void> {
  const closing = closeWindow(name);
  await waitForDialog(name, 30_000);
  await answerDialog(name, "Don't Save");
  await closing;
}

describe('Kill Current VS Code Server with unsaved work (card coverage-100)', function () {
  this.timeout(600_000);

  let settingsBefore: string | undefined;

  before(async () => {
    await rememberPage('local');
    settingsBefore = readUserSettings();
    // The launch draws core's dialogs natively, which the renderer cannot read.
    await userSettings({'window.dialogStyle': 'custom'});
  });

  beforeEach(async () => {
    await closeAllButLocal();
    await onHostAs('harness', 'rm', '-f', SAVED_FILE);
  });

  after(async () => {
    await closeAllButLocal();
    restoreUserSettings(settingsBefore);
  });

  /** A window on the host with an untitled editor holding unsaved text, and the host's server process. */
  async function withUnsaved(name: string): Promise<{servers: string[]}> {
    await openWindow('harness', name);
    await connectedWithin(name, INSTALL_MILLISECONDS);
    await inWindow(name, 'acceptance.agent.openUntitled', UNSAVED);
    await waitFor(
      'the untitled editor to be unsaved',
      async () => (await dirtyDocumentsOf(name)).length > 0,
      15_000,
    );
    const servers = await serverMain();
    // The command ends when the window has gone local, which core's question holds up: it is not awaited here.
    const killing = inWindow(name, 'opensshremotes.cleanCurrentRemoteServer');
    killing.catch(() => undefined);
    return {servers};
  }

  it('F-2411 AC-29 (c100-kill-cancel): the notice and core’s save question show together while the window stays an SSH window; Cancel keeps the window, the unsaved text and the server', async () => {
    const {servers} = await withUnsaved('k29a');
    try {
      const dialog = await waitForDialog('k29a', 60_000);
      await waitFor(
        'the notice',
        () => notices('k29a').includes(KILLED),
        30_000,
      );
      const shown = {
        dialogButtons: dialog.buttons,
        notice: notices('k29a'),
        remoteName: (await windowState('k29a')).remoteName,
      };
      await answerDialog('k29a', 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 3000));
      const after = await windowState('k29a');
      deepStrictEqual(
        {
          shown,
          remoteName: after.remoteName,
          dirty: (await dirtyDocumentsOf('k29a')).length,
          indicator: (await statusItem('k29a', 'status.host')).text,
          servers: await serverMain(),
        },
        {
          shown: {
            dialogButtons: ["Don't Save", 'Cancel', 'Save'],
            notice: [KILLED],
            remoteName: 'ssh-remote',
          },
          remoteName: 'ssh-remote',
          dirty: 1,
          indicator: 'SSH: harness',
          servers,
        },
      );
    } finally {
      await discard('k29a');
    }
  });

  it('F-2411 AC-29 (c100-kill-dont-save): Don’t Save turns the window into an empty local window, and the server keeps running', async () => {
    const {servers} = await withUnsaved('k29b');
    await waitForDialog('k29b', 60_000);
    const local = await nextEmptyWindow(() =>
      answerDialog('k29b', "Don't Save"),
    );
    const state = await windowState(local);
    deepStrictEqual(
      [state.remoteName, state.folders, await serverMain()],
      [null, [], servers],
    );
    await closeWindow(local);
  });

  it('F-2411 AC-29 (c100-kill-save): Save writes the file on the host and then turns the window local, and the server keeps running', async () => {
    const {servers} = await withUnsaved('k29c');
    await waitForDialog('k29c', 60_000);
    await answerDialog('k29c', 'Save');
    await waitFor(
      'the Save As input',
      async () => (await inputBoxOf('k29c'))?.title === 'Save As',
      30_000,
    );
    // The input offers the folder of the window and a name made from the text; its OK button confirms that.
    const local = await nextEmptyWindow(() => pressQuickPickOk('k29c'));
    const state = await windowState(local);
    deepStrictEqual(
      [
        state.remoteName,
        state.folders,
        (await existsOnHost(SAVED_FILE))
          ? (await onHostAs('harness', 'cat', SAVED_FILE)).trim()
          : null,
        await serverMain(),
      ],
      [null, [], UNSAVED, servers],
    );
    await closeWindow(local);
  });
});
