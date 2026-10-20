import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  reopenStarted,
  variable,
} from '../windows/harness.ts';
import {
  dialogOf,
  notifications,
  statusItem,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The string of the editor's table that the failed-setup dialog shows, and F-0410's three buttons, sorted. */
const S034 = 'An error occurred setting up the container.';
const RECOVERY_BUTTONS = [
  'Edit devcontainer.json Locally',
  'More Actions...',
  'Retry',
];

/** How long a connect that ends in a dialog takes. */
const DIALOG_MILLISECONDS = 180_000;

/** The output of `docker` run with `parameters`, trimmed. */
async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** `docker build` of `dockerfile`, given on standard input, as `tag`. */
async function buildTag(tag: string, dockerfile: string): Promise<void> {
  const running = execFileAsync('docker', ['build', '-t', tag, '-']);
  running.child.stdin?.end(dockerfile);
  await running;
}

/** The repositories of the engine's images that start with `prefix`, sorted. */
async function repositoriesStarting(prefix: string): Promise<string[]> {
  return (await docker('images', '--format', '{{.Repository}}'))
    .split('\n')
    .filter(each => each.startsWith(prefix))
    .sort();
}

/** The part of a `vsc-` tag that names `folder`: its base name in lower case, with what Docker does not take dropped. */
function nameOf(folder: string): string {
  return path
    .basename(folder)
    .toLowerCase()
    .replaceAll(/[^a-z0-9_.-]/g, '');
}

/** The tag the CLI gives the image it builds for `folder`, without `-uid`. */
function tagOf(folder: string): string {
  return `vsc-${nameOf(folder)}-${createHash('sha256').update(folder).digest('hex')}`;
}

/** Removes the containers of `folder` and the images the CLI made for it, and `extra` ones. */
async function cleanUp(
  folder: string,
  extra: readonly string[] = [],
): Promise<void> {
  await removeContainers(folder);
  const made = await repositoriesStarting(`vsc-${nameOf(folder)}-`);
  const all = [...made, ...extra];
  if (all.length > 0) {
    await execFileAsync('docker', ['image', 'rm', '-f', ...all]).catch(
      () => undefined,
    );
  }
}

/** Writes the Dockerfile of `folder`'s `.devcontainer` folder, or of `relative` under it. */
function writeDockerfile(
  folder: string,
  text: string,
  relative = 'Dockerfile',
) {
  const file = path.join(folder, '.devcontainer', relative);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, text);
}

/** The base image of the run, for Dockerfiles. */
function base(): string {
  return variable('HARNESS_DEVCONTAINER_IMAGE');
}

describe('F-0412 the image and Dockerfile paths (card containers-52)', function () {
  this.timeout(900_000);

  it('F-0412 AC-1, AC-2 (i1): an image-only configuration builds no vsc- image of the folder, and a root image runs as the literal image string', async () => {
    const folder = devContainerFolder('c52-image-only', {name: 'Image Only'});
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      const image = await docker(
        'inspect',
        '-f',
        '{{.Config.Image}}',
        containerId,
      );
      const made = await repositoriesStarting(`vsc-${nameOf(folder)}-`);
      await closeWindow(name);
      deepStrictEqual([image, made], [base(), []]);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0412 AC-3, AC-7 (i3): a non-root image runs a -uid image built on it, and a built image keeps its unsuffixed tag beside the -uid one', async () => {
    const nonRoot = 'c52-nonroot:1';
    await buildTag(nonRoot, `FROM ${base()}\nUSER node\n`);
    const imageFolder = devContainerFolder('c52-nonroot-image', {
      name: 'Non Root',
      image: nonRoot,
    });
    const builtFolder = devContainerFolder('c52-nonroot-built', {
      name: 'Non Root Built',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
    });
    writeDockerfile(builtFolder, `FROM ${base()}\nUSER node\n`);
    try {
      const first = await openFolderWindow(imageFolder);
      await reopenInContainer(first);
      const [firstId = ''] = await devContainersOf(imageFolder);
      const imageRun = await docker(
        'inspect',
        '-f',
        '{{.Config.Image}}',
        firstId,
      );
      await closeWindow(first);
      const second = await openFolderWindow(builtFolder);
      await reopenInContainer(second);
      const [secondId = ''] = await devContainersOf(builtFolder);
      const builtRun = await docker(
        'inspect',
        '-f',
        '{{.Config.Image}}',
        secondId,
      );
      const builtImages = await repositoriesStarting(
        `vsc-${nameOf(builtFolder)}-`,
      );
      await closeWindow(second);
      deepStrictEqual(
        [imageRun, builtRun, builtImages],
        [
          `${tagOf(imageFolder)}-uid`,
          `${tagOf(builtFolder)}-uid`,
          [tagOf(builtFolder), `${tagOf(builtFolder)}-uid`],
        ],
      );
    } finally {
      await cleanUp(imageFolder);
      await cleanUp(builtFolder, [nonRoot]);
    }
  });
});
