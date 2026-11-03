import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, inWindow, variable} from '../windows/harness.ts';
import {openWorkspaceWindow} from '../windows/folder-windows.ts';
import {
  chooseQuickPickRow,
  detailedQuickPickRows,
  quickPickChecks,
  quickPickFacts,
  quickPickOf,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {
  CONFIGURATION,
  FEATURES_PLACEHOLDER,
  OPTIONAL_PLACEHOLDER,
  chooseWorkspace,
  closeScreen,
  configurationOf,
  emptyStore,
  filesIn,
  fromEntry,
  pickShown,
  rowsOf,
  startCommand,
  storeRoot,
  takeFeatureScreen,
  takeOptionScreen,
  takeOptionalScreen,
  withWindow,
  writeToStore,
  written,
  writtenToStore,
} from '../windows/authoring-support.ts';

/** The placeholder of the stage pick. */
const STAGE = 'How would you like to create your container configuration?';

/** The template row, first in every stage pick. */
const TEMPLATE_ROW = 'From a predefined container configuration template...';

/** The compose file the Compose template writes beside the configuration. */
const GENERATED = '.devcontainer/docker-compose.yml';

/** A compose file of the one keep-alive service `app`. */
const ONE_APP =
  'services:\n  app:\n    image: alpine\n    command: sleep infinity\n';

/** The mark of the location pick's workspace row when a configuration is already there. */
const EXISTS = 'Configuration already exists';

/** Makes `<run>/<label>/` with the roots `roots`, each holding the files given, and the workspace file listing them. */
function workspaceWith(
  label: string,
  roots: Readonly<Record<string, Readonly<Record<string, string>>>>,
  beside: Readonly<Record<string, string>> = {},
): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  rmSync(folder, {recursive: true, force: true});
  const entries = Object.entries(roots).flatMap(([root, files]) =>
    Object.entries(files).map(([file, text]) => [`${root}/${file}`, text]),
  );
  for (const [relative, text] of [...entries, ...Object.entries(beside)]) {
    const file = path.join(folder, relative ?? '');
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(file, text ?? '');
  }
  for (const root of Object.keys(roots)) {
    mkdirSync(path.join(folder, root), {recursive: true});
  }
  const file = path.join(folder, `${label}.code-workspace`);
  writeFileSync(
    file,
    JSON.stringify({folders: Object.keys(roots).map(root => ({path: root}))}),
  );
  return file;
}

/** Opens the workspace `file`, runs the command, and gives the rows of the location pick before it closes the pick. */
async function locationRowsOf(file: string): Promise<string[]> {
  const window = await openWorkspaceWindow(file);
  try {
    await startCommand(window);
    await waitForQuickPick(window, 180_000);
    const rows = (await rowsOf(window)).map(([label, description]) =>
      description === '' ? label : `${label} | ${description}`,
    );
    await closeScreen(window);
    return rows;
  } finally {
    await closeWindow(window).catch(() => undefined);
  }
}

