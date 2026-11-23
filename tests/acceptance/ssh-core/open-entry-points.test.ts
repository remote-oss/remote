/**
 * @fileoverview Opening folders, workspaces, files and links on an SSH host (F-2504, card #2623): the editor's command
 * line (`--remote`, `-r`, `-n`, `--goto`, `--folder-uri`, `--file-uri`) handed to the running instance, the File
 * commands that open on the host, Open Recent, and the links `<scheme>://remote-oss.remote-ssh/` and
 * `<scheme>://vscode-remote/…`. A window is named by its folder, so a row names the folder it opens.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  editorCommandLine,
  extensionActive,
  inWindow,
  isOpen,
  nextEmptyWindow,
  onHostAs,
  openLink,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  untitledDocuments,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  answerDialog,
  answerFolderDialog,
  chooseQuickPickRow,
  dialogOf,
  editorTabs,
  folderDialogFacts,
  folderDialogOpen,
  notifications,
  pageText,
  pressControlEnter,
  pressEscape,
  pressQuickInputButton,
  pressQuickPickRowButton,
  quickPickOf,
  type QuickPickRow,
  quickPickRows,
  rememberPage,
  statusBarText,
  typeInQuickPick,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';

/** The home folder of the harness account on the host. */
const HOME = '/home/harness';

/** The id of the extension, and the modal core asks before it hands the extension a URI. */
const EXTENSION = 'remote-oss.remote-ssh';
const CONSENT = "Allow 'Remote - SSH' extension to open this URI?";

/** The buttons of the connection error dialog of F-2601, in the order they are sorted. */
const ERROR_BUTTONS = ['Close Remote', 'More Actions...', 'Retry'];

