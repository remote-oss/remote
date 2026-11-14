import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  inWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  type ShownDialog,
  waitForDialog,
} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The key the dev container format gives the GPU requirement, which is shorter than a name may be. */
const GPU_KEY = 'gpu';

const MESSAGE =
  'Not all host requirements in devcontainer.json are met by the Docker daemon.';

/** Starts Reopen in Container and gives the dialog the host requirements raise, with the command still pending. */
async function dialogOfReopen(name: string): Promise<{
  dialog: ShownDialog;
  running: Promise<unknown>;
}> {
  const running = inWindow(name, 'remote-containers.reopenInContainer');
  running.catch(() => undefined);
  return {dialog: await waitForDialog(name, 120_000), running};
}

/** Waits until window `name` is on the dev container authority and the folder's container exists: the authority comes first, while the window still resolves. */
async function waitForContainer(name: string, folder: string): Promise<void> {
  await waitFor(
    `the container of ${folder}`,
    async () =>
      (await windowState(name)).remoteName === 'dev-container' &&
      (await devContainersOf(folder)).length === 1,
    300_000,
  );
}

/** The limits a container's host configuration holds, as the engine reports them. */
async function limitsOf(containerId: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    '{{.HostConfig.NanoCpus}} {{.HostConfig.CpuQuota}} {{.HostConfig.Memory}}',
    containerId,
  ]);
  return stdout.trim();
}

