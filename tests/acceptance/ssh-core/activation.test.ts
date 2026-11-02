import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  extensionActive,
  extensionPresent,
  inWindow,
  nextEmptyWindow,
  variable,
} from '../windows/harness.ts';
import {
  indicatorGroups,
  LOCAL_ENTRIES,
  remoteSshEntries,
  SSH_EXTENSION,
  sshActivations,
  windowWithLog,
} from '../windows/activation-support.ts';
import {openFolderWindow, openMemoryWindow} from '../windows/folder-windows.ts';
import {runFromPalette} from '../windows/palette.ts';
import {
  dialogOf,
  notifications,
  outputChannelOf,
  pageText,
  quickPickOf,
} from '../windows/renderer.ts';

/** How long the rows let a window settle, so that an activation that comes late would have come. */
const SETTLE_MILLISECONDS = 5000;

/** The folder `name` of the launch's run, made. */
function folderOf(name: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** Waits for the settle time. */
function settled(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
}

describe('the activation of Remote - SSH in a local window (card coverage-95)', function () {
  this.timeout(300_000);

  let name = '';
  let logFile = '';

  before(async () => {
    ({name, logFile} = await windowWithLog(() =>
      openFolderWindow(folderOf('c95-local')),
    ));
    await settled();
  });

  after(async () => {
    await closeWindow(name).catch(() => undefined);
  });

  /** What says whether the extension of window `window`, whose extension host logs to `file`, is inactive. */
  async function inactive(window: string, file: string): Promise<boolean[]> {
    return [
      await extensionActive(window, SSH_EXTENSION),
      sshActivations(file).length > 0,
    ];
  }

  it('F-2001 AC-1 (c95-inactive-start-part): a fresh window, empty or on a folder, never activates the extension: it is not active and its extension host log has no activation of it', async () => {
    const empty = await windowWithLog(() =>
      nextEmptyWindow(() => inWindow('local', 'workbench.action.newWindow')),
    );
    try {
      await settled();
      deepStrictEqual(
        [
          await inactive(empty.name, empty.logFile),
          await inactive(name, logFile),
        ],
        [
          [false, false],
          [false, false],
        ],
      );
    } finally {
      await closeWindow(empty.name).catch(() => undefined);
    }
  });

  it('F-2001 AC-2 (c95-palette): the Command Palette filtered with "Remote-SSH:" lists exactly the 13 entries of a local window, and the extension stays inactive', async () => {
    const entries = await remoteSshEntries(name);
    deepStrictEqual(
      [entries, await inactive(name, logFile)],
      [LOCAL_ENTRIES, [false, false]],
    );
  });

  it('F-2001 AC-3 (c95-indicator): the remote indicator’s menu opens with the group "Remote-SSH": Connect to Host... and Connect Current Window to Host..., and the extension stays inactive', async () => {
    const rows = await indicatorGroups(name);
    deepStrictEqual(
      [rows.slice(0, 2), await inactive(name, logFile)],
      [
        [
          {label: 'Connect to Host...', separator: 'Remote-SSH'},
          {label: 'Connect Current Window to Host...', separator: ''},
        ],
        [false, false],
      ],
    );
  });

  it('F-2001 AC-4 (c95-settings): the Settings editor filtered to the extension lists its 33 non-deprecated settings, and the extension stays inactive', async () => {
    await inWindow(
      name,
      'workbench.action.openSettings',
      `@ext:${SSH_EXTENSION}`,
    );
    await settled();
    deepStrictEqual(
      [
        (await pageText(name)).match(/\d+ Settings? Found/g)?.[0],
        await inactive(name, logFile),
      ],
      ['33 Settings Found', [false, false]],
    );
  });

  it('F-2001 AC-5, AC-6 (c95-show-log): Remote-SSH: Show Log activates the extension with the event onCommand:opensshremotes.showLog and opens the output channel Remote - SSH, with no notification, dialog or quick pick of the activation', async () => {
    await runFromPalette(name, 'Remote-SSH: Show Log');
    await settled();
    deepStrictEqual(
      {
        events: sshActivations(logFile),
        active: await extensionActive(name, SSH_EXTENSION),
        channel: await outputChannelOf(name),
        dialog: await dialogOf(name),
        notices: await notifications(name),
        quickPick: await quickPickOf(name),
      },
      {
        events: ['onCommand:opensshremotes.showLog'],
        active: true,
        channel: 'Remote - SSH',
        dialog: undefined,
        notices: [],
        quickPick: undefined,
      },
    );
  });

  it('F-2001 AC-22 (c95-virtual): in a virtual workspace the extension is enabled, Get Started with SSH is hidden and the other 12 local-window commands are listed', async () => {
    const virtual = await openMemoryWindow();
    try {
      await settled();
      deepStrictEqual(
        [
          await extensionPresent(virtual, SSH_EXTENSION),
          await remoteSshEntries(virtual),
        ],
        [
          true,
          LOCAL_ENTRIES.filter(
            entry => !entry.endsWith('Get Started with SSH'),
          ),
        ],
      );
    } finally {
      await closeWindow(virtual).catch(() => undefined);
    }
  });

  it('F-2001 AC-23 (c95-command-part): a command the palette hides, run with executeCommand in a local window, activates the extension with the event of its own command and shows nothing', async () => {
    const own = await windowWithLog(() =>
      openFolderWindow(folderOf('c95-command')),
    );
    try {
      await settled();
      const before = sshActivations(own.logFile);
      await inWindow(own.name, 'opensshremotes.openEmptyWindowOnCurrentHost');
      await settled();
      deepStrictEqual(
        {
          before,
          events: sshActivations(own.logFile),
          notices: await notifications(own.name),
          dialog: await dialogOf(own.name),
          quickPick: await quickPickOf(own.name),
        },
        {
          before: [],
          events: ['onCommand:opensshremotes.openEmptyWindowOnCurrentHost'],
          notices: [],
          dialog: undefined,
          quickPick: undefined,
        },
      );
    } finally {
      await closeWindow(own.name).catch(() => undefined);
    }
  });
});
