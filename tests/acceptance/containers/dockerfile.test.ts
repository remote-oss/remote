import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reloadWindow,
  reopenInContainer,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {answerDialog, waitForDialog, windowTitle} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The output of `docker` run with `parameters`, trimmed. */
async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** `docker` run with `parameters` and `input` on its standard input. */
async function dockerWithInput(
  input: string,
  ...parameters: string[]
): Promise<void> {
  const running = execFileAsync('docker', parameters);
  running.child.stdin?.end(input);
  await running;
}

/** Builds `gate-base:2` on the run's dev container image, labelled so a row can see the base's label in its image. */
function buildBase(): Promise<void> {
  return dockerWithInput(
    `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nLABEL gate.base=one\n`,
    'build',
    '-t',
    'gate-base:2',
    '-',
  );
}

/** The tag the CLI gives the image it builds for `folder`: `vsc-<name>-<sha256 of the folder's path>`. */
function builtTag(folder: string): string {
  return `vsc-${path.basename(folder).toLowerCase().replaceAll(' ', '')}-${createHash('sha256').update(folder).digest('hex')}`;
}

/** Writes the Dockerfile of `folder`. */
function writeDockerfile(folder: string, text: string): void {
  writeFileSync(path.join(folder, '.devcontainer', 'Dockerfile'), text);
}

/** The configuration of a folder that builds `gate-base:2`, with `extra` beside it and no image of the run's. */
function buildConfiguration(
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    image: undefined,
    build: {dockerfile: 'Dockerfile', options: ['--label=gate.option=two']},
    ...extra,
  };
}

/** How many lines `file` holds in container `containerId`. */
async function linesIn(containerId: string, file: string): Promise<number> {
  try {
    return Number(
      await docker('exec', containerId, 'sh', '-c', `wc -l < ${file}`),
    );
  } catch {
    return 0;
  }
}

/** Removes the containers of `folder` and the images a row made. */
async function cleanUp(folder: string): Promise<void> {
  await removeContainers(folder);
  await execFileAsync('docker', ['image', 'rm', '-f', builtTag(folder)]).catch(
    () => undefined,
  );
}

