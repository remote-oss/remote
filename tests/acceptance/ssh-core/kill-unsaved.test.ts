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

/** The processes of the host, with their parents and command lines. */
async function processes(): Promise<
  Array<{processId: string; parent: string; command: string}>
> {
  const listing = await onHostAs('root', 'ps', '-o', 'pid,ppid,args');
  return listing
    .split('\n')
    .slice(1)
    .map(line => line.trim().split(/\s+/))
    .filter(columns => columns.length > 2)
    .map(columns => ({
      processId: columns[0] ?? '',
      parent: columns[1] ?? '',
      command: columns.slice(2).join(' '),
    }));
}

/** Whether the server main process `processId` of the host runs. */
async function serverRuns(processId: string): Promise<boolean> {
  return (await processes()).some(
    entry =>
      entry.processId === processId &&
      entry.command.includes('out/server-main.js'),
  );
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

  /** A window on the host with an untitled editor holding unsaved text, and the server process that window's extension host belongs to. */
  async function withUnsaved(name: string): Promise<{server: string}> {
    const known = (await processes()).map(entry => entry.processId);
    await openWindow('harness', name);
    await connectedWithin(name, INSTALL_MILLISECONDS);
    // The host may run other servers, idle ones among them: the window's is the parent of its new extension host.
    const [own] = (await processes())
      .filter(
        entry =>
          !known.includes(entry.processId) &&
          entry.command.includes('--type=extensionHost'),
      )
      .map(entry => entry.parent);
    await inWindow(name, 'acceptance.agent.openUntitled', UNSAVED);
    await waitFor(
      'the untitled editor to be unsaved',
      async () => (await dirtyDocumentsOf(name)).length > 0,
      15_000,
    );
    const server = own ?? '';
    // The command ends when the window has gone local, which core's question holds up: it is not awaited here.
    const killing = inWindow(name, 'opensshremotes.cleanCurrentRemoteServer');
    killing.catch(() => undefined);
    return {server};
  }

  it('F-2411 AC-29 (c100-kill-cancel): the notice and core’s save question show together while the window stays an SSH window; Cancel keeps the window, the unsaved text and the server', async () => {
    const {server} = await withUnsaved('k29a');
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
          serverRuns: await serverRuns(server),
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
          serverRuns: true,
        },
      );
    } finally {
      await discard('k29a');
    }
  });

  it('F-2411 AC-29 (c100-kill-dont-save): Don’t Save turns the window into an empty local window, and the server keeps running', async () => {
    const {server} = await withUnsaved('k29b');
    await waitForDialog('k29b', 60_000);
    const local = await nextEmptyWindow(() =>
      answerDialog('k29b', "Don't Save"),
    );
    const state = await windowState(local);
    deepStrictEqual(
      [state.remoteName, state.folders, await serverRuns(server)],
      [null, [], true],
    );
    await closeWindow(local);
  });

  it('F-2411 AC-29 (c100-kill-save): Save writes the file on the host and then turns the window local, and the server keeps running', async () => {
    const {server} = await withUnsaved('k29c');
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
        await serverRuns(server),
      ],
      [null, [], UNSAVED, true],
    );
    await closeWindow(local);
  });
});
