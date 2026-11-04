/**
 * @fileoverview Switch Container (card containers-166, F-0407): the command in a dev container window, its picker, the
 * dialog with no other configuration, and the windows that do not offer it.
 */

import {deepStrictEqual} from 'node:assert';
import {devContainersOf, inWindow, waitFor} from '../windows/harness.ts';
import {SWITCH, switchScene} from './switch-support.ts';
import {
  chooseQuickPickItem,
  dialogOf,
  editorTabs,
  notifications,
  paletteRows,
  pressEscape,
  pressQuickPickRowButton,
  quickPickFacts,
  quickPickRows,
  statusItem,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';

const MAIN = '.devcontainer/devcontainer.json';
const OTHER = '.devcontainer/other/devcontainer.json';
const NO_OTHER =
  'No other Dev Container configurations found in folder. Did you mean to open another folder in a container?';

describe('Switch Container (card containers-166, F-0407)', function () {
  this.timeout(900_000);
  const {folderOf, connected, opening, stateOf, waitForOwnEntry, cleanUp} =
    switchScene();

  afterEach(cleanUp);

  it('F-0407 AC-2, AC-5, AC-11, AC-19 (c166-picker): the picker has the title Select Configuration, the placeholder of the initial picker, one row per configuration with its path and an Open File button, the connected one marked (Current), the first row focused; Escape changes nothing', async () => {
    const folder = folderOf('c166-picker', {[MAIN]: 'Main', [OTHER]: 'Other'});
    const window = await connected(folder, 'Main');
    const before = await stateOf(window);
    const running = inWindow(window, SWITCH);
    await waitForQuickPick(window, 60_000);
    const facts = await quickPickFacts(window);
    const rows = await quickPickRows(window);
    await pressEscape(window);
    await running.catch(() => undefined);
    deepStrictEqual(
      {
        facts: [facts?.title, facts?.placeholder],
        rows: rows.map(each => [
          each.label,
          each.description,
          each.buttons,
          each.focused,
        ]),
        same: JSON.stringify(await stateOf(window)) === JSON.stringify(before),
      },
      {
        facts: ['Select Configuration', 'Select a devcontainer.json file.'],
        rows: [
          ['Main', `${MAIN} (Current)`, ['Open File'], true],
          ['Other', OTHER, ['Open File'], false],
        ],
        same: true,
      },
    );
  });

  it('F-0407 AC-4, AC-26 (c166-nothing): choosing the connected configuration, and the Open File button of another, leave the window connected to the same container with nothing shown', async () => {
    const folder = folderOf('c166-nothing', {[MAIN]: 'Main', [OTHER]: 'Other'});
    const window = await connected(folder, 'Main');
    const [container] = await devContainersOf(folder);
    const beforeState = await stateOf(window);
    const before = JSON.stringify(beforeState);
    const choosing = inWindow(window, SWITCH);
    await waitForQuickPick(window, 60_000);
    await chooseQuickPickItem(window, 'Main');
    await choosing.catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const afterCurrent = [
      JSON.stringify(await stateOf(window)),
      await devContainersOf(folder),
      await notifications(window),
    ];
    const opening = inWindow(window, SWITCH);
    await waitForQuickPick(window, 60_000);
    await pressQuickPickRowButton(window, 'Other', 'Open File');
    await opening.catch(() => undefined);
    await waitFor(
      'the configuration file to open',
      async () =>
        (await editorTabs(window)).some(each => each.label === 'devcontainer'),
      30_000,
    );
    deepStrictEqual(
      [
        afterCurrent,
        (await windowTitle(window)) === beforeState.title,
        (await statusItem(window, 'status.host')).text,
        await devContainersOf(folder),
      ],
      [[before, [container], []], true, 'Dev Container: Main', [container]],
    );
  });

  it('F-0407 AC-6 (c166-single): with the connected configuration alone the dialog says there is no other one, with Cancel and Open Folder in Container...; Cancel changes nothing', async () => {
    const folder = folderOf('c166-single', {[MAIN]: 'Main'});
    const window = await connected(folder);
    const before = JSON.stringify(await stateOf(window));
    const running = inWindow(window, SWITCH);
    await waitFor(
      'the dialog',
      async () => (await dialogOf(window)) !== undefined,
      60_000,
    );
    const dialog = await dialogOf(window);
    await pressEscape(window);
    await running.catch(() => undefined);
    deepStrictEqual(
      [
        dialog?.details,
        dialog?.buttons,
        JSON.stringify(await stateOf(window)),
        await dialogOf(window),
      ],
      [NO_OTHER, ['Cancel', 'Open Folder in Container...'], before, undefined],
    );
  });

  it('F-0407 AC-1 (c166-palette): the palette of a dev container window lists the command, and the palette of a local window does not', async () => {
    const folder = folderOf('c166-palette', {[MAIN]: 'Main', [OTHER]: 'Other'});
    const window = await connected(folder, 'Main');
    const inside = (
      await paletteRows(window, 'Dev Containers: Switch Container')
    ).filter(each => each === 'Dev Containers: Switch Container');
    const local = await opening(
      folderOf('c166-palette-local', {[MAIN]: 'Main'}),
    );
    const own = await waitForOwnEntry(local);
    const outside = (await paletteRows(local, 'Switch Container')).filter(
      each => each.includes('Switch Container'),
    );
    deepStrictEqual(
      [inside, own, outside],
      [['Dev Containers: Switch Container'], true, []],
    );
  });

  it('F-0407 AC-10, AC-17, AC-25 (c166-order): the items follow the root file, then .devcontainer/devcontainer.json, then the sub-folders by folder name; a configuration with no name is labelled by its folder; a file two levels deep is not listed', async () => {
    const folder = folderOf('c166-order', {
      '.devcontainer.json': 'Root',
      [MAIN]: 'Main',
      '.devcontainer/b/devcontainer.json': 'Bee',
      '.devcontainer/a/devcontainer.json': undefined,
      '.devcontainer/x/y/devcontainer.json': 'Deep',
    });
    const window = await connected(folder, 'Main');
    const running = inWindow(window, SWITCH);
    await waitForQuickPick(window, 60_000);
    const rows = await quickPickRows(window);
    await pressEscape(window);
    await running.catch(() => undefined);
    deepStrictEqual(
      rows.map(each => [each.label, each.description]),
      [
        ['Root', '.devcontainer.json'],
        ['Main', `${MAIN} (Current)`],
        ['a', '.devcontainer/a/devcontainer.json'],
        ['Bee', '.devcontainer/b/devcontainer.json'],
      ],
    );
  });

  it('F-0407 AC-28, AC-29 (c166-local): in a local window the command shows the dialog with at most one configuration, and with several the picker of Reopen in Container, which Escape closes with nothing created', async () => {
    const single = await opening(folderOf('c166-local-one', {[MAIN]: 'Main'}));
    const singleRun = inWindow(single, SWITCH);
    await waitFor(
      'the dialog',
      async () => (await dialogOf(single)) !== undefined,
      60_000,
    );
    const dialog = await dialogOf(single);
    await pressEscape(single);
    await singleRun.catch(() => undefined);
    const several = folderOf('c166-local-two', {
      [MAIN]: 'Main',
      [OTHER]: 'Other',
    });
    const pair = await opening(several);
    const pairRun = inWindow(pair, SWITCH);
    await waitForQuickPick(pair, 60_000);
    const facts = await quickPickFacts(pair);
    await pressEscape(pair);
    await pairRun.catch(() => undefined);
    deepStrictEqual(
      [
        dialog?.details,
        facts?.placeholder,
        facts?.title.replaceAll('\u00a0', ' ').trim(),
        await devContainersOf(several),
        await windowTitle(pair),
      ],
      [
        NO_OTHER,
        'Select a devcontainer.json file.',
        '',
        [],
        '[c166-local-two]',
      ],
    );
  });
});
