import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  type BrokenRepository,
  startBrokenRepository,
} from '../windows/broken-repository.ts';
import {
  closeWindow,
  connectedToContainer,
  openEmptyWindows,
  readUserSettings,
  restoreUserSettings,
  startInWindow,
  userSettings,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {openMemoryWindow} from '../windows/folder-windows.ts';
import {
  acceptQuickPick,
  answerDialog,
  dialogOf,
  quickPickOf,
  quickPickRows,
  typeInQuickPick,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  clonedVolumes,
  containersWith,
  dockerLines,
  removeClone,
} from '../windows/volume-clones.ts';

const execFileAsync = promisify(execFile);

/** The folder of the clone of `broken.git`, and of `broken-two.git`: the windows' names. */
const FIRST = 'broken';
const SECOND = 'broken-two';

/** The text of the clone warning, which shows once in the profile. */
const CLONE_WARNING =
  'Cloning a repository in a Dev Container may execute arbitrary code.';

/** The failure dialog's buttons for a volume window, in the order the dialog lists them. */
const FOUR_BUTTONS = [
  'Close Remote',
  'Edit devcontainer.json in Recovery Container',
  'More Actions...',
  'Retry',
];

/** The offer's button. */
const RECOVERY = 'Edit devcontainer.json in Recovery Container';

/**
 * Types `source` into the clone command of a new memory-folder window, giving the warning its Got It when it shows; the
 * window's failure dialog is then the next thing to wait for.
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

/** Clones `source` until its build fails, then asks the dialog for the recovery container and waits for the window. */
async function reachRecovery(source: string, folder: string): Promise<void> {
  await startClone(source);
  await waitForDialog(folder, 900_000);
  await answerDialog(folder, RECOVERY);
  await connectedToContainer(folder, 900_000);
}

/** The recovery containers of the volume, in any state, as ids. */
async function recoveryContainers(volume: string): Promise<string[]> {
  return containersWith(`vsch.local.volume=${volume}`);
}

/** The name of the one volume the clone of `source` made. */
async function volumeOf(source: string): Promise<string> {
  return String((await clonedVolumes(source))[0]?.split(' ')[0]);
}

/** What `docker inspect` prints for `container` through the Go template `format`. */
async function inspected(container: string, format: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    format,
    container,
  ]);
  return stdout.trim();
}

