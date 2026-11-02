import {deepStrictEqual} from 'node:assert';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  extensionActive,
  inWindow,
  isTrusted,
  openWindow,
  recordLines,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  CONNECTED_ENTRIES,
  indicatorGroups,
  LOCAL_ENTRIES,
  remoteSshEntries,
  SSH_EXTENSION,
  sshActivations,
  windowWithLog,
} from '../windows/activation-support.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {runFromPalette} from '../windows/palette.ts';
import {
  answerDialog,
  dialogOf,
  extensionsViewSections,
  extensionStatusShown,
  waitForDialog,
} from '../windows/renderer.ts';

/** The question of the host picker of Connect to Host.... */
const HOST_QUESTION = 'Select configured SSH host or enter user@host';

/** The display name of Remote - SSH in the Extensions view. */
const DISPLAY_NAME = 'Remote - SSH';

/** The answer of core's startup question that keeps the folder in Restricted Mode. */
const REFUSE = "No, I don't trust the authors";

/** How long the rows let a window settle, so that an activation that comes late would have come. */
const SETTLE_MILLISECONDS = 5000;

describe('Remote - SSH in Restricted Mode (card coverage-95)', function () {
  this.timeout(300_000);

  let name = '';
  let logFile = '';

  before(async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'c95-restricted');
    mkdirSync(folder, {recursive: true});
    ({name, logFile} = await windowWithLog(() => openFolderWindow(folder)));
    await waitForDialog(name, 60_000);
    await answerDialog(name, REFUSE);
    await new Promise(resolve => setTimeout(resolve, SETTLE_MILLISECONDS));
  });

  after(async () => {
    await closeWindow(name).catch(() => undefined);
  });

  it('F-2001 AC-1 (c95-untrusted-start): a fresh window on an untrusted folder never activates the extension: it is not active and its extension host log has no activation of it', async () => {
    deepStrictEqual(
      [
        await isTrusted(name),
        await dialogOf(name),
        await extensionActive(name, SSH_EXTENSION),
        sshActivations(logFile),
      ],
      [false, undefined, false, []],
    );
  });

  it('F-2001 AC-9 (c95-unsupported): the extension is in neither "Disabled in Restricted Mode" nor "Limited in Restricted Mode" of the @workspaceUnsupported list, and its row in the Extensions view has no Restricted Mode shield', async () => {
    await inWindow(name, 'workbench.view.extensions');
    await inWindow(
      name,
      'workbench.extensions.action.clearExtensionsSearchResults',
    );
    await waitFor(
      'the Extensions view to list the extension',
      async () =>
        (await extensionsViewSections(name)).some(section =>
          section.entries.includes(DISPLAY_NAME),
        ),
      30_000,
    );
    const shield = await extensionStatusShown(name, DISPLAY_NAME);
    await inWindow(
      name,
      'workbench.extensions.action.listWorkspaceUnsupportedExtensions',
    );
    await waitFor(
      'the @workspaceUnsupported list',
      async () =>
        (await extensionsViewSections(name)).some(
          section =>
            section.title === 'Disabled in Restricted Mode' &&
            section.entries.length > 0,
        ),
      30_000,
    );
    const lists = (await extensionsViewSections(name)).filter(section =>
      ['Disabled in Restricted Mode', 'Limited in Restricted Mode'].includes(
        section.title,
      ),
    );
    deepStrictEqual(
      [
        shield,
        lists.map(section => section.title),
        lists.flatMap(section => section.entries).includes(DISPLAY_NAME),
      ],
      [
        false,
        ['Disabled in Restricted Mode', 'Limited in Restricted Mode'],
        false,
      ],
    );
  });

  it('F-2001 AC-10 (c95-restricted-palette): in Restricted Mode the palette lists the same 13 Remote-SSH entries and the indicator menu the same Remote-SSH group as in a trusted window, and the extension stays inactive', async () => {
    const entries = await remoteSshEntries(name);
    const rows = await indicatorGroups(name);
    deepStrictEqual(
      [
        entries,
        rows.slice(0, 2),
        await extensionActive(name, SSH_EXTENSION),
        sshActivations(logFile),
      ],
      [
        LOCAL_ENTRIES,
        [
          {label: 'Connect to Host...', separator: 'Remote-SSH'},
          {label: 'Connect Current Window to Host...', separator: ''},
        ],
        false,
        [],
      ],
    );
  });

  it('F-2001 AC-11 (c95-restricted-connect): Connect to Host... in Restricted Mode activates the extension and opens the host picker', async () => {
    appendScript([
      {
        surface: 'hostPick',
        match: HOST_QUESTION,
        answer: 'dismiss',
        window: name,
      },
    ]);
    await runFromPalette(name, 'Remote-SSH: Connect to Host...');
    await waitFor(
      'the host picker',
      () => recordLines('hostPick', name).length > 0,
      30_000,
    );
    deepStrictEqual(
      [
        recordLines('hostPick', name).map(line => line.question),
        await extensionActive(name, SSH_EXTENSION),
        sshActivations(logFile),
      ],
      [[HOST_QUESTION], true, ['onCommand:opensshremotes.openEmptyWindow']],
    );
  });

  it('F-2001 AC-16 (c95-connected-restricted): a connected SSH window in Restricted Mode lists the 15 Remote-SSH commands in the palette and keeps the Remote-SSH group of the indicator menu', async () => {
    await openWindow('harness', 'c95-connected');
    try {
      await waitForDialog('c95-connected', 60_000);
      await answerDialog('c95-connected', REFUSE);
      await connectedWithin('c95-connected', INSTALL_MILLISECONDS);
      const entries = await remoteSshEntries('c95-connected');
      const rows = await indicatorGroups('c95-connected');
      deepStrictEqual(
        [
          await isTrusted('c95-connected'),
          entries,
          rows.some(each => each.separator === 'Remote-SSH'),
        ],
        [false, CONNECTED_ENTRIES, true],
      );
    } finally {
      await closeWindow('c95-connected').catch(() => undefined);
    }
  });
});
