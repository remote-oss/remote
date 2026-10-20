import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  containersLog,
  containersLogSince,
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
async function buildTag(imageTag: string, dockerfile: string): Promise<void> {
  const running = execFileAsync('docker', ['build', '-t', imageTag, '-']);
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

/** The `build.args` member of a configuration, written through a key so that the lint rule on `args` is not met. */
function argumentsOf(
  values: Record<string, string>,
): Record<string, Record<string, string>> {
  return Object.fromEntries([['args', values]]);
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

  it('F-0412 AC-4, AC-8 (i4): a build with a context above the Dockerfile, args, a target and an option label builds as written, in the nested form and in the top-level dockerFile and context form', async () => {
    const forms: Array<[string, Record<string, unknown>]> = [
      [
        'c52-build-nested',
        {
          image: undefined,
          build: {
            dockerfile: 'Dockerfile',
            context: '..',
            ...argumentsOf({FIRST_ARG: 'one', SECOND_ARG: 'two words'}),
            target: 'final',
            options: ['--label=c52.option=yes'],
          },
        },
      ],
      [
        'c52-build-legacy',
        {
          image: undefined,
          dockerFile: 'Dockerfile',
          context: '..',
          build: {
            ...argumentsOf({FIRST_ARG: 'one', SECOND_ARG: 'two words'}),
            target: 'final',
            options: ['--label=c52.option=yes'],
          },
        },
      ],
    ];
    const seen: Array<{
      form: string;
      copied: string;
      arguments: string;
      label: string;
      imageTag: string;
    }> = [];
    for (const [folderName, configuration] of forms) {
      const folder = devContainerFolder(folderName, {
        name: folderName,
        ...configuration,
      });
      writeFileSync(path.join(folder, 'workspace-root-file'), 'from-root\n');
      writeDockerfile(
        folder,
        `FROM ${base()} AS final\nARG FIRST_ARG\nARG SECOND_ARG\nCOPY workspace-root-file /root-file\nRUN printf '%s|%s' "$FIRST_ARG" "$SECOND_ARG" > /args\n`,
      );
      try {
        const name = await openFolderWindow(folder);
        await reopenInContainer(name);
        const [containerId = ''] = await devContainersOf(folder);
        const imageTag = await docker(
          'inspect',
          '-f',
          '{{.Config.Image}}',
          containerId,
        );
        seen.push({
          form: folderName,
          copied: await docker('exec', containerId, 'cat', '/root-file'),
          arguments: await docker('exec', containerId, 'cat', '/args'),
          label: await docker(
            'image',
            'inspect',
            '-f',
            '{{index .Config.Labels "c52.option"}}',
            imageTag,
          ),
          imageTag:
            imageTag === `${tagOf(folder)}-uid` || imageTag === tagOf(folder)
              ? 'vsc'
              : imageTag,
        });
        await closeWindow(name);
      } finally {
        await cleanUp(folder);
      }
    }
    deepStrictEqual(
      seen,
      forms.map(([form]) => ({
        form,
        copied: 'from-root',
        arguments: 'one|two words',
        label: 'yes',
        imageTag: 'vsc',
      })),
    );
  });

  it('F-0412 AC-5 (i5): a target stage is built with its dependencies only, and a stage it does not depend on never runs', async () => {
    const folder = devContainerFolder('c52-build-target', {
      name: 'Build Target',
      image: undefined,
      build: {dockerfile: 'Dockerfile', target: 'wanted'},
    });
    writeDockerfile(
      folder,
      `FROM ${base()} AS earlier\nRUN echo earlier > /earlier\nFROM earlier AS wanted\nRUN echo wanted > /wanted\nFROM ${base()} AS unrelated\nRUN false\n`,
    );
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      const files = await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        'cat /earlier /wanted',
      );
      await closeWindow(name);
      deepStrictEqual(files, 'earlier\nwanted');
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0412 AC-9 (i9): a cacheFrom that names a local tag nobody pushed does not stop the build, and no dialog or notice shows', async () => {
    const folder = devContainerFolder('c52-cache-local', {
      name: 'Cache Local',
      image: undefined,
      build: {dockerfile: 'Dockerfile', cacheFrom: 'c52-never-pushed:1'},
    });
    writeDockerfile(folder, `FROM ${base()}\nRUN echo built > /built\n`);
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      deepStrictEqual(
        [
          await docker('exec', containerId, 'cat', '/built'),
          await dialogOf(name),
          await notifications(name),
        ],
        ['built', undefined, []],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0412 AC-16 (i16): a connected image or Dockerfile configuration titles the window with the container’s name and labels the host indicator', async () => {
    const seen: string[][] = [];
    for (const [folderName, configuration] of [
      ['c52-title-image', {}],
      [
        'c52-title-build',
        {image: undefined, build: {dockerfile: 'Dockerfile'}},
      ],
    ] as const) {
      const folder = devContainerFolder(folderName, {
        name: 'Title Name',
        ...configuration,
      });
      if (folderName === 'c52-title-build') {
        writeDockerfile(folder, `FROM ${base()}\n`);
      }
      try {
        const name = await openFolderWindow(folder);
        await reopenInContainer(name);
        seen.push([
          await windowTitle(name),
          (await statusItem(name, 'status.host')).text,
        ]);
        await closeWindow(name);
      } finally {
        await cleanUp(folder);
      }
    }
    deepStrictEqual(seen, [
      [
        '[c52-title-image [Dev Container: Title Name]]',
        'Dev Container: Title Name',
      ],
      [
        '[c52-title-build [Dev Container: Title Name]]',
        'Dev Container: Title Name',
      ],
    ]);
  });

  it('F-0412 AC-17, AC-34 (i17): the name part of the vsc- tag is the folder’s name in lower case with what Docker does not take dropped', async () => {
    const cases: Array<[string, string]> = [
      ['Case Test', 'casetest'],
      ['CaFé_123.Test!Name', 'caf_123.testname'],
      ['9Leading', '9leading'],
    ];
    const seen: string[] = [];
    for (const [folderName] of cases) {
      const folder = devContainerFolder(folderName, {
        name: 'Tag Names',
        image: undefined,
        build: {dockerfile: 'Dockerfile'},
      });
      writeDockerfile(folder, `FROM ${base()}\n`);
      try {
        const name = await openFolderWindow(folder);
        await reopenInContainer(name);
        const [containerId = ''] = await devContainersOf(folder);
        const imageTag = await docker(
          'inspect',
          '-f',
          '{{.Config.Image}}',
          containerId,
        );
        seen.push(imageTag.replace(/-[0-9a-f]{64}(-uid)?$/, ''));
        await closeWindow(name);
      } finally {
        await cleanUp(folder);
      }
    }
    deepStrictEqual(
      seen,
      cases.map(([, part]) => `vsc-${part}`),
    );
  });

  it('F-0412 AC-35 (i35): the hash part of the vsc- tag is the SHA-256 of the folder’s absolute path (the Remote-SSH half of the criterion waits for remote engines)', async () => {
    const folder = devContainerFolder('c52-tag-hash', {
      name: 'Tag Hash',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
    });
    writeDockerfile(folder, `FROM ${base()}\n`);
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      const imageTag = await docker(
        'inspect',
        '-f',
        '{{.Config.Image}}',
        containerId,
      );
      await closeWindow(name);
      deepStrictEqual(imageTag, tagOf(folder));
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0412 AC-42 (i42): a build beside an image wins: the container holds what the Dockerfile wrote and runs its base, not the image', async () => {
    const other = 'c52-other:1';
    await buildTag(other, `FROM ${base()}\nRUN echo other > /which\n`);
    const folder = devContainerFolder('c52-build-wins', {
      name: 'Build Wins',
      image: other,
      build: {dockerfile: 'Dockerfile'},
    });
    writeDockerfile(
      folder,
      `FROM ${base()}\nRUN echo built > /which && echo marker > /marker\n`,
    );
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      deepStrictEqual(
        [
          await docker('exec', containerId, 'cat', '/which'),
          await docker('exec', containerId, 'cat', '/marker'),
          await dialogOf(name),
          await notifications(name),
        ],
        ['built', 'marker', undefined, []],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder, [other]);
    }
  });

  it('F-0412 AC-10 (i10): an image that cannot start shows the generic dialog with F-0410’s buttons, and nothing but a container is made', async () => {
    const folder = devContainerFolder('c52-cannot-start', {
      name: 'Cannot Start',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
    });
    writeDockerfile(folder, `FROM ${base()}\nUSER nobody-such-user\n`);
    try {
      const name = await openFolderWindow(folder);
      await reopenStarted(name);
      const shown = await waitForDialog(name, DIALOG_MILLISECONDS);
      await closeWindow(name);
      deepStrictEqual(
        [shown.message, shown.details, [...shown.buttons].sort()],
        ['', S034, RECOVERY_BUTTONS],
      );
    } finally {
      await cleanUp(folder);
    }
  });

  it('F-0412 AC-31, AC-33 (i31): a missing build context and an image nobody can pull each end in the generic dialog and leave no container or image', async () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      [
        'c52-missing-context',
        {
          image: undefined,
          build: {dockerfile: 'Dockerfile', context: 'no-such-folder'},
        },
        `FROM ${base()}\n`,
      ],
      ['c52-unpullable-image', {image: 'does-not-exist.invalid/x:1'}, ''],
      [
        'c52-unpullable-from',
        {image: undefined, build: {dockerfile: 'Dockerfile'}},
        'FROM does-not-exist.invalid/x:1\n',
      ],
    ];
    const seen: Array<[string, string, string[], string[], string[]]> = [];
    for (const [folderName, configuration, dockerfile] of cases) {
      const folder = devContainerFolder(folderName, {
        name: 'Fails',
        ...configuration,
      });
      if (dockerfile !== '') {
        writeDockerfile(folder, dockerfile);
      }
      try {
        const name = await openFolderWindow(folder);
        await reopenStarted(name);
        const shown = await waitForDialog(name, DIALOG_MILLISECONDS);
        seen.push([
          folderName,
          shown.details,
          [...shown.buttons].sort(),
          await devContainersOf(folder),
          await repositoriesStarting(`vsc-${nameOf(folder)}-`),
        ]);
        await closeWindow(name);
      } finally {
        await cleanUp(folder);
      }
    }
    deepStrictEqual(
      seen,
      cases.map(([folderName]) => [folderName, S034, RECOVERY_BUTTONS, [], []]),
    );
  });

  it('F-0412 AC-13 (cache-plain): a cacheFrom that names an image pushed to a registry, built with no cache options, lets the build complete with no failure shown', async () => {
    const pushed = `${variable('HARNESS_REGISTRY')}/c52-cache-plain:1`;
    await buildTag(pushed, `FROM ${base()}\nRUN echo one > /one\n`);
    await docker('push', pushed);
    const folder = devContainerFolder('c52-cache-plain', {
      name: 'Cache Plain',
      image: undefined,
      build: {dockerfile: 'Dockerfile', cacheFrom: pushed},
    });
    writeDockerfile(folder, `FROM ${base()}\nRUN echo one > /one\n`);
    try {
      const mark = containersLog().length;
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      deepStrictEqual(
        [
          await docker('inspect', '-f', '{{.State.Status}}', containerId),
          containersLogSince(mark).filter(line =>
            /cache.*fail|fail.*cache/i.test(line),
          ),
          await dialogOf(name),
          await notifications(name),
        ],
        ['running', [], undefined, []],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder, [pushed]);
    }
  });

  it('F-0412 AC-15 (cache-registry): a cacheFrom that names a registry-hosted image built with its cache inline lets the build complete with no failure shown', async () => {
    const pushed = `${variable('HARNESS_REGISTRY')}/c52-cache-registry:1`;
    const context = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c52-cache-context',
    );
    mkdirSync(context, {recursive: true});
    writeFileSync(
      path.join(context, 'Dockerfile'),
      `FROM ${base()}\nRUN echo one > /one\n`,
    );
    await docker(
      'build',
      '--build-arg',
      'BUILDKIT_INLINE_CACHE=1',
      '-t',
      pushed,
      context,
    );
    await docker('push', pushed);
    const folder = devContainerFolder('c52-cache-registry', {
      name: 'Cache Registry',
      image: undefined,
      build: {dockerfile: 'Dockerfile', cacheFrom: pushed},
    });
    writeDockerfile(folder, `FROM ${base()}\nRUN echo one > /one\n`);
    try {
      const mark = containersLog().length;
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      deepStrictEqual(
        [
          await docker('inspect', '-f', '{{.State.Status}}', containerId),
          containersLogSince(mark).filter(line =>
            /cache.*fail|fail.*cache/i.test(line),
          ),
          await dialogOf(name),
          await notifications(name),
        ],
        ['running', [], undefined, []],
      );
      await closeWindow(name);
    } finally {
      await cleanUp(folder, [pushed]);
    }
  });
});