describe('The recovery container (card containers-160, part A)', function () {
  this.timeout(2_400_000);
  let repository: BrokenRepository;
  let settingsBefore: string | undefined;

  before(async () => {
    repository = await startBrokenRepository();
    settingsBefore = readUserSettings();
    await removeClone(repository.url);
    await removeClone(repository.otherUrl);
  });

  after(async () => {
    restoreUserSettings(settingsBefore);
    await removeClone(repository.url);
    await removeClone(repository.otherUrl);
    await repository.stop();
  });

  it('F-0410 AC-14, AC-16c: a clone whose build fails offers four buttons, and More Actions picks five items with no container, the recovery one second', async () => {
    await startClone(repository.url);
    const dialog = await waitForDialog(FIRST, 900_000);
    await answerDialog(FIRST, 'More Actions...');
    await waitFor(
      'the More Actions pick',
      async () => (await quickPickOf(FIRST)) !== undefined,
      30_000,
    );
    const labels = (await quickPickRows(FIRST)).map(row => row.label);
    deepStrictEqual(
      {buttons: dialog.buttons, items: labels},
      {
        buttons: FOUR_BUTTONS,
        items: [
          'Reload Window',
          RECOVERY,
          'Open Repository',
          'Open Recent...',
          'Open Documentation',
        ],
      },
    );
    await closeWindow(FIRST);
  });

  it('F-0410 AC-15: Close Remote leaves a plain empty local window', async () => {
    const known = openEmptyWindows();
    await startClone(repository.url);
    await waitForDialog(FIRST, 900_000);
    await answerDialog(FIRST, 'Close Remote');
    let left = '';
    await waitFor(
      'an empty local window',
      () => {
        left = openEmptyWindows().find(each => !known.includes(each)) ?? '';
        return left !== '';
      },
      60_000,
    );
    deepStrictEqual((await windowState(left)).remoteName, null);
    await closeWindow(left);
  });

  it('F-0410 AC-16, AC-16a, AC-16b: the recovery button connects a container of the bootstrap image on the volume, with Git and a docker client but no daemon, and a second start restarts the same container', async () => {
    await reachRecovery(repository.url, FIRST);
    const volume = await volumeOf(repository.url);
    const [container] = await recoveryContainers(volume);
    const tools = await execFileAsync('docker', [
      'exec',
      String(container),
      'sh',
      '-c',
      'git --version; docker version 2>&1; true',
    ]);
    const mounted = await inspected(
      String(container),
      '{{range .Mounts}}{{.Name}} {{end}}',
    );
    const state = await windowState(FIRST);
    deepStrictEqual(
      {
        count: (await recoveryContainers(volume)).length,
        remoteName: state.remoteName,
        image: await inspected(String(container), '{{.Config.Image}}'),
        mounted: mounted.trim(),
        git: tools.stdout.includes('git version'),
        client: tools.stdout.includes('Client:'),
        daemon: tools.stdout.includes(
          'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
        ),
      },
      {
        count: 1,
        remoteName: 'dev-container',
        image: 'vsc-volume-bootstrap:latest',
        mounted: volume,
        git: true,
        client: true,
        daemon: true,
      },
    );
    await closeWindow(FIRST);
    await execFileAsync('docker', ['stop', String(container)]);
    await reachRecovery(repository.url, FIRST);
    deepStrictEqual(
      [
        await recoveryContainers(volume),
        await inspected(String(container), '{{.State.Running}}'),
      ],
      [[container], 'true'],
    );
    await closeWindow(FIRST);
  });

  it('F-0410 AC-29: a stopped recovery container is restarted on its own image after the bootstrap image setting changed', async () => {
    const volume = await volumeOf(repository.url);
    const [container] = await recoveryContainers(volume);
    await execFileAsync('docker', ['stop', String(container)]);
    const before = await inspected(String(container), '{{.Image}}');
    await userSettings({'dev.containers.bootstrapImage': 'alpine:3.20'});
    await reachRecovery(repository.url, FIRST);
    deepStrictEqual(
      {
        containers: await recoveryContainers(volume),
        image: await inspected(String(container), '{{.Image}}'),
        running: await inspected(String(container), '{{.State.Running}}'),
        fromNewImage: await dockerLines(
          'ps',
          '-a',
          '-q',
          '--filter',
          `ancestor=alpine:3.20`,
          '--filter',
          `label=vsch.local.volume=${volume}`,
        ),
      },
      {
        containers: [container],
        image: before,
        running: 'true',
        fromNewImage: [],
      },
    );
    await closeWindow(FIRST);
    restoreUserSettings(settingsBefore);
  });

  it('F-0410 AC-28: a stopped container with the labels of another temp root is left as it is, and a new one is made', async () => {
    const volume = await volumeOf(repository.url);
    const [recovery] = await recoveryContainers(volume);
    await execFileAsync('docker', ['rm', '-f', String(recovery)]);
    const {stdout} = await execFileAsync('docker', [
      'create',
      '--label',
      `vsch.local.volume=${volume}`,
      '--label',
      'devcontainer.config_file=/other-root/vsch-other/recovery-volume/0/x/.devcontainer.json',
      'alpine:3.20',
      'sleep',
      '1d',
    ]);
    const old = stdout.trim();
    await reachRecovery(repository.url, FIRST);
    const containers = await recoveryContainers(volume);
    deepStrictEqual(
      {
        count: containers.length,
        oldKept: containers.some(each => old.startsWith(each)),
        oldRunning: await inspected(old, '{{.State.Running}}'),
        oldLabel: await inspected(
          old,
          '{{index .Config.Labels "devcontainer.config_file"}}',
        ),
      },
      {
        count: 2,
        oldKept: true,
        oldRunning: 'false',
        oldLabel:
          '/other-root/vsch-other/recovery-volume/0/x/.devcontainer.json',
      },
    );
    await closeWindow(FIRST);
  });

  it('F-0410 AC-16 (concurrency): two windows recovering two volumes at once each get a container that mounts only its own volume', async () => {
    await removeClone(repository.url);
    await removeClone(repository.otherUrl);
    await Promise.all([
      reachRecovery(repository.url, FIRST),
      reachRecovery(repository.otherUrl, SECOND),
    ]);
    const mounts = await Promise.all(
      [repository.url, repository.otherUrl].map(async source => {
        const volume = await volumeOf(source);
        const containers = await recoveryContainers(volume);
        return {
          containers: containers.length,
          mounted: (
            await inspected(
              String(containers[0]),
              '{{range .Mounts}}{{.Name}} {{end}}',
            )
          ).trim(),
          volume,
        };
      }),
    );
    deepStrictEqual(
      mounts.map(each => [each.containers, each.mounted === each.volume]),
      [
        [1, true],
        [1, true],
      ],
    );
    await closeWindow(FIRST);
    await closeWindow(SECOND);
  });
});
