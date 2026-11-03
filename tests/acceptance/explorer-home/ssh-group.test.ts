/**
 * @fileoverview The "SSH" group's two hand-overs to Remote - SSH (card coverage-102, #1809, part 2): the buttons and
 * menu of the row, and the picker and the input that open from them, which are the ones the companion's own palette
 * commands open. The launch shows the extension's real pickers, and its HOME is the run's own.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
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
  waitFor,
} from '../windows/harness.ts';
import {
  answerInputBox,
  clickRowLabel,
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

/** Waits until the SSH row is drawn: a group with no host has no listing to wait for. */
async function groupDrawn(window: string): Promise<void> {
  await waitFor(
    `window ${window} to draw the ${GROUP} row`,
    async () =>
      ((await viewRows(window, VIEW)) ?? []).some(each => each.label === GROUP),
    30_000,
  );
}

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

  it('F-5102 AC-1 (inline-buttons): an idle SSH row shows no button, and a hovered one, and a selected and focused one with the mouse away, show the gear and then the plus', async () => {
    sshFile('config', ['Host user-one']);
    const window = await viewWindow('group-buttons');
    try {
      await listing(window, ['user-one', ...systemHosts()]);
      await hoverRow(window, VIEW, undefined);
      const idle = await shownRowActionTitles(window, VIEW, GROUP);
      await hoverRow(window, VIEW, GROUP);
      const hovered = await shownRowActionTitles(window, VIEW, GROUP);
      await clickRowLabel(window, VIEW, GROUP);
      await hoverRow(window, VIEW, undefined);
      deepStrictEqual(
        [
          idle,
          hovered,
          await shownRowActionTitles(window, VIEW, GROUP),
          await rowActionTitles(window, VIEW, GROUP),
        ],
        [[], [GEAR, PLUS], [GEAR, PLUS], [GEAR, PLUS]],
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

  it('F-5102 AC-3 (no-palette): the Command Palette lists neither command of the group, by title', async () => {
    const window = await viewWindow('group-palette');
    try {
      const listed = (
        await Promise.all([GEAR, PLUS].map(text => paletteRows(window, text)))
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

  it("F-5102 AC-10 (gear-picker): the gear and its menu entry open the picker of the companion's own palette command at once, and nothing else is shown", async () => {
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

  it("F-5102 AC-12 (plus-input): the plus and its menu entry open the input of the companion's own palette command at once, with its title, placeholder and an empty value", async () => {
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

  it('F-5102 AC-19 (cancelled): Escape on the picker, on the input and on the file pick after a valid command, and Enter on an empty input, create and change no file, show no notification and leave the host list as it was', async () => {
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
      await answerInputBox(window, 'ssh cancelled-one');
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

  it('F-5102 AC-24 (empty-or-missing-file): a configFile naming a missing or an empty file leaves the SSH row expanded with no child and no notification, and both buttons offered', async () => {
    const missing = path.join(sshFolder(), 'missing.conf');
    const empty = sshFile('empty.conf', []);
    writeFileSync(empty, '');
    const seen: unknown[] = [];
    for (const [index, file] of [missing, empty].entries()) {
      await userSettings({'remote.SSH.configFile': file});
      const window = await viewWindow(`group-empty-${String(index)}`);
      try {
        await groupDrawn(window);
        seen.push([
          await hostLabels(window),
          (await viewRows(window, VIEW))?.find(each => each.label === GROUP)
            ?.expanded,
          await notifications(window),
          await rowActionTitles(window, VIEW, GROUP),
        ]);
      } finally {
        await closeWindow(window);
      }
    }
    deepStrictEqual(seen, [
      [[], true, [], [GEAR, PLUS]],
      [[], true, [], [GEAR, PLUS]],
    ]);
  });

  it('F-5102 AC-44 (custom-picker): with a configFile, existing or missing, the picker has the placeholder of a custom file and exactly the custom path, Settings and Help', async () => {
    const existing = sshFile('custom.conf', ['Host custom-one']);
    const missing = path.join(sshFolder(), 'custom-missing.conf');
    const seen: unknown[] = [];
    for (const [index, file] of [existing, missing].entries()) {
      await userSettings({'remote.SSH.configFile': file});
      const window = await viewWindow(`group-custom-${String(index)}`);
      try {
        await groupDrawn(window);
        await rowAction(window, VIEW, GROUP, GEAR);
        const shown = await pickShown(window);
        await closePick(window);
        seen.push([shown.placeholder, shown.rows]);
      } finally {
        await closeWindow(window);
      }
    }
    function offered(file: string): unknown[] {
      return [
        'Edit custom SSH configuration file',
        [
          file,
          'Settings | specify a custom configuration file',
          'Help | about SSH configuration files',
        ],
      ];
    }
    deepStrictEqual(
      [seen, existsSync(missing), readFileSync(existing, 'utf8')],
      [[offered(existing), offered(missing)], false, 'Host custom-one\n'],
    );
  });
});
