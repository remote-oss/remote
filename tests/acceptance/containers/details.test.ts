import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  containersLog,
  containersLogSince,
  devContainerFolder,
  devContainersOf,
  dockerContainers,
  dockerImages,
  dockerVolumes,
  inWindow,
  readUserSettings,
  reopenInContainer,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {notificationCentre, toggleRow, viewRows} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The command of "View: Show Remote Explorer". */
const SHOW_REMOTE_EXPLORER = 'workbench.view.remote';

describe('the Details (Containers) view (card containers-33)', function () {
  this.timeout(600_000);

  it('F-0903 AC-1, AC-30 (gate-row-19): in the dev container window the section is titled with the folder and shows Attributes and Mounts, and Refresh changes nothing', async () => {
    const folder = devContainerFolder('gate-details', {name: 'Gate Details'});
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    await inWindow(name, SHOW_REMOTE_EXPLORER);
    const title = path.basename(folder);
    async function rows(): Promise<string[]> {
      return (
        (await viewRows(name, title))?.map(
          shown =>
            `${String(shown.level)} ${shown.label}: ${shown.description}`,
        ) ?? []
      );
    }
    await waitFor(
      `the Details section ${title} to show its rows`,
      async () => (await rows()).length > 0,
      60_000,
    );
    const [containerId = ''] = await devContainersOf(folder);
    const {stdout: containerName} = await execFileAsync('docker', [
      'inspect',
      '--format',
      '{{.Name}}',
      containerId,
    ]);
    const attributes = (await rows()).slice(0, 6);
    await toggleRow(name, title, 'Attributes');
    await toggleRow(name, title, 'Volume mount');
    const mounts = await rows();
    const before = [
      await devContainersOf(folder),
      await dockerVolumes(),
      await dockerImages(),
    ];
    await inWindow(name, 'remote-containers.explorerDetailsRefresh');
    await new Promise(resolve => setTimeout(resolve, 2000));
    deepStrictEqual(
      [
        attributes,
        mounts,
        await rows(),
        await notificationCentre(name),
        [
          await devContainersOf(folder),
          await dockerVolumes(),
          await dockerImages(),
        ],
      ],
      [
        [
          '1 Attributes: ',
          `2 Workspace: ${folder}`,
          `2 Name: ${containerName.trim()}`,
          `2 Image: ${variable('HARNESS_DEVCONTAINER_IMAGE')}`,
          `2 Configuration: ${path.join(folder, '.devcontainer', 'devcontainer.json')}`,
          '1 Mounts: ',
        ],
        [
          '1 Attributes: ',
          '1 Mounts: ',
          '2 Volume mount: ',
          '2 Bind mount: ',
          `3 Source: ${folder}`,
          `3 Destination: /workspaces/${title}`,
        ],
        mounts,
        [],
        before,
      ],
    );
    await closeWindow(name);
  });

  it('#1367 (quiet-wait): in a local folder window the Dev Containers log holds no Details-view line in the 30 s after the window opens, and none is repeated', async () => {
    const folder = devContainerFolder('c99-quiet', {name: 'c99'});
    const mark = containersLog().length;
    const name = await openFolderWindow(folder);
    try {
      await new Promise(resolve => setTimeout(resolve, 30_000));
      const lines = containersLogSince(mark);
      deepStrictEqual(
        [
          lines.filter(line => line.includes('Details view')),
          lines.filter(
            (line, index) =>
              lines.indexOf(line) !== index &&
              line.includes('view is not registered'),
          ),
        ],
        [[], []],
      );
    } finally {
      await closeWindow(name);
    }
  });

  it('F-0903 AC-35 (refresh-anywhere): the Refresh command, run before the Remote Explorer is shown and after, in a window with no Details section, changes no container, volume or image, writes no settings, and leaves the window usable', async () => {
    const before = [
      await dockerContainers(),
      await dockerVolumes(),
      await dockerImages(),
      readUserSettings(),
    ];
    await inWindow('local', 'remote-containers.explorerDetailsRefresh');
    await inWindow('local', SHOW_REMOTE_EXPLORER);
    await inWindow('local', 'remote-containers.explorerDetailsRefresh');
    await new Promise(resolve => setTimeout(resolve, 2000));
    deepStrictEqual(
      [
        await dockerContainers(),
        await dockerVolumes(),
        await dockerImages(),
        readUserSettings(),
        (await windowState('local')).remoteName,
      ],
      [...before, null],
    );
  });

  it('F-0903 AC-8 (rebuild): after Rebuild Container the section is the container’s again, titled with its folder, with a new Name and the same Image and volumes', async () => {
    const folder = devContainerFolder('details-rebuild', {name: 'Rebuild'});
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    await inWindow(name, SHOW_REMOTE_EXPLORER);
    const title = path.basename(folder);
    /** The Name and Image descriptions of the section, and the names of its volumes. */
    async function shown(): Promise<{
      name: string;
      image: string;
      volumes: string[];
    }> {
      let found = {name: '', image: '', volumes: [] as string[]};
      await waitFor(
        `the Details section ${title} to show its rows`,
        async () => {
          try {
            const rows = (await viewRows(name, title)) ?? [];
            const named = rows.find(each => each.label === 'Name');
            if (named === undefined) {
              return false;
            }
            found = {
              name: named.description,
              image:
                rows.find(each => each.label === 'Image')?.description ?? '',
              volumes: rows
                .filter(each => each.label === 'Volume')
                .map(each => each.description),
            };
            return true;
          } catch {
            return false;
          }
        },
        60_000,
      );
      return found;
    }
    const first = await shown();
    await reopenInContainer(
      name,
      300_000,
      'remote-containers.rebuildContainer',
    );
    await inWindow(name, SHOW_REMOTE_EXPLORER);
    const second = await shown();
    deepStrictEqual(
      [
        first.name !== second.name && second.name !== '',
        second.image,
        second.volumes,
      ],
      [true, first.image, first.volumes],
    );
    await closeWindow(name);
  });
});
