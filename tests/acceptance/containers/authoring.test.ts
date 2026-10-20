import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {
  acceptQuickPick,
  answerDialog,
  cancelFolderDialog,
  chooseQuickPickItem,
  chooseQuickPickRow,
  dialogText,
  editorTabs,
  folderDialogOpen,
  notificationCentre,
  paletteRows,
  pressEscape,
  quickPickOf,
  quickPickRows,
  typeInQuickPick,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {runTemplatesReady} from '../windows/run-templates.ts';

const COMMAND = 'remote-containers.createDevContainerFile';

const NOTICE_START = 'Folder contains a Dev Container configuration file.';

const CONFIGURATION = '.devcontainer/devcontainer.json';

/** The folder of the row `name` with the files `contents` names, made empty first, and the window on it. */
async function windowWith(
  name: string,
  contents: Readonly<Record<string, string>> = {},
): Promise<{window: string; folder: string}> {
  await runTemplatesReady();
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'authoring', name);
  rmSync(folder, {recursive: true, force: true});
  mkdirSync(folder, {recursive: true});
  for (const [relative, text] of Object.entries(contents)) {
    const file = path.join(folder, relative);
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(file, text);
  }
  return {window: await openFolderWindow(folder), folder};
}

/** Runs the command in `window` without waiting for it, which ends only when the wizard does. */
function startCommand(window: string): void {
  inWindow(window, COMMAND).catch(() => undefined);
}

/** Runs `body` over a window with the files, and closes the window after. */
async function withWindow(
  name: string,
  contents: Readonly<Record<string, string>>,
  body: (window: string, folder: string) => Promise<void>,
): Promise<void> {
  const {window, folder} = await windowWith(name, contents);
  try {
    await body(window, folder);
  } finally {
    await closeWindow(window).catch(() => undefined);
  }
}

/** Starts the command in `window` and picks the template labelled `label`. */
async function pickTemplate(window: string, label: string): Promise<void> {
  startCommand(window);
  await waitForQuickPick(window);
  await chooseQuickPickRow(window, label);
}

/** Waits until `file` exists. */
function written(file: string): Promise<void> {
  return waitFor(`${file} to be written`, () => existsSync(file), 60_000);
}

/** The files named `relatives` under `folder`, those that exist. */
function existing(folder: string, ...relatives: string[]): string[] {
  return relatives.filter(relative => existsSync(path.join(folder, relative)));
}

