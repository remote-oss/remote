import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  hexOf,
  inWindow,
  openEmptyWindows,
  startInWindow,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {openMemoryWindow} from '../windows/folder-windows.ts';
import {
  ALPINE_OPTION,
  takeFeatureScreen,
  takeOptionScreen,
} from '../windows/authoring-support.ts';
import {
  clonedVolumes,
  containersWith,
  dockerLines,
  removeClone,
} from '../windows/volume-clones.ts';
import {
  acceptQuickPick,
  answerDialog,
  chooseQuickPickRow,
  dialogOf,
  pressEscape,
  quickPickOf,
  typeInQuickPick,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The repository the rows clone: public, with a `.devcontainer/devcontainer.json`. */
const REPOSITORY = 'https://github.com/microsoft/vscode-remote-try-node';

/** The repository's own name: the folder under `/workspaces`, and the window's. */
const FOLDER = 'vscode-remote-try-node';

/** A branch URL of the repository whose branch doesn't exist: it passes the pre-check, and the clone fails. */
const NO_BRANCH = `${REPOSITORY}/tree/no-such-branch-c151`;

/** A public repository with no dev container configuration, and its folder. */
const BARE = 'https://github.com/octocat/Hello-World';
const BARE_FOLDER = 'Hello-World';

/** The text of the clone warning, which shows once in the profile. */
const CLONE_WARNING =
  'Cloning a repository in a Dev Container may execute arbitrary code.';

/** The URI of a window of the repository's clone, as a link or a recent entry of another profile opens it. */
const CLONE_URI = `vscode-remote://dev-container+${hexOf({
  repositoryPath: REPOSITORY,
  volumeName: '__UNIQUE__',
  folder: FOLDER,
  cloneInfo: {urlToClone: REPOSITORY},
  inspectVolume: false,
})}/workspaces/${FOLDER}`;

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
    await removeClone(BARE);
  });

  after(async () => {
    await removeClone(REPOSITORY);
    await removeClone(NO_BRANCH);
    await removeClone(BARE);
  });

  it('F-0106 AC-17 (c171-crafted-part): a clone window opened from a link, in a profile that never gave the warning, asks it before any Docker object; Cancel leaves an empty local window with nothing cloned', async () => {
    const known = openEmptyWindows();
    await inWindow('local', 'acceptance.agent.openWindow', CLONE_URI);
    const dialog = await waitForDialog(FOLDER, 120_000);
    const volumesWhileAsked = await clonedVolumes(REPOSITORY);
    await answerDialog(FOLDER, 'Cancel');
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
        warning: dialog.message,
        volumesWhileAsked,
        volumes: await clonedVolumes(REPOSITORY),
        bootstraps: (await bootstrapContainers()).length,
        remoteName: (await windowState(left)).remoteName,
      },
      {
        warning: CLONE_WARNING,
        volumesWhileAsked: [],
        volumes: [],
        bootstraps: 0,
        remoteName: null,
      },
    );
    await closeWindow(left);
  });

  it('F-0106 AC-11 (c171-given-part): Got It on that warning clones the repository and connects the window', async () => {
    await inWindow('local', 'acceptance.agent.openWindow', CLONE_URI);
    await waitForDialog(FOLDER, 120_000);
    await answerDialog(FOLDER, 'Got It');
    await connectedToContainer(FOLDER, 900_000);
    deepStrictEqual(
      [
        (await clonedVolumes(REPOSITORY)).length,
        (await windowState(FOLDER)).remoteName,
      ],
      [1, 'dev-container'],
    );
    await closeWindow(FOLDER);
    await removeClone(REPOSITORY);
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

  it('F-0701 AC-14 (c151-reuse-part): the same URL again reuses its volume and its dev container: nothing is cloned or built again', async () => {
    const volumesBefore = await clonedVolumes(REPOSITORY);
    const volume = String(volumesBefore[0]?.split(' ')[0]);
    const containersBefore = await containersWith(
      `vsch.local.repository.volume=${volume}`,
    );
    await startClone(REPOSITORY);
    await connectedToContainer(FOLDER, 600_000);
    deepStrictEqual(
      [
        await clonedVolumes(REPOSITORY),
        await containersWith(`vsch.local.repository.volume=${volume}`),
      ],
      [volumesBefore, containersBefore],
    );
    await closeWindow(FOLDER);
  });

  it('F-0701 AC-9 (c151-no-config-part): a clone with no configuration opens the template picker; Escape shows S414, and Cancel leaves an empty local window, the volume kept with no configuration', async () => {
    const known = openEmptyWindows();
    await startClone(BARE);
    await waitForQuickPick(BARE_FOLDER, 900_000);
    await pressEscape(BARE_FOLDER);
    const dialog = await waitForDialog(BARE_FOLDER);
    await answerDialog(BARE_FOLDER, 'Cancel');
    let left = '';
    await waitFor(
      'an empty local window',
      () => {
        left = openEmptyWindows().find(each => !known.includes(each)) ?? '';
        return left !== '';
      },
      60_000,
    );
    const volume = String((await clonedVolumes(BARE))[0]?.split(' ')[0]);
    const folder = await folderOfVolume(volume, BARE_FOLDER);
    deepStrictEqual(
      {
        mustSelect: `${dialog.message} ${dialog.details}`.includes(
          'You must select a container configuration since the repository does not contain a dev container configuration.',
        ),
        buttons: dialog.buttons,
        readme: folder.split(' ').includes('README'),
        configuration: folder.includes('.devcontainer'),
        bootstraps: (await bootstrapContainers()).length,
        remoteName: (await windowState(left)).remoteName,
      },
      {
        mustSelect: true,
        buttons: ['Cancel', 'Select Configuration'],
        readme: true,
        configuration: false,
        bootstraps: 0,
        remoteName: null,
      },
    );
    await closeWindow(left);
  });

  it('F-0701 AC-8 (c151-template-part): a template picked for a clone with no configuration is written into the clone, and the window connects to its container', async () => {
    await removeClone(BARE);
    await startClone(BARE);
    await waitForQuickPick(BARE_FOLDER, 900_000);
    await chooseQuickPickRow(BARE_FOLDER, 'Alpine');
    await takeOptionScreen(BARE_FOLDER, ALPINE_OPTION);
    await takeFeatureScreen(BARE_FOLDER);
    await connectedToContainer(BARE_FOLDER, 900_000);
    const volume = String((await clonedVolumes(BARE))[0]?.split(' ')[0]);
    deepStrictEqual(
      {
        readme: (await folderOfVolume(volume, BARE_FOLDER))
          .split(' ')
          .includes('README'),
        configuration: (
          await folderOfVolume(volume, `${BARE_FOLDER}/.devcontainer`)
        )
          .split(' ')
          .includes('devcontainer.json'),
        remoteName: (await windowState(BARE_FOLDER)).remoteName,
      },
      {readme: true, configuration: true, remoteName: 'dev-container'},
    );
    await closeWindow(BARE_FOLDER);
  });
});
