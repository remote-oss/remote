import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  connectedToContainer,
  openEmptyWindows,
  startInWindow,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  acceptQuickPick,
  answerDialog,
  typeInQuickPick,
  waitForDialog,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The repository the rows clone: public, with a `.devcontainer/devcontainer.json`. */
const REPOSITORY = 'https://github.com/microsoft/vscode-remote-try-node';

/** The repository's own name: the folder under `/workspaces`, and the window's. */
const FOLDER = 'vscode-remote-try-node';

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

/** Opens a new empty local window from `local`, and gives its name. */
async function newEmptyWindow(): Promise<string> {
  const known = openEmptyWindows();
  await startInWindow('local', 'workbench.action.newWindow');
  let name = '';
  await waitFor(
    'a new empty window',
    () => {
      name = openEmptyWindows().find(each => !known.includes(each)) ?? '';
      return name !== '';
    },
    60_000,
  );
  return name;
}

describe('Clone Repository in Container Volume (card containers-151)', function () {
  this.timeout(1_200_000);
  before(() => removeClone(REPOSITORY));

  after(() => removeClone(REPOSITORY));

  it('F-0701 AC-1, AC-6, AC-7 (c151-clone-url): a typed URL clones into a new unique volume through a bootstrap, connects the reloaded window, and the bootstrap is gone within 20 s', async () => {
    const empty = await newEmptyWindow();
    await startInWindow(
      empty,
      'remote-containers.openRepositoryInUniqueVolume',
    );
    await waitForDialog(empty);
    await answerDialog(empty, 'Got It');
    await typeInQuickPick(empty, REPOSITORY);
    await acceptQuickPick(empty);
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
  });
});