/** Waits `milliseconds`, for what a window does after a command that nothing tells the end of. */
async function settle(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** The names of the windows that are open, sorted. */
function openNames(): string[] {
  return windowNames()
    .filter(isOpen)
    .sort((first, second) => first.localeCompare(second));
}

/** The names of the open windows but `local`. */
function otherNames(): string[] {
  return openNames().filter(name => name !== 'local');
}

/** Runs the editor's command line with `words` and gives its exit status. */
async function commandLine(...words: string[]): Promise<number | null> {
  return (await editorCommandLine(...words)).status;
}

/** Makes `folders` and `files` (name and text) under the harness home. */
async function onHost(
  folders: readonly string[],
  files: Record<string, string> = {},
): Promise<void> {
  if (folders.length > 0) {
    await onHostAs(
      'harness',
      'mkdir',
      '-p',
      ...folders.map(each => `${HOME}/${each}`),
    );
  }
  for (const [name, text] of Object.entries(files)) {
    await onHostAs('harness', 'sh', '-c', `printf '${text}' > ${HOME}/${name}`);
  }
}

/** Waits until window `name` shows the remote indicator `SSH: <alias>`. */
async function shows(name: string, alias = 'harness'): Promise<void> {
  await waitFor(
    `${name} to show SSH: ${alias}`,
    async () =>
      isOpen(name) &&
      (await statusBarText(name, 'status.host').catch(() => '')) ===
        `SSH: ${alias}`,
    120_000,
  );
}

/** Waits until a dialog shows in window `name`, and gives it. */
async function asks(name: string) {
  await waitFor(
    `a dialog in ${name}`,
    async () => (await dialogOf(name).catch(() => undefined)) !== undefined,
    60_000,
  );
  return dialogOf(name);
}

/** Opens window `folder` on the host and waits until it is connected. */
async function connectedWindow(folder: string): Promise<string> {
  await onHost([folder]);
  await openWindow('harness', folder);
  await connectedWithin(folder, 120_000);
  return folder;
}

/** The title, the indicator, the folders and the workspace file of window `name`. */
async function whatShows(name: string) {
  const state = await windowState(name);
  return {
    title: await windowTitle(name),
    indicator: await statusBarText(name, 'status.host'),
    folders: state.folders,
    workspaceFile: state.workspaceFile,
  };
}

/** Waits until window `name` reports a folder: a workspace window reports none until its folders are read. */
async function withFolders(name: string): Promise<void> {
  await waitFor(
    `${name} to report its folders`,
    async () => (await windowState(name)).folders.length > 0,
    60_000,
  );
}

/** The labels of the tabs of window `name`. */
async function tabLabels(name: string): Promise<string[]> {
  return (await editorTabs(name)).map(entry => entry.label);
}

/** How many times the agent of window `name` activated. */
function activations(name: string): number {
  return windowEvents(name).filter(each => each.event === 'activated').length;
}

/** The questions of the login the record gained since `mark`: a password, a host key, a platform. */
function loginQuestions(mark: number): string[] {
  return recordLines()
    .slice(mark)
    .filter(line =>
      ['maskedInput', 'pick', 'platformPick', 'hostPick'].includes(
        line.surface,
      ),
    )
    .map(line => `${line.window}: ${line.question}`);
}

/** How long the filtered Open Recent pick has to stop changing: it settles within a second, so ten is a hang. */
const RECENT_SETTLE_MILLISECONDS = 10_000;

/**
 * Opens the Open Recent pick of window `name`, filters it by `filter` and gives its rows, the pick left open. The pick
 * draws only the rows that fit its height, about seventeen, and lists files after the folders, so after the many
 * folders a whole run has opened an entry the row looks for is not drawn at all until the list is filtered to it.
 */
async function recentRows(
  name: string,
  filter: string,
): Promise<{rows: QuickPickRow[]; note: string}> {
  /** The pick's rows once two reads 250 ms apart agree; a pick that keeps changing past the deadline says what it last read. */
  async function steadyRows(what: string): Promise<QuickPickRow[]> {
    let rows = await quickPickRows(name);
    const began = Date.now();
    for (let steady = 0; steady < 2;) {
      if (Date.now() - began > RECENT_SETTLE_MILLISECONDS) {
        throw new Error(
          `the Open Recent pick of window ${name}, ${what}, did not settle within ${String(RECENT_SETTLE_MILLISECONDS / 1000)} s; it last read ${JSON.stringify(rows)}`,
        );
      }
      await settle(250);
      const next = await quickPickRows(name);
      steady = JSON.stringify(next) === JSON.stringify(rows) ? steady + 1 : 0;
      rows = next;
    }
    return rows;
  }
  void inWindow(name, 'workbench.action.openRecent');
  await waitForQuickPick(name, 30_000);
  // One read, only for the failure message of the rows: it never throws, so the diagnostic cannot fail a row that passes.
  await settle(500);
  const unfiltered = await quickPickRows(name).catch(() => undefined);
  await typeInQuickPick(name, filter);
  const rows = await steadyRows(`filtered by ${JSON.stringify(filter)}`);
  const before =
    unfiltered === undefined
      ? 'an unread number of rows'
      : `${String(unfiltered.length)} rows, ${unfiltered.some(entry => entry.label.startsWith(filter)) ? 'with' : 'without'} an entry for it among them`;
  return {
    rows,
    note: `the Open Recent pick of window ${name} drew ${before} before the filter ${JSON.stringify(filter)}, and ${String(rows.length)} rows after it`,
  };
}

/** The label and the description of each row of `rows` whose label starts with one of `names`. */
function described(
  rows: ReadonlyArray<{label: string; description: string}>,
  names: readonly string[],
): string[] {
  return rows
    .filter(entry => names.some(name => entry.label.startsWith(name)))
    .map(entry => `${entry.label} | ${entry.description}`);
}

/** Runs `action` and gives the name of the one window it opens, whatever the agent names it. */
async function newWindow(action: () => Promise<unknown>): Promise<string> {
  const before = new Set(openNames());
  await action();
  let opened: string[] = [];
  await waitFor(
    'one new window',
    () => {
      opened = openNames().filter(name => !before.has(name));
      return opened.length === 1;
    },
    60_000,
  );
  const [name] = opened;
  if (name === undefined) {
    throw new Error('no window opened');
  }
  return name;
}

/** A new empty local window that has its page told apart from `local`'s, and its name. */
async function newLocalWindow(): Promise<string> {
  const created = await nextEmptyWindow(() =>
    inWindow('local', 'workbench.action.newWindow'),
  );
  await rememberPage(created);
  return created;
}

/** Closes what a row left: a save prompt answered with Don't Save, any other dialog escaped, then every window but `local`. */
async function tidy(): Promise<void> {
  for (const name of otherNames()) {
    if ((await untitledDocuments(name).catch(() => [])).length > 0) {
      await inWindow(name, 'workbench.action.revertAndCloseActiveEditor').catch(
        () => undefined,
      );
    }
    const dialog = await dialogOf(name).catch(() => undefined);
    if (dialog?.buttons.includes("Don't Save") === true) {
      await answerDialog(name, "Don't Save").catch(() => undefined);
    } else if (dialog !== undefined) {
      await pressEscape(name).catch(() => undefined);
    }
  }
  await closeAllButLocal();
}

describe('opening folders, workspaces and links on an SSH host (card #2623, F-2504)', function () {
  this.timeout(900_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    // Core's dialogs and the file dialogs are drawn in the window, where a row can read and answer them.
    await userSettings({
      'window.dialogStyle': 'custom',
      'files.simpleDialog.enable': true,
    });
    await rememberPage('local');
  });

  afterEach(async function () {
    // A row that failed while it read an Open Recent pick of `local` leaves the pick open, and the window's agent takes no
    // command while its `openRecent` runs, so the next row's `openWindow` waits on it: the pick is escaped through its page.
    if (this.currentTest?.state === 'failed') {
      await pressEscape('local').catch(() => undefined);
    }
    await tidy();
  });

  after(async () => {
    restoreUserSettings(saved);
    // The folders and files the rows made on the host.
    await onHostAs(
      'harness',
      'sh',
      '-c',
      'rm -rf /home/harness/c2623* /tmp/c2623-*',
    );
    await onHostAs(
      'harness-tmpdir',
      'sh',
      '-c',
      'rm -rf /home/harness-tmpdir/trust-*',
    );
  });

  it('F-2504 AC-1, AC-2, AC-24 (c2623-uri-open): the extension’s URI with the editor’s own scheme asks core’s modal with the extension’s name and the buttons Cancel and Open, and Open activates the extension with no window, notification or dialog after it', async () => {
    const window = await newLocalWindow();
    const before = await extensionActive(window, EXTENSION);
    const link = await openLink(window, '{scheme}://remote-oss.remote-ssh/');
    const asked = await asks(window);
    await answerDialog(window, 'Open');
    await waitFor(
      'the activation',
      () => extensionActive(window, EXTENSION),
      30_000,
    );
    await settle(3_000);
    deepStrictEqual(
      {
        scheme: !link.startsWith('vscode://'),
        before,
        asked,
        dialog: await dialogOf(window),
        notices: await notifications(window),
        windows: otherNames(),
      },
      {
        scheme: true,
        before: false,
        asked: {message: CONSENT, details: '', buttons: ['Cancel', 'Open']},
        dialog: undefined,
        notices: [],
        windows: [window],
      },
    );
  });

  it('F-2504 AC-3 (c2623-uri-cancel): Cancel at the modal leaves the extension inactive and changes nothing visible', async () => {
    const window = await newLocalWindow();
    await openLink(window, '{scheme}://remote-oss.remote-ssh/');
    await asks(window);
    await answerDialog(window, 'Cancel');
    await settle(4_000);
    deepStrictEqual(
      {
        active: await extensionActive(window, EXTENSION),
        dialog: await dialogOf(window),
        notices: await notifications(window),
        windows: otherNames(),
      },
      {active: false, dialog: undefined, notices: [], windows: [window]},
    );
  });

  it('F-2504 AC-4 (c2623-uri-active): with the extension active in an SSH window, three shapes of its URI, allowed, open no window, show no message and leave the window’s folder and connection as they were', async () => {
    const window = await connectedWindow('c2623-uri-active');
    const before = await whatShows(window);
    const asked: unknown[] = [];
    for (const shape of [
      '{scheme}://remote-oss.remote-ssh/',
      '{scheme}://remote-oss.remote-ssh/some/path?x=1',
      '{scheme}://remote-oss.remote-ssh',
    ]) {
      await openLink(window, shape);
      asked.push((await asks(window))?.message);
      await answerDialog(window, 'Open');
      await settle(3_000);
    }
    deepStrictEqual(
      {
        asked,
        after: await whatShows(window),
        dialog: await dialogOf(window),
        notices: await notifications(window),
        windows: otherNames(),
      },
      {
        asked: [CONSENT, CONSENT, CONSENT],
        after: before,
        dialog: undefined,
        notices: [],
        windows: [window],
      },
    );
  });

  it('F-2504 AC-5 (c2623-new-window): from a window on another host, code --remote <alias> <folder> opens a window titled by the folder with the indicator Opening Remote..., which connects and ends titled with the authority and the indicator SSH: <alias>', async () => {
    await connectedWindow('c2623-other-host');
    await onHost(['c2623-new-window']);
    const name = 'c2623-new-window';
    const status = await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/${name}`,
    );
    const seen: string[] = [];
    await waitFor(
      'the window to connect',
      async () => {
        const now = `${await windowTitle(name).catch(() => '-')} | ${await statusBarText(name, 'status.host').catch(() => '-')}`;
        if (seen.at(-1) !== now) {
          seen.push(now);
        }
        return now === `[${name} [SSH: harness]] | SSH: harness`;
      },
      120_000,
    );
    deepStrictEqual(
      {
        status,
        first: seen[0]?.split(' | ')[1],
        last: seen.at(-1),
        windows: otherNames(),
      },
      {
        status: 0,
        first: 'Opening Remote...',
        last: `[${name} [SSH: harness]] | SSH: harness`,
        windows: ['c2623-new-window', 'c2623-other-host'],
      },
    );
  });

  it('F-2504 AC-6 (c2623-file-in-window): a file with a dot in its name opens as an editor in the connected window, with no new window and no reload', async () => {
    const window = await connectedWindow('c2623-file-window');
    await onHost([], {'c2623-file-window/note.dot.txt': 'one\\n'});
    const before = activations(window);
    const status = await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/${window}/note.dot.txt`,
    );
    await waitFor(
      'the editor',
      async () => (await windowState(window)).activeTab !== null,
      60_000,
    );
    deepStrictEqual(
      {
        status,
        active: (await windowState(window)).activeTab?.uri,
        windows: otherNames(),
        reloads: activations(window) - before,
      },
      {
        status: 0,
        active: `vscode-remote://ssh-remote%2Bharness${HOME}/${window}/note.dot.txt`,
        windows: [window],
        reloads: 0,
      },
    );
  });

  it('F-2504 AC-7 (c2623-dot-folder): a remote folder with a dot passed without a trailing slash opens nothing and is listed under files in Open Recent; with a trailing slash or by --folder-uri it opens in a new window', async () => {
    const window = await connectedWindow('c2623-dot-folder');
    await onHost(['c2623.dot-a', 'c2623.dot-b', 'c2623.dot-c']);
    const plain = await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/c2623.dot-a`,
    );
    await settle(10_000);
    const afterPlain = otherNames();
    const read = await recentRows(window, 'c2623.dot-a');
    await pressEscape(window);
    const files = described(read.rows, ['c2623.dot-a']);
    await commandLine('--remote', 'ssh-remote+harness', `${HOME}/c2623.dot-b/`);
    await shows('c2623.dot-b');
    await commandLine(
      '--folder-uri',
      `vscode-remote://ssh-remote+harness${HOME}/c2623.dot-c`,
    );
    await shows('c2623.dot-c');
    deepStrictEqual(
      {plain, afterPlain, files, windows: otherNames()},
      {
        plain: 0,
        afterPlain: [window],
        files: ['c2623.dot-a [SSH: harness] | ~'],
        windows: [window, 'c2623.dot-b', 'c2623.dot-c'],
      },
      read.note,
    );
  });

  it('F-2504 AC-8 (c2623-no-dot-file): a remote file without a dot passed without --goto opens a new remote window with No Folder Opened and Connected to remote.; with --goto or --file-uri it opens as a file in the window of that authority', async () => {
    const window = await connectedWindow('c2623-no-dot-file');
    await onHost([], {
      c2623nodota: 'a\\n',
      c2623nodotb: 'b\\n',
      c2623nodotc: 'c\\n',
    });
    const opened = await newWindow(() =>
      commandLine('--remote', 'ssh-remote+harness', `${HOME}/c2623nodota`),
    );
    await shows(opened);
    await waitFor(
      'the empty explorer',
      async () => (await pageText(opened)).includes('Connected to remote.'),
      60_000,
    );
    const text = await pageText(opened);
    await closeWindow(opened);
    await commandLine(
      '--remote',
      'ssh-remote+harness',
      '--goto',
      `${HOME}/c2623nodotb:1:1`,
    );
    await waitFor(
      'the file',
      async () => (await tabLabels(window)).includes('c2623nodotb'),
      60_000,
    );
    await commandLine(
      '--file-uri',
      `vscode-remote://ssh-remote+harness${HOME}/c2623nodotc`,
    );
    await waitFor(
      'the second file',
      async () => (await tabLabels(window)).includes('c2623nodotc'),
      60_000,
    );
    deepStrictEqual(
      {
        empty: [
          text.includes('No Folder Opened'),
          text.includes('Connected to remote.'),
        ],
        tabs: await tabLabels(window),
        windows: otherNames(),
      },
      {
        empty: [true, true],
        tabs: ['c2623nodotb', 'c2623nodotc'],
        windows: [window],
      },
    );
  });

  it('F-2504 AC-9 (c2623-goto): --goto with a line and a column puts the cursor there', async () => {
    const window = await connectedWindow('c2623-goto');
    await onHost([], {
      'c2623-goto/g.txt': 'one two\\nthree four\\nfive six\\n',
    });
    await commandLine(
      '--remote',
      'ssh-remote+harness',
      '--goto',
      `${HOME}/${window}/g.txt:2:5`,
    );
    await waitFor(
      'the cursor',
      async () =>
        (await statusBarText(window, 'status.editor.selection')) ===
        'Ln 2, Col 5',
      60_000,
    );
    deepStrictEqual(
      await statusBarText(window, 'status.editor.selection'),
      'Ln 2, Col 5',
    );
  });

  it('F-2504 AC-10 (c2623-workspace): a remote .code-workspace file opens a new window with the multi-root workspace titled by its name, (Workspace) and the authority', async () => {
    await onHost(['c2623-workspace', 'c2623-workspace/inner'], {
      'c2623-workspace/ws.code-workspace': '{"folders":[{"path":"inner"}]}',
    });
    await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/c2623-workspace/ws.code-workspace`,
    );
    await shows('c2623-workspace');
    await withFolders('c2623-workspace');
    deepStrictEqual(await whatShows('c2623-workspace'), {
      title: '[ws (Workspace) [SSH: harness]]',
      indicator: 'SSH: harness',
      folders: [
        `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-workspace/inner`,
      ],
      workspaceFile: `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-workspace/ws.code-workspace`,
    });
  });

  it('F-2504 AC-11 (c2623-encoded-authority): a --folder-uri whose authority is written ssh-remote%2B<alias> gives the same window as with ssh-remote+<alias>', async () => {
    await onHost(['c2623-encoded-a', 'c2623-encoded-b']);
    await commandLine(
      '--folder-uri',
      `vscode-remote://ssh-remote+harness${HOME}/c2623-encoded-a`,
    );
    await shows('c2623-encoded-a');
    await commandLine(
      '--folder-uri',
      `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-encoded-b`,
    );
    await shows('c2623-encoded-b');
    const plus = await whatShows('c2623-encoded-a');
    const encoded = await whatShows('c2623-encoded-b');
    deepStrictEqual(
      {
        title: [plus.title, encoded.title.replace('encoded-b', 'encoded-a')],
        indicator: [plus.indicator, encoded.indicator],
        folders: [
          plus.folders.map(folder => folder.replace('encoded-a', 'encoded-x')),
          encoded.folders.map(folder =>
            folder.replace('encoded-b', 'encoded-x'),
          ),
        ],
      },
      {
        title: [
          '[c2623-encoded-a [SSH: harness]]',
          '[c2623-encoded-a [SSH: harness]]',
        ],
        indicator: ['SSH: harness', 'SSH: harness'],
        folders: [
          [`vscode-remote://ssh-remote%2Bharness${HOME}/c2623-encoded-x`],
          [`vscode-remote://ssh-remote%2Bharness${HOME}/c2623-encoded-x`],
        ],
      },
    );
  });

  it('F-2504 AC-12 (c2623-missing-folder): a folder that does not exist opens a window that connects and shows core’s Workspace does not exist with Cancel and Open Workspace..., and nothing is created on the host', async () => {
    const status = await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/c2623-missing-folder/`,
    );
    await shows('c2623-missing-folder');
    deepStrictEqual(
      {
        status,
        dialog: await asks('c2623-missing-folder'),
        onHost: await onHostAs(
          'harness',
          'sh',
          '-c',
          `ls -d ${HOME}/c2623-missing-folder* 2>&1 || true`,
        ),
      },
      {
        status: 0,
        dialog: {
          message: 'Workspace does not exist',
          details: 'Please select another workspace to open.',
          buttons: ['Cancel', 'Open Workspace...'],
        },
        onHost: `ls: ${HOME}/c2623-missing-folder*: No such file or directory\n`,
      },
    );
  });

  it('F-2504 AC-13 (c2623-missing-file): a file that does not exist opens an unsaved editor with that name, and nothing is created on the host', async () => {
    const window = await connectedWindow('c2623-missing-file');
    const status = await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/c2623-missing-file-gone.txt`,
    );
    await waitFor(
      'the editor',
      async () => (await untitledDocuments(window)).length > 0,
      60_000,
    );
    deepStrictEqual(
      {
        status,
        untitled: (await untitledDocuments(window)).map(each => ({
          uri: each.uri,
          dirty: each.dirty,
        })),
        onHost: await onHostAs(
          'harness',
          'sh',
          '-c',
          `ls ${HOME}/c2623-missing-file-gone* 2>&1 || true`,
        ),
      },
      {
        status: 0,
        untitled: [
          {
            uri: `untitled://ssh-remote%2Bharness${HOME}/c2623-missing-file-gone.txt`,
            dirty: true,
          },
        ],
        onHost: `ls: ${HOME}/c2623-missing-file-gone*: No such file or directory\n`,
      },
    );
  });

  it('F-2504 AC-14 (c2623-reuse-window): code -r --remote <other host> <folder> reloads the same window onto the other host, which ends titled with its authority', async () => {
    await connectedWindow('c2623-reuse-a');
    await onHost(['c2623-reuse-b']);
    const status = await commandLine(
      '-r',
      '--remote',
      'ssh-remote+routed',
      `${HOME}/c2623-reuse-b`,
    );
    await shows('c2623-reuse-b', 'routed');
    deepStrictEqual(
      {
        status,
        windows: otherNames(),
        shown: (await whatShows('c2623-reuse-b')).title,
      },
      {
        status: 0,
        windows: ['c2623-reuse-b'],
        shown: '[c2623-reuse-b [SSH: routed]]',
      },
    );
  });

  it('F-2504 AC-15 (c2623-no-path): code --remote <alias> with no path opens a new empty remote window with the indicator SSH: <alias>', async () => {
    const opened = await nextEmptyWindow(async () => {
      await commandLine('--remote', 'ssh-remote+harness');
    });
    await shows(opened);
    deepStrictEqual(await whatShows(opened), {
      title: '[]',
      indicator: 'SSH: harness',
      folders: [],
      workspaceFile: null,
    });
  });

  it('F-2504 AC-16 (c2623-denied): an authority the resolver cannot authenticate to shows the connection error dialog with Retry, More Actions... and Close Remote, and Close Remote leaves an empty local window', async () => {
    const mark = recordLines().length;
    appendScript([
      {
        surface: 'maskedInput',
        match: 'password',
        answer: 'dismiss',
        window: 'c2623-denied',
      },
      {
        surface: 'failureDialog',
        match: 'Could not establish',
        answer: {button: 'Close Remote'},
        window: 'c2623-denied',
      },
    ]);
    await commandLine(
      '--remote',
      'ssh-remote+password',
      `${HOME}/c2623-denied`,
    );
    await waitFor(
      'the dialog',
      () =>
        recordLines()
          .slice(mark)
          .some(line => line.surface === 'failureDialog'),
      120_000,
    );
    const shown = recordLines()
      .slice(mark)
      .find(line => line.surface === 'failureDialog');
    await waitFor(
      'the empty window',
      () => otherNames().some(name => name.startsWith('empty-')),
      60_000,
    );
    const [left] = otherNames();
    deepStrictEqual(
      {
        buttons: [...(shown?.buttons ?? [])].sort(),
        windows: otherNames().length,
        left: left === undefined ? undefined : await whatShows(left),
      },
      {
        buttons: ERROR_BUTTONS,
        windows: 1,
        left: {title: '[]', indicator: '', folders: [], workspaceFile: null},
      },
    );
  });

  it('F-2504 AC-17 (c2623-open-folder): File: Open Folder... in a connected window lists the home folder’s entries with OK and Show Local, and a remote folder reloads the same window on the same host', async () => {
    const window = await connectedWindow('c2623-open-folder');
    await onHost(['c2623-open-folder-sub']);
    void inWindow(window, 'workbench.action.files.openFolder');
    await waitFor('the dialog', () => folderDialogOpen(window), 30_000);
    await waitFor(
      'the home entries',
      async () => (await folderDialogFacts(window)).rows.includes('.ssh'),
      30_000,
    );
    const dialog = await folderDialogFacts(window);
    await answerFolderDialog(window, `${HOME}/c2623-open-folder-sub`);
    await shows('c2623-open-folder-sub');
    deepStrictEqual(
      {
        value: dialog.value,
        buttons: dialog.buttons,
        rows: dialog.rows.includes('.ssh'),
        windows: otherNames(),
        shown: (await whatShows('c2623-open-folder-sub')).folders,
      },
      {
        value: `${HOME}/`,
        buttons: ['OK', 'Show Local'],
        rows: true,
        windows: ['c2623-open-folder-sub'],
        shown: [
          `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-open-folder-sub`,
        ],
      },
    );
  });

  it('F-2504 AC-18 (c2623-show-local): Show Local in that dialog and a local folder turn the same window into a local window with no SSH: in the indicator', async () => {
    const window = await connectedWindow('c2623-show-local');
    const local = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c2623-local-folder',
    );
    mkdirSync(local, {recursive: true});
    void inWindow(window, 'workbench.action.files.openFolder');
    await waitFor('the dialog', () => folderDialogOpen(window), 30_000);
    await waitFor(
      'the home entries',
      async () => (await folderDialogFacts(window)).rows.includes('.ssh'),
      30_000,
    );
    await waitFor(
      'the local listing',
      async () => {
        const facts = await folderDialogFacts(window);
        if (facts.buttons.includes('Show Local')) {
          await pressQuickInputButton(window, 'Show Local');
          await settle(2_000);
        }
        return !(await folderDialogFacts(window)).buttons.includes(
          'Show Local',
        );
      },
      60_000,
    );
    await answerFolderDialog(window, local);
    await waitFor(
      'the local window',
      () => isOpen('c2623-local-folder'),
      60_000,
    );
    deepStrictEqual(
      {windows: otherNames(), shown: await whatShows('c2623-local-folder')},
      {
        windows: ['c2623-local-folder'],
        shown: {
          title: '[c2623-local-folder]',
          indicator: '',
          folders: [`file://${local}`],
          workspaceFile: null,
        },
      },
    );
  });

  it('F-2504 AC-19 (c2623-open-file): Open File opens a remote file in the window without a reload, and Open Workspace from File reloads the same window as the workspace on that host', async () => {
    const window = await connectedWindow('c2623-open-file');
    await onHost(['c2623-open-file-ws'], {
      'c2623-open-file-note.txt': 'f\\n',
      'c2623-open-file-ws/w.code-workspace': '{"folders":[{"path":"."}]}',
    });
    const before = activations(window);
    void inWindow(window, 'workbench.action.files.openFile');
    await waitFor('the dialog', () => folderDialogOpen(window), 30_000);
    await answerFolderDialog(window, `${HOME}/c2623-open-file-note.txt`);
    await waitFor(
      'the file',
      async () => (await windowState(window)).activeTab !== null,
      60_000,
    );
    const file = {
      active: (await windowState(window)).activeTab?.uri,
      reloads: activations(window) - before,
      windows: otherNames(),
    };
    void inWindow(window, 'workbench.action.openWorkspace');
    await waitFor('the second dialog', () => folderDialogOpen(window), 30_000);
    await answerFolderDialog(
      window,
      `${HOME}/c2623-open-file-ws/w.code-workspace`,
    );
    await shows('c2623-open-file-ws');
    await withFolders('c2623-open-file-ws');
    deepStrictEqual(
      {
        file,
        workspace: await whatShows('c2623-open-file-ws'),
        windows: otherNames(),
      },
      {
        file: {
          active: `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-open-file-note.txt`,
          reloads: 0,
          windows: [window],
        },
        workspace: {
          title: '[w (Workspace) [SSH: harness]]',
          indicator: 'SSH: harness',
          folders: [
            `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-open-file-ws`,
          ],
          workspaceFile: `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-open-file-ws/w.code-workspace`,
        },
        windows: ['c2623-open-file-ws'],
      },
    );
  });

  it('F-2504 AC-20 (c2623-recent-open): an SSH entry of Open Recent picked in a local window connects that window and shows it, and Ctrl+Enter on one opens a new window, with no login or host-key question', async () => {
    await connectedWindow('c2623-recent-open');
    await onHost(['c2623-recent-x', 'c2623-recent-y']);
    for (const folder of ['c2623-recent-x', 'c2623-recent-y']) {
      await commandLine('--remote', 'ssh-remote+harness', `${HOME}/${folder}/`);
      await shows(folder);
      await closeWindow(folder);
    }
    const mark = recordLines().length;
    const window = await newLocalWindow();
    void inWindow(window, 'workbench.action.openRecent');
    await waitForQuickPick(window, 30_000);
    await chooseQuickPickRow(window, 'c2623-recent-x [SSH: harness]');
    await shows('c2623-recent-x');
    const picked = otherNames();
    void inWindow('c2623-recent-open', 'workbench.action.openRecent');
    await waitForQuickPick('c2623-recent-open', 30_000);
    await typeInQuickPick('c2623-recent-open', 'c2623-recent-y');
    await pressControlEnter('c2623-recent-open');
    await shows('c2623-recent-y');
    deepStrictEqual(
      {picked, windows: otherNames(), questions: loginQuestions(mark)},
      {
        picked: ['c2623-recent-open', 'c2623-recent-x'],
        windows: ['c2623-recent-open', 'c2623-recent-x', 'c2623-recent-y'],
        questions: [],
      },
    );
  });

  it('F-2504 AC-21 (c2623-recent-labels-part): Open Recent lists an entry as <name> [SSH: <host>] with a ~-relative description in a connected SSH window, with the absolute parent path in a new local window and as <name> [SSH] in the local window that was open before the host connected, and a folder outside the home keeps its absolute parent path', async () => {
    await onHost(['c2623-labels-home']);
    await onHostAs(
      'harness',
      'sh',
      '-c',
      'mkdir -p /tmp/c2623-labels-tmp && chmod 777 /tmp/c2623-labels-tmp',
    );
    const window = await connectedWindow('c2623-labels');
    for (const folder of [
      `${HOME}/c2623-labels-home/`,
      '/tmp/c2623-labels-tmp/',
    ]) {
      await commandLine('--remote', 'ssh-remote+harness', folder);
      await shows(path.basename(folder));
      await closeWindow(path.basename(folder));
    }
    const names = ['c2623-labels-home', 'c2623-labels-tmp'];
    const connectedRead = await recentRows(window, 'c2623-labels');
    const connected = described(connectedRead.rows, names);
    await pressEscape(window);
    const fresh = await newLocalWindow();
    const freshRead = await recentRows(fresh, 'c2623-labels');
    const freshRows = described(freshRead.rows, names);
    await pressEscape(fresh);
    await closeWindow(fresh);
    const originalRead = await recentRows('local', 'c2623-labels');
    const original = described(originalRead.rows, names);
    await pressEscape('local');
    deepStrictEqual(
      {connected, fresh: freshRows, original},
      {
        connected: [
          'c2623-labels-tmp [SSH: harness] | /tmp',
          'c2623-labels-home [SSH: harness] | ~',
        ],
        fresh: [
          'c2623-labels-tmp [SSH: harness] | /tmp',
          'c2623-labels-home [SSH: harness] | /home/harness',
        ],
        original: [
          'c2623-labels-tmp [SSH] | /tmp',
          'c2623-labels-home [SSH] | /home/harness',
        ],
      },
      [connectedRead.note, freshRead.note, originalRead.note].join('; '),
    );
  });

  it('F-2504 AC-22 (c2623-link-folder): a vscode-remote link makes the last active window reload connected to the host with the folder, and with ?windowId=_blank on a file link it opens a new remote window holding the file', async () => {
    const window = await connectedWindow('c2623-link-folder');
    await onHost(['c2623-link-target'], {
      'c2623-link-file.txt': 'l1\\nl2\\nl3 text\\n',
    });
    await userSettings({
      'security.promptForRemoteFileProtocolHandling': false,
    });
    await openLink(
      window,
      `{scheme}://vscode-remote/ssh-remote+harness${HOME}/c2623-link-target`,
    );
    await shows('c2623-link-target');
    const folder = {
      windows: otherNames(),
      shown: (await whatShows('c2623-link-target')).folders,
    };
    const opened = await nextEmptyWindow(async () => {
      await openLink(
        'c2623-link-target',
        `{scheme}://vscode-remote/ssh-remote+harness${HOME}/c2623-link-file.txt:3:4?windowId=_blank`,
      );
    });
    await shows(opened);
    await waitFor(
      'the file',
      async () => (await windowState(opened)).activeTab !== null,
      60_000,
    );
    deepStrictEqual(
      {
        folder,
        file: (await windowState(opened)).activeTab?.uri,
        windows: otherNames().length,
      },
      {
        folder: {
          windows: ['c2623-link-target'],
          shown: [
            `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-link-target`,
          ],
        },
        file: `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-link-file.txt`,
        windows: 2,
      },
    );
  });

  it('F-2504 AC-23 (c2623-host-writes): a folder opened by the command line writes on the host only what a plain connect writes', async () => {
    const marker = '/tmp/c2623-writes-mark';
    /** The files the host account gained since the marker, with the digits and the hashes of their names masked. */
    async function gained(): Promise<string[]> {
      const listing = await onHostAs(
        'harness',
        'sh',
        '-c',
        `find ${HOME} /tmp -xdev -newer ${marker} -not -path '*/.vscodium-server-insiders/*' -not -path '/tmp/ssh-*' 2>/dev/null | sort`,
      );
      return [
        ...new Set(
          listing
            .split('\n')
            .filter(line => line !== '')
            .map(line =>
              line
                .replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gu, '#')
                .replace(/[0-9a-f]{8,}|\d+/gu, '#'),
            ),
        ),
      ];
    }
    await onHost(['c2623-writes-a', 'c2623-writes-b']);
    await onHostAs('harness', 'sh', '-c', `touch ${marker}; sleep 1`);
    await openWindow('harness', 'c2623-writes-a');
    await connectedWithin('c2623-writes-a', 120_000);
    await settle(5_000);
    const plain = await gained();
    await onHostAs('harness', 'sh', '-c', `touch ${marker}; sleep 1`);
    await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/c2623-writes-b/`,
    );
    await shows('c2623-writes-b');
    await settle(5_000);
    const entry = await gained();
    deepStrictEqual(
      entry.filter(each => !plain.includes(each)),
      [],
    );
  });

  it('F-2504 AC-25 (c2623-new-file-window): code -n --remote <alias> <file> opens a new remote window holding only that file, with the indicator SSH: <alias>', async () => {
    await connectedWindow('c2623-new-file');
    await onHost([], {'c2623-new-file.txt': 'x\\n'});
    const opened = await nextEmptyWindow(async () => {
      await commandLine(
        '-n',
        '--remote',
        'ssh-remote+harness',
        `${HOME}/c2623-new-file.txt`,
      );
    });
    await shows(opened);
    await waitFor(
      'the file',
      async () => (await windowState(opened)).activeTab !== null,
      60_000,
    );
    deepStrictEqual(
      {tabs: await tabLabels(opened), shown: await whatShows(opened)},
      {
        tabs: ['c2623-new-file'],
        shown: {
          title: '[]',
          indicator: 'SSH: harness',
          folders: [],
          workspaceFile: null,
        },
      },
    );
  });

  it('F-2504 AC-26 (c2623-same-folder): code --remote <alias> <folder> for a folder a window already shows opens no new window', async () => {
    const window = await connectedWindow('c2623-same-folder');
    const status = await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/${window}`,
    );
    await settle(12_000);
    deepStrictEqual(
      {status, windows: otherNames()},
      {status: 0, windows: [window]},
    );
  });

  it('F-2504 AC-27 (c2623-recent-remove): the Remove from Recently Opened button of an SSH entry takes it out of the list', async () => {
    await onHost(['c2623-recent-gone']);
    await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/c2623-recent-gone/`,
    );
    await shows('c2623-recent-gone');
    await closeWindow('c2623-recent-gone');
    const window = await newLocalWindow();
    const read = await recentRows(window, 'c2623-recent-gone');
    const before = described(read.rows, ['c2623-recent-gone']);
    await pressQuickPickRowButton(
      window,
      'c2623-recent-gone [SSH: harness]',
      'Remove from Recently Opened',
    );
    await settle(2_000);
    // An empty list is also what a closed pick reads as, so the pick is read open first.
    const stillOpen = (await quickPickOf(window)) !== undefined;
    deepStrictEqual(
      {
        before,
        stillOpen,
        after: described(await quickPickRows(window), ['c2623-recent-gone']),
      },
      {
        before: ['c2623-recent-gone [SSH: harness] | /home/harness'],
        stillOpen: true,
        after: [],
      },
      read.note,
    );
  });

  it('F-2504 AC-28 (c2623-unsaved): with an unsaved editor, code -r --remote <other alias> <folder> asks core’s save prompt; Cancel leaves the window on its host and folder with the editor unsaved and starts no connection to the other host, and Don’t Save reloads it onto the other host', async () => {
    const window = await connectedWindow('c2623-unsaved-a');
    await onHost(['c2623-unsaved-b']);
    void inWindow(window, 'workbench.action.files.newUntitledFile');
    await waitFor(
      'the editor',
      async () => (await untitledDocuments(window)).length > 0,
      30_000,
    );
    await inWindow(window, 'acceptance.agent.call', 'type', {text: 'unsaved'});
    const mark = recordLines().length;
    await commandLine(
      '-r',
      '--remote',
      'ssh-remote+routed',
      `${HOME}/c2623-unsaved-b`,
    );
    const prompt = await asks(window);
    await answerDialog(window, 'Cancel');
    await settle(8_000);
    const cancelled = {
      windows: otherNames(),
      shown: (await whatShows(window)).folders,
      untitled: (await untitledDocuments(window)).length,
      questions: loginQuestions(mark),
    };
    await commandLine(
      '-r',
      '--remote',
      'ssh-remote+routed',
      `${HOME}/c2623-unsaved-b`,
    );
    await asks(window);
    await answerDialog(window, "Don't Save");
    await shows('c2623-unsaved-b', 'routed');
    deepStrictEqual(
      {prompt, cancelled, windows: otherNames()},
      {
        prompt: {
          message: 'Do you want to save the changes you made to unsaved?',
          details: "Your changes will be lost if you don't save them.",
          buttons: ["Don't Save", 'Cancel', 'Save'],
        },
        cancelled: {
          windows: [window],
          shown: [
            `vscode-remote://ssh-remote%2Bharness${HOME}/c2623-unsaved-a`,
          ],
          untitled: 1,
          questions: [],
        },
        windows: ['c2623-unsaved-b'],
      },
    );
  });

  it('F-2504 AC-29 (c2623-trust): a remote folder, workspace or outside file that is not trusted shows core’s trust modal, and the extension adds no dialog of its own', async () => {
    await onHostAs(
      'harness-tmpdir',
      'sh',
      '-c',
      'mkdir -p /home/harness-tmpdir/trust-f /home/harness-tmpdir/trust-w; printf \'{"folders":[{"path":"."}]}\' > /home/harness-tmpdir/trust-w/t.code-workspace; printf "x" > /home/harness-tmpdir/trust-file.txt',
    );
    const mark = recordLines().length;
    const asked: unknown[] = [];
    await commandLine(
      '--remote',
      'ssh-remote+agentfwd-tmpdir',
      '/home/harness-tmpdir/trust-f/',
    );
    asked.push(await asks('trust-f'));
    await tidy();
    await commandLine(
      '--remote',
      'ssh-remote+agentfwd-tmpdir',
      '/home/harness-tmpdir/trust-w/t.code-workspace',
    );
    asked.push(await asks('trust-w'));
    await tidy();
    const outside = await nextEmptyWindow(async () => {
      await commandLine(
        '--remote',
        'ssh-remote+agentfwd-tmpdir',
        '/home/harness-tmpdir/trust-file.txt',
      );
    });
    asked.push(await asks(outside));
    deepStrictEqual(
      {
        asked,
        own: recordLines()
          .slice(mark)
          .filter(line => ['failureDialog', 'notice'].includes(line.surface))
          .length,
      },
      {
        asked: [
          {
            message: 'Do you trust the authors of the files in this folder?',
            details: '',
            buttons: ['Manage', 'Cancel', 'Trust Folder & Continue'],
          },
          {
            message: 'Do you trust the authors of the files in this workspace?',
            details: '',
            buttons: ['Manage', 'Cancel', 'Trust Workspace & Continue'],
          },
          {
            message: 'Do you trust the authors of the files in this workspace?',
            details: '',
            buttons: ['Manage', 'Cancel', 'Trust Workspace & Continue'],
          },
        ],
        own: 0,
      },
    );
  });

  it('F-2504 AC-30 (c2623-relative-path): code --remote <alias> tmp/<name> from the harness’s own folder opens the host folder /tmp/<name>', async () => {
    await onHostAs(
      'harness',
      'sh',
      '-c',
      'mkdir -p /tmp/c2623-relative-path && chmod 777 /tmp/c2623-relative-path',
    );
    const status = await commandLine(
      '--remote',
      'ssh-remote+harness',
      'tmp/c2623-relative-path',
    );
    await shows('c2623-relative-path');
    deepStrictEqual(
      {status, folders: (await whatShows('c2623-relative-path')).folders},
      {
        status: 0,
        folders: [
          'vscode-remote://ssh-remote%2Bharness/tmp/c2623-relative-path',
        ],
      },
    );
  });

  it('F-2504 AC-31 (c2623-uri-twice): the extension’s URI handed to the editor twice within a minute asks core’s modal both times, and after Open the extension shows nothing either time', async () => {
    const window = await newLocalWindow();
    const asked: unknown[] = [];
    for (let time = 0; time < 2; time += 1) {
      await openLink(window, '{scheme}://remote-oss.remote-ssh/');
      asked.push((await asks(window))?.message);
      await answerDialog(window, 'Open');
      await settle(3_000);
    }
    deepStrictEqual(
      {
        asked,
        dialog: await dialogOf(window),
        notices: await notifications(window),
        windows: otherNames(),
      },
      {
        asked: [CONSENT, CONSENT],
        dialog: undefined,
        notices: [],
        windows: [window],
      },
    );
  });

  it('F-2504 AC-32 (c2623-no-reference): a window opened by the command line connects through the extension’s resolver with no notification that another extension is required', async () => {
    await onHost(['c2623-no-reference']);
    await commandLine(
      '--remote',
      'ssh-remote+harness',
      `${HOME}/c2623-no-reference`,
    );
    await shows('c2623-no-reference');
    await settle(5_000);
    deepStrictEqual(
      (await notifications('c2623-no-reference')).filter(text =>
        text.includes('is required to open the remote window'),
      ),
      [],
    );
  });
});
