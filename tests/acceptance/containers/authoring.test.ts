import {deepStrictEqual} from 'node:assert';
import {chmodSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  inWindow,
  nextEmptyWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  acceptQuickPick,
  answerDialog,
  answerFolderDialog,
  cancelFolderDialog,
  chooseQuickPickRow,
  dialogKindOf,
  dialogOf,
  dialogText,
  editorTabs,
  folderDialogOpen,
  moveQuickPickFocus,
  notificationCentre,
  paletteRows,
  pressEscape,
  primaryButtonOf,
  type DetailedQuickPickRow,
  detailedQuickPickRows,
  quickPickOf,
  quickPickValue,
  rememberPage,
  typeInQuickPick,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  ALPINE_OPTION,
  chooseWorkspace,
  CONFIGURATION,
  closeScreen,
  existing,
  startCommand,
  takeFeatureScreen,
  takeOptionScreen,
  withWindow,
  written,
} from '../windows/authoring-support.ts';

const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/** Starts the command in `window` and picks the template labelled `label`. */
async function pickTemplate(window: string, label: string): Promise<void> {
  await startCommand(window);
  await chooseWorkspace(window);
  await chooseQuickPickRow(window, label);
  await takeOptionScreen(window, ALPINE_OPTION);
  await takeFeatureScreen(window);
}