describe('the wizard on the folder’s own Dockerfile and Compose files (card containers-145, part 3)', function () {
  this.timeout(900_000);

  beforeEach(emptyStore);

  it('F-0801 AC-7 (c145b-stage): with a stored configuration, a Dockerfile and a Compose file, the stage pick lists the template row focused, the copy row with Open File, both From rows and Learn More', async () => {
    await withWindow('c145b-stage', {}, async (window, folder) => {
      // The store is written while the folder has no file of its own, so the wizard goes straight to the templates.
      await writeToStore(window);
      await writtenToStore(
        window,
        path.join(storeRoot(), 'c145b-stage', CONFIGURATION),
      );
      await inWindow(window, 'workbench.action.closeAllEditors');
      writeFileSync(path.join(folder, 'Dockerfile'), 'FROM alpine\n');
      writeFileSync(path.join(folder, 'docker-compose.yml'), ONE_APP);
      await startCommand(window);
      await chooseWorkspace(window);
      const placeholder = (await quickPickOf(window))?.placeholder;
      const rows = await detailedQuickPickRows(window);
      await closeScreen(window);
      deepStrictEqual(
        [
          placeholder,
          rows.map(entry => [entry.label, entry.buttons, entry.focused]),
          rows[0]?.detail,
        ],
        [
          STAGE,
          [
            [TEMPLATE_ROW, [], true],
            ['Copy existing configuration to workspace', ['Open File'], false],
            ["From 'Dockerfile'", [], false],
            ["From 'docker-compose.yml'", [], false],
            ['Learn More', [], false],
          ],
          'Use a base configuration from the container template registry',
        ],
      );
    });
  });

  it('F-0801 AC-7, AC-13 (c145b-multi-root): 6.8 steps 1 and 2, a saved multi-root workspace whose roots hold a Dockerfile goes from the two-row location pick straight to the template list', async () => {
    const file = workspaceWith('c145b-multi-root', {
      first: {Dockerfile: 'FROM alpine\n'},
      second: {Dockerfile: 'FROM alpine\n'},
    });
    const window = await openWorkspaceWindow(file);
    try {
      await startCommand(window);
      await waitForQuickPick(window, 180_000);
      const location = (await rowsOf(window)).map(([label]) => label);
      await chooseWorkspace(window);
      const next = await quickPickOf(window);
      const labels = (await rowsOf(window)).map(([label]) => label);
      await closeScreen(window);
      deepStrictEqual(
        [
          location,
          next?.placeholder === STAGE,
          labels.some(label => label.startsWith('From ')),
        ],
        [
          [
            'Add configuration to workspace',
            'Add configuration to user data folder',
          ],
          false,
          false,
        ],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0801 AC-13 (c145b-multi-root-exists): 6.8 step 3, a configuration beside the workspace file marks the workspace row, and a root with its own configuration hides the mark', async () => {
    const configuration = JSON.stringify({image: 'alpine'});
    const beside = workspaceWith(
      'c145b-beside',
      {first: {}, second: {}},
      {[CONFIGURATION]: configuration},
    );
    const hidden = workspaceWith(
      'c145b-hidden',
      {first: {[CONFIGURATION]: configuration}, second: {}},
      {[CONFIGURATION]: configuration},
    );
    deepStrictEqual(
      [(await locationRowsOf(beside))[0], (await locationRowsOf(hidden))[0]],
      [
        `Add configuration to workspace | ${EXISTS}`,
        'Add configuration to workspace',
      ],
    );
  });

  it('F-0801 AC-11 (c145b-compose-files): From the Compose file skips the options, takes Select Features and the one optional file, and writes exactly the two files of the template', async () => {
    await withWindow(
      'c145b-compose-files',
      {'docker-compose.yml': ONE_APP},
      async (window, folder) => {
        await fromEntry(window, 'docker-compose.yml');
        await takeOptionScreen(window, FEATURES_PLACEHOLDER);
        await pickShown(window, OPTIONAL_PLACEHOLDER);
        const optional = await quickPickChecks(window);
        await takeOptionalScreen(window);
        await written(path.join(folder, GENERATED));
        const configuration = await configurationOf(folder);
        const text = readFileSync(path.join(folder, CONFIGURATION), 'utf8');
        const generated = readFileSync(path.join(folder, GENERATED), 'utf8');
        deepStrictEqual(
          [
            optional.map(entry => entry.label),
            filesIn(folder),
            text.trimStart().startsWith('//'),
            configuration.name,
            configuration.dockerComposeFile,
            configuration.service,
            configuration.workspaceFolder,
            /version: ['"]?3\.8/.test(generated),
            /^ {2}app:/m.test(generated),
            generated.includes('..:/workspaces:cached'),
            /command: .*sleep infinity/.test(generated),
            readFileSync(path.join(folder, 'docker-compose.yml'), 'utf8'),
          ],
          [
            ['.github/dependabot.yml'],
            [CONFIGURATION, GENERATED, 'docker-compose.yml'].sort(),
            true,
            'Existing Docker Compose (Extend)',
            ['../docker-compose.yml', 'docker-compose.yml'],
            'app',
            '/workspaces/${localWorkspaceFolderBasename}',
            true,
            true,
            true,
            true,
            ONE_APP,
          ],
        );
      },
    );
  });

  it('F-0801 AC-32 (c145b-dockerfile-dev): a Dockerfile in a subfolder adds no row, and From Dockerfile.dev writes only the configuration that builds it', async () => {
    await withWindow(
      'c145b-dockerfile-dev',
      {
        DOCKERFILE: 'FROM alpine\n',
        'Dockerfile.dev': 'FROM alpine\n',
        'compose.yml': ONE_APP,
        'docker-compose.override.yml': ONE_APP,
        'compose.json': '{}',
        Containerfile: 'FROM alpine\n',
        'sub/Dockerfile': 'FROM alpine\n',
      },
      async (window, folder) => {
        const before = filesIn(folder);
        await startCommand(window);
        await chooseWorkspace(window);
        const labels = (await rowsOf(window)).map(([label]) => label);
        await chooseQuickPickRow(window, "From 'Dockerfile.dev'");
        await takeFeatureScreen(window);
        await written(path.join(folder, CONFIGURATION));
        const configuration = await configurationOf(folder);
        deepStrictEqual(
          [
            labels,
            filesIn(folder).filter(file => !before.includes(file)),
            configuration.name,
            configuration.build,
          ],
          [
            [
              TEMPLATE_ROW,
              "From 'DOCKERFILE'",
              "From 'Dockerfile.dev'",
              "From 'compose.yml'",
              "From 'docker-compose.override.yml'",
              'Learn More',
            ],
            [CONFIGURATION],
            'Existing Dockerfile',
            {context: '..', dockerfile: '../Dockerfile.dev'},
          ],
        );
      },
    );
  });

  it('F-0801 AC-33 (c145b-two-compose): with compose.yaml and docker-compose.yml, picking docker-compose.yml names only that file', async () => {
    await withWindow(
      'c145b-two-compose',
      {'compose.yaml': ONE_APP, 'docker-compose.yml': ONE_APP},
      async (window, folder) => {
        await fromEntry(window, 'docker-compose.yml');
        await takeFeatureScreen(window);
        await written(path.join(folder, GENERATED));
        deepStrictEqual((await configurationOf(folder)).dockerComposeFile, [
          '../docker-compose.yml',
          'docker-compose.yml',
        ]);
      },
    );
  });

  it('F-0802 AC-22 (c145b-chooser): the chooser is single-select with the template row focused first, each row with its detail and Learn More with its description, and the optional file comes unchecked', async () => {
    await withWindow(
      'c145b-chooser',
      {Dockerfile: 'FROM alpine\n'},
      async window => {
        await startCommand(window);
        await chooseWorkspace(window);
        const facts = await quickPickFacts(window);
        const rows = await detailedQuickPickRows(window);
        await chooseQuickPickRow(window, "From 'Dockerfile'");
        await takeOptionScreen(window, FEATURES_PLACEHOLDER);
        await pickShown(window, OPTIONAL_PLACEHOLDER);
        const optional = await quickPickChecks(window);
        await closeScreen(window);
        deepStrictEqual(
          [
            facts?.multiSelect,
            rows.map(entry => [
              entry.label,
              entry.detail,
              entry.description,
              entry.focused,
            ]),
            optional,
          ],
          [
            false,
            [
              [
                TEMPLATE_ROW,
                'Use a base configuration from the container template registry',
                '',
                true,
              ],
              [
                "From 'Dockerfile'",
                "Refer to the existing 'Dockerfile' in the container configuration",
                '',
                false,
              ],
              [
                'Learn More',
                '',
                'Documentation on predefined container templates',
                false,
              ],
            ],
            [{label: '.github/dependabot.yml', checked: false}],
          ],
        );
      },
    );
  });

  it('F-0802 AC-23 (c145b-both): a Dockerfile and a docker-compose.yml give both From rows with the template row and Learn More', async () => {
    await withWindow(
      'c145b-both',
      {Dockerfile: 'FROM alpine\n', 'docker-compose.yml': ONE_APP},
      async window => {
        await startCommand(window);
        await chooseWorkspace(window);
        const labels = (await rowsOf(window)).map(([label]) => label);
        await closeScreen(window);
        deepStrictEqual(labels, [
          TEMPLATE_ROW,
          "From 'Dockerfile'",
          "From 'docker-compose.yml'",
          'Learn More',
        ]);
      },
    );
  });
});
