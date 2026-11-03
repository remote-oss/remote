import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {waitFor} from '../windows/harness.ts';
import {
  chooseQuickPickRow,
  dialogOf,
  notificationCentre,
  pressEscape,
  pressQuickPickBack,
  quickPickFacts,
  quickPickOf,
} from '../windows/renderer.ts';
import {
  CONFIGURATION,
  chooseWorkspace,
  closeScreen,
  configurationOf,
  filesIn,
  rowsOf,
  startCommand,
  takeFeatureScreen,
  withWindow,
  written,
} from '../windows/authoring-support.ts';

/** The placeholder of the service pick. */
const SERVICE_PLACEHOLDER = 'Select a service';

/** The placeholder of the chooser. */
const CHOOSER_PLACEHOLDER =
  'How would you like to create your container configuration?';

/** The compose file the template writes beside the configuration. */
const GENERATED = '.devcontainer/docker-compose.yml';

/** A compose file with the services `names`, each a keep-alive Alpine. */
function composeWith(...names: string[]): string {
  return `services:\n${names.map(name => `  ${name}:\n    image: alpine\n    command: sleep infinity\n`).join('')}`;
}

/** Starts the wizard in `window`, takes the workspace and picks the From row of `entry`. */
async function fromEntry(window: string, entry: string): Promise<void> {
  await startCommand(window);
  await chooseWorkspace(window);
  await chooseQuickPickRow(window, `From '${entry}'`);
}

/** Waits for the pick whose placeholder is `placeholder`. */
function pickShown(window: string, placeholder: string): Promise<void> {
  return waitFor(
    `the pick ${placeholder}`,
    async () => (await quickPickOf(window))?.placeholder === placeholder,
    60_000,
  );
}

