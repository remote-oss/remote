import {deepStrictEqual, strictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  containersLogSince,
  devContainerFolder,
  engineCli,
  reloadingCommand,
  reopenInContainer,
  variable,
} from '../windows/harness.ts';
import {statusItem} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** What the launch's engine printed for `argv`, trimmed. */
async function engine(...argv: string[]): Promise<string> {
  const {stdout} = await execFileAsync(engineCli(), argv);
  return stdout.trim();
}

/** The ids of the run's containers made for `folder`, in the launch's engine, by the label the dev container CLI gives them. */
async function containersOf(folder: string): Promise<string[]> {
  return (
    await engine(
      'ps',
      '--all',
      '--quiet',
      '--filter',
      `label=devcontainer.local_folder=${folder}`,
      '--filter',
      `label=remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
    )
  )
    .split('\n')
    .filter(line => line !== '');
}

/** A folder of the run for an image configuration whose image is the one the engine lists under its own name. */
function imageFolder(
  name: string,
  configuration: Readonly<Record<string, unknown>> = {},
): string {
  return devContainerFolder(name, {
    image: variable('HARNESS_ENGINE_IMAGE'),
    ...configuration,
  });
}

/** A folder of the run whose configuration builds `Dockerfile`, which starts from the engine's image and then runs `steps`. */
function dockerfileFolder(name: string, steps: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
  const place = path.join(folder, '.devcontainer');
  mkdirSync(place, {recursive: true});
  writeFileSync(
    path.join(place, 'devcontainer.json'),
    JSON.stringify({
      build: {dockerfile: 'Dockerfile'},
      runArgs: [
        '--label',
        `remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
      ],
    }),
  );
  writeFileSync(
    path.join(place, 'Dockerfile'),
    `FROM ${variable('HARNESS_ENGINE_IMAGE')}\n${steps}\n`,
  );
  return folder;
}

/** Runs `body` over a window on `folder`, and closes the window after. */
async function withWindow(
  folder: string,
  body: (window: string) => Promise<void>,
): Promise<void> {
  const window = await openFolderWindow(folder);
  try {
    await body(window);
  } finally {
    await closeWindow(window).catch(() => undefined);
  }
}

describe('the launch of release 1 on Podman (card containers-101)', function () {
  this.timeout(900_000);

  it('the launch’s engine CLI is podman', () => {
    strictEqual(engineCli(), 'podman');
  });

  it('F-0201 AC-4 (podman-storage): with dockerPath podman, Reopen creates the container and the vscode volume in Podman’s storage only, with the three labels, and the window connects', async () => {
    const folder = imageFolder('c101-storage', {name: 'Podman Storage'});
    await withWindow(folder, async window => {
      await reopenInContainer(window);
      const containers = await containersOf(folder);
      const labels = JSON.parse(
        await engine(
          'inspect',
          '--format',
          '{{json .Config.Labels}}',
          containers[0] ?? '',
        ),
      ) as Record<string, string>;
      // The criterion's other half names Docker itself, so this is the one place the rows run `docker`.
      const {stdout: inDocker} = await execFileAsync('docker', [
        'ps',
        '--all',
        '--quiet',
        '--filter',
        `label=devcontainer.local_folder=${folder}`,
      ]);
      deepStrictEqual(
        [
          (await engine('volume', 'ls', '--format', '{{.Name}}'))
            .split('\n')
            .includes('vscode'),
          containers.length,
          inDocker.trim(),
          [
            'devcontainer.local_folder',
            'devcontainer.config_file',
            'devcontainer.metadata',
          ].map(label => label in labels),
          (await statusItem(window, 'status.host')).text,
        ],
        [true, 1, '', [true, true, true], 'Dev Container: Podman Storage'],
      );
    });
  });

  it('podman smoke: a folder with a Dockerfile opens in a container', async () => {
    const folder = dockerfileFolder('c101-open', 'RUN true');
    await withWindow(folder, async window => {
      await reopenInContainer(window);
      strictEqual((await containersOf(folder)).length, 1);
    });
  });

  it('podman smoke: a reload connects to the same container, and the vscode volume that is there is not reported as a failure', async () => {
    const folder = imageFolder('c101-reuse');
    let first: string[] = [];
    await withWindow(folder, async window => {
      await reopenInContainer(window);
      first = await containersOf(folder);
    });
    const mark = containersLog().length;
    await withWindow(folder, async window => {
      await reopenInContainer(window);
      deepStrictEqual(
        [
          await containersOf(folder),
          containersLogSince(mark).filter(line =>
            line.includes('vscode volume could not be created'),
          ),
        ],
        [first, []],
      );
    });
  });

  it('podman smoke: Rebuild Container makes a new container and keeps the vscode volume', async () => {
    const folder = imageFolder('c101-rebuild');
    await withWindow(folder, async window => {
      await reopenInContainer(window);
      const before = await containersOf(folder);
      await reloadingCommand(window, 'remote-containers.rebuildContainer');
      await connectedToContainer(window);
      const after = await containersOf(folder);
      deepStrictEqual(
        [
          before.length,
          after.length,
          after[0] === before[0],
          (await engine('volume', 'ls', '--format', '{{.Name}}'))
            .split('\n')
            .includes('vscode'),
        ],
        [1, 1, false, true],
      );
    });
  });

  it('podman smoke: a Dockerfile’s RUN step has run in the container', async () => {
    const folder = dockerfileFolder(
      'c101-run',
      'RUN echo built > /built-by-dockerfile',
    );
    await withWindow(folder, async window => {
      await reopenInContainer(window);
      const [container = ''] = await containersOf(folder);
      strictEqual(
        await engine('exec', container, 'cat', '/built-by-dockerfile'),
        'built',
      );
    });
  });
});
