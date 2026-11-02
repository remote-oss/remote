/**
 * @fileoverview The "SSH" group's two hand-overs to Remote - SSH (card coverage-102, #1809, part 2): the buttons and
 * menu of the row, and the picker and the input that open from them, which are the ones the companion's own palette
 * commands open. The launch shows the extension's real pickers, and its HOME is the run's own.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import {
  closePick,
  pickShown,
  sshFile,
  sshFolder,
  systemHosts,
  viewWindow,
} from '../windows/explorer-home.ts';
import {hostLabels, listing, VIEW} from '../windows/explorer-rows.ts';
import {
  closeWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {
  answerInputBox,
  hoverRow,
  notifications,
  paletteRows,
  paletteRun,
  rowAction,
  rowActionTitles,
  rowContextMenu,
  rowMenuAction,
  shownRowActionTitles,
  viewRows,
} from '../windows/renderer.ts';

const GEAR = 'Open SSH Config File';
const PLUS = 'New Remote';
const GROUP = 'SSH';

describe("the SSH group's hand-overs to Remote - SSH (card coverage-102, part 2)", function () {
  this.timeout(240_000);
  let savedSettings: string | undefined;

  beforeEach(async () => {
    savedSettings = readUserSettings();
    rmSync(sshFolder(), {recursive: true, force: true});
    await userSettings({'remote.SSH.configFile': ''});
  });

  afterEach(() => {
    restoreUserSettings(savedSettings);
    rmSync(sshFolder(), {recursive: true, force: true});
  });

  it('F-5102 AC-1 (inline-buttons): an idle SSH row shows no button, and a hovered one shows the gear and then the plus', async () => {
    sshFile('config', ['Host user-one']);
    const window = await viewWindow('group-buttons');
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      await hoverRow(window, VIEW, undefined);
      const idle = await shownRowActionTitles(window, VIEW, GROUP);
      await hoverRow(window, VIEW, GROUP);
      deepStrictEqual(
        [
          idle,
          await shownRowActionTitles(window, VIEW, GROUP),
          await rowActionTitles(window, VIEW, GROUP),
        ],
        [[], [GEAR, PLUS], [GEAR, PLUS]],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-2 (context-menu): the context menu of the SSH row holds the gear and then the plus, with no separator and no other entry', async () => {
    sshFile('config', ['Host user-one']);
    const window = await viewWindow('group-menu');
    try {
      deepStrictEqual(await rowContextMenu(window, VIEW, GROUP), [GEAR, PLUS]);
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-3 (no-palette): the Command Palette lists neither command of the group, by title or by id', async () => {
    const window = await viewWindow('group-palette');
    try {
      const listed = (
        await Promise.all(
          [GEAR, PLUS, 'remote-explorer.'].map(text =>
            paletteRows(window, text),
          ),
        )
      ).flat();
      deepStrictEqual(
        listed.filter(
          label =>
            label === GEAR ||
            label === PLUS ||
            label.includes(`: ${GEAR}`) ||
            label.includes(`: ${PLUS}`),
        ),
        [],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it("F-5102 AC-10, AC-15 (gear-picker): the gear and its menu entry open the picker of the companion's own palette command at once, and nothing else is shown", async () => {
    sshFile('config', ['Host user-one']);
    const window = await viewWindow('group-gear');
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      await rowAction(window, VIEW, GROUP, GEAR);
      const fromGear = await pickShown(window);
      await closePick(window);
      await rowMenuAction(window, VIEW, GROUP, GEAR);
      const fromMenu = await pickShown(window);
      await closePick(window);
      await paletteRun(window, 'Remote-SSH: Open SSH Configuration File...');
      const fromPalette = await pickShown(window);
      await closePick(window);
      deepStrictEqual(
        [
          fromGear,
          fromMenu,
          await notifications(window),
          fromPalette.placeholder,
        ],
        [
          fromPalette,
          fromPalette,
          [],
          'Select SSH configuration file to update',
        ],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it("F-5102 AC-12, AC-15 (plus-input): the plus and its menu entry open the input of the companion's own palette command at once, with its title, placeholder and an empty value", async () => {
    sshFile('config', ['Host user-one']);
    const window = await viewWindow('group-plus');
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      await rowAction(window, VIEW, GROUP, PLUS);
      const fromPlus = await pickShown(window);
      await closePick(window);
      await rowMenuAction(window, VIEW, GROUP, PLUS);
      const fromMenu = await pickShown(window);
      await closePick(window);
      await paletteRun(window, 'Remote-SSH: Add New SSH Host...');
      const fromPalette = await pickShown(window);
      await closePick(window);
      deepStrictEqual(
        [
          fromPlus,
          fromMenu,
          await notifications(window),
          [fromPalette.title, fromPalette.placeholder, fromPalette.value],
        ],
        [
          fromPalette,
          fromPalette,
          [],
          ['Enter SSH Connection Command', 'E.g. ssh hello@example.com -A', ''],
        ],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-19 (cancelled): Escape on the picker and on the input, and Enter on an empty input, create and change no file, show no notification and leave the host list as it was', async () => {
    const window = await viewWindow('group-cancel');
    try {
      await listing(window, systemHosts());
      const before = await hostLabels(window);
      await rowAction(window, VIEW, GROUP, GEAR);
      await pickShown(window);
      await closePick(window);
      await rowAction(window, VIEW, GROUP, PLUS);
      await pickShown(window);
      await closePick(window);
      await rowAction(window, VIEW, GROUP, PLUS);
      await pickShown(window);
      await answerInputBox(window, '');
      await new Promise(resolve => setTimeout(resolve, 3_000));
      deepStrictEqual(
        [
          existsSync(path.join(sshFolder(), 'config')),
          await notifications(window),
          await hostLabels(window),
        ],
        [false, [], before],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-24 (missing-file): a configFile naming a missing file leaves the SSH row expanded with no child and no notification, and both buttons offered', async () => {
    const missing = path.join(sshFolder(), 'missing.conf');
    await userSettings({'remote.SSH.configFile': missing});
    const window = await viewWindow('group-missing');
    try {
      await listing(window, []);
      deepStrictEqual(
        [
          (await viewRows(window, VIEW))?.find(each => each.label === GROUP)
            ?.expanded,
          await notifications(window),
          await rowActionTitles(window, VIEW, GROUP),
          existsSync(missing),
        ],
        [true, [], [GEAR, PLUS], false],
      );
    } finally {
      await closeWindow(window);
    }
  });

  it('F-5102 AC-44 (custom-picker): with a configFile the picker has the placeholder of a custom file and exactly the custom path, Settings and Help', async () => {
    const custom = sshFile('custom.conf', ['Host custom-one']);
    await userSettings({'remote.SSH.configFile': custom});
    const window = await viewWindow('group-custom');
    try {
      await listing(window, ['custom-one']);
      await rowAction(window, VIEW, GROUP, GEAR);
      const shown = await pickShown(window);
      await closePick(window);
      deepStrictEqual(
        [shown.placeholder, shown.rows, readFileSync(custom, 'utf8')],
        [
          'Edit custom SSH configuration file',
          [
            custom,
            'Settings | specify a custom configuration file',
            'Help | about SSH configuration files',
          ],
          'Host custom-one\n',
        ],
      );
    } finally {
      await closeWindow(window);
    }
  });
});