describe('Dev Containers: the Dockerfile path and the lifecycle (card containers-15)', function () {
  this.timeout(900_000);

  it('F-0412 AC-6 (gate-row-2): a Dockerfile configuration is built and tagged vsc-<name>-<hash>, with the option and the base image’s labels, and connects', async () => {
    await buildBase();
    const folder = devContainerFolder(
      'gate-dockerfile',
      buildConfiguration('Gate Two'),
    );
    try {
      writeDockerfile(folder, 'FROM gate-base:2\nRUN echo built > /built\n');
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      const imageTag = builtTag(folder);
      const labels = JSON.parse(
        await docker(
          'image',
          'inspect',
          imageTag,
          '-f',
          '{{json .Config.Labels}}',
        ),
      ) as Record<string, string>;
      deepStrictEqual(
        {
          containerCount: (await devContainersOf(folder)).length,
          image: await docker(
            'inspect',
            '-f',
            '{{.Config.Image}}',
            containerId,
          ),
          option: labels['gate.option'],
          base: labels['gate.base'],
          built: await docker('exec', containerId, 'cat', '/built'),
          title: await windowTitle(name),
        },
        {
          containerCount: 1,
          image: imageTag,
          option: 'two',
          base: 'one',
          built: 'built',
          title: '[gate-dockerfile [Dev Container: Gate Two]]',
        },
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
      await execFileAsync('docker', ['image', 'rm', '-f', 'gate-base:2']).catch(
        () => undefined,
      );
    }
  });

  it('F-0412 AC-43 (gate-row-2b): an image beside a Dockerfile build is ignored: the container runs the built image and the real image keeps its id', async () => {
    await buildBase();
    const folder = devContainerFolder(
      'gate-both',
      buildConfiguration('Gate Both', {image: 'alpine:3.22'}),
    );
    const noted = await docker(
      'image',
      'inspect',
      'alpine:3.22',
      '-f',
      '{{.Id}}',
    ).catch(() => 'none');
    try {
      writeDockerfile(folder, 'FROM gate-base:2\nRUN echo built > /built\n');
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      deepStrictEqual(
        {
          image: await docker(
            'inspect',
            '-f',
            '{{.Config.Image}}',
            containerId,
          ),
          alpine: await docker(
            'image',
            'inspect',
            'alpine:3.22',
            '-f',
            '{{.Id}}',
          ).catch(() => 'none'),
        },
        {image: builtTag(folder), alpine: noted},
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
      if (noted !== 'none') {
        await execFileAsync('docker', ['tag', noted, 'alpine:3.22']);
      }
      await execFileAsync('docker', ['image', 'rm', '-f', 'gate-base:2']).catch(
        () => undefined,
      );
    }
  });

  it('F-0412 AC-18, AC-32 (gate-row-2c): a Dockerfile that does not exist is refused before the reload, with S004 and its two buttons, and nothing is made', async () => {
    const folder = devContainerFolder('gate-nodf', {
      name: 'x',
      image: undefined,
      build: {dockerfile: 'Missing'},
    });
    const name = await openFolderWindow(folder);
    const running = inWindow(name, 'remote-containers.reopenInContainer');
    const shown = await waitForDialog(name);
    await answerDialog(name, 'Cancel');
    await running;
    deepStrictEqual(
      {
        detail: shown.details,
        buttons: [...shown.buttons].sort(),
        remoteName: (await windowState(name)).remoteName,
        containers: await devContainersOf(folder),
      },
      {
        detail: `"${path.join(folder, '.devcontainer', 'Missing')}" does not exist.`,
        buttons: ['Cancel', 'Open devcontainer.json'],
        remoteName: null,
        containers: [],
      },
    );
    await closeWindow(name);
  });

  it('F-0415 AC-7, AC-8, AC-9 (gate-row-6): the create hooks run once, a restart runs the start and attach hooks and initializeCommand again, and a reload runs the attach hook and initializeCommand but not the start hook', async () => {
    const folder = devContainerFolder('gate-lifecycle', {
      name: 'Gate Lifecycle',
      initializeCommand: 'date +%s%N >> .gate-init.log',
      onCreateCommand: 'date +%s%N >> /tmp/oncreate.log',
      updateContentCommand: 'date +%s%N >> /tmp/update.log',
      postCreateCommand: 'date +%s%N >> /tmp/create.log',
      postStartCommand: 'date +%s%N >> /tmp/start.log',
      postAttachCommand: 'date +%s%N >> /tmp/attach.log',
    });
    /** The line counts of the six hooks' files, for the container `containerId`. */
    async function counts(containerId: string): Promise<number[]> {
      const initialize = existsSync(path.join(folder, '.gate-init.log'))
        ? readFileSync(path.join(folder, '.gate-init.log'), 'utf8')
            .split('\n')
            .filter(line => line !== '').length
        : 0;
      return [
        initialize,
        ...(await Promise.all(
          ['oncreate', 'update', 'create', 'start', 'attach'].map(hook =>
            linesIn(containerId, `/tmp/${hook}.log`),
          ),
        )),
      ];
    }
    /** Waits until the attach hook's file has `lines` lines: the background stage runs after the connect. */
    async function attached(containerId: string, lines: number): Promise<void> {
      await waitFor(
        `/tmp/attach.log to hold ${String(lines)} lines`,
        async () => (await linesIn(containerId, '/tmp/attach.log')) >= lines,
        60_000,
      );
    }
    try {
      const first = await openFolderWindow(folder);
      await reopenInContainer(first);
      const [containerId = ''] = await devContainersOf(folder);
      await attached(containerId, 1);
      const afterOpen = await counts(containerId);
      await closeWindow(first);
      await docker('stop', containerId);
      const second = await openFolderWindow(folder);
      await reopenInContainer(second);
      await attached(containerId, 2);
      const afterRestart = await counts(containerId);
      await reloadWindow(second);
      await connectedToContainer(second);
      await attached(containerId, 3);
      const afterReload = await counts(containerId);
      deepStrictEqual(
        {
          afterOpen,
          sameContainer: await devContainersOf(folder),
          afterRestart,
          afterReload,
        },
        {
          afterOpen: [1, 1, 1, 1, 1, 1],
          sameContainer: [containerId],
          afterRestart: [2, 1, 1, 1, 2, 2],
          afterReload: [3, 1, 1, 1, 2, 3],
        },
      );
      await closeWindow(second);
    } finally {
      await removeContainers(folder);
    }
  });
});