/** The S182 question for an existing configuration, answered `answer`: whether the file stayed the user's. */
async function answeredOverwrite(
  answer: 'Overwrite' | 'Skip' | 'Cancel',
  kept: 'replaced' | 'mine',
): Promise<void> {
  await withWindow(
    `a9-${answer.toLowerCase()}`,
    {[CONFIGURATION]: 'mine'},
    async (window, folder) => {
      await pickTemplate(window, 'Alpine');
      const dialog = await waitForDialog(window);
      const said = await dialogText(window);
      await answerDialog(window, answer);
      await waitFor(
        'the wizard to end',
        async () => (await quickPickOf(window)) === undefined,
        30_000,
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      const text = readFileSync(path.join(folder, CONFIGURATION), 'utf8');
      deepStrictEqual(
        [
          said?.includes(
            "File './.devcontainer/devcontainer.json' already exists, overwrite?",
          ),
          [...dialog.buttons].sort(),
          text === 'mine' ? 'mine' : 'replaced',
        ],
        [true, ['Cancel', 'Overwrite', 'Skip'], kept],
      );
    },
  );
}

/** Opens the screen in `window` and gives its rows, leaving it open. */
async function screenOf(window: string): Promise<DetailedQuickPickRow[]> {
  await startCommand(window);
  await chooseWorkspace(window);
  return detailedQuickPickRows(window);
}

/** Types `text` into the screen of `window` and gives the rows once the list has followed. */
async function typed(
  window: string,
  text: string,
): Promise<DetailedQuickPickRow[]> {
  await typeInQuickPick(window, text);
  await new Promise(resolve => setTimeout(resolve, 1000));
  return detailedQuickPickRows(window);
}

/** The label of the row that has the focus. */
function focusedLabel(
  rows: readonly DetailedQuickPickRow[],
): string | undefined {
  return rows.find(each => each.focused)?.label;
}

/** The label of the row with the focus after the arrow key `key` was pressed in `window`. */
async function focusAfter(
  window: string,
  key: 'ArrowUp' | 'ArrowDown',
): Promise<string | undefined> {
  await moveQuickPickFocus(window, key);
  await new Promise(resolve => setTimeout(resolve, 500));
  return focusedLabel(await detailedQuickPickRows(window));
}

/**
 * Whether the template rows follow F-0802 BR-5: a row shows the `codicon-verified` badge exactly when its description is
 * `devcontainers`, and none has the description `Unknown Publisher` or `community`.
 */
function badgesFollowOwner(rows: readonly DetailedQuickPickRow[]): boolean {
  return rows.every(
    each =>
      each.icons.includes('codicon-verified') ===
        (each.description === 'devcontainers') &&
      each.description !== 'Unknown Publisher' &&
      each.description !== 'community',
  );
}

/** The neutral files of F-0802 BR-14, which alone do not curate the list. */
const NEUTRAL_FILES = {
  'package.json': '{}',
  'requirements.txt': '',
  Gemfile: '',
  'readme.txt': '',
  'README.md': '',
  'data.json': '{}',
  Makefile: '',
  'empty/': '',
  '.git/HEAD': 'ref: refs/heads/main\n',
} as const;

describe('the authoring wizard (card containers-80)', function () {
  this.timeout(600_000);

  before(() => rememberPage('local'));

  it('F-0801 AC-1 (a1): Add Dev Container Configuration Files is in the palette of a local window with a folder', async () => {
    await withWindow('a1', {}, async window => {
      deepStrictEqual(
        (
          await paletteRows(window, 'Add Dev Container Configuration Files')
        ).includes('Dev Containers: Add Dev Container Configuration Files...'),
        true,
      );
    });
  });

  it('F-0801 AC-2 (a2): with no folder open the modal info dialog shows S263 with Cancel then Open Folder (primary), Cancel ends the flow and Open Folder opens the folder dialog', async () => {
    const window = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    await rememberPage(window);
    try {
      await startCommand(window);
      const shown = await waitForDialog(window);
      const said = await dialogText(window);
      const kind = await dialogKindOf(window);
      const primary = await primaryButtonOf(window);
      await answerDialog(window, 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const afterCancel = [await dialogOf(window), await quickPickOf(window)];
      await startCommand(window);
      await waitForDialog(window);
      await answerDialog(window, 'Open Folder');
      await waitFor(
        'the folder dialog',
        () => folderDialogOpen(window),
        30_000,
      );
      await cancelFolderDialog(window);
      deepStrictEqual(
        [
          said?.includes(
            'Open a folder to create the configuration files in first.',
          ),
          shown.message,
          shown.details,
          kind,
          shown.buttons,
          primary,
          afterCancel,
        ],
        [
          true,
          '',
          'Open a folder to create the configuration files in first.',
          'info',
          ['Cancel', 'Open Folder'],
          'Open Folder',
          [undefined, undefined],
        ],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0801 AC-15 (a15): Open Folder, opening a directory, opens it in the same window and the flow does not continue: no picker, notification or error within 60 s', async () => {
    const target = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'authoring',
      'a15-target',
    );
    rmSync(target, {recursive: true, force: true});
    mkdirSync(target, {recursive: true});
    const window = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    await rememberPage(window);
    await startCommand(window);
    await waitForDialog(window);
    await answerDialog(window, 'Open Folder');
    await answerFolderDialog(window, target);
    const opened = path.basename(target);
    try {
      await waitFor(
        'the directory to open in the window',
        async () =>
          (await windowState(opened)).folders.some(
            entry => decodeURIComponent(new URL(entry).pathname) === target,
          ),
        120_000,
      );
      const seen: unknown[] = [];
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        seen.push(
          await quickPickOf(opened),
          await dialogOf(opened),
          ...(await notificationCentre(opened)),
        );
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      deepStrictEqual(
        seen.filter(each => each !== undefined),
        [],
      );
    } finally {
      await closeWindow(opened).catch(() => undefined);
    }
  });

  it('F-0801 AC-4, F-0802 AC-2 (a4): alpine on an empty folder writes the configuration, opens it in a preview and offers the reopen notification', async () => {
    await withWindow('a4', {}, async (window, folder) => {
      await startCommand(window);
      await chooseWorkspace(window);
      await chooseQuickPickRow(window, 'Alpine');
      await takeOptionScreen(window, ALPINE_OPTION);
      await takeFeatureScreen(window);
      await written(path.join(folder, CONFIGURATION));
      await waitFor(
        'the reopen notification',
        async () =>
          (await notificationCentre(window)).some(text =>
            text.startsWith(NOTICE_START),
          ),
        30_000,
      );
      const text = readFileSync(path.join(folder, CONFIGURATION), 'utf8');
      deepStrictEqual(
        [
          text.includes(
            '"image": "mcr.microsoft.com/devcontainers/base:alpine',
          ),
          /Learn More|Show All Templates|Add Dev Container Configuration/.test(
            text,
          ),
          (await editorTabs(window)).find(each => each.label === 'devcontainer')
            ?.preview,
        ],
        [true, false, true],
      );
    });
  });

  it('F-0802 AC-2, AC-3, AC-4 (a-flat): the flat list is the same for an empty folder and for one of neutral files, Learn More first and the templates by name, the verified badge follows the owner, focus starts on the first template and ArrowUp moves it to Learn More', async () => {
    const lists: string[][] = [];
    const first: Array<[boolean, string | undefined, string | undefined]> = [];
    for (const [name, contents] of [
      ['a-flat-empty', {}],
      ['a-flat-neutral', NEUTRAL_FILES],
    ] as const) {
      await withWindow(name, contents, async window => {
        const rows = await screenOf(window);
        const labels = rows.map(each => each.label);
        lists.push(labels);
        const templates = labels.slice(1);
        first.push([
          labels[0] === 'Learn More' &&
            rows[0]?.description ===
              'Documentation on predefined container templates' &&
            templates.every(
              (label, index) =>
                index === 0 ||
                (templates[index - 1] ?? '').localeCompare(label) <= 0,
            ) &&
            badgesFollowOwner(rows),
          focusedLabel(rows),
          await focusAfter(window, 'ArrowUp'),
        ]);
        await closeScreen(window);
      });
    }
    deepStrictEqual(
      [lists[0], first],
      [
        lists[1],
        [
          [true, lists[0]?.[1], 'Learn More'],
          [true, lists[0]?.[1], 'Learn More'],
        ],
      ],
    );
  });

  it('F-0802 AC-3, AC-4 (a-curated): the curated list has the verified badge by owner, focus starts on the first template, and ArrowUp reaches Learn More and then Show All Templates', async () => {
    await withWindow('a-curated', {'main.py': 'print(1)\n'}, async window => {
      const rows = await screenOf(window);
      const labels = rows.map(each => each.label);
      const initial = focusedLabel(rows);
      const afterFirst = await focusAfter(window, 'ArrowUp');
      const afterSecond = await focusAfter(window, 'ArrowUp');
      await chooseQuickPickRow(window, 'Show All Templates...');
      await waitFor(
        'the whole list',
        async () =>
          (await detailedQuickPickRows(window)).every(
            each => each.label !== 'Show All Templates...',
          ),
        10_000,
      );
      const all = (await detailedQuickPickRows(window)).map(each => each.label);
      await closeScreen(window);
      deepStrictEqual(
        [
          labels.slice(0, 2),
          badgesFollowOwner(rows),
          initial,
          afterFirst,
          afterSecond,
          [all.includes('Show All Templates...'), all[0]],
        ],
        [
          ['Show All Templates...', 'Learn More'],
          true,
          labels[2],
          'Learn More',
          'Show All Templates...',
          [false, 'Learn More'],
        ],
      );
    });
  });

  it('F-0802 AC-9, AC-10 (a-custom-mode): two slashes leave only the custom item and the fixed rows, with the exact detail; a bare word or one slash does not', async () => {
    const custom = "Use 'a/alpine/c' as template...";
    const seen: unknown[] = [];
    for (const [name, contents, fixed] of [
      ['a-mode-flat', {}, ['Learn More']],
      [
        'a-mode-curated',
        {'main.py': ''},
        ['Learn More', 'Show All Templates...'],
      ],
    ] as const) {
      await withWindow(name, contents, async window => {
        await screenOf(window);
        const rows = await typed(window, 'a/alpine/c');
        seen.push(
          rows.map(each => each.label).toSorted(),
          rows.find(each => each.label === custom)?.detail,
          fixed.toSorted(),
        );
        const bare = await typed(window, 'alpine');
        const single = await typed(window, 'a/alpine');
        seen.push(
          bare.some(each => each.label === 'Alpine'),
          [...bare, ...single].some(each => each.label.startsWith("Use '")),
        );
        await closeScreen(window);
      });
    }
    const expected: unknown[] = [];
    for (const fixed of [
      ['Learn More'],
      ['Learn More', 'Show All Templates...'],
    ]) {
      expected.push(
        [custom, ...fixed].toSorted(),
        'Apply this custom template instead of one of the listed templates.',
        fixed.toSorted(),
        true,
        false,
      );
    }
    deepStrictEqual(seen, expected);
  });

  it('F-0801 AC-9 (a9-overwrite): an existing configuration file is asked about, and Overwrite leaves it replaced', async () => {
    await answeredOverwrite('Overwrite', 'replaced');
  });

  it('F-0801 AC-9 (a9-skip): an existing configuration file is asked about, and Skip leaves it mine', async () => {
    await answeredOverwrite('Skip', 'mine');
  });

  it('F-0801 AC-9 (a9-cancel): an existing configuration file is asked about, and Cancel leaves it mine', async () => {
    await answeredOverwrite('Cancel', 'mine');
  });

  it('F-0801 AC-24 (a24): a root .devcontainer.json is left byte for byte, no dialog is shown for it, and the new configuration is written beside it', async () => {
    await withWindow(
      'a24',
      {'.devcontainer.json': 'dot'},
      async (window, folder) => {
        await pickTemplate(window, 'Alpine');
        await written(path.join(folder, CONFIGURATION));
        await new Promise(resolve => setTimeout(resolve, 2000));
        deepStrictEqual(
          [
            readFileSync(path.join(folder, '.devcontainer.json'), 'utf8'),
            await dialogOf(window),
          ],
          ['dot', undefined],
        );
      },
    );
  });

  it('F-0801 AC-38 (a38): with Overwrite on the configuration, the template output replaces it and the Dockerfile, the other file of .devcontainer and .github/dependabot.yml stay byte for byte, with no prompt about them', async () => {
    const others = {
      '.devcontainer/Dockerfile': 'FROM alpine\n',
      '.devcontainer/notes.txt': 'notes',
      '.github/dependabot.yml': 'version: 2\n',
    } as const;
    await withWindow(
      'a38',
      {[CONFIGURATION]: 'mine', ...others},
      async (window, folder) => {
        await pickTemplate(window, 'Alpine');
        const question = await dialogText(
          await waitForDialog(window).then(() => window),
        );
        await answerDialog(window, 'Overwrite');
        await waitFor(
          'the configuration to be replaced',
          () =>
            readFileSync(path.join(folder, CONFIGURATION), 'utf8') !== 'mine',
          60_000,
        );
        await new Promise(resolve => setTimeout(resolve, 2000));
        deepStrictEqual(
          [
            question?.includes("'./.devcontainer/devcontainer.json'"),
            readFileSync(path.join(folder, CONFIGURATION), 'utf8').includes(
              'base:alpine',
            ),
            ['Dockerfile', 'notes', 'dependabot'].some(name =>
              question?.includes(name),
            ),
            Object.entries(others).map(
              ([relative, text]) =>
                readFileSync(path.join(folder, relative), 'utf8') === text,
            ),
            await dialogOf(window),
          ],
          [true, true, false, [true, true, true], undefined],
        );
      },
    );
  });

  it('F-0801 AC-37 (a37): a configuration in a subfolder of .devcontainer is left alone and the new one is written beside it with no dialog', async () => {
    await withWindow(
      'a37',
      {'.devcontainer/a/devcontainer.json': '{}'},
      async (window, folder) => {
        await pickTemplate(window, 'Alpine');
        await written(path.join(folder, CONFIGURATION));
        await new Promise(resolve => setTimeout(resolve, 2000));
        deepStrictEqual(
          [
            readFileSync(
              path.join(folder, '.devcontainer/a/devcontainer.json'),
              'utf8',
            ),
            await dialogOf(window),
          ],
          ['{}', undefined],
        );
      },
    );
  });

  it('F-0801 AC-30 (a30-file): a .devcontainer that is a file fails the write with a modal of ours naming the folder, writes nothing, and the command writes normally once the file is gone', async () => {
    await withWindow(
      'a30-file',
      {'.devcontainer': 'a file'},
      async (window, folder) => {
        await pickTemplate(window, 'Alpine');
        await waitForDialog(window);
        const said = await dialogText(window);
        await pressEscape(window);
        const kept = readFileSync(path.join(folder, '.devcontainer'), 'utf8');
        rmSync(path.join(folder, '.devcontainer'));
        await pickTemplate(window, 'Alpine');
        await written(path.join(folder, CONFIGURATION));
        deepStrictEqual(
          [
            said?.includes("The configuration couldn't be written to "),
            said?.includes(folder),
            kept,
          ],
          [true, true, 'a file'],
        );
      },
    );
  });

  it('F-0801 AC-30 (a30-readonly): a folder that cannot be written fails the write with a modal of ours naming the folder, writes nothing, and the command writes normally once the cause is fixed', async () => {
    await withWindow('a30-readonly', {}, async (window, folder) => {
      chmodSync(folder, 0o555);
      try {
        await pickTemplate(window, 'Alpine');
        await waitForDialog(window);
        const said = await dialogText(window);
        await pressEscape(window);
        const created = existing(folder, '.devcontainer');
        chmodSync(folder, 0o755);
        await pickTemplate(window, 'Alpine');
        await written(path.join(folder, CONFIGURATION));
        deepStrictEqual(
          [
            said?.includes("The configuration couldn't be written to "),
            said?.includes(folder),
            created,
          ],
          [true, true, []],
        );
      } finally {
        chmodSync(folder, 0o755);
      }
    });
  });

  it('F-0802 AC-18 (r-31): Learn More ends the wizard with nothing written', async () => {
    await withWindow('a18', {}, async (window, folder) => {
      await startCommand(window);
      await chooseWorkspace(window);
      await chooseQuickPickRow(window, 'Learn More');
      await waitFor(
        'the pick to close',
        async () => (await quickPickOf(window)) === undefined,
        30_000,
      );
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(existing(folder, '.devcontainer'), []);
    });
  });

  it('F-0802 AC-19 (a19): Escape on the pick writes nothing', async () => {
    await withWindow('a19', {}, async (window, folder) => {
      await screenOf(window);
      await closeScreen(window);
      deepStrictEqual(existing(folder, '.devcontainer'), []);
    });
  });

  it('F-0802 AC-11 (a-custom): a custom template id of two slashes is written from the run’s own registry', async () => {
    await withWindow('a-custom', {}, async (window, folder) => {
      await screenOf(window);
      await typeInQuickPick(
        window,
        `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/mini`,
      );
      await waitFor(
        'the custom row',
        async () =>
          (await detailedQuickPickRows(window)).some(each =>
            each.label.startsWith("Use '"),
          ),
        10_000,
      );
      await acceptQuickPick(window);
      await takeOptionScreen(window, 'Greeting:');
      await takeFeatureScreen(window);
      await written(path.join(folder, CONFIGURATION));
    });
  });

  it('F-0802 AC-12, AC-13 (a-missing): a custom template id the registry lacks shows the failure with Cancel and Show Log, and Cancel closes it with the window as it was, nothing written and no notification left', async () => {
    await withWindow('a-missing', {}, async (window, folder) => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const tabsBefore = await editorTabs(window);
      await screenOf(window);
      await typeInQuickPick(
        window,
        `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/absent`,
      );
      await waitFor(
        'the custom row',
        async () =>
          (await detailedQuickPickRows(window)).some(each =>
            each.label.startsWith("Use '"),
          ),
        10_000,
      );
      await acceptQuickPick(window);
      await takeFeatureScreen(window, false);
      const dialog = await waitForDialog(window, 120_000);
      const said = await dialogText(window);
      const kind = await dialogKindOf(window);
      await answerDialog(window, 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        [
          said?.includes('Application of the template failed.'),
          kind,
          dialog.buttons,
          await dialogOf(window),
          await quickPickOf(window),
          await notificationCentre(window),
          await editorTabs(window),
          existing(folder, '.devcontainer'),
        ],
        [
          true,
          'error',
          ['Cancel', 'Show Log'],
          undefined,
          undefined,
          [],
          tabsBefore,
          [],
        ],
      );
    });
  });

  it('F-0802 AC-22 (a22): a folder with a Dockerfile starts at the chooser, and the entry it names is what the written configuration builds', async () => {
    await withWindow(
      'a22',
      {'api.Dockerfile': 'FROM alpine\n'},
      async (window, folder) => {
        const rows = (await screenOf(window)).map(each => each.label);
        await chooseQuickPickRow(window, "From 'api.Dockerfile'");
        await takeFeatureScreen(window);
        await written(path.join(folder, CONFIGURATION));
        const text = readFileSync(path.join(folder, CONFIGURATION), 'utf8');
        deepStrictEqual(
          [
            rows.includes("From 'api.Dockerfile'"),
            text.includes('"dockerfile": "../api.Dockerfile"'),
          ],
          [true, true],
        );
      },
    );
  });

  it('F-0802 AC-31 (a31): a screen that was typed into and had a row focused, then closed, starts again empty with the first item focused, for the template screen and for the chooser', async () => {
    const seen: unknown[] = [];
    for (const [name, contents] of [
      ['a31-flat', {}],
      ['a31-chooser', {Dockerfile: 'FROM alpine\n'}],
    ] as const) {
      await withWindow(name, contents, async window => {
        const rows = await screenOf(window);
        await typed(window, 'zzz');
        await typed(window, '');
        await moveQuickPickFocus(window, 'ArrowDown');
        await closeScreen(window);
        const again = await screenOf(window);
        seen.push([
          await quickPickValue(window),
          focusedLabel(again),
          focusedLabel(rows),
        ]);
        await closeScreen(window);
      });
    }
    deepStrictEqual(
      seen.map(
        each =>
          (each as string[])[0] === '' &&
          (each as string[])[1] === (each as string[])[2],
      ),
      [true, true],
    );
  });
});