describe('the authoring wizard (card containers-80)', function () {
  this.timeout(600_000);

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

  it('F-0801 AC-2, AC-15 (a2): with no folder open the modal asks for one, Cancel does nothing and Open Folder opens the folder dialog', async () => {
    startCommand('local');
    const shown = await waitForDialog('local');
    const text = await dialogText('local');
    await answerDialog('local', 'Cancel');
    startCommand('local');
    await waitForDialog('local');
    await answerDialog('local', 'Open Folder');
    await waitFor('the folder dialog', () => folderDialogOpen('local'), 30_000);
    await cancelFolderDialog('local');
    deepStrictEqual(
      [
        text?.includes(
          'Open a folder to create the configuration files in first.',
        ),
        [...shown.buttons].sort(),
      ],
      [true, ['Cancel', 'Open Folder']],
    );
  });

  it('F-0801 AC-4, F-0802 AC-2 (a4): alpine on an empty folder shows the flat screen, writes the configuration, opens it in a preview and offers the reopen notification', async () => {
    await withWindow('a4', {}, async (window, folder) => {
      startCommand(window);
      const shown = await waitForQuickPick(window);
      await chooseQuickPickItem(window, 'Alpine');
      await written(path.join(folder, CONFIGURATION));
      await waitFor(
        'the reopen notification',
        async () =>
          (await notificationCentre(window)).some(text =>
            text.startsWith(NOTICE_START),
          ),
        30_000,
      );
      deepStrictEqual(
        [
          shown.items.slice(0, 2),
          readFileSync(path.join(folder, CONFIGURATION), 'utf8').includes(
            '"image": "mcr.microsoft.com/devcontainers/base:alpine',
          ),
          (await editorTabs(window)).find(each => each.label === 'devcontainer')
            ?.preview,
        ],
        [['Learn More', 'Alpine'], true, true],
      );
    });
  });

  it('F-0802 AC-3, AC-4 (a-flat): the flat screen lists Learn More first and the templates by name, with the first template focused', async () => {
    await withWindow('a-flat', {}, async window => {
      startCommand(window);
      await waitForQuickPick(window);
      const rows = await quickPickRows(window);
      await pressEscape(window);
      const names = rows.slice(1).map(each => each.label);
      deepStrictEqual(
        [
          rows[0]?.label,
          names,
          names.toSorted((left, right) => left.localeCompare(right)),
          rows.findIndex(each => each.focused),
        ],
        ['Learn More', names, names, 1],
      );
    });
  });

  for (const [answer, kept] of [
    ['Overwrite', 'replaced'],
    ['Skip', 'mine'],
    ['Cancel', 'mine'],
  ] as const) {
    it(`F-0801 AC-9 (a9-${answer.toLowerCase()}): an existing configuration file is asked about, and ${answer} leaves it ${kept}`, async () => {
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
    });
  }

  it('F-0801 AC-24, AC-38 (a24): a dotfile configuration and the other files of the folder are left alone', async () => {
    await withWindow(
      'a24',
      {'.devcontainer.json': 'dot', 'src/main.txt': 'main'},
      async (window, folder) => {
        await pickTemplate(window, 'Alpine');
        await written(path.join(folder, CONFIGURATION));
        deepStrictEqual(
          [
            readFileSync(path.join(folder, '.devcontainer.json'), 'utf8'),
            readFileSync(path.join(folder, 'src/main.txt'), 'utf8'),
          ],
          ['dot', 'main'],
        );
      },
    );
  });

  it('F-0801 AC-37 (a37): a configuration in a subfolder of .devcontainer is left alone and the new one is written beside it', async () => {
    await withWindow(
      'a37',
      {'.devcontainer/sub/devcontainer.json': '{}'},
      async (window, folder) => {
        await pickTemplate(window, 'Alpine');
        await written(path.join(folder, CONFIGURATION));
        deepStrictEqual(
          readFileSync(
            path.join(folder, '.devcontainer/sub/devcontainer.json'),
            'utf8',
          ),
          '{}',
        );
      },
    );
  });

  it('F-0801 AC-30 (a30-file): a .devcontainer that is a file fails the write with a modal of ours and writes nothing', async () => {
    await withWindow(
      'a30-file',
      {'.devcontainer': 'a file'},
      async (window, folder) => {
        await pickTemplate(window, 'Alpine');
        await waitForDialog(window);
        const said = await dialogText(window);
        await pressEscape(window);
        deepStrictEqual(
          [
            said?.includes("The configuration couldn't be written to "),
            readFileSync(path.join(folder, '.devcontainer'), 'utf8'),
          ],
          [true, 'a file'],
        );
      },
    );
  });

  it('F-0802 AC-18 (a18): Learn More ends the wizard with nothing written', async () => {
    await withWindow('a18', {}, async (window, folder) => {
      await pickTemplate(window, 'Learn More');
      await waitFor(
        'the pick to close',
        async () => (await quickPickOf(window)) === undefined,
        30_000,
      ).catch(async (caught: unknown) => {
        throw new Error(
          `${String(caught)}; pick ${JSON.stringify(await quickPickOf(window))}; dialog ${JSON.stringify(await dialogText(window))}`,
          {cause: caught},
        );
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(existing(folder, '.devcontainer'), []);
    });
  });

  it('F-0802 AC-19 (a19): Escape on the pick writes nothing', async () => {
    await withWindow('a19', {}, async (window, folder) => {
      startCommand(window);
      await waitForQuickPick(window);
      await pressEscape(window);
      await waitFor(
        'the pick to close',
        async () => (await quickPickOf(window)) === undefined,
        10_000,
      );
      deepStrictEqual(existing(folder, '.devcontainer'), []);
    });
  });

  it('F-0802 AC-9, AC-10 (a-custom): a custom template id of two slashes is written from the run’s own registry', async () => {
    await withWindow('a-custom', {}, async (window, folder) => {
      startCommand(window);
      await waitForQuickPick(window);
      await typeInQuickPick(
        window,
        `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/mini`,
      );
      await waitFor(
        'the custom row',
        async () =>
          (await quickPickRows(window)).some(each =>
            each.label.startsWith("Use '"),
          ),
        10_000,
      );
      await acceptQuickPick(window);
      await written(path.join(folder, CONFIGURATION));
    });
  });

  it('F-0802 AC-12, AC-13 (a-missing): a custom template id the registry lacks shows the failure with Cancel and Show Log and writes nothing', async () => {
    await withWindow('a-missing', {}, async (window, folder) => {
      startCommand(window);
      await waitForQuickPick(window);
      await typeInQuickPick(
        window,
        `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/absent`,
      );
      await waitFor(
        'the custom row',
        async () =>
          (await quickPickRows(window)).some(each =>
            each.label.startsWith("Use '"),
          ),
        10_000,
      );
      await acceptQuickPick(window);
      const dialog = await waitForDialog(window, 120_000);
      const said = await dialogText(window);
      await answerDialog(window, 'Cancel');
      deepStrictEqual(
        [
          said?.includes('Application of the template failed.'),
          [...dialog.buttons].sort(),
          existing(folder, '.devcontainer'),
        ],
        [true, ['Cancel', 'Show Log'], []],
      );
    });
  });

  it('F-0802 AC-22 (a22): a folder with a Dockerfile starts at the chooser, and the entry it names is what the written configuration builds', async () => {
    await withWindow(
      'a22',
      {'api.Dockerfile': 'FROM alpine\n'},
      async (window, folder) => {
        startCommand(window);
        await waitForQuickPick(window);
        const rows = (await quickPickRows(window)).map(each => each.label);
        await chooseQuickPickItem(window, "From 'api.Dockerfile'");
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

  it('F-0802 AC-24, AC-26 (a-curated): a folder with a source file shows the curated screen, Show All Templates replaces it with the whole list, and a new run starts curated again', async () => {
    await withWindow('a-curated', {'main.py': 'print(1)\n'}, async window => {
      startCommand(window);
      await waitForQuickPick(window);
      const curated = (await quickPickRows(window)).map(each => each.label);
      await chooseQuickPickRow(window, 'Show All Templates...');
      await waitFor(
        'the whole list',
        async () =>
          (await quickPickRows(window)).every(
            each => each.label !== 'Show All Templates...',
          ),
        10_000,
      );
      const all = (await quickPickRows(window)).map(each => each.label);
      await pressEscape(window);
      await waitFor(
        'the pick to close',
        async () => (await quickPickOf(window)) === undefined,
        10_000,
      );
      startCommand(window);
      await waitForQuickPick(window);
      const again = (await quickPickRows(window)).map(each => each.label);
      await pressEscape(window);
      await waitFor(
        'the pick to close',
        async () => (await quickPickOf(window)) === undefined,
        10_000,
      );
      deepStrictEqual(
        [
          curated.slice(0, 2),
          [all.includes('Show All Templates...'), all[0]],
          again.slice(0, 2),
        ],
        [
          ['Show All Templates...', 'Learn More'],
          [false, 'Learn More'],
          ['Show All Templates...', 'Learn More'],
        ],
      );
    });
  });
});