/** The key line of the generated compose file's first service. */
function generatedKey(folder: string): string | undefined {
  return readFileSync(path.join(folder, GENERATED), 'utf8')
    .split('\n')
    .find(line => /^ {2}[^ #].*:\s*$/.test(line) || line === '  :');
}

describe('the wizard on an existing Compose file (card containers-145)', function () {
  this.timeout(600_000);

  it('F-0413 AC-3, F-0801 AC-21, F-0802 AC-32 (c145-two): two services give Select a service in file order, the first focused, with Back, and the pick is the service of both written files', async () => {
    const original = composeWith('web', 'db');
    await withWindow(
      'c145-two',
      {'docker-compose.yml': original},
      async (window, folder) => {
        await fromEntry(window, 'docker-compose.yml');
        await pickShown(window, SERVICE_PLACEHOLDER);
        const facts = await quickPickFacts(window);
        const rows = await rowsOf(window);
        await chooseQuickPickRow(window, 'db');
        await takeFeatureScreen(window);
        await written(path.join(folder, GENERATED));
        const configuration = await configurationOf(folder);
        deepStrictEqual(
          [
            facts?.title,
            facts?.titleButtons.map(button => button.startsWith('Back')),
            facts?.multiSelect,
            rows.map(([label, description, , focused]) => [
              label,
              description,
              focused,
            ]),
            configuration.dockerComposeFile,
            configuration.service,
            generatedKey(folder),
            readFileSync(path.join(folder, 'docker-compose.yml'), 'utf8'),
            filesIn(folder),
          ],
          [
            'Add Dev Container Configuration Files',
            [true],
            false,
            [
              ['web', '', true],
              ['db', '', false],
            ],
            ['../docker-compose.yml', 'docker-compose.yml'],
            'db',
            '  db:',
            original,
            [CONFIGURATION, GENERATED, 'docker-compose.yml'].sort(),
          ],
        );
      },
    );
  });

  it('F-0413 AC-54, F-0801 AC-11, AC-33 (c145-solo): one service in compose.yaml gives no service pick, the Features pick next, and the file first in dockerComposeFile', async () => {
    await withWindow(
      'c145-solo',
      {'compose.yaml': composeWith('app')},
      async (window, folder) => {
        await fromEntry(window, 'compose.yaml');
        await takeFeatureScreen(window);
        await written(path.join(folder, GENERATED));
        const configuration = await configurationOf(folder);
        deepStrictEqual(
          [
            configuration.name,
            configuration.dockerComposeFile,
            configuration.service,
            configuration.workspaceFolder,
            generatedKey(folder),
          ],
          [
            'Existing Docker Compose (Extend)',
            ['../compose.yaml', 'docker-compose.yml'],
            'app',
            '/workspaces/${localWorkspaceFolderBasename}',
            '  app:',
          ],
        );
      },
    );
  });

  it('F-0413 AC-4 (c145-list): a services list offers its indices', async () => {
    await withWindow(
      'c145-list',
      {'docker-compose.yml': 'services:\n  - a\n  - b\n'},
      async window => {
        await fromEntry(window, 'docker-compose.yml');
        await pickShown(window, SERVICE_PLACEHOLDER);
        const labels = (await rowsOf(window)).map(([label]) => label);
        await closeScreen(window);
        deepStrictEqual(labels, ['0', '1']);
      },
    );
  });

  it('F-0413 AC-4 (c145-none): no service gives no pick, "service": "" and the nameless placeholder in the generated file', async () => {
    await withWindow(
      'c145-none',
      {'docker-compose.yml': 'services: {}\n'},
      async (window, folder) => {
        await fromEntry(window, 'docker-compose.yml');
        await takeFeatureScreen(window);
        await written(path.join(folder, GENERATED));
        const configuration = await configurationOf(folder);
        deepStrictEqual(
          [configuration.service, generatedKey(folder)],
          ['', '  :'],
        );
      },
    );
  });

  it('F-0413 AC-61 (c145-back): Back on the service pick shows the chooser again with its rows, and nothing is written', async () => {
    await withWindow(
      'c145-back',
      {'docker-compose.yml': composeWith('web', 'db')},
      async (window, folder) => {
        await fromEntry(window, 'docker-compose.yml');
        await pickShown(window, SERVICE_PLACEHOLDER);
        await pressQuickPickBack(window);
        await pickShown(window, CHOOSER_PLACEHOLDER);
        const labels = (await rowsOf(window)).map(([label]) => label);
        await closeScreen(window);
        deepStrictEqual(
          [labels, filesIn(folder)],
          [
            [
              'From a predefined container configuration template...',
              "From 'docker-compose.yml'",
              'Learn More',
            ],
            ['docker-compose.yml'],
          ],
        );
      },
    );
  });

  it('F-0413 AC-26 (c145-escape): Escape on the service pick ends the wizard silently, with nothing written', async () => {
    await withWindow(
      'c145-escape',
      {'docker-compose.yml': composeWith('web', 'db')},
      async (window, folder) => {
        await fromEntry(window, 'docker-compose.yml');
        await pickShown(window, SERVICE_PLACEHOLDER);
        await pressEscape(window);
        await new Promise(resolve => setTimeout(resolve, 3000));
        deepStrictEqual(
          [
            await quickPickOf(window),
            await dialogOf(window),
            (await notificationCentre(window)).length,
            filesIn(folder),
          ],
          [undefined, undefined, 0, ['docker-compose.yml']],
        );
      },
    );
  });

  it('F-0801 AC-32, F-0802 AC-23, AC-36 (c145-families): the chooser lists the Dockerfile family, then the Compose family, each by character code, with the detail naming the file', async () => {
    await withWindow(
      'c145-families',
      {
        DOCKERFILE: 'FROM alpine\n',
        'Dockerfile.dev': 'FROM alpine\n',
        'compose.yml': composeWith('app'),
        'docker-compose.override.yml': composeWith('app'),
        'compose.json': '{}',
        Containerfile: 'FROM alpine\n',
      },
      async window => {
        await startCommand(window);
        await chooseWorkspace(window);
        await pickShown(window, CHOOSER_PLACEHOLDER);
        const rows = await rowsOf(window);
        await closeScreen(window);
        deepStrictEqual(
          rows.map(([label, , detail]) => [label, detail]),
          [
            [
              'From a predefined container configuration template...',
              'Use a base configuration from the container template registry',
            ],
            [
              "From 'DOCKERFILE'",
              "Refer to the existing 'DOCKERFILE' in the container configuration",
            ],
            [
              "From 'Dockerfile.dev'",
              "Refer to the existing 'Dockerfile.dev' in the container configuration",
            ],
            [
              "From 'compose.yml'",
              "Refer to the existing 'compose.yml' in the container configuration",
            ],
            [
              "From 'docker-compose.override.yml'",
              "Refer to the existing 'docker-compose.override.yml' in the container configuration",
            ],
            ['Learn More', ''],
          ],
        );
      },
    );
  });
});
