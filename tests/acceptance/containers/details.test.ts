import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  dockerVolumes,
  inWindow,
  reopenInContainer,
  variable,
  waitFor,
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
    const attributes = (await rows()).slice(0, 5);
    await toggleRow(name, title, 'Attributes');
    await toggleRow(name, title, 'Volume mount');
    const mounts = await rows();
    const before = [await devContainersOf(folder), await dockerVolumes()];
    const notified = await notificationCentre(name);
    await inWindow(name, 'remote-containers.explorerDetailsRefresh');
    await new Promise(resolve => setTimeout(resolve, 2000));
    deepStrictEqual(
      [
        attributes,
        mounts,
        await rows(),
        await notificationCentre(name),
        [await devContainersOf(folder), await dockerVolumes()],
      ],
      [
        [
          '1 Attributes: ',
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
        notified,
        before,
      ],
    );
    await closeWindow(name);
  });
});
