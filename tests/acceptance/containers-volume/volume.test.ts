import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {volumeServerFolder} from 'lib-product';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The detail of F-0410's generic dialog (S034). */
const SETUP_FAILED = 'An error occurred setting up the container.';

/** The product's server folder on the volume, from the application name of the editor under test and lib-product's rule. */
function serverFolderOf(): string {
  const product = JSON.parse(
    readFileSync(
      path.join(
        path.dirname(variable('HARNESS_VSCODIUM_EXECUTABLE')),
        'resources',
        'app',
        'product.json',
      ),
      'utf8',
    ),
  ) as {applicationName: string};
  return `/vscode/${volumeServerFolder(product.applicationName)}`;
}

/** Runs `script` as root in a throwaway container of the run's image that mounts the `vscode` volume; its stdout. */
async function onVolume(script: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'run',
    '--rm',
    '--user',
    'root',
    '--volume',
    'vscode:/vscode',
    variable('HARNESS_DEVCONTAINER_IMAGE'),
    'sh',
    '-c',
    script,
  ]);
  return stdout;
}

/** The running containers of another run that mount the `vscode` volume, as `<id> <run>` lines. */
async function othersOnVolume(): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'ps',
    '--filter',
    'volume=vscode',
    '--format',
    '{{.ID}} {{.Label "remote-oss.acceptance.run"}}',
  ]);
  return stdout
    .split('\n')
    .filter(line => line !== '')
    .filter(line => line.split(' ')[1] !== variable('HARNESS_RUN_ID'));
}

/** Empties the `vscode` volume, as a fresh one is: these rows need the volume alone, so another run's use fails them. */
async function clearVolume(): Promise<void> {
  const others = await othersOnVolume();
  if (others.length > 0) {
    throw new Error(
      `the vscode volume is in use by another run's containers: ${others.join(', ')}; this launch needs it alone`,
    );
  }
  await onVolume('rm -rf /vscode/* /vscode/.[!.]* 2>/dev/null; true');
}

/** The owner, mode and path of each server folder on the volume, to the commit folder's depth, in path order. */
async function serverFolders(): Promise<string[]> {
  const listing = await onVolume(
    "find /vscode -mindepth 1 -maxdepth 4 -path '/vscode/*-server*' -type d -exec stat -c '%U %a %n' {} \\;",
  );
  return listing
    .split('\n')
    .filter(line => line !== '')
    .sort(
      (left, right) =>
        left.split(' ')[2]?.localeCompare(right.split(' ')[2] ?? '') ?? 0,
    );
}

describe("C10's root step for the vscode volume (card containers-25)", function () {
  this.timeout(600_000);
  after(async () => {
    // Later launches install afresh into a volume of their own making.
    await clearVolume();
  });

  it('contracts §5.2 (v1): a non-root remote user connects on a fresh volume; the shared folders are root 0777 and the commit folder is the user’s', async () => {
    await clearVolume();
    const folder = devContainerFolder('volume-user', {
      name: 'Volume User',
      remoteUser: 'node',
    });
    const name = await openFolderWindow(folder);
    await reopenInContainer(name);
    const state = await windowState(name);
    const folders = await serverFolders();
    console.log(
      `containers-25 V1: the server folders: ${JSON.stringify(folders)}`,
    );
    const serverFolder = serverFolderOf();
    deepStrictEqual(
      {
        remoteName: state.remoteName,
        containers: (await devContainersOf(folder)).length,
        shared: folders.slice(0, 3).map(line => line.split(' ').slice(0, 2)),
        names: folders.slice(0, 2).map(line => line.split(' ')[2]),
        depths: folders.map(line => line.split(' ')[2]?.split('/').length),
        commitOwner: folders[3]?.split(' ')[0],
      },
      {
        remoteName: 'dev-container',
        containers: 1,
        shared: [
          ['root', '777'],
          ['root', '777'],
          ['root', '777'],
        ],
        names: [serverFolder, `${serverFolder}/bin`],
        depths: [3, 4, 5, 6],
        commitOwner: 'node',
      },
    );
    await closeWindow(name);
  });

  it('F-0419 AC-24 (v2): a server folder that is root 0700 stays so, the install fails with the setup dialog, and the missing folders under it are made 0777', async () => {
    await clearVolume();
    const serverFolder = serverFolderOf();
    await onVolume(`mkdir -m 0700 ${serverFolder}`);
    const folder = devContainerFolder('volume-closed', {
      name: 'Volume Closed',
      remoteUser: 'node',
    });
    const name = await openFolderWindow(folder);
    void reopenInContainer(name).catch(() => undefined);
    const dialog = await waitForDialog(name, 300_000);
    const folders = await serverFolders();
    console.log(
      `containers-25 V2: the server folders: ${JSON.stringify(folders)}`,
    );
    deepStrictEqual(
      {
        detail: dialog.details,
        folders: folders.map(line => line.split(' ').slice(0, 2)),
        first: folders[0]?.split(' ')[2],
      },
      {
        detail: SETUP_FAILED,
        // The kept 0700 folder, then its bin and bin/<platform> made 0777, and no commit folder.
        folders: [
          ['root', '700'],
          ['root', '777'],
          ['root', '777'],
        ],
        first: serverFolder,
      },
    );
    await answerDialog(name, 'Cancel');
    await closeWindow(name);
  });
});
