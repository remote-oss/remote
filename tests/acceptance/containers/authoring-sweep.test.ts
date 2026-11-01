import {deepStrictEqual} from 'node:assert';
import {chmodSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainersOf,
  dockerVolumes,
  inWindow,
  nextEmptyWindow,
  waitFor,
} from '../windows/harness.ts';
import {
  acceptQuickPick,
  answerDialog,
  chooseQuickPickRow,
  detailedQuickPickRows,
  dialogOf,
  dialogText,
  editorTabs,
  notificationButtons,
  notificationCentre,
  notificationLinks,
  notifications,
  pageText,
  paletteRows,
  pressQuickPickOk,
  quickPickFacts,
  quickPickOf,
  rememberPage,
  toastProgressIndeterminate,
  toggleQuickPickRow,
  typeInFocus,
  typeInQuickPick,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {activations} from '../windows/folder-windows.ts';
import {
  ADD_ITEM,
  ALPINE_OPTION,
  chooseWorkspace,
  CONFIGURATION,
  closeScreen,
  emptyStore,
  existing,
  filesIn,
  indicatorMenu,
  neighboursOf,
  rowsOf,
  screenWith,
  startCommand,
  storeRoot,
  takeFeatureScreen,
  takeOptionScreen,
  USER_DATA_ROW,
  waitForPickAfterLocation,
  withWindow,
  WORKSPACE_ROW,
  writeToStore,
  written,
} from '../windows/authoring-support.ts';
import {dockerObjects} from './resolve-support.ts';

const WRITING = 'Adding Dev Container Configuration Files...';

const NOTICE_START = 'Folder contains a Dev Container configuration file.';

/** The start of the reopen notice of a configuration in the store of user data. */
const STORED_NOTICE_START = 'There is a Dev Container configuration';

const OPTIONAL_PLACEHOLDER = 'Include the following optional files/directories';

const FEATURES_PLACEHOLDER = 'Select additional features to install';

describe('F-0801 the command, its progress and its rows (card coverage-72)', function () {
  this.timeout(600_000);

  before(() => rememberPage('local'));

  it('F-0801 AC-1 (c72-menu): the remote indicator menu of a window with a folder offers the command right before Reopen in Container, and the menu of a window without a folder does not', async () => {
    const seen: Record<string, unknown> = {};
    await withWindow('c72-menu', {}, async window => {
      seen.local = neighboursOf(await indicatorMenu(window))[1];
      seen.palette = (
        await paletteRows(window, 'Add Dev Container Configuration')
      ).includes(`Dev Containers: ${ADD_ITEM}`);
    });
    const empty = await nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
    await rememberPage(empty);
    try {
      seen.empty = neighboursOf(await indicatorMenu(empty));
      seen.emptyPalette = (
        await paletteRows(empty, 'Add Dev Container Configuration')
      ).includes(`Dev Containers: ${ADD_ITEM}`);
    } finally {
      await closeWindow(empty).catch(() => undefined);
    }
    deepStrictEqual(seen, {
      local: 'Reopen in Container',
      palette: true,
      empty: [],
      emptyPalette: true,
    });
  });

  it("F-0801 AC-4, AC-16 (c72-progress): after the last pick the pick is replaced by the Adding Dev Container Configuration Files toast, an indeterminate progress with no button that is gone within seconds; the window does not reload, no container, image or volume is made, and the folder notification, with learn more, Reopen in Container and Don't Show Again, leaves the toasts after about 10 s", async () => {
    await withWindow('c72-progress', {}, async (window, folder) => {
      const before = [await dockerObjects(), await dockerVolumes()];
      const activated = activations(window);
      await startCommand(window);
      await chooseWorkspace(window);
      await chooseQuickPickRow(window, 'Alpine');
      await takeOptionScreen(window, ALPINE_OPTION);
      await takeFeatureScreen(window);
      const toast: unknown[] = [];
      let appeared = 0;
      let gone = 0;
      let noticeAppeared = 0;
      let noticeGone = 0;
      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline && noticeGone === 0) {
        const shown = await notifications(window);
        if (shown.includes(WRITING)) {
          appeared = appeared || Date.now();
          toast.push(true);
        } else if (appeared !== 0 && gone === 0) {
          gone = Date.now();
        }
        const noticeShown = shown.some(text => text.startsWith(NOTICE_START));
        if (noticeShown && noticeAppeared === 0) {
          noticeAppeared = Date.now();
        } else if (!noticeShown && noticeAppeared !== 0) {
          noticeGone = Date.now();
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await written(path.join(folder, CONFIGURATION));
      const buttons = await notificationButtons(window, NOTICE_START);
      const links = (await notificationLinks(window, NOTICE_START)).map(
        entry => entry.text,
      );
      deepStrictEqual(
        {
          toast: [...new Set(toast.filter(entry => entry !== undefined))],
          toastSeconds: gone !== 0 && gone - appeared < 5000,
          quickPick: await quickPickOf(window),
          activated: activations(window) === activated,
          unchanged: [await dockerObjects(), await dockerVolumes()],
          containers: await devContainersOf(folder),
          buttons,
          links,
          files: filesIn(folder),
          noticeSeconds:
            noticeGone - noticeAppeared > 5000 &&
            noticeGone - noticeAppeared < 15_000,
        },
        {
          toast: [true],
          toastSeconds: true,
          quickPick: undefined,
          activated: true,
          unchanged: before,
          containers: [],
          buttons: ['Reopen in Container', "Don't Show Again..."],
          links: ['learn more'],
          files: [CONFIGURATION],
          noticeSeconds: true,
        },
      );
    });
  });

  it('F-0801 AC-6 (c72-exists): a configuration in the folder, a root dotfile or one without image information gives the workspace row Configuration already exists, one in the store of user data gives the user data row, and no dialog shows', async () => {
    const seen: unknown[] = [];
    for (const [name, contents] of [
      ['c72-exists-main', {[CONFIGURATION]: '{"image":"alpine"}'}],
      ['c72-exists-dot', {'.devcontainer.json': '{"image":"alpine"}'}],
      ['c72-exists-bare', {[CONFIGURATION]: '{"name":"No image"}'}],
    ] as const) {
      await withWindow(name, contents, async window => {
        await startCommand(window);
        await waitForQuickPick(window);
        seen.push(await rowsOf(window), await dialogOf(window));
        await closeScreen(window);
      });
    }
    emptyStore();
    await withWindow('c72-exists-store', {}, async window => {
      await writeToStore(window);
      await written(path.join(storeRoot(), 'c72-exists-store', CONFIGURATION));
      // The file is written before the run opens its preview and offers to reopen; a second command started meanwhile is
      // refused as already running. The notice is the run's last step, so it is shown once the command can run again.
      await waitFor(
        'the first run to end with its reopen notice',
        async () =>
          (await notificationCentre(window)).some(text =>
            text.startsWith(STORED_NOTICE_START),
          ),
        60_000,
      );
      await startCommand(window);
      await waitForQuickPick(window);
      seen.push(await rowsOf(window), await dialogOf(window));
      await closeScreen(window);
    });
    emptyStore();
    const exists = 'Configuration already exists';
    const workspaceDetail =
      'This allows you to share the configuration with others via source control';
    const userDataDetail =
      'This avoids having outgoing changes in your workspace folder';
    const inWorkspace = [
      [WORKSPACE_ROW, exists, workspaceDetail, true],
      [USER_DATA_ROW, '', userDataDetail, false],
    ];
    deepStrictEqual(seen, [
      inWorkspace,
      undefined,
      inWorkspace,
      undefined,
      inWorkspace,
      undefined,
      [
        [WORKSPACE_ROW, '', workspaceDetail, true],
        [USER_DATA_ROW, exists, userDataDetail, false],
      ],
      undefined,
    ]);
  });

  it('F-0801 AC-10, F-0802 AC-22 (c72-dockerfile): From Dockerfile applies the existing Dockerfile template with no options pick, a Features pick and an optional files pick of .github/dependabot.yml, and writes one file named Existing Dockerfile that builds the Dockerfile, which is untouched', async () => {
    const dockerfile = 'FROM alpine\n';
    await withWindow(
      'c72-dockerfile',
      {Dockerfile: dockerfile},
      async (window, folder) => {
        await startCommand(window);
        await chooseWorkspace(window);
        await chooseQuickPickRow(window, "From 'Dockerfile'");
        await takeOptionScreen(window, FEATURES_PLACEHOLDER);
        await waitFor(
          'the optional files pick',
          async () =>
            (await quickPickFacts(window))?.placeholder ===
            OPTIONAL_PLACEHOLDER,
          30_000,
        );
        const optional = (await detailedQuickPickRows(window)).map(
          entry => entry.label,
        );
        await acceptQuickPick(window);
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
        const parsed = JSON.parse(
          text
            .split('\n')
            .filter(line => !line.trim().startsWith('//'))
            .join('\n')
            .replace(/,(\s*[}\]])/g, '$1'),
        ) as {name: string; build: Record<string, string>};
        deepStrictEqual(
          {
            optional,
            header: text.startsWith('// For format details'),
            examples: text.includes('// "forwardPorts": [],'),
            name: parsed.name,
            build: parsed.build,
            files: filesIn(folder),
            dockerfile: readFileSync(path.join(folder, 'Dockerfile'), 'utf8'),
          },
          {
            optional: ['.github/dependabot.yml'],
            header: true,
            examples: true,
            name: 'Existing Dockerfile',
            build: {context: '..', dockerfile: '../Dockerfile'},
            files: ['.devcontainer/devcontainer.json', 'Dockerfile'],
            dockerfile,
          },
        );
      },
    );
  });

  it('F-0801 AC-18 (c72-no-hypothesized): the flow, with and without a Dockerfile, shows neither Add Files... nor the folder-select pick of Folder, Project Root and Workspace', async () => {
    const forbidden = [
      'Add Files...',
      'Select a folder to create a container configuration for',
      'Folder',
      'Project Root',
      'Workspace',
    ];
    const found: string[] = [];
    for (const [name, contents] of [
      ['c72-hypo-plain', {}],
      ['c72-hypo-dockerfile', {Dockerfile: 'FROM alpine\n'}],
    ] as const) {
      await withWindow(name, contents, async window => {
        async function scanned(): Promise<void> {
          const facts = await quickPickFacts(window);
          const rows = (await detailedQuickPickRows(window)).map(
            entry => entry.label,
          );
          for (const text of [facts?.title, facts?.placeholder, ...rows]) {
            if (text !== undefined && forbidden.includes(text)) {
              found.push(`${name}: ${text}`);
            }
          }
        }
        await startCommand(window);
        await waitForQuickPick(window);
        await scanned();
        await chooseQuickPickRow(window, WORKSPACE_ROW);
        await waitForPickAfterLocation(window);
        await scanned();
        if (name === 'c72-hypo-dockerfile') {
          await chooseQuickPickRow(
            window,
            'From a predefined container configuration template...',
          );
          await waitForPickAfterLocation(window);
          await scanned();
        }
        await closeScreen(window);
        found.push(...(await notificationCentre(window)));
      });
    }
    deepStrictEqual(found, []);
  });

  it('F-0801 AC-36 (c72-template-unreachable): a custom template id of a registry that does not answer shows Application of the template failed with Cancel and Show Log, and after Cancel no pick, dialog or progress is left and nothing is written', async () => {
    await withWindow('c72-unreachable', {}, async (window, folder) => {
      await startCommand(window);
      await chooseWorkspace(window);
      await typeInQuickPick(window, 'localhost:1/remote-oss-run/custom/none:1');
      await new Promise(resolve => setTimeout(resolve, 1500));
      await acceptQuickPick(window);
      await takeFeatureScreen(window, false);
      const dialog = await waitForDialog(window, 120_000);
      await answerDialog(window, 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        {
          details: dialog.details,
          buttons: [...dialog.buttons].sort(),
          left: [
            await dialogOf(window),
            await quickPickOf(window),
            await notifications(window),
          ],
          files: existing(folder, '.devcontainer'),
        },
        {
          details: 'Application of the template failed.',
          buttons: ['Cancel', 'Show Log'],
          left: [undefined, undefined, []],
          files: [],
        },
      );
    });
  });

  it('F-0801 AC-39 (c72-unsaved): with the configuration open and edited, adding a template over it with Overwrite writes the template output to the disk and leaves the edits in the editor, marked unsaved', async () => {
    await withWindow(
      'c72-unsaved',
      {[CONFIGURATION]: '{"image":"alpine"}'},
      async (window, folder) => {
        await inWindow(window, 'acceptance.agent.openFile', CONFIGURATION);
        await waitFor(
          'the configuration in an editor',
          async () =>
            (await editorTabs(window)).some(
              entry => entry.label === 'devcontainer',
            ),
          30_000,
        );
        await typeInFocus(window, 'unsavedwords');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const dirtyBefore = (await editorTabs(window)).find(
          entry => entry.label === 'devcontainer',
        )?.dirty;
        await startCommand(window);
        await chooseWorkspace(window);
        await chooseQuickPickRow(window, 'Alpine');
        await takeOptionScreen(window, ALPINE_OPTION);
        await takeFeatureScreen(window);
        await waitForDialog(window, 60_000);
        await answerDialog(window, 'Overwrite');
        await waitFor(
          'the template output on the disk',
          () =>
            readFileSync(path.join(folder, CONFIGURATION), 'utf8').includes(
              'mcr.microsoft.com/devcontainers/base:alpine',
            ),
          60_000,
        );
        await new Promise(resolve => setTimeout(resolve, 3000));
        const shown = (await editorTabs(window)).find(
          entry => entry.label === 'devcontainer',
        );
        await inWindow(window, 'workbench.action.files.save');
        await new Promise(resolve => setTimeout(resolve, 3000));
        const conflict = (await notificationCentre(window)).some(text =>
          text.startsWith("Failed to save 'devcontainer.json'"),
        );
        deepStrictEqual(
          {
            conflict,
            dirtyBefore,
            onDisk: readFileSync(
              path.join(folder, CONFIGURATION),
              'utf8',
            ).includes('unsavedwords'),
            tabDirty: shown?.dirty,
            buffer: (await pageText(window)).includes('unsavedwords'),
          },
          {
            conflict: true,
            dirtyBefore: true,
            onDisk: false,
            tabDirty: true,
            buffer: true,
          },
        );
      },
    );
  });

  it('F-0801 AC-7 (c72-stage): with a user data configuration and a Dockerfile, the stage pick lists the template row, the copy row with its Open File button, the Dockerfile row and Learn More, and without the user data configuration no copy row (the Compose row is later in release 1)', async () => {
    const seen: unknown[] = [];
    emptyStore();
    await withWindow('c72-stage', {}, async (window, folder) => {
      await writeToStore(window);
      await written(path.join(storeRoot(), 'c72-stage', CONFIGURATION));
      writeFileSync(path.join(folder, 'Dockerfile'), 'FROM alpine\n');
      await new Promise(resolve => setTimeout(resolve, 3000));
      await startCommand(window);
      await chooseWorkspace(window);
      seen.push(
        (await quickPickFacts(window))?.placeholder,
        await rowsOf(window),
        (await detailedQuickPickRows(window)).map(entry => entry.buttons),
      );
      await closeScreen(window);
    });
    emptyStore();
    for (const [name, contents] of [
      ['c72-stage-dockerfile', {Dockerfile: 'FROM alpine\n'}],
    ] as const) {
      await withWindow(name, contents, async window => {
        await startCommand(window);
        await chooseWorkspace(window);
        seen.push((await rowsOf(window)).map(entry => entry[0]));
        await closeScreen(window);
      });
    }
    deepStrictEqual(seen, [
      'How would you like to create your container configuration?',
      [
        [
          'From a predefined container configuration template...',
          '',
          'Use a base configuration from the container template registry',
          true,
        ],
        [
          'Copy existing configuration to workspace',
          '',
          'Copy the configuration from your user data folder to the workspace folder',
          false,
        ],
        [
          "From 'Dockerfile'",
          '',
          "Refer to the existing 'Dockerfile' in the container configuration",
          false,
        ],
        [
          'Learn More',
          'Documentation on predefined container templates',
          '',
          false,
        ],
      ],
      [[], ['Open File'], [], []],
      [
        'From a predefined container configuration template...',
        "From 'Dockerfile'",
        'Learn More',
      ],
    ]);
  });

  it('F-0801 AC-9, AC-16 (c72-overwrite): with two existing target files each gets its own question while the toast stays, Skip leaves a file and goes on, Overwrite replaces it and goes on, and Cancel at the first ends the write with both files as they were and no further question', async () => {
    const files = {
      [CONFIGURATION]: 'mine',
      '.github/dependabot.yml': 'also mine',
    };
    const outcomes: unknown[] = [];
    for (const answers of [
      ['Skip', 'Overwrite'],
      ['Overwrite', 'Skip'],
      ['Cancel'],
    ] as const) {
      await withWindow(
        `c72-overwrite-${answers.join('-').toLowerCase()}`,
        files,
        async (window, folder) => {
          await startCommand(window);
          await chooseWorkspace(window);
          await chooseQuickPickRow(window, 'Alpine');
          await takeOptionScreen(window, ALPINE_OPTION);
          await takeOptionScreen(window, FEATURES_PLACEHOLDER);
          await screenWith(window, OPTIONAL_PLACEHOLDER);
          await toggleQuickPickRow(window, '.github/dependabot.yml');
          await pressQuickPickOk(window);
          const asked: Array<[string, boolean]> = [];
          const bars: Array<boolean | undefined> = [];
          const kept: Record<string, string> = {};
          for (const answer of answers) {
            await waitForDialog(window, 60_000);
            const said = (await dialogText(window)) ?? '';
            asked.push([
              (/File '([^']*)'/.exec(said)?.[1] ?? '').replace(/^\.\//, ''),
              (await notifications(window)).includes(WRITING),
            ]);
            bars.push(await toastProgressIndeterminate(window, WRITING));
            await answerDialog(window, answer);
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
          for (const [file] of asked) {
            kept[file] =
              readFileSync(path.join(folder, file), 'utf8') ===
              files[file as keyof typeof files]
                ? 'mine'
                : 'written';
          }
          outcomes.push({
            asked: asked.map(([, toast]) => toast),
            bars,
            left: await dialogOf(window),
            files: filesIn(folder),
            kept: answers.map((answer, index) => [
              answer,
              kept[asked[index]?.[0] ?? ''],
            ]),
            errors: (await notificationCentre(window)).filter(
              text => !text.startsWith(NOTICE_START),
            ),
          });
        },
      );
    }
    const both = [CONFIGURATION, '.github/dependabot.yml'].sort();
    deepStrictEqual(outcomes, [
      {
        asked: [true, true],
        bars: [true, true],
        left: undefined,
        files: both,
        kept: [
          ['Skip', 'mine'],
          ['Overwrite', 'written'],
        ],
        errors: [],
      },
      {
        asked: [true, true],
        bars: [true, true],
        left: undefined,
        files: both,
        kept: [
          ['Overwrite', 'written'],
          ['Skip', 'mine'],
        ],
        errors: [],
      },
      {
        asked: [true],
        bars: [true],
        left: undefined,
        files: both,
        kept: [['Cancel', 'mine']],
        errors: [],
      },
    ]);
  });

  it('F-0801 AC-30, AC-37 (c72-no-exists): a configuration only in a subfolder of .devcontainer, a file named .devcontainer and a read-only folder show Configuration already exists on neither row and no dialog, and with the subfolder one the workspace row goes straight to the template pick', async () => {
    const seen: unknown[] = [];
    const cases = [
      ['c72-no-sub', {'.devcontainer/a/devcontainer.json': '{}'}],
      ['c72-no-file', {'.devcontainer': 'a file'}],
      ['c72-no-readonly', {}],
    ] as const;
    for (const [name, contents] of cases) {
      await withWindow(name, contents, async (window, folder) => {
        if (name === 'c72-no-readonly') {
          chmodSync(folder, 0o555);
        }
        try {
          await startCommand(window);
          await waitForQuickPick(window);
          seen.push(await rowsOf(window), await dialogOf(window));
          if (name === 'c72-no-sub') {
            await chooseQuickPickRow(window, WORKSPACE_ROW);
            await waitForPickAfterLocation(window);
            seen.push((await quickPickFacts(window))?.placeholder);
          }
          await closeScreen(window);
        } finally {
          chmodSync(folder, 0o755);
        }
      });
    }
    const rows = [
      [
        WORKSPACE_ROW,
        '',
        'This allows you to share the configuration with others via source control',
        true,
      ],
      [
        USER_DATA_ROW,
        '',
        'This avoids having outgoing changes in your workspace folder',
        false,
      ],
    ];
    deepStrictEqual(seen, [
      rows,
      undefined,
      'Select a container configuration template or enter a custom template id',
      rows,
      undefined,
      rows,
      undefined,
    ]);
  });
});