describe('Host requirements rows (card containers-202, F-0206)', function () {
  this.timeout(600_000);

  it('F-0206 AC-3, AC-5, AC-6 (c202-cancel): requirements no runner meets show the dialog with the daemon’s figures and the configuration’s CPUs, Cancel leaves the window local with no container, and the same command shows it again', async () => {
    const folder = devContainerFolder('c202-cancel', {
      name: 'C202 Cancel',
      hostRequirements: {cpus: 4096},
    });
    const name = await openFolderWindow(folder);
    const shown: ShownDialog[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const {dialog, running} = await dialogOfReopen(name);
      shown.push(dialog);
      await answerDialog(name, 'Cancel');
      await running;
    }
    deepStrictEqual(
      {
        messages: shown.map(dialog => dialog.message),
        details: shown.map(dialog =>
          /^Docker daemon: CPUs \d+, RAM [\d.]+gb(, GPU)?\s*devcontainer\.json: CPUs 4096$/.test(
            dialog.details,
          ),
        ),
        buttons: shown.map(dialog => [...dialog.buttons].sort()),
        remoteName: (await windowState(name)).remoteName,
        containers: await devContainersOf(folder),
      },
      {
        messages: [MESSAGE, MESSAGE],
        details: [true, true],
        buttons: [
          ['Cancel', 'Continue'],
          ['Cancel', 'Continue'],
        ],
        remoteName: null,
        containers: [],
      },
    );
    await closeWindow(name);
  });

  it('F-0206 AC-4 (c202-continue): Continue creates the container and connects, with no CPU or memory limit applied', async () => {
    const folder = devContainerFolder('c202-continue', {
      name: 'C202 Continue',
      hostRequirements: {cpus: 4096},
    });
    try {
      const name = await openFolderWindow(folder);
      const {running} = await dialogOfReopen(name);
      await answerDialog(name, 'Continue');
      await running;
      await waitForContainer(name, folder);
      const [containerId = ''] = await devContainersOf(folder);
      deepStrictEqual(
        {
          containers: (await devContainersOf(folder)).length,
          limits: await limitsOf(containerId),
        },
        {containers: 1, limits: '0 0 0'},
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0206 AC-23 (c217-pull-first): BR-13, an image whose details its registry cannot give is pulled before the dialog shows its label’s requirements, and Cancel leaves the image pulled and no container', async () => {
    const reference = `${variable('HARNESS_REGISTRY').replace('127.0.0.1', 'localhost')}/c217-pull-first:${String(Date.now())}`;
    const context = await mkdtemp(path.join(tmpdir(), 'c217-'));
    await writeFile(
      path.join(context, 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nLABEL devcontainer.metadata='[{"hostRequirements":{"cpus":1024}}]'\n`,
    );
    await execFileAsync('docker', ['build', '--tag', reference, context]);
    await execFileAsync('docker', ['push', reference]);
    await execFileAsync('docker', ['image', 'rm', reference]);
    const folder = devContainerFolder('c217-pull-first', {
      name: 'C217 Pull First',
      image: reference,
    });
    try {
      const name = await openFolderWindow(folder);
      const since = Math.floor(Date.now() / 1000);
      const {dialog, running} = await dialogOfReopen(name);
      const {stdout: pulls} = await execFileAsync('docker', [
        'events',
        '--since',
        String(since),
        '--until',
        String(Math.floor(Date.now() / 1000) + 1),
        '--filter',
        'type=image',
        '--filter',
        'event=pull',
        '--format',
        '{{.Actor.ID}}',
      ]);
      await answerDialog(name, 'Cancel');
      await running;
      const local = await execFileAsync('docker', [
        'image',
        'inspect',
        '--format',
        '{{.Id}}',
        reference,
      ]).then(
        () => true,
        () => false,
      );
      deepStrictEqual(
        {
          pulledBeforeDialog: pulls.split('\n').includes(reference),
          cpus: dialog.details.endsWith('devcontainer.json: CPUs 1024'),
          local,
          containers: await devContainersOf(folder),
        },
        {pulledBeforeDialog: true, cpus: true, local: true, containers: []},
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
      await execFileAsync('docker', [
        'image',
        'rm',
        '--force',
        reference,
      ]).catch(() => undefined);
      await rm(context, {recursive: true, force: true});
    }
  });

  it('F-0206 AC-37 (c217-hub): BR-13, an image the registry gives its details for is not pulled before the dialog, which shows the file’s requirements', async () => {
    const reference = 'alpine:3.22';
    await execFileAsync('docker', ['image', 'rm', reference]).catch(
      () => undefined,
    );
    const folder = devContainerFolder('c217-hub', {
      name: 'C217 Hub',
      image: reference,
      hostRequirements: {cpus: 4096},
    });
    try {
      const name = await openFolderWindow(folder);
      const since = Math.floor(Date.now() / 1000);
      const {dialog, running} = await dialogOfReopen(name);
      const {stdout: pulls} = await execFileAsync('docker', [
        'events',
        '--since',
        String(since),
        '--until',
        String(Math.floor(Date.now() / 1000) + 1),
        '--filter',
        'type=image',
        '--filter',
        'event=pull',
        '--format',
        '{{.Actor.ID}}',
      ]);
      await answerDialog(name, 'Cancel');
      await running;
      deepStrictEqual(
        {
          pulls: pulls.trim(),
          cpus: dialog.details.endsWith('devcontainer.json: CPUs 4096'),
          containers: await devContainersOf(folder),
        },
        {pulls: '', cpus: true, containers: []},
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0206 AC-9, AC-18, AC-35 (c202-lines): the configuration’s part lists CPUs, RAM, disk and GPU in that order, in gibibytes with one decimal', async () => {
    const folder = devContainerFolder('c202-lines', {
      name: 'C202 Lines',
      hostRequirements: {
        cpus: 4096,
        memory: '70000mb',
        storage: '70000mb',
        [GPU_KEY]: true,
      },
    });
    const name = await openFolderWindow(folder);
    const {dialog, running} = await dialogOfReopen(name);
    await answerDialog(name, 'Cancel');
    await running;
    deepStrictEqual(
      /devcontainer\.json: (.+)$/.exec(dialog.details)?.[1],
      'CPUs 4096, RAM 68.4gb, disk 68.4gb, GPU',
    );
    await closeWindow(name);
  });

  it('F-0206 AC-20 (c202-ignored): a CPU count and a GPU setting the format does not read ask nothing: no dialog, and the container is created', async () => {
    const folder = devContainerFolder('c202-ignored', {
      name: 'C202 Ignored',
      hostRequirements: {
        cpus: 'not-a-number',
        [GPU_KEY]: 'sometimes',
        bogusExtraKey: 'x',
      },
    });
    try {
      const name = await openFolderWindow(folder);
      const running = inWindow(name, 'remote-containers.reopenInContainer');
      running.catch(() => undefined);
      await waitForContainer(name, folder);
      await running;
      deepStrictEqual((await devContainersOf(folder)).length, 1);
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });
});
