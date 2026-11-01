import {deepStrictEqual} from 'node:assert';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import {
  isOpen,
  windowNames,
  containersLog,
  containersLogSince,
  inWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {activations} from '../windows/folder-windows.ts';
import {
  acceptQuickPick,
  dialogOf,
  editorTabs,
  notificationCentre,
  pressControlAlt,
  pageText,
  pressEscape,
  pressQuickPickBack,
  pressQuickPickOk,
  pressQuickPickTitleButton,
  quickPickChecks,
  quickPickChrome,
  quickPickFacts,
  quickPickOf,
  quickPickRows,
  detailedQuickPickRows,
  toggleQuickPickRow,
  typeInFocus,
  typeInQuickPick,
} from '../windows/renderer.ts';
import {
  BOOLEAN_SCREEN,
  chooseWorkspace,
  FEATURES_PLACEHOLDER,
  screenWith,
  startCommand,
  startedWith,
  STRING_SCREENS,
  takenThrough,
  withWindow,
} from '../windows/authoring-support.ts';

/** The windows that are open now. */
function openWindows(): string[] {
  return windowNames().filter(isOpen).sort();
}

const OPTIONAL_PLACEHOLDER = 'Include the following optional files/directories';

const NOTICE_START = 'Folder contains a Dev Container configuration file.';

const BASE = '.devcontainer/devcontainer.json';

const ALL_OPTIONAL = ['alpha.txt', 'docs/a.md', 'docs/sub/b.md', 'zeta.txt'];

/** Runs the wizard on the options-lab template, takes every option screen, and confirms Select Features with Finish. */
async function toOptionalScreen(window: string): Promise<void> {
  await startedWith(window, 'options-lab');
  await takenThrough(window, STRING_SCREENS);
  await screenWith(window, BOOLEAN_SCREEN);
  await pressQuickPickOk(window);
  await screenWith(window, FEATURES_PLACEHOLDER);
  await pressQuickPickTitleButton(window, 'Finish');
  await screenWith(window, OPTIONAL_PLACEHOLDER);
}

/** The files under `folder`, relative and sorted. */
function filesIn(folder: string): string[] {
  return readdirSync(folder, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile())
    .map(entry =>
      path.relative(folder, path.join(entry.parentPath, entry.name)),
    )
    .sort();
}

/** Waits until the wizard has ended, which its notification shows, and gives the files it wrote. */
async function writtenFiles(window: string, folder: string): Promise<string[]> {
  await waitFor(
    'the reopen notification',
    async () =>
      (await notificationCentre(window)).some(text =>
        text.startsWith(NOTICE_START),
      ),
    60_000,
  );
  return filesIn(folder);
}

describe('Optional Files/Directories in the wizard (card containers-90)', function () {
  this.timeout(600_000);

  it('F-0805 AC-1, AC-2, F-0802 AC-8 (screen): after Select Features comes the screen with its title and placeholder, a count of 0 Selected, no focused item, Back as its one title button and OK, and the entries as the template names them, in its order, with nothing besides the label', async () => {
    await withWindow('o90-screen', {}, async window => {
      await toOptionalScreen(window);
      await waitFor(
        'the rows to be drawn',
        async () => {
          const drawn = await detailedQuickPickRows(window);
          return drawn.length === 3 && drawn.every(each => each.detail === '');
        },
        15_000,
      );
      const rows = await detailedQuickPickRows(window);
      deepStrictEqual(
        [
          await quickPickFacts(window),
          await quickPickChrome(window),
          rows.map(each => [
            each.label,
            each.description,
            each.detail,
            each.icons,
            each.focused,
          ]),
        ],
        [
          {
            title: 'Optional Files/Directories',
            placeholder: OPTIONAL_PLACEHOLDER,
            titleButtons: ['Back (Ctrl+Alt+-)'],
            multiSelect: true,
          },
          {counter: '0 Selected', okShown: true},
          [
            ['zeta.txt', '', '', [], false],
            ['docs/*', '', '', [], false],
            ['alpha.txt', '', '', [], false],
          ],
        ],
      );
    });
  });

  it('F-0805 AC-3 (counter): toggling one item and then a second reads 1 Selected and then 2 Selected, with the items otherwise as they were', async () => {
    await withWindow('o90-counter', {}, async window => {
      await toOptionalScreen(window);
      const seen = [];
      for (const label of ['zeta.txt', 'alpha.txt']) {
        await toggleQuickPickRow(window, label);
        await new Promise(resolve => setTimeout(resolve, 500));
        seen.push([
          (await quickPickChrome(window)).counter,
          (await detailedQuickPickRows(window)).map(each => each.label),
        ]);
      }
      deepStrictEqual(seen, [
        ['1 Selected', ['zeta.txt', 'docs/*', 'alpha.txt']],
        ['2 Selected', ['zeta.txt', 'docs/*', 'alpha.txt']],
      ]);
    });
  });

  it('F-0805 AC-4 (one-checked): alpha.txt checked and OK writes it and the base configuration, not docs/ or zeta.txt, ends the wizard with no further screen, opens devcontainer.json in a preview of the same window and shows the reopen notification', async () => {
    await withWindow('o90-one', {}, async (window, folder) => {
      await toOptionalScreen(window);
      await toggleQuickPickRow(window, 'alpha.txt');
      const windows = openWindows();
      const before = activations(window);
      await pressQuickPickOk(window);
      const files = await writtenFiles(window, folder);
      deepStrictEqual(
        [
          files,
          (await editorTabs(window)).find(each => each.label === 'devcontainer')
            ?.preview,
          await quickPickOf(window),
          await dialogOf(window),
          openWindows(),
          activations(window),
        ],
        [
          [BASE, 'alpha.txt'].sort(),
          true,
          undefined,
          undefined,
          windows,
          before,
        ],
      );
    });
  });

  it('F-0805 AC-5 (none-checked): OK with nothing checked writes only the base configuration, shows no error, and the reopen notification still shows', async () => {
    await withWindow('o90-none', {}, async (window, folder) => {
      await toOptionalScreen(window);
      await pressQuickPickOk(window);
      deepStrictEqual(
        [await writtenFiles(window, folder), await dialogOf(window)],
        [[BASE], undefined],
      );
    });
  });

  it('F-0805 AC-6 (boilerplate): with every entry checked, README.md, NOTES.md and devcontainer-template.json are not written', async () => {
    await withWindow('o90-boilerplate', {}, async (window, folder) => {
      await toOptionalScreen(window);
      for (const label of ['zeta.txt', 'docs/*', 'alpha.txt']) {
        await toggleQuickPickRow(window, label);
      }
      await pressQuickPickOk(window);
      deepStrictEqual(
        await writtenFiles(window, folder),
        [BASE, ...ALL_OPTIONAL].sort(),
      );
    });
  });

  it('F-0805 AC-9, AC-18 (back): Back by its button and by Ctrl+Alt+- opens Select Features again with its checks intact and writes nothing, and the screen is fresh when reached again', async () => {
    await withWindow('o90-back', {}, async (window, folder) => {
      await startedWith(window, 'options-lab');
      await takenThrough(window, STRING_SCREENS);
      await screenWith(window, BOOLEAN_SCREEN);
      await pressQuickPickOk(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      await toggleQuickPickRow(window, 'Lab Plain');
      const seen = [];
      for (const method of ['button', 'keys'] as const) {
        await pressQuickPickTitleButton(window, 'Finish');
        await screenWith(window, OPTIONAL_PLACEHOLDER);
        await toggleQuickPickRow(window, 'alpha.txt');
        if (method === 'button') {
          await pressQuickPickBack(window);
        } else {
          await pressControlAlt(window, '-');
        }
        await screenWith(window, FEATURES_PLACEHOLDER);
        seen.push((await quickPickChecks(window)).filter(each => each.checked));
        await pressQuickPickTitleButton(window, 'Finish');
        await screenWith(window, OPTIONAL_PLACEHOLDER);
        seen.push((await quickPickChrome(window)).counter);
        await pressQuickPickBack(window);
        await screenWith(window, FEATURES_PLACEHOLDER);
      }
      deepStrictEqual(
        [seen, filesIn(folder)],
        [
          [
            [{label: 'Lab Plain, remote-oss-run', checked: true}],
            '0 Selected',
            [{label: 'Lab Plain, remote-oss-run', checked: true}],
            '0 Selected',
          ],
          [],
        ],
      );
    });
  });

  it('F-0805 AC-10, F-0801 AC-42 (escape-all): Escape on the screen does not cancel: every entry and the base configuration are written, and the reopen notification shows', async () => {
    await withWindow('o90-escape', {}, async (window, folder) => {
      await toOptionalScreen(window);
      await toggleQuickPickRow(window, 'alpha.txt');
      await pressEscape(window);
      deepStrictEqual(
        await writtenFiles(window, folder),
        [BASE, ...ALL_OPTIONAL].sort(),
      );
    });
  });

  it('F-0805 AC-11, F-0802 AC-8 (no-paths): a template with options and no optional file shows no such screen, and the wizard completes after Select Features', async () => {
    await withWindow('o90-paths-free', {}, async (window, folder) => {
      await startedWith(window, 'paths-free-lab');
      await takenThrough(window, ['Size:']);
      await screenWith(window, FEATURES_PLACEHOLDER);
      await pressQuickPickTitleButton(window, 'Finish');
      deepStrictEqual(await writtenFiles(window, folder), [BASE]);
    });
  });

  it('F-0805 AC-12 (no-metadata): a custom id whose published artifact carries no template metadata shows no optional files stage and logs a warning about the missing metadata, and the apply goes on with every file', async () => {
    await withWindow('o90-no-metadata', {}, async (window, folder) => {
      const mark = containersLog().length;
      await startCommand(window);
      await chooseWorkspace(window);
      const templateId = `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/no-metadata-lab`;
      await typeInQuickPick(window, templateId);
      await new Promise(resolve => setTimeout(resolve, 1500));
      await acceptQuickPick(window);
      await takenThrough(window, [FEATURES_PLACEHOLDER]);
      const files = await writtenFiles(window, folder);
      deepStrictEqual(
        [
          files,
          await quickPickOf(window),
          await dialogOf(window),
          containersLogSince(mark).filter(line =>
            line.toLowerCase().includes('metadata'),
          ),
        ],
        [
          [BASE, 'extra/kept.txt'].sort(),
          undefined,
          undefined,
          [
            `the template ${templateId} has no metadata, so every optional file is included`,
          ],
        ],
      );
    });
  });

  it('F-0805 AC-13 (enter): Enter on the screen confirms it with the current selection and no confirmation prompt', async () => {
    await withWindow('o90-enter', {}, async (window, folder) => {
      await toOptionalScreen(window);
      await toggleQuickPickRow(window, 'zeta.txt');
      await acceptQuickPick(window);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const asked = await dialogOf(window);
      deepStrictEqual(
        [await writtenFiles(window, folder), asked],
        [[BASE, 'zeta.txt'].sort(), undefined],
      );
    });
  });

  it('F-0805 AC-15 (palette-escape): opening the Command Palette over the screen and closing it with Escape does not cancel the wizard: every entry is written and devcontainer.json opens in a preview', async () => {
    await withWindow('o90-palette', {}, async (window, folder) => {
      await toOptionalScreen(window);
      await inWindow(window, 'workbench.action.showCommands');
      await new Promise(resolve => setTimeout(resolve, 1500));
      await pressEscape(window);
      const files = await writtenFiles(window, folder);
      deepStrictEqual(
        [
          files,
          (await editorTabs(window)).find(each => each.label === 'devcontainer')
            ?.preview,
        ],
        [[BASE, ...ALL_OPTIONAL].sort(), true],
      );
    });
  });

  it('F-0805 AC-16 (focus-moved): moving the focus into an editor (a new untitled file) and typing into it leaves the screen open with its selection, and OK afterwards finishes with that selection', async () => {
    await withWindow('o90-focus', {}, async (window, folder) => {
      await toOptionalScreen(window);
      await toggleQuickPickRow(window, 'alpha.txt');
      await inWindow(window, 'workbench.action.files.newUntitledFile');
      await new Promise(resolve => setTimeout(resolve, 2000));
      await typeInFocus(window, 'notes');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const stillOpen = [
        (await quickPickOf(window))?.placeholder,
        (await quickPickChrome(window)).counter,
        (await quickPickRows(window)).length,
        (await pageText(window)).includes('notes'),
      ];
      await pressQuickPickOk(window);
      deepStrictEqual(
        [stillOpen, await writtenFiles(window, folder)],
        [
          [OPTIONAL_PLACEHOLDER, '1 Selected', 3, true],
          [BASE, 'alpha.txt'].sort(),
        ],
      );
    });
  });

  it('F-0805 AC-17 (filter): a checked item the filter hides is written on Enter, and with a filter that shows some items and none checked, Enter excludes every entry', async () => {
    const written: string[][] = [];
    for (const [name, checked] of [
      ['o90-filter-hidden', true],
      ['o90-filter-none', false],
    ] as const) {
      await withWindow(name, {}, async (window, folder) => {
        await toOptionalScreen(window);
        if (checked) {
          await toggleQuickPickRow(window, 'alpha.txt');
        }
        await typeInQuickPick(window, checked ? 'docs' : 'zeta');
        await new Promise(resolve => setTimeout(resolve, 1000));
        await acceptQuickPick(window);
        written.push(await writtenFiles(window, folder));
      });
    }
    deepStrictEqual(written, [[BASE, 'alpha.txt'].sort(), [BASE]]);
  });

  it('F-0805 AC-21 (enter-escape): after Select Features was confirmed with Enter, one Escape on the screen finishes the wizard with every entry', async () => {
    await withWindow('o90-escape-enter', {}, async (window, folder) => {
      await startedWith(window, 'options-lab');
      await takenThrough(window, STRING_SCREENS);
      await screenWith(window, BOOLEAN_SCREEN);
      await pressQuickPickOk(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      await acceptQuickPick(window);
      await screenWith(window, OPTIONAL_PLACEHOLDER);
      const counter = (await quickPickChrome(window)).counter;
      await pressEscape(window);
      deepStrictEqual(
        [counter, await writtenFiles(window, folder)],
        ['0 Selected', [BASE, ...ALL_OPTIONAL].sort()],
      );
    });
  });
});
