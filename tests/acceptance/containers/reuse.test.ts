import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';
import {dialogOf, type ShownDialog} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from './folder-windows.ts';

const execFileAsync = promisify(execFile);

/** What `docker inspect` says of a container. */
interface Inspected {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  labels: Record<string, string>;
}

/** What `docker inspect` says of container `containerId`: its full id, name, status, start time and labels. */
async function inspectOf(containerId: string): Promise<Inspected> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.StartedAt}}|{{json .Config.Labels}}',
    containerId,
  ]);
  const [fullId = '', name = '', status = '', startedAt = '', ...labels] =
    stdout.trim().split('|');
  return {
    id: fullId,
    name,
    status,
    startedAt,
    labels: JSON.parse(labels.join('|')) as Record<string, string>,
  };
}

/** The one container of the run made for `folder`; it fails naming them when there isn't exactly one. */
async function containerOf(folder: string): Promise<string> {
  const containerIds = await devContainersOf(folder);
  deepStrictEqual(
    containerIds.length,
    1,
    `the containers of ${folder}: ${JSON.stringify(containerIds)}`,
  );
  return containerIds[0] ?? '';
}

/** Opens a local window on `folder`, reopens it in its container, and gives the window's name. */
async function reopened(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  return name;
}

/** Reopens `folder` in its container, closes the window, and gives the container it made. */
async function containerLeftBy(folder: string): Promise<string> {
  const name = await reopened(folder);
  const containerId = await containerOf(folder);
  await closeWindow(name);
  return containerId;
}

describe('the remaining Dev Containers gate rows (card containers-19)', function () {
  this.timeout(900_000);

  it('F-0409 AC-1, AC-3 (gate-row-3): a folder gets one new container with a generated name and the folder labels, and the next Reopen reuses it while it runs', async () => {
    const folder = devContainerFolder('reuse-same', {name: 'Reuse'});
    try {
      const created = await inspectOf(await containerLeftBy(folder));
      const second = await reopened(folder);
      const containerIds = await devContainersOf(folder);
      const reused = await inspectOf(containerIds[0] ?? '');
      await closeWindow(second);
      deepStrictEqual(
        {
          generatedName: !['/', `/${path.basename(folder)}`].includes(
            created.name,
          ),
          labels: [
            created.labels['devcontainer.local_folder'],
            created.labels['devcontainer.config_file'],
          ],
          containers: containerIds.length,
          sameId: reused.id === created.id,
          startedAt: reused.startedAt,
        },
        {
          generatedName: true,
          labels: [
            folder,
            path.join(folder, '.devcontainer', 'devcontainer.json'),
          ],
          containers: 1,
          sameId: true,
          startedAt: created.startedAt,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-2 (gate-row-4): a stopped container is started again with the same id, and no dialog shows', async () => {
    const folder = devContainerFolder('reuse-stopped');
    try {
      const stopped = await inspectOf(await containerLeftBy(folder));
      await execFileAsync('docker', ['stop', stopped.id]);
      const name = await reopened(folder);
      const dialog = await dialogOf(name);
      const containerIds = await devContainersOf(folder);
      const started = await inspectOf(containerIds[0] ?? '');
      await closeWindow(name);
      deepStrictEqual(
        {
          containers: containerIds.length,
          sameId: started.id === stopped.id,
          status: started.status,
          later: started.startedAt > stopped.startedAt,
          dialog,
        },
        {
          containers: 1,
          sameId: true,
          status: 'running',
          later: true,
          dialog: undefined,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0409 AC-6 (r4b): a container removed outside the editor is made again silently, with a new id', async () => {
    const folder = devContainerFolder('reuse-removed');
    try {
      const removed = await containerLeftBy(folder);
      await execFileAsync('docker', ['rm', '-f', removed]);
      const name = await openFolderWindow(folder);
      const shown: ShownDialog[] = [];
      const watch = {connected: false};
      const polling = (async () => {
        while (!watch.connected) {
          // A window that reloads into its container has no page for a moment; that's no dialog.
          const dialog = await dialogOf(name).catch(() => undefined);
          if (dialog !== undefined) {
            shown.push(dialog);
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      })();
      await reopenInContainer(name);
      watch.connected = true;
      await polling;
      const containerIds = await devContainersOf(folder);
      const remoteName = (await windowState(name)).remoteName;
      await closeWindow(name);
      deepStrictEqual(
        {
          containers: containerIds.length,
          newId: containerIds[0] !== removed,
          remoteName,
          shown,
        },
        {containers: 1, newId: true, remoteName: 'dev-container', shown: []},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0412 AC-41 (t41): the image tags of folders with odd names are the pinned CLI’s, and Docker accepts each', async () => {
    const cases = [
      {
        folder: '.f412x-_a..b___c_.d',
        image: /^vsc-f412x-a\.b__c_d-[0-9a-f]{64}$/,
      },
      {folder: 'f412end.', image: /^vsc-f412end\.[0-9a-f]{64}$/},
      {folder: '-f412lead', image: /^vsc--f412lead-[0-9a-f]{64}$/},
    ];
    const folders = cases.map(each => {
      const folder = devContainerFolder(each.folder, {
        image: undefined,
        build: {dockerfile: 'Dockerfile'},
      });
      writeFileSync(
        path.join(folder, '.devcontainer', 'Dockerfile'),
        `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n`,
      );
      return folder;
    });
    try {
      for (const folder of folders) {
        await closeWindow(await reopened(folder));
      }
      const {stdout} = await execFileAsync('docker', [
        'images',
        '--format',
        '{{.Repository}}',
      ]);
      const repositories = stdout.split('\n');
      console.log(
        `containers-19 T41: the vsc- images: ${JSON.stringify(repositories.filter(each => each.includes('f412')))}`,
      );
      deepStrictEqual(
        cases.map(each =>
          repositories.some(repository => each.image.test(repository)),
        ),
        [true, true, true],
      );
    } finally {
      for (const folder of folders) {
        await removeContainers(folder);
      }
    }
  });
});
