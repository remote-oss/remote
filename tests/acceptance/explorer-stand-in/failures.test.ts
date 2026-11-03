/**
 * @fileoverview The explorer beside a companion whose calls fail (card coverage-102, #1809, part 3h): the stand-in
 * companion of the explorer-stand-in launch rejects the history call, rejects or never answers the delete call, and
 * shows an error of its own before rejecting the two commands the group's buttons hand over to.
 */

import {deepStrictEqual} from 'node:assert';
import {
  inWindow,
  readUserSettings,
  setStandInModes,
  windowNames,
} from '../windows/harness.ts';
import {
  dialogOf,
  notifications,
  paletteRows,
  rememberPage,
  rowAction,
  rowMenuAction,
  viewRows,
} from '../windows/renderer.ts';

const LOCAL = 'local';
const VIEW = 'Remotes (Tunnels/SSH)';

/** The interface version the explorer speaks, which the stand-in's answers carry. */
const VERSION = {major: 1, minor: 0};

const HOSTNAMES = 'remote-internal.getConfiguredHostnames';
const HISTORY = 'remote-internal.getSshFoldersHistory';
const DELETE = 'remote-internal.deleteSshFolderFromHistory';

/** The host the stand-in lists, and its one recent folder. */
const HOST = 'stand-in-host';
const FOLDER = '/w/stand-in-proj';

/** The text of the error the stand-in shows before it rejects. */
const OWN_ERROR = 'stand-in error of its own';

/** How long the delete call is given before the explorer gives up on it, and a little more. */
const DELETE_TIMEOUT_MILLISECONDS = 12_000;

/** The labels and levels of the rows the view shows now. */
async function rows(): Promise<Array<[string, number]>> {
  return ((await viewRows(LOCAL, VIEW)) ?? []).map(entry => [
    entry.label,
    entry.level,
  ]);
}

/** The modes of a companion that lists the host with its one folder. */
const WITH_FOLDER = {
  [HOSTNAMES]: {answer: {interfaceVersion: VERSION, hostnames: [HOST]}},
  [HISTORY]: {
    answer: {
      interfaceVersion: VERSION,
      hosts: [{hostKey: HOST, entries: [{path: FOLDER, kind: 'folder'}]}],
    },
  },
};

/** Refreshes the view and waits for the rows it settles on. */
async function refreshed(): Promise<void> {
  await inWindow(LOCAL, 'remote-explorer.refresh');
  await new Promise(resolve => setTimeout(resolve, 4_000));
}

/** Runs Remove from Recent List with the delete call in `mode`, and gives what the view and the window show, and what they should. */
async function removalLeavesRow(
  mode: unknown,
): Promise<[unknown[], unknown[]]> {
  setStandInModes({...WITH_FOLDER, [DELETE]: mode});
  await refreshed();
  const folderRow = 'stand-in-proj';
  const settings = readUserSettings();
  const before = await rows();
  await rowMenuAction(LOCAL, VIEW, folderRow, 'Remove from Recent List');
  await new Promise(resolve => setTimeout(resolve, 3_000));
  const soon = await rows();
  await new Promise(resolve =>
    setTimeout(resolve, DELETE_TIMEOUT_MILLISECONDS),
  );
  return [
    [
      before.some(([label]) => label === folderRow),
      soon,
      await rows(),
      await notifications(LOCAL),
      readUserSettings() === settings,
    ],
    [true, before, before, [], true],
  ];
}

describe('the explorer beside a failing companion (card coverage-102, part 3h)', function () {
  this.timeout(300_000);

  before(async () => {
    await rememberPage(LOCAL);
    await inWindow(LOCAL, 'remoteTargets.focus');
  });

  it('F-5902 AC-16 (history-rejects): with the history call rejecting while the host call answers, the host rows are leaves and no notification appears', async () => {
    setStandInModes({
      ...WITH_FOLDER,
      [HISTORY]: {reject: 'stand-in history'},
    });
    await refreshed();
    deepStrictEqual(
      [await rows(), await notifications(LOCAL)],
      [
        [
          ['SSH', 1],
          [HOST, 2],
        ],
        [],
      ],
    );
  });

  it('F-5902 AC-20 (delete-rejects): with the delete call rejecting, Remove from Recent List leaves the row where it was, also after the timeout, with no notification and no setting written', async () => {
    deepStrictEqual(...(await removalLeavesRow({reject: 'stand-in delete'})));
  });

  it('F-5902 AC-20 (delete-never-answers): with the delete call never answering, Remove from Recent List leaves the row where it was, also after the timeout, with no notification and no setting written', async () => {
    deepStrictEqual(...(await removalLeavesRow({never: true})));
  });

  it('F-5902 AC-22 (own-errors): with the two commands of the group’s buttons showing an error of their own and rejecting, that error appears and nothing from the explorer does, no window opens or closes and the window stays usable', async () => {
    setStandInModes({
      'opensshremotes.openConfigFile': {showErrorThenReject: OWN_ERROR},
      'opensshremotes.addNewSshHost': {showErrorThenReject: OWN_ERROR},
    });
    await refreshed();
    const windows = windowNames();
    const settings = readUserSettings();
    const toasts: string[][] = [];
    for (const button of ['Open SSH Config File', 'New Remote']) {
      await rowAction(LOCAL, VIEW, 'SSH', button);
      await new Promise(resolve => setTimeout(resolve, 3_000));
      toasts.push(await notifications(LOCAL));
    }
    deepStrictEqual(
      [
        toasts.map(list =>
          list.filter(
            text =>
              text.includes('remote-explorer') ||
              text.includes('Error running'),
          ),
        ),
        toasts.map(list => list.some(text => text.includes(OWN_ERROR))),
        await dialogOf(LOCAL),
        windowNames(),
        readUserSettings() === settings,
        (await paletteRows(LOCAL, 'Focus on Remotes')).length > 0,
      ],
      [[[], []], [true, true], undefined, windows, true, true],
    );
  });
});
