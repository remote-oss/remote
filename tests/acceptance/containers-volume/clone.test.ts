import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  openEmptyWindows,
  startInWindow,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {openMemoryWindow} from '../windows/folder-windows.ts';
import {
  acceptQuickPick,
  answerDialog,
  dialogOf,
  quickPickOf,
  typeInQuickPick,
  waitForDialog,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The repository the rows clone: public, with a `.devcontainer/devcontainer.json`. */
const REPOSITORY = 'https://github.com/microsoft/vscode-remote-try-node';

/** The repository's own name: the folder under `/workspaces`, and the window's. */
const FOLDER = 'vscode-remote-try-node';

/** A branch URL of the repository whose branch doesn't exist: it passes the pre-check, and the clone fails. */
const NO_BRANCH = `${REPOSITORY}/tree/no-such-branch-c151`;

/** The text of the clone warning, which shows once in the profile. */
const CLONE_WARNING =
  'Cloning a repository in a Dev Container may execute arbitrary code.';

/** The lines `docker` prints for `argv`, without empty ones. */
async function dockerLines(...argv: string[]): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', argv);
  return stdout.split('\n').filter(line => line !== '');
}

/** The volumes of the clone of `repository`, as `<name> <unique label>` lines. */
function clonedVolumes(repository: string): Promise<string[]> {
  return dockerLines(
    'volume',
    'ls',
    '--filter',
    `label=vsch.local.repository=${repository}`,
    '--format',
    '{{.Name}} {{.Label "vsch.local.repository.unique"}}',
  );
}

/** The containers, in any state, that carry `label`, as their ids. */
function containersWith(label: string): Promise<string[]> {
  return dockerLines('ps', '-a', '-q', '--filter', `label=${label}`);
}

/** The bootstrap containers, in any state, by the image they run. */
function bootstrapContainers(): Promise<string[]> {
  return dockerLines(
    'ps',
    '-a',
    '-q',
    '--filter',
    'ancestor=vsc-volume-bootstrap:latest',
  );
}

/** Removes what a clone of `repository` left: its dev containers, then its volumes. */
async function removeClone(repository: string): Promise<void> {
  const containers = await containersWith(
    `vsch.local.repository=${repository}`,
  );
  if (containers.length > 0) {
    await execFileAsync('docker', ['rm', '-f', ...containers]);
  }
  for (const line of await clonedVolumes(repository)) {
    await execFileAsync('docker', [
      'volume',
      'rm',
      '-f',
      String(line.split(' ')[0]),
    ]);
  }
}

/**
 * Runs the command in a new memory-folder window with `source` typed into its pick, giving the warning its Got It when
 * it shows (the first time in the profile).
 */
async function startClone(source: string): Promise<void> {
  const local = await openMemoryWindow();
  await startInWindow(local, 'remote-containers.openRepositoryInUniqueVolume');
  await waitFor(
    'the clone warning or the source pick',
    async () =>
      (await dialogOf(local)) !== undefined ||
      (await quickPickOf(local)) !== undefined,
    60_000,
  );
  if ((await dialogOf(local))?.message === CLONE_WARNING) {
    await answerDialog(local, 'Got It');
  }
  await typeInQuickPick(local, source);
  await acceptQuickPick(local);
}

/** Lists the folder `folder` of volume `volume` in a throwaway container: its entries, or `missing`. */
async function folderOfVolume(volume: string, folder: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'run',
    '--rm',
    '--volume',
    `${volume}:/w`,
    'alpine:3.20',
    'sh',
    '-c',
    'ls -A "/w/$0" 2>/dev/null | tr "\\n" " " || echo missing; [ -d "/w/$0" ] || echo missing',
    folder,
  ]);
  return stdout.trim();
}

describe('Clone Repository in Container Volume (card containers-151)', function () {
  this.timeout(1_200_000);
  before(async () => {
    await removeClone(REPOSITORY);
    await removeClone(NO_BRANCH);
  });

  after(async () => {
    await removeClone(REPOSITORY);
    await removeClone(NO_BRANCH);
  });

  it('F-0701 AC-6, AC-7 (c151-clone-url-part): a typed URL clones into a new unique volume through a bootstrap, connects the reloaded window, and the bootstrap is gone within 20 s', async () => {
    await startClone(REPOSITORY);
    await connectedToContainer(FOLDER, 900_000);
    const connectedAt = Date.now();
    await waitFor(
      'the bootstrap container to go',
      async () => (await bootstrapContainers()).length === 0,
      20_000,
    );
    const volumes = await clonedVolumes(REPOSITORY);
    const volume = String(volumes[0]?.split(' ')[0]);
    const devContainers = await containersWith(
      `vsch.local.repository.volume=${volume}`,
    );
    deepStrictEqual(
      {
        volumes: volumes.map(line =>
          line.replace(/-[0-9a-f]{64} /, '-<digest> '),
        ),
        devContainers: devContainers.length,
        remoteName: (await windowState(FOLDER)).remoteName,
        withinTwentySeconds: Date.now() - connectedAt <= 20_000,
      },
      {
        volumes: [`${FOLDER}-<digest> true`],
        devContainers: 1,
        remoteName: 'dev-container',
        withinTwentySeconds: true,
      },
    );
    await closeWindow(FOLDER);
  });

  it('F-0701 AC-10, AC-33 (c151-no-branch-part): a branch that doesn’t exist fails with S193 and git’s text, leaves its volume an empty folder, and Close Remote leaves an empty local window', async () => {
    const known = openEmptyWindows();
    await startClone(NO_BRANCH);
    const dialog = await waitForDialog(FOLDER, 900_000);
    const volumes = await clonedVolumes(NO_BRANCH);
    const volume = String(volumes[0]?.split(' ')[0]);
    const folder = await folderOfVolume(volume, FOLDER);
    await answerDialog(FOLDER, 'Close Remote');
    let left = '';
    await waitFor(
      'an empty local window',
      () => {
        left = openEmptyWindows().find(each => !known.includes(each)) ?? '';
        return left !== '';
      },
      60_000,
    );
    deepStrictEqual(
      {
        detail: dialog.details.startsWith('Git clone failed. '),
        branch: dialog.details.includes(
          'Remote branch no-such-branch-c151 not found in upstream origin',
        ),
        buttons: dialog.buttons,
        volumes: volumes.map(line =>
          line.replace(/-[0-9a-f]{64} /, '-<digest> '),
        ),
        folder,
        bootstraps: (await bootstrapContainers()).length,
        remoteName: (await windowState(left)).remoteName,
      },
      {
        detail: true,
        branch: true,
        buttons: ['Close Remote', 'More Actions...', 'Retry'],
        volumes: [`${FOLDER}-no-such-branch-c151-<digest> true`],
        folder: '',
        bootstraps: 0,
        remoteName: null,
      },
    );
    await closeWindow(left);
  });
});
