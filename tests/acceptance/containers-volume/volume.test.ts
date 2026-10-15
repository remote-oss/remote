import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  openFolderWindow,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';

const execFileAsync = promisify(execFile);

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
    deepStrictEqual(
      {
        remoteName: state.remoteName,
        containers: (await devContainersOf(folder)).length,
        shared: folders.slice(0, 3).map(line => line.split(' ').slice(0, 2)),
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
        depths: [3, 4, 5, 6],
        commitOwner: 'node',
      },
    );
    await closeWindow(name);
  });
});
