import {deepStrictEqual, strictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  startInWindow,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {
  closeStrayWindows,
  openMemoryWindow,
} from '../windows/folder-windows.ts';
import {
  acceptQuickPick,
  answerDialog,
  answerInputBox,
  chooseQuickPickItem,
  detailedQuickPickRows,
  inputBoxOf,
  notifications,
  pageCount,
  pressEscape,
  primaryButtonOf,
  quickPickFacts,
  quickPickOf,
  statusBarItemIds,
  statusBarText,
  toastsOfPages,
  typeInQuickPick,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {createdAtOf} from '../../../packages/remote-containers/src/volumes/volume-name-rules.ts';

const execFileAsync = promisify(execFile);

/** The repository a new volume is cloned with: public, with a `.devcontainer/devcontainer.json`. */
const REPOSITORY = 'https://github.com/microsoft/vscode-remote-try-node';

/** A second repository with its own configuration, for a second folder in one volume. */
const SECOND = 'https://github.com/microsoft/vscode-remote-try-python';

/** The trust confirmation's message, owned by F-0106 and shared with F-0701. */
const TRUST =
  'Cloning a repository in a Dev Container may execute arbitrary code.';

/** The standard hint VS Code core appends to an input box's message. */
const HINT = "(Press 'Enter' to confirm or 'Escape' to cancel)";

/** The prompt of the volume-name box, S167. */
const VOLUME_NAME_PROMPT = 'Enter the volume name.';

/** The prompt of the folder-name box, S166. */
const FOLDER_NAME_PROMPT = 'Enter the target folder name.';

/** A named volume of the daemon, by its name and creation date. */
interface NamedVolume {
  name: string;
  created: string;
}

/** The labels of a Docker object, by key. */
type Labels = Record<string, string>;

/** Runs `docker` with `argv` and gives its stdout, trimmed. */
async function docker(...argv: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', argv);
  return stdout.trim();
}

/** The volumes carrying the repository label and the named mark, by name and creation date. */
async function namedVolumes(): Promise<NamedVolume[]> {
  const stdout = await docker(
    'volume',
    'ls',
    '-q',
    '--filter',
    'label=vsch.local.repository',
    '--filter',
    'label=vsch.local.repository.unique=false',
  );
  if (stdout === '') {
    return [];
  }
  const names = stdout.split('\n');
  const detailed = await docker(
    'volume',
    'inspect',
    '--format',
    '{{.Name}}|{{.CreatedAt}}',
    ...names,
  );
  return detailed.split('\n').map(line => {
    const [name, created] = line.split('|');
    return {name: String(name), created: String(created)};
  });
}

/** The labels of `name`, as they are set on the daemon. */
async function volumeLabels(name: string): Promise<Labels> {
  return JSON.parse(
    await docker('volume', 'inspect', '--format', '{{json .Labels}}', name),
  ) as Labels;
}

/** The labels of the container `containerId`, by key. */
async function containerLabels(containerId: string): Promise<Labels> {
  return JSON.parse(
    await docker('inspect', '--format', '{{json .Config.Labels}}', containerId),
  ) as Labels;
}

/** The containers, in any state, that carry `label`, as their ids. */
async function containersWith(label: string): Promise<string[]> {
  const stdout = await docker('ps', '-a', '-q', '--filter', `label=${label}`);
  return stdout === '' ? [] : stdout.split('\n');
}

/** Creates `name` on the daemon with each of `labels`, in order. */
async function createVolume(name: string, labels: Labels = {}): Promise<void> {
  const argv = ['volume', 'create'];
  for (const [key, value] of Object.entries(labels)) {
    argv.push('--label', `${key}=${value}`);
  }
  argv.push(name);
  await execFileAsync('docker', argv);
}

/** Removes `name`, silently when it was already gone. */
async function removeVolume(name: string): Promise<void> {
  await execFileAsync('docker', ['volume', 'rm', '-f', name]).catch(
    () => undefined,
  );
}

/** Removes every container of `volume`. */
async function removeContainers(volume: string): Promise<void> {
  const containerIds = await containersWith(
    `vsch.local.repository.volume=${volume}`,
  );
  if (containerIds.length > 0) {
    await execFileAsync('docker', ['rm', '-f', ...containerIds]);
  }
}

/** Has `win` start the named-volume command, settling the trust confirmation the first time. */
let trustSettled = false;
/** Runs the command in `window`; the first window settles the trust confirmation, which the run remembers. */
async function start(window: string): Promise<void> {
  await startInWindow(window, 'remote-containers.openRepositoryInVolume');
  if (trustSettled) {
    return;
  }
  try {
    const dialog = await waitForDialog(window);
    strictEqual(dialog.message, TRUST);
    await answerDialog(window, 'Got It');
  } catch (caught) {
    if (!(caught instanceof Error && caught.message.includes('timed out'))) {
      throw caught;
    }
  }
  trustSettled = true;
}

/** Types `url` into the repository-source pick, whose exact match accepts the typed source. */
async function pickSource(window: string, url: string): Promise<void> {
  await waitFor(
    `the source pick of window ${window}`,
    async () =>
      (await quickPickOf(window))?.placeholder ===
      'Provide repository URL or pick a repository source.',
    60_000,
  );
  await typeInQuickPick(window, url);
  await acceptQuickPick(window);
}

/** Waits for the volume pick of `win`, by its own S318 placeholder, so that a closing source pick is never read; gives it. */
async function volumePick(window: string): Promise<{
  placeholder: string;
  rows: Awaited<ReturnType<typeof detailedQuickPickRows>>;
}> {
  await waitFor(
    `the volume pick of window ${window}`,
    async () =>
      (await quickPickOf(window))?.placeholder ===
      'Select the volume for the cloned repository',
    60_000,
  );
  const shown = await waitForQuickPick(window, 10_000);
  return {
    placeholder: shown.placeholder,
    rows: await detailedQuickPickRows(window),
  };
}

/** The message of the input box open in `win`, without the standard hint core appends. */
async function liveMessageOf(window: string): Promise<string> {
  const shown = await inputBoxOf(window);
  return shown === undefined ? '' : shown.message.replace(HINT, '').trim();
}

/** The value the input box open in `win` holds, or undefined when no box is open. */
async function boxValueOf(window: string): Promise<string | undefined> {
  const shown = await inputBoxOf(window);
  return shown === undefined ? undefined : shown.value;
}

/** The name the window reloaded from `before` takes once its folder is known. */
async function reloadedName(before: string): Promise<string> {
  await waitFor(
    `a window other than ${before}`,
    () => windowNames().find(name => name !== before) !== undefined,
    60_000,
  );
  return String(windowNames().find(name => name !== before));
}

/** Waits for the input box of `window` to open and gives its value and message, without the hint; with `prompt`, waits for the box that shows it, so a closing box is never read. */
async function boxOf(
  window: string,
  prompt?: string,
): Promise<{value: string; message: string}> {
  if (prompt !== undefined) {
    await waitFor(
      `the ${prompt} box of window ${window}`,
      async () => (await liveMessageOf(window)) === prompt,
      60_000,
    );
  }
  await waitFor(
    `the input box of window ${window} to open`,
    async () => {
      const value = await boxValueOf(window);
      return value !== undefined && value !== '';
    },
    60_000,
  );
  const shown = await inputBoxOf(window);
  if (shown === undefined) {
    throw new Error(`the input box of window ${window} closed`);
  }
  return {value: shown.value, message: shown.message.replace(HINT, '').trim()};
}

/** Types `text` into the input box open in `window`, replacing its value, and leaves the box open. */
async function typeInBox(window: string, text: string): Promise<void> {
  await typeInQuickPick(window, text);
}

describe('Clone Repository in Named Container Volume (card containers-152)', function () {
  this.timeout(1_200_000);
  beforeEach(closeStrayWindows);

  it('F-0702 AC-2, AC-3, AC-4, AC-22 (c152-picker): after the source is picked, a pick opens in the same, still-unreloaded window with the placeholder S318, the create row first and focused, the eligible volumes below it in character-code order with their creation dates, and unique or unlabeled volumes absent; Escape leaves nothing behind', async () => {
    await createVolume('1-x', {
      'vsch.local.repository': 'https://github.com/o/first',
      'vsch.local.repository.unique': 'false',
    });
    await createVolume('B-x', {
      'vsch.local.repository': 'https://github.com/o/first',
      'vsch.local.repository.unique': 'false',
    });
    await createVolume('a-x', {
      'vsch.local.repository': 'https://github.com/o/first',
      'vsch.local.repository.unique': 'false',
    });
    await createVolume('c152-unique', {
      'vsch.local.repository': 'https://github.com/o/first',
      'vsch.local.repository.unique': 'true',
    });
    await createVolume('c152-plain');
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, REPOSITORY);
      const pick = await volumePick(window);
      const eligible = (await namedVolumes()).sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );
      seen.push({
        placeholder: pick.placeholder,
        rows: pick.rows.map(entry => [
          entry.label.trim(),
          entry.description,
          entry.focused,
          entry.icons,
        ]),
        remoteName: (await windowState(window)).remoteName,
        windows: await pageCount(),
      });
      await pressEscape(window);
      await waitFor(
        'the pick to close',
        async () => (await inputBoxOf(window)) === undefined,
        10_000,
      );
      seen.push({
        eligible: (await namedVolumes()).map(volume => volume.name),
        containers: await containersWith('vsch.local.repository'),
        remoteName: (await windowState(window)).remoteName,
      });
      deepStrictEqual(seen, [
        {
          placeholder: 'Select the volume for the cloned repository',
          rows: [
            [
              'Create a new volume...',
              'Use this volume to store several cloned repositories.',
              true,
              ['codicon-plus', 'codicon-colored'],
            ],
            ...eligible.map(volume => [
              volume.name,
              `created at ${createdAtOf(new Date(volume.created))}`,
              false,
              ['codicon-folder', 'codicon-colored'],
            ]),
          ],
          remoteName: null,
          windows: 2,
        },
        {
          eligible: ['1-x', 'B-x', 'a-x'],
          containers: [],
          remoteName: null,
        },
      ]);
    } finally {
      await closeWindow(window);
      for (const name of ['1-x', 'B-x', 'a-x', 'c152-unique', 'c152-plain']) {
        await removeVolume(name);
      }
    }
  });

  it('F-0702 AC-3, AC-5, AC-6, AC-7, AC-8 (c152-name-box): with no eligible volume the pick holds only the create row; the name box opens prefilled with the default and the S167 message, shows S397 under two characters and the combined S248 on any character violation of two or more with Enter without effect, and a name that exists ends the attempt with the single-OK S395 modal, creating nothing', async () => {
    await createVolume('c152-collide');
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, REPOSITORY);
      const pick = await volumePick(window);
      seen.push(
        pick.rows.map(entry => [
          entry.label.trim(),
          entry.description,
          entry.focused,
        ]),
      );
      await acceptQuickPick(window);
      seen.push(await boxOf(window, VOLUME_NAME_PROMPT));
      await typeInBox(window, 'x');
      await waitFor(
        'the length message to show',
        async () =>
          (await liveMessageOf(window)) ===
          'Volume names should be at least two characters and the first character must be alphanumeric.',
        10_000,
      );
      await acceptQuickPick(window);
      await new Promise(resolve => setTimeout(resolve, 3_000));
      seen.push([await boxValueOf(window), await liveMessageOf(window)]);
      await typeInBox(window, 'a b');
      await waitFor(
        'the combined character message to show',
        async () =>
          (await liveMessageOf(window)) ===
          'Only [a-zA-Z0-9_.-] are allowed and the first character must be alphanumeric.',
        10_000,
      );
      await acceptQuickPick(window);
      await new Promise(resolve => setTimeout(resolve, 3_000));
      seen.push([await boxValueOf(window), await liveMessageOf(window)]);
      await typeInBox(window, 'c152-collide');
      await waitFor(
        'no error message on the passing name',
        async () => {
          const message = await liveMessageOf(window);
          return (
            message !==
              'Volume names should be at least two characters and the first character must be alphanumeric.' &&
            message !==
              'Only [a-zA-Z0-9_.-] are allowed and the first character must be alphanumeric.'
          );
        },
        10_000,
      );
      await acceptQuickPick(window);
      const dialog = await waitForDialog(window);
      seen.push({
        detail: dialog.details,
        buttons: dialog.buttons,
        primary: await primaryButtonOf(window),
      });
      await answerDialog(window, 'OK');
      await waitFor(
        'the window to stay local',
        async () => (await windowState(window)).remoteName === null,
        10_000,
      );
      seen.push({
        volumes: (await namedVolumes()).map(volume => volume.name),
        containers: await containersWith('vsch.local.repository'),
        collide: await docker(
          'volume',
          'inspect',
          '--format',
          '{{.Name}}',
          'c152-collide',
        ).catch(() => 'gone'),
      });
      deepStrictEqual(seen, [
        [
          [
            'Create a new volume...',
            'Use this volume to store several cloned repositories.',
            true,
          ],
        ],
        {
          value: 'vsc-remote-containers',
          message: 'Enter the volume name.',
        },
        [
          'x',
          'Volume names should be at least two characters and the first character must be alphanumeric.',
        ],
        [
          'a b',
          'Only [a-zA-Z0-9_.-] are allowed and the first character must be alphanumeric.',
        ],
        {
          detail: 'Volume already exists',
          buttons: ['Cancel', 'OK'],
          primary: 'OK',
        },
        {
          volumes: [],
          containers: [],
          collide: 'c152-collide',
        },
      ]);
    } finally {
      await closeWindow(window);
      await removeVolume('c152-collide');
    }
  });

  it('F-0702 AC-12, AC-13, AC-33 (c152-cancel-empty): Escape at the name box or the folder box aborts the attempt with the volume uncreated, and Enter on an empty folder name closes it the same way, leaving no volume, container or notification behind', async () => {
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, REPOSITORY);
      await volumePick(window);
      await acceptQuickPick(window);
      await boxOf(window, VOLUME_NAME_PROMPT);
      await typeInBox(window, 'c152-esc');
      await acceptQuickPick(window);
      seen.push(await boxOf(window, FOLDER_NAME_PROMPT));
      seen.push({
        volume: await docker(
          'volume',
          'inspect',
          '--format',
          '{{.Name}}',
          'c152-esc',
        ).catch(() => 'absent'),
        containers: await containersWith('vsch.local.repository'),
      });
      await pressEscape(window);
      await waitFor(
        'the folder box to close',
        async () => (await inputBoxOf(window)) === undefined,
        10_000,
      );
      await waitFor(
        'the window to stay local',
        async () => (await windowState(window)).remoteName === null,
        10_000,
      );
      seen.push({
        volume: await docker(
          'volume',
          'inspect',
          '--format',
          '{{.Name}}',
          'c152-esc',
        ).catch(() => 'absent'),
        containers: await containersWith('vsch.local.repository'),
        notifications: await notifications(window),
        remoteName: (await windowState(window)).remoteName,
      });
      // Enter on the empty folder name: the same silent ending.
      await start(window);
      await pickSource(window, REPOSITORY);
      await volumePick(window);
      await acceptQuickPick(window);
      await boxOf(window, VOLUME_NAME_PROMPT);
      await typeInBox(window, 'c152-empty');
      await acceptQuickPick(window);
      await boxOf(window, FOLDER_NAME_PROMPT);
      await answerInputBox(window, '');
      await waitFor(
        'the folder box to close',
        async () => (await inputBoxOf(window)) === undefined,
        10_000,
      );
      await waitFor(
        'the window to stay local',
        async () => (await windowState(window)).remoteName === null,
        10_000,
      );
      seen.push({
        volume: await docker(
          'volume',
          'inspect',
          '--format',
          '{{.Name}}',
          'c152-empty',
        ).catch(() => 'absent'),
        containers: await containersWith('vsch.local.repository'),
        notifications: await notifications(window),
        remoteName: (await windowState(window)).remoteName,
      });
      deepStrictEqual(seen, [
        {
          value: 'vscode-remote-try-node',
          message: 'Enter the target folder name.',
        },
        {volume: 'absent', containers: []},
        {
          volume: 'absent',
          containers: [],
          notifications: [],
          remoteName: null,
        },
        {
          volume: 'absent',
          containers: [],
          notifications: [],
          remoteName: null,
        },
      ]);
    } finally {
      await closeWindow(window);
      await removeVolume('c152-esc');
      await removeVolume('c152-empty');
    }
  });

  /** The URL a repository without a devcontainer.json clones into, for the template pick. */
  const BARE = 'https://github.com/octocat/Hello-World';

  /** A repository URL that fails the shared repository-access pre-check. */
  const UNREACHABLE = 'https://github.com/microsoft/no-such-repository-c152';

  /** A repository URL that names a branch, whose existence the card checked. */
  const BRANCH_URL =
    'https://github.com/microsoft/vscode-remote-try-python/tree/clantz/test';

  /** The text of each status bar item window `name` shows, in the order of the bar. */
  async function statusBarTexts(name: string): Promise<string[]> {
    const itemIds = await statusBarItemIds(name);
    return Promise.all(itemIds.map(itemId => statusBarText(name, itemId)));
  }

  /** Runs `command` in a throwaway container that mounts `volume` at `/workspaces`. */
  async function inVolume(volume: string, command: string): Promise<string> {
    return docker(
      'run',
      '--rm',
      `--volume=${volume}:/workspaces`,
      'alpine',
      'sh',
      '-c',
      command,
    );
  }

  it('F-0702 AC-11, AC-14, AC-20, AC-34, AC-37 (c152-clone-noop): the accepted folder reloads the same, folderless window into the clone, whose dev container name the title and the remote-host item carry, with the volume fixed at its labels and one container; re-running the command in that connected window with the same URL and volume, and accepting the prefilled folder, changes nothing: no reload, no dialog, no notification, the same container id and start time', async () => {
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, REPOSITORY);
      const pick = await volumePick(window);
      seen.push(pick.placeholder);
      await acceptQuickPick(window);
      await boxOf(window, VOLUME_NAME_PROMPT);
      await typeInBox(window, 'c152-clone');
      await acceptQuickPick(window);
      const folderBox = await boxOf(window, FOLDER_NAME_PROMPT);
      seen.push(folderBox.value);
      await answerInputBox(window, folderBox.value);
      let cloneSuffix = false;
      await waitFor(
        'the clone suffix of the connecting toast',
        async () => {
          cloneSuffix = (await toastsOfPages()).some(
            toast =>
              toast.startsWith('Connecting to Dev Container') &&
              toast.includes(': Cloning Repository'),
          );
          return cloneSuffix;
        },
        120_000,
      );
      seen.push(cloneSuffix);
      await connectedToContainer('vscode-remote-try-node', 900_000);
      const containers = await containersWith(
        'vsch.local.repository.volume=c152-clone',
      );
      seen.push({
        windows: await pageCount(),
        remoteName: (await windowState('vscode-remote-try-node')).remoteName,
        host: await statusBarText('vscode-remote-try-node', 'status.host'),
        volumes: (await namedVolumes()).map(volume => volume.name),
        labels: await volumeLabels('c152-clone'),
        containers: containers.length,
      });
      const devContainerId = String(containers[0]);
      const startedAt = await docker(
        'inspect',
        '--format',
        '{{.State.StartedAt}}',
        devContainerId,
      );
      // The re-run: the same URL, the same volume, the prefilled folder.
      await start('vscode-remote-try-node');
      await pickSource('vscode-remote-try-node', REPOSITORY);
      const again = await volumePick('vscode-remote-try-node');
      seen.push(again.rows.map(entry => [entry.label.trim(), entry.focused]));
      await chooseQuickPickItem('vscode-remote-try-node', 'c152-clone');
      const againBox = await boxOf(
        'vscode-remote-try-node',
        FOLDER_NAME_PROMPT,
      );
      seen.push(againBox.value);
      await answerInputBox('vscode-remote-try-node', againBox.value);
      await new Promise(resolve => setTimeout(resolve, 10_000));
      seen.push({
        windows: await pageCount(),
        remoteName: (await windowState('vscode-remote-try-node')).remoteName,
        host: await statusBarText('vscode-remote-try-node', 'status.host'),
        toasts: await notifications('vscode-remote-try-node'),
        containers: await containersWith(
          'vsch.local.repository.volume=c152-clone',
        ),
        startedAt: await docker(
          'inspect',
          '--format',
          '{{.State.StartedAt}}',
          devContainerId,
        ),
        volumes: (await namedVolumes()).map(volume => volume.name),
      });
      deepStrictEqual(seen, [
        'Select the volume for the cloned repository',
        'vscode-remote-try-node',
        true,
        {
          windows: 1,
          remoteName: 'dev-container',
          host: 'Dev Container: Node.js',
          volumes: ['c152-clone'],
          labels: {
            'vsch.local.repository': REPOSITORY,
            'vsch.local.repository.unique': 'false',
          },
          containers: 1,
        },
        [
          ['Create a new volume...', true],
          ['c152-clone', false],
        ],
        'vscode-remote-try-node',
        {
          windows: 1,
          remoteName: 'dev-container',
          host: 'Dev Container: Node.js',
          toasts: [],
          containers: [devContainerId],
          startedAt,
          volumes: ['c152-clone'],
        },
      ]);
    } finally {
      await closeWindow('vscode-remote-try-node').catch(() => undefined);
      await removeContainers('c152-clone');
      await removeVolume('c152-clone');
    }
  });

  it("F-0702 AC-9, AC-14, AC-15, AC-16 (c152-second-repo): picking an existing volume opens the folder box straight away, prefilled with the typed URL's default; a distinct folder adds a sibling clone beside the first without touching the volume's own labels, and resubmitting the first folder for the other repository connects to the content already at it, leaving it unchanged, with exactly one container labeled by the new triple", async () => {
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      // The first clone fixes the volume's labels.
      await start(window);
      await pickSource(window, REPOSITORY);
      await volumePick(window);
      await acceptQuickPick(window);
      await boxOf(window, VOLUME_NAME_PROMPT);
      await typeInBox(window, 'c152-shared');
      await acceptQuickPick(window);
      const firstBox = await boxOf(window, FOLDER_NAME_PROMPT);
      seen.push(firstBox.value);
      await answerInputBox(window, firstBox.value);
      await connectedToContainer('vscode-remote-try-node', 900_000);
      seen.push(await volumeLabels('c152-shared'));
      await closeWindow('vscode-remote-try-node');
      // A second repository into the same volume, under its own folder.
      const secondWindow = await openMemoryWindow();
      await start(secondWindow);
      await pickSource(secondWindow, SECOND);
      const pick = await volumePick(secondWindow);
      seen.push(pick.rows.map(entry => [entry.label.trim(), entry.focused]));
      await chooseQuickPickItem(secondWindow, 'c152-shared');
      const secondBox = await boxOf(secondWindow, FOLDER_NAME_PROMPT);
      seen.push(secondBox);
      await answerInputBox(secondWindow, secondBox.value);
      await connectedToContainer('vscode-remote-try-python', 900_000);
      const siblings = await containersWith(
        'vsch.local.repository.volume=c152-shared',
      );
      seen.push({
        folders: await inVolume('c152-shared', 'ls /workspaces'),
        intact: await inVolume(
          'c152-shared',
          'test -d /workspaces/vscode-remote-try-node/.git && test -f /workspaces/vscode-remote-try-node/.devcontainer/devcontainer.json && test -d /workspaces/vscode-remote-try-python/.git && test -f /workspaces/vscode-remote-try-python/.devcontainer/devcontainer.json && echo ok',
        ),
        labels: await volumeLabels('c152-shared'),
        triples: (
          await Promise.all(
            siblings.map(async containerId => {
              const labels = await containerLabels(containerId);
              return [
                labels['vsch.local.repository'],
                labels['vsch.local.repository.folder'],
                labels['vsch.local.repository.volume'],
              ];
            }),
          )
        ).sort((left, right) => ((left[0] ?? '') < (right[0] ?? '') ? -1 : 1)),
      });
      await closeWindow('vscode-remote-try-python');
      // The first folder again, for the other repository: the content stays, the new container's labels change.
      const thirdWindow = await openMemoryWindow();
      await start(thirdWindow);
      await pickSource(thirdWindow, SECOND);
      await volumePick(thirdWindow);
      await chooseQuickPickItem(thirdWindow, 'c152-shared');
      await boxOf(thirdWindow, FOLDER_NAME_PROMPT);
      await typeInBox(thirdWindow, 'vscode-remote-try-node');
      const beforeResubmit = await inVolume(
        'c152-shared',
        'ls -A /workspaces/vscode-remote-try-node',
      );
      await answerInputBox(thirdWindow, 'vscode-remote-try-node');
      await connectedToContainer('vscode-remote-try-node', 900_000);
      await new Promise(resolve => setTimeout(resolve, 5_000));
      const resubmitted = await containersWith(
        'vsch.local.repository.volume=c152-shared',
      );
      const newTripleContainers = (
        await Promise.all(
          resubmitted.map(async containerId => {
            const labels = await containerLabels(containerId);
            return (
              labels['vsch.local.repository'] === SECOND &&
              labels['vsch.local.repository.folder'] ===
                'vscode-remote-try-node'
            );
          }),
        )
      ).filter(Boolean).length;
      seen.push({
        toasts: await notifications('vscode-remote-try-node'),
        unchanged:
          (await inVolume(
            'c152-shared',
            'ls -A /workspaces/vscode-remote-try-node',
          )) === beforeResubmit,
        containers: resubmitted.length,
        newTripleContainers,
      });
      deepStrictEqual(seen, [
        'vscode-remote-try-node',
        {
          'vsch.local.repository': REPOSITORY,
          'vsch.local.repository.unique': 'false',
        },
        [
          ['Create a new volume...', true],
          ['c152-shared', false],
        ],
        {
          value: 'vscode-remote-try-python',
          message: 'Enter the target folder name.',
        },
        {
          folders: 'vscode-remote-try-node\nvscode-remote-try-python',
          intact: 'ok',
          labels: {
            'vsch.local.repository': REPOSITORY,
            'vsch.local.repository.unique': 'false',
          },
          triples: [
            [REPOSITORY, 'vscode-remote-try-node', 'c152-shared'],
            [SECOND, 'vscode-remote-try-python', 'c152-shared'],
          ],
        },
        {
          toasts: [],
          unchanged: true,
          containers: 3,
          newTripleContainers: 1,
        },
      ]);
    } finally {
      for (const name of [
        'vscode-remote-try-node',
        'vscode-remote-try-python',
      ]) {
        await closeWindow(name).catch(() => undefined);
      }
      await removeContainers('c152-shared');
      await removeVolume('c152-shared');
    }
  });

  it('F-0702 AC-30 (c152-empty-folder): a folder name that already exists in the picked volume as an empty folder clones the repository into it with no dialog, and the window connects to the dev container the cloned configuration defines', async () => {
    await createVolume('c152-e5', {
      'vsch.local.repository': REPOSITORY,
      'vsch.local.repository.unique': 'false',
    });
    await inVolume('c152-e5', 'mkdir /workspaces/e5-folder');
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, REPOSITORY);
      const pick = await volumePick(window);
      seen.push(pick.rows.map(entry => [entry.label.trim(), entry.focused]));
      await chooseQuickPickItem(window, 'c152-e5');
      const folderBox = await boxOf(window, FOLDER_NAME_PROMPT);
      seen.push(folderBox.value);
      await typeInBox(window, 'e5-folder');
      await answerInputBox(window, 'e5-folder');
      await connectedToContainer('e5-folder', 900_000);
      const containers = await containersWith(
        'vsch.local.repository.volume=c152-e5',
      );
      seen.push({
        remoteName: (await windowState('e5-folder')).remoteName,
        host: await statusBarText('e5-folder', 'status.host'),
        cloned: await inVolume(
          'c152-e5',
          'test -d /workspaces/e5-folder/.git && test -f /workspaces/e5-folder/.devcontainer/devcontainer.json && echo ok',
        ),
        labels: await volumeLabels('c152-e5'),
        containers: containers.length,
      });
      deepStrictEqual(seen, [
        [
          ['Create a new volume...', true],
          ['c152-e5', false],
        ],
        'vscode-remote-try-node',
        {
          remoteName: 'dev-container',
          host: 'Dev Container: Node.js',
          cloned: 'ok',
          labels: {
            'vsch.local.repository': REPOSITORY,
            'vsch.local.repository.unique': 'false',
          },
          containers: 1,
        },
      ]);
    } finally {
      await closeWindow('e5-folder').catch(() => undefined);
      await removeContainers('c152-e5');
      await removeVolume('c152-e5');
    }
  });

  it('F-0702 AC-10, AC-17 (c152-traversal): no value the folder-name box holds is validated inline, and a traversal folder that resolves to a pre-existing, non-empty path ends the attempt, after the reload, with the shared Git clone failed. dialog, the volume left behind with its fixed labels and no container of it', async () => {
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, REPOSITORY);
      await volumePick(window);
      await acceptQuickPick(window);
      await boxOf(window, VOLUME_NAME_PROMPT);
      await typeInBox(window, 'c152-trav');
      await acceptQuickPick(window);
      const folderBox = await boxOf(window, FOLDER_NAME_PROMPT);
      seen.push(folderBox.value);
      await typeInBox(window, '../../etc');
      await waitFor(
        'no inline message on a traversal folder',
        async () => (await liveMessageOf(window)) === '',
        10_000,
      );
      await answerInputBox(window, '../../etc');
      const failed = await reloadedName(window);
      seen.push(failed);
      const dialog = await waitForDialog(failed, 300_000);
      seen.push({
        message: dialog.message,
        detail: dialog.details.startsWith('Git clone failed.'),
        buttons: dialog.buttons,
      });
      await pressEscape(failed);
      await new Promise(resolve => setTimeout(resolve, 3_000));
      await closeWindow(failed).catch(() => undefined);
      seen.push({
        labels: await volumeLabels('c152-trav').catch(() => 'absent'),
        containers: await containersWith(
          'vsch.local.repository.volume=c152-trav',
        ),
      });
      deepStrictEqual(seen, [
        'vscode-remote-try-node',
        'etc',
        {
          message: '',
          detail: true,
          buttons: ['Retry', 'More Actions...'],
        },
        {
          labels: {
            'vsch.local.repository': REPOSITORY,
            'vsch.local.repository.unique': 'false',
          },
          containers: [],
        },
      ]);
    } finally {
      await removeContainers('c152-trav');
      await removeVolume('c152-trav');
    }
  });

  it('F-0702 AC-19 (c152-no-config): a clone whose folder holds no devcontainer.json anywhere opens the shared Add Dev Container Configuration Files pick after the clone, and Escape there leaves the window local, with the volume and its labels kept and no container of it', async () => {
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, BARE);
      await volumePick(window);
      await acceptQuickPick(window);
      await boxOf(window, VOLUME_NAME_PROMPT);
      await typeInBox(window, 'c152-nocfg');
      await acceptQuickPick(window);
      const folderBox = await boxOf(window, FOLDER_NAME_PROMPT);
      seen.push(folderBox.value);
      await answerInputBox(window, 'Hello-World');
      const reloaded = await reloadedName(window);
      await waitFor(
        'the Add Dev Container Configuration Files pick',
        async () =>
          (await quickPickFacts(reloaded))?.title ===
          'Add Dev Container Configuration Files',
        600_000,
      );
      seen.push(reloaded);
      await pressEscape(reloaded);
      await waitFor(
        'the template pick to close',
        async () => (await quickPickFacts(reloaded)) === undefined,
        30_000,
      );
      seen.push({
        remoteName: (await windowState(reloaded)).remoteName,
        labels: await volumeLabels('c152-nocfg'),
        volumes: (await namedVolumes()).map(volume => volume.name),
        containers: await containersWith(
          'vsch.local.repository.volume=c152-nocfg',
        ),
      });
      deepStrictEqual(seen, [
        'Hello-World',
        'Hello-World',
        {
          remoteName: null,
          labels: {
            'vsch.local.repository': BARE,
            'vsch.local.repository.unique': 'false',
          },
          volumes: ['c152-nocfg'],
          containers: [],
        },
      ]);
    } finally {
      await closeWindow('Hello-World').catch(() => undefined);
      await removeContainers('c152-nocfg');
      await removeVolume('c152-nocfg');
    }
  });

  it("F-0702 AC-21 (c152-too-long): a 300-character name passes both boxes' own validation and is rejected by the filesystem underneath: the volume-name case ends in the generic setup dialog with no volume created, and the folder-name case in the shared Git clone failed. dialog with the volume left behind and no container of it", async () => {
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      // The too-long volume name: the generic setup dialog, nothing created.
      await start(window);
      await pickSource(window, REPOSITORY);
      await volumePick(window);
      await acceptQuickPick(window);
      await boxOf(window, VOLUME_NAME_PROMPT);
      await typeInBox(window, 'a'.repeat(300));
      await waitFor(
        'no live message on a long volume name',
        async () => (await liveMessageOf(window)) === '',
        10_000,
      );
      await acceptQuickPick(window);
      const firstBox = await boxOf(window, FOLDER_NAME_PROMPT);
      await answerInputBox(window, firstBox.value);
      const volumeFailed = await reloadedName(window);
      const setupDialog = await waitForDialog(volumeFailed, 300_000);
      seen.push({
        window: volumeFailed,
        message: setupDialog.message,
        detail: setupDialog.details,
        buttons: setupDialog.buttons,
      });
      await pressEscape(volumeFailed);
      await new Promise(resolve => setTimeout(resolve, 3_000));
      await closeWindow(volumeFailed).catch(() => undefined);
      seen.push(await namedVolumes());
      // The too-long folder name: the clone-failure dialog, the volume left behind.
      const secondWindow = await openMemoryWindow();
      await start(secondWindow);
      await pickSource(secondWindow, REPOSITORY);
      await volumePick(secondWindow);
      await acceptQuickPick(secondWindow);
      await boxOf(secondWindow, VOLUME_NAME_PROMPT);
      await typeInBox(secondWindow, 'c152-long');
      await acceptQuickPick(secondWindow);
      await boxOf(secondWindow, FOLDER_NAME_PROMPT);
      await typeInBox(secondWindow, 'x'.repeat(300));
      await waitFor(
        'no live message on a long folder name',
        async () => (await liveMessageOf(secondWindow)) === '',
        10_000,
      );
      await acceptQuickPick(secondWindow);
      const folderFailed = await reloadedName(secondWindow);
      const cloneDialog = await waitForDialog(folderFailed, 300_000);
      seen.push({
        window: folderFailed,
        detail: cloneDialog.details.startsWith('Git clone failed.'),
        buttons: cloneDialog.buttons,
      });
      await pressEscape(folderFailed);
      await new Promise(resolve => setTimeout(resolve, 3_000));
      await closeWindow(folderFailed).catch(() => undefined);
      seen.push({
        volumes: (await namedVolumes()).map(volume => volume.name),
        labels: await volumeLabels('c152-long').catch(() => 'absent'),
        containers: await containersWith(
          'vsch.local.repository.volume=c152-long',
        ),
      });
      deepStrictEqual(seen, [
        {
          window: 'vscode-remote-try-node',
          message: '',
          detail: 'An error occurred setting up the container.',
          buttons: ['Retry', 'More Actions...'],
        },
        [],
        {
          window: 'x'.repeat(300),
          detail: true,
          buttons: ['Retry', 'More Actions...'],
        },
        {
          volumes: ['c152-long'],
          labels: {
            'vsch.local.repository': REPOSITORY,
            'vsch.local.repository.unique': 'false',
          },
          containers: [],
        },
      ]);
    } finally {
      await removeContainers('c152-long');
      await removeVolume('c152-long');
    }
  });

  it("F-0702 AC-23 (c152-precheck): a URL that fails the shared repository-access pre-check ends the command in that pre-check's dialog before the volume pick opens, leaving the window local and no Docker object behind", async () => {
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, UNREACHABLE);
      const dialog = await waitForDialog(window, 60_000);
      seen.push({
        message: dialog.message,
        buttons: dialog.buttons,
        pick: (await quickPickOf(window))?.placeholder,
      });
      await pressEscape(window);
      await waitFor(
        'the window to stay local',
        async () => (await windowState(window)).remoteName === null,
        10_000,
      );
      seen.push({
        remoteName: (await windowState(window)).remoteName,
        volumes: await namedVolumes(),
        containers: await containersWith('vsch.local.repository'),
      });
      deepStrictEqual(seen, [
        {
          message: `Cannot access the repository '${UNREACHABLE}'.`,
          buttons: [],
          pick: undefined,
        },
        {remoteName: null, volumes: [], containers: []},
      ]);
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it("F-0702 AC-35 (c152-branch): a URL that names a branch prefills the folder box with the repository name alone, clones that branch, labels the volume with the branch, leaves the container's labels branchless, and checks the folder out at the branch", async () => {
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, BRANCH_URL);
      await volumePick(window);
      await acceptQuickPick(window);
      await boxOf(window, VOLUME_NAME_PROMPT);
      await typeInBox(window, 'c152-branch');
      await acceptQuickPick(window);
      const folderBox = await boxOf(window, FOLDER_NAME_PROMPT);
      seen.push(folderBox);
      await answerInputBox(window, folderBox.value);
      await connectedToContainer('vscode-remote-try-python', 900_000);
      await waitFor(
        'the SCM branch item to read clantz/test',
        async () =>
          (await statusBarTexts('vscode-remote-try-python')).some(
            text => text === 'clantz/test',
          ),
        120_000,
      );
      const containers = await containersWith(
        'vsch.local.repository.volume=c152-branch',
      );
      const devLabels = await containerLabels(String(containers[0]));
      const ownLabels: Labels = {};
      for (const [labelKey, labelValue] of Object.entries(devLabels)) {
        if (labelKey.startsWith('vsch.local.')) {
          ownLabels[labelKey] = labelValue;
        }
      }
      seen.push({
        labels: await volumeLabels('c152-branch'),
        ownLabels,
        branch: await docker(
          'exec',
          '--user',
          'root',
          String(containers[0]),
          'git',
          '--git-dir',
          '/workspaces/vscode-remote-try-python/.git',
          'branch',
          '--show-current',
        ),
      });
      deepStrictEqual(seen, [
        {
          value: 'vscode-remote-try-python',
          message: 'Enter the target folder name.',
        },
        {
          labels: {
            'vsch.local.repository': BRANCH_URL,
            'vsch.local.repository.branch': 'clantz/test',
            'vsch.local.repository.unique': 'false',
          },
          ownLabels: {
            'vsch.local.repository': BRANCH_URL,
            'vsch.local.repository.folder': 'vscode-remote-try-python',
            'vsch.local.repository.volume': 'c152-branch',
          },
          branch: 'clantz/test',
        },
      ]);
    } finally {
      await closeWindow('vscode-remote-try-python').catch(() => undefined);
      await removeContainers('c152-branch');
      await removeVolume('c152-branch');
    }
  });

  it('F-0702 AC-36 (c152-untitled): the command run from an untitled, virtual-workspace window asks VS Code core to save that workspace before it reloads, and Cancel leaves the window local with no volume and no container created', async () => {
    const window = await openMemoryWindow();
    const seen: unknown[] = [];
    try {
      await start(window);
      await pickSource(window, REPOSITORY);
      await volumePick(window);
      await acceptQuickPick(window);
      await boxOf(window, VOLUME_NAME_PROMPT);
      await typeInBox(window, 'c152-untitled');
      await acceptQuickPick(window);
      const folderBox = await boxOf(window, FOLDER_NAME_PROMPT);
      await answerInputBox(window, folderBox.value);
      const dialog = await waitForDialog(window, 60_000);
      seen.push({
        message: dialog.message,
        details: dialog.details,
        buttons: dialog.buttons,
      });
      await answerDialog(window, 'Cancel');
      await waitFor(
        'the window to stay local',
        async () => (await windowState(window)).remoteName === null,
        10_000,
      );
      seen.push({
        remoteName: (await windowState(window)).remoteName,
        toasts: await notifications(window),
        volume: await docker(
          'volume',
          'inspect',
          '--format',
          '{{.Name}}',
          'c152-untitled',
        ).catch(() => 'absent'),
        containers: await containersWith(
          'vsch.local.repository.volume=c152-untitled',
        ),
      });
      deepStrictEqual(seen, [
        {
          message:
            'Do you want to save your workspace configuration as a file?',
          details: 'Save your workspace if you plan to open it again.',
          buttons: ["Don't Save", 'Cancel', 'Save'],
        },
        {
          remoteName: null,
          toasts: [],
          volume: 'absent',
          containers: [],
        },
      ]);
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainers('c152-untitled');
      await removeVolume('c152-untitled');
    }
  });
});
