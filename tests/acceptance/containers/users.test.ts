import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reloadWindow,
  reopenInContainer,
  reopenStarted,
  runLabelArguments,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  chooseQuickPickItem,
  dialogOf,
  focusTerminal,
  notifications,
  type ShownDialog,
  terminalText,
  typeInTerminal,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {
  activations,
  openFolderWindow,
  removeContainers,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The runner's user and group ids, which are the host's the CLI syncs an account to. */
const HOST_UID = process.getuid?.() ?? -1;
const HOST_GID = process.getgid?.() ?? -1;

/** An account id that is neither the host's nor one the run's image uses. */
const OTHER_ID = 4711;
const THIRD_ID = 4712;

/** Dockerfile lines that add an account `name` with user id and group id `userId` and the POSIX shell. */
function accountLines(name: string, userId: number): string {
  return `RUN addgroup -g ${String(userId)} ${name} && adduser -D -u ${String(userId)} -G ${name} -s /bin/sh ${name}\n`;
}

/** The account of the run's image whose ids are the host's, or one added for the Dockerfile when no account has them. */
const HOST_ACCOUNT = HOST_UID === 1000 && HOST_GID === 1000 ? 'node' : 'vscode';

/** Dockerfile lines that give `HOST_ACCOUNT` the host's ids when the run's image has no account with them. */
function hostAccountLines(): string {
  return HOST_ACCOUNT === 'node' ? '' : accountLines(HOST_ACCOUNT, HOST_UID);
}

/**
 * Dockerfile lines that free the host's accountIds from the run's `node` account when they are its accountIds, so that an account
 * synced to them meets no other (the CLI leaves the account alone when another one holds the accountIds, F-0416 AC-8).
 */
function freeHostIdsLines(): string {
  return HOST_ACCOUNT === 'node' ? 'RUN deluser node\n' : '';
}

/** Runs `docker` with `programArguments` and gives its trimmed standard output. */
async function docker(...programArguments: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', programArguments);
  return stdout.trim();
}

/** The `id` of `account` in container `containerId` as `<userId>:<groupId>`, from `docker exec <id> id -u/-g <account>`. */
async function idsOf(containerId: string, account: string): Promise<string> {
  const userId = await docker('exec', containerId, 'id', '-u', account);
  const groupId = await docker('exec', containerId, 'id', '-g', account);
  return `${userId}:${groupId}`;
}

/** `Config.User` of container `containerId`. */
function configuredUserOf(containerId: string): Promise<string> {
  return docker('inspect', '-f', '{{.Config.User}}', containerId);
}

/** The ids of the host as `<userId>:<groupId>`. */
function hostIds(): string {
  return `${String(HOST_UID)}:${String(HOST_GID)}`;
}

/** The image repositories the CLI made for `folder`: the build and the `-uid` image, sorted. */
async function folderImagesOf(folder: string): Promise<string[]> {
  const repositories = await docker('images', '--format', '{{.Repository}}');
  const prefix = `vsc-${path.basename(folder).toLowerCase()}-`;
  return repositories
    .split('\n')
    .filter(each => each.startsWith(prefix))
    .sort();
}

/** The `-uid` image repositories among the folder's. */
async function uidImagesOf(folder: string): Promise<string[]> {
  return (await folderImagesOf(folder)).filter(each => each.endsWith('-uid'));
}

/** The name F-0416 BR-15 gives the folder's `-uid` image. */
function uidImageName(folder: string): string {
  const digest = createHash('sha256').update(folder).digest('hex');
  return `vsc-${path.basename(folder).toLowerCase()}-${digest}-uid`;
}

/** Removes the images the CLI made for `folder` and the ones `extra` names. */
async function removeImages(
  folder: string,
  extra: readonly string[] = [],
): Promise<void> {
  const images = [...(await folderImagesOf(folder)), ...extra];
  if (images.length > 0) {
    await execFileAsync('docker', ['image', 'rm', '-f', ...images]);
  }
}

/**
 * Writes the folder `<run>/<name>` with a Dockerfile on the run's image that adds `dockerfileLines`, and a
 * configuration that builds it, over `configuration`.
 */
function dockerfileFolder(
  name: string,
  dockerfileLines: string,
  configuration: Readonly<Record<string, unknown>> = {},
): string {
  const folder = devContainerFolder(name, {
    image: undefined,
    build: {dockerfile: 'Dockerfile'},
    ...configuration,
  });
  mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
  writeFileSync(
    path.join(folder, '.devcontainer', 'Dockerfile'),
    `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n${dockerfileLines}`,
  );
  return folder;
}

/** Opens `folder` in a window, reopens it in its container, and gives the window's name. */
async function reopened(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  return name;
}

/** The one container of `folder`; it fails when the number is not one. */
async function containerOf(folder: string): Promise<string> {
  const containers = await devContainersOf(folder);
  const [containerId] = containers;
  if (containerId === undefined || containers.length !== 1) {
    throw new Error(
      `expected one container of ${folder}, found ${
        containers.length === 0 ? 'none' : containers.join(', ')
      }`,
    );
  }
  return containerId;
}

/** The users of the processes of container `containerId` whose command line holds `fragment`, sorted and unique. */
async function usersRunning(
  containerId: string,
  fragment: string,
): Promise<string[]> {
  const table = await docker('exec', containerId, 'ps', '-o', 'user,args');
  const users = table
    .split('\n')
    .filter(line => line.includes(fragment))
    .map(line => line.trim().split(/\s+/)[0] ?? '');
  return [...new Set(users)].sort();
}

/** The account window `name`'s new integrated terminal runs as: it types `id -un` and reads the marked answer. */
async function terminalUserOf(name: string): Promise<string> {
  await inWindow(name, 'workbench.action.terminal.new');
  await focusTerminal(name);
  await typeInTerminal(name, 'echo "terminal-user=$(id -un)"\n');
  let user = '';
  await waitFor(
    `the terminal of window ${name} to answer`,
    async () => {
      user = /^terminal-user=(\S+)$/m.exec(await terminalText(name))?.[1] ?? '';
      return user !== '';
    },
    60_000,
  );
  return user;
}

/** The string of the editor's table that the failed-setup dialog shows. */
const S034 = 'An error occurred setting up the container.';

/** F-0410's three buttons, sorted. */
const RECOVERY_BUTTONS = [
  'Edit devcontainer.json Locally',
  'More Actions...',
  'Retry',
];

/** How long a connect that ends in a dialog takes: the build, the start and the failed step. */
const DIALOG_MILLISECONDS = 180_000;

/** The window's saying and buttons: the dialog's details and its buttons, sorted. */
function sayingAndButtons(dialog: ShownDialog): {
  details: string;
  buttons: string[];
} {
  return {details: dialog.details, buttons: [...dialog.buttons].sort()};
}

/** Opens `folder`, starts Reopen in Container, and gives the window's name and the dialog that ends the connect. */
async function failedConnect(
  folder: string,
): Promise<{name: string; dialog: ShownDialog}> {
  const name = await openFolderWindow(folder);
  await reopenStarted(name);
  return {name, dialog: await waitForDialog(name, DIALOG_MILLISECONDS)};
}

/** The state and the creation time of container `containerId`, from `docker inspect`. */
async function stateOf(
  containerId: string,
): Promise<{status: string; created: string}> {
  const text = await docker(
    'inspect',
    '-f',
    '{{.State.Status}} {{.Created}}',
    containerId,
  );
  const [status = '', created = ''] = text.split(' ');
  return {status, created};
}

/** The value of the variable `variableName` in container `containerId`'s `Config.Env`, or undefined when it has none. */
async function configuredEnvOf(
  containerId: string,
  variableName: string,
): Promise<string | undefined> {
  const text = await docker(
    'inspect',
    '-f',
    '{{json .Config.Env}}',
    containerId,
  );
  const entries = JSON.parse(text) as string[];
  return entries
    .find(entry => entry.startsWith(`${variableName}=`))
    ?.slice(variableName.length + 1);
}

/** The value of `variableName` in a plain `docker exec` of container `containerId`, empty when it has none. */
function execEnvOf(containerId: string, variableName: string): Promise<string> {
  return docker('exec', containerId, 'printenv', variableName).catch(() => '');
}

/** Sets `key` of `folder`'s devcontainer.json to `value`, or removes it when `value` is undefined. */
function editConfiguration(folder: string, key: string, value: unknown): void {
  const file = path.join(folder, '.devcontainer', 'devcontainer.json');
  const others = Object.entries(
    JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>,
  ).filter(([name]) => name !== key);
  const configuration = Object.fromEntries(
    value === undefined ? others : [...others, [key, value]],
  );
  writeFileSync(file, JSON.stringify(configuration));
}

describe('F-0416 users and the UID image (card containers-42)', function () {
  this.timeout(900_000);

  it('F-0416 AC-1 (u1): with no containerUser and no remoteUser, Config.User is the image’s own default user', async () => {
    const folder = dockerfileFolder(
      'c42-default-user',
      `${accountLines('tester', OTHER_ID)}USER tester\n`,
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const configuredUser = await configuredUserOf(containerId);
      await closeWindow(name);
      deepStrictEqual(configuredUser, 'tester');
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-4 (u4): a containerUser that already has the host’s ids is Config.User, and a -uid image is still made', async () => {
    const folder = dockerfileFolder('c42-matching-user', hostAccountLines(), {
      containerUser: HOST_ACCOUNT,
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const configuredUser = await configuredUserOf(containerId);
      const uidImages = await uidImagesOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {configuredUser, uidImages},
        {configuredUser: HOST_ACCOUNT, uidImages: [uidImageName(folder)]},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-5 (u5): a mismatched remoteUser gets the host’s ids, and its home directory is owned by them', async () => {
    const folder = dockerfileFolder(
      'c42-synced-user',
      `${freeHostIdsLines()}${accountLines('tester', OTHER_ID)}`,
      {remoteUser: 'tester'},
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const accountIds = await idsOf(containerId, 'tester');
      const home = await docker(
        'exec',
        containerId,
        'stat',
        '-c',
        '%u:%g',
        '/home/tester',
      );
      await closeWindow(name);
      deepStrictEqual(
        {accountIds, home},
        {accountIds: hostIds(), home: hostIds()},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-6 (u6): with containerUser root, Config.User is root and the remoteUser account is still synced', async () => {
    const folder = dockerfileFolder(
      'c42-root-container-user',
      `${freeHostIdsLines()}${accountLines('tester', OTHER_ID)}`,
      {containerUser: 'root', remoteUser: 'tester'},
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const configuredUser = await configuredUserOf(containerId);
      const accountIds = await idsOf(containerId, 'tester');
      await closeWindow(name);
      deepStrictEqual(
        {configuredUser, accountIds},
        {configuredUser: 'root', accountIds: hostIds()},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-7 (u7): with updateRemoteUserUID false, no -uid image is made and the account keeps its ids', async () => {
    const folder = dockerfileFolder(
      'c42-no-sync',
      accountLines('tester', OTHER_ID),
      {remoteUser: 'tester', updateRemoteUserUID: false},
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const accountIds = await idsOf(containerId, 'tester');
      const uidImages = await uidImagesOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {accountIds, uidImages},
        {accountIds: `${String(OTHER_ID)}:${String(OTHER_ID)}`, uidImages: []},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-8 (u8): host ids another account already uses leave the remoteUser’s ids alone, with no notification', async () => {
    const taken =
      HOST_ACCOUNT === 'node' ? '' : accountLines('squatter', HOST_UID);
    const folder = dockerfileFolder(
      'c42-id-collision',
      `${taken}${accountLines('tester', OTHER_ID)}`,
      {remoteUser: 'tester'},
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const accountIds = await idsOf(containerId, 'tester');
      const toasts = await notifications(name);
      await closeWindow(name);
      deepStrictEqual(
        {accountIds, toasts},
        {accountIds: `${String(OTHER_ID)}:${String(OTHER_ID)}`, toasts: []},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-20 (u20): a configuration whose users all end at root builds no -uid image', async () => {
    const folder = devContainerFolder('c42-root-only');
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const configuredUser = await configuredUserOf(containerId);
      const images = await folderImagesOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {configuredUser, images},
        {configuredUser: '', images: []},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-21 (u21): a numeric remoteUser that is already the account’s id builds no -uid image', async () => {
    const folder = dockerfileFolder(
      'c42-numeric-user',
      accountLines('tester', 2000),
      {remoteUser: '2000'},
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const accountIds = await idsOf(containerId, 'tester');
      const uidImages = await uidImagesOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {accountIds, uidImages},
        {accountIds: '2000:2000', uidImages: []},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-36 (u36): with different containerUser and remoteUser accounts, only the remoteUser’s ids are synced', async () => {
    const folder = dockerfileFolder(
      'c42-two-users',
      `${freeHostIdsLines()}${accountLines('tester', OTHER_ID)}${accountLines('builder', THIRD_ID)}`,
      {containerUser: 'builder', remoteUser: 'tester'},
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const tester = await idsOf(containerId, 'tester');
      const builder = await idsOf(containerId, 'builder');
      await closeWindow(name);
      deepStrictEqual(
        {tester, builder},
        {tester: hostIds(), builder: `${String(THIRD_ID)}:${String(THIRD_ID)}`},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-26, F-0501 AC-21 (u26): rebuilds, also after the Dockerfile changed, leave exactly one -uid image, named by the folder’s path', async () => {
    const lines = `${freeHostIdsLines()}${accountLines('tester', OTHER_ID)}`;
    const folder = dockerfileFolder('c42-rebuilds', lines, {
      remoteUser: 'tester',
    });
    const dockerfile = path.join(folder, '.devcontainer', 'Dockerfile');
    const from = `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n`;
    try {
      const name = await reopened(folder);
      const afterFirst = await uidImagesOf(folder);
      await reopenInContainer(
        name,
        300_000,
        'remote-containers.rebuildContainer',
      );
      const afterSecond = await uidImagesOf(folder);
      writeFileSync(dockerfile, `${from}${lines}RUN touch /changed\n`);
      await reopenInContainer(
        name,
        300_000,
        'remote-containers.rebuildContainer',
      );
      const afterChange = await uidImagesOf(folder);
      await closeWindow(name);
      const expected = [uidImageName(folder)];
      deepStrictEqual(
        {afterFirst, afterSecond, afterChange},
        {afterFirst: expected, afterSecond: expected, afterChange: expected},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-40 (u40): runArgs with --user name the account to sync, and a -uid image is made', async () => {
    const folder = dockerfileFolder(
      'c42-run-args-user',
      `${freeHostIdsLines()}${accountLines('tester', OTHER_ID)}`,
      {runArgs: [...runLabelArguments(), '--user', 'tester']},
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const accountIds = await idsOf(containerId, 'tester');
      const uidImages = await uidImagesOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {accountIds, uidImages},
        {accountIds: hostIds(), uidImages: [uidImageName(folder)]},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-2, AC-3 (u2): an image label’s remoteUser runs the server and wins over a Dockerfile’s USER, which keeps its own ids', async () => {
    const base = 'c42-labelled-base';
    const context = path.join(variable('HARNESS_RUN_FOLDER'), 'c42-labelled');
    mkdirSync(context, {recursive: true});
    writeFileSync(
      path.join(context, 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n${accountLines('tester', OTHER_ID)}USER node\n` +
        `LABEL devcontainer.metadata='${JSON.stringify([{remoteUser: 'tester'}])}'\n`,
    );
    await docker('build', '--tag', base, context);
    const folder = dockerfileFolder('c42-label-user', '', {});
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      `FROM ${base}\nUSER root\n${accountLines('builder', THIRD_ID)}USER builder\n`,
    );
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const serverUsers = await usersRunning(containerId, 'server');
      const terminalUser = await terminalUserOf(name);
      const builder = await idsOf(containerId, 'builder');
      await closeWindow(name);
      deepStrictEqual(
        {serverUsers, terminalUser, builder},
        {
          serverUsers: ['tester'],
          terminalUser: 'tester',
          builder: `${String(THIRD_ID)}:${String(THIRD_ID)}`,
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder, [base]);
    }
  });

  it('F-0416 AC-11 (u11): a containerUser the image lacks shows F-0410’s dialog and leaves one container, created and never started', async () => {
    const folder = devContainerFolder('c42-bad-container-user', {
      containerUser: 'doesnotexist123',
    });
    try {
      const {name, dialog} = await failedConnect(folder);
      const containers = await devContainersOf(folder);
      const states = await Promise.all(containers.map(stateOf));
      await closeWindow(name);
      deepStrictEqual(
        {
          saying: sayingAndButtons(dialog),
          states: states.map(each => each.status),
        },
        {
          saying: {details: S034, buttons: RECOVERY_BUTTONS},
          states: ['created'],
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-12 (u12): Retry starts the same container again and shows the same dialog; the Reload Window and Rebuild halves wait for ruling 14’s pick item', async () => {
    const folder = devContainerFolder('c42-bad-user-retry', {
      containerUser: 'doesnotexist123',
    });
    try {
      const {name, dialog} = await failedConnect(folder);
      const [containerId = ''] = await devContainersOf(folder);
      const before = await stateOf(containerId);
      const activated = activations(name);
      await answerDialog(name, 'Retry');
      await waitFor(
        `window ${name} to activate again`,
        () => activations(name) > activated,
        60_000,
      );
      const again = await waitForDialog(name, DIALOG_MILLISECONDS);
      const containers = await devContainersOf(folder);
      const after = await stateOf(containerId);
      await closeWindow(name);
      deepStrictEqual(
        {dialog: sayingAndButtons(again), containers, after},
        {
          dialog: sayingAndButtons(dialog),
          containers: [containerId],
          after: before,
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-24 (u24): a remoteUser the image lacks shows F-0410’s dialog and leaves a running container', async () => {
    const folder = devContainerFolder('c42-bad-remote-user', {
      remoteUser: 'doesnotexist456',
    });
    try {
      const {name, dialog} = await failedConnect(folder);
      const containers = await devContainersOf(folder);
      const states = await Promise.all(containers.map(stateOf));
      await closeWindow(name);
      deepStrictEqual(
        {
          saying: sayingAndButtons(dialog),
          states: states.map(each => each.status),
        },
        {
          saying: {details: S034, buttons: RECOVERY_BUTTONS},
          states: ['running'],
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-15 (u15): containerEnv reaches a plain docker exec, with the editor’s variables resolved', async () => {
    const folder = devContainerFolder('c42-container-env', {
      containerEnv: {
        MY_CONTAINER_VAR: 'container-value',
        MY_CONTAINER_VAR2: '${localEnv:HARNESS_RUN_ID}',
      },
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const plain = {
        first: await execEnvOf(containerId, 'MY_CONTAINER_VAR'),
        second: await execEnvOf(containerId, 'MY_CONTAINER_VAR2'),
      };
      await closeWindow(name);
      deepStrictEqual(plain, {
        first: 'container-value',
        second: variable('HARNESS_RUN_ID'),
      });
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-16 (u16): a containerEnv variable from the editor’s environment that is not set is the empty string, with no error', async () => {
    const folder = devContainerFolder('c42-container-env-unset', {
      containerEnv: {MY_CONTAINER_VAR2: '${localEnv:F0416_LOCAL_VAR}'},
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const configured = await configuredEnvOf(
        containerId,
        'MY_CONTAINER_VAR2',
      );
      const plain = await execEnvOf(containerId, 'MY_CONTAINER_VAR2');
      const toasts = await notifications(name);
      await closeWindow(name);
      deepStrictEqual(
        {configured, plain, toasts},
        {configured: '', plain: '', toasts: []},
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-30 (u30): a containerEnv entry that refers to another with containerEnv keeps the literal text in Config.Env and in a process', async () => {
    const folder = devContainerFolder('c42-container-env-literal', {
      containerEnv: {
        FIRST_VAR: 'first-value',
        SECOND_VAR: '${containerEnv:FIRST_VAR}',
      },
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const configured = await configuredEnvOf(containerId, 'SECOND_VAR');
      const plain = await execEnvOf(containerId, 'SECOND_VAR');
      await closeWindow(name);
      deepStrictEqual(
        {configured, plain},
        {
          configured: '${containerEnv:FIRST_VAR}',
          plain: '${containerEnv:FIRST_VAR}',
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-32 (u32): a containerEnv default is used when the editor’s variable is unset, as seen by a plain docker exec', async () => {
    const folder = devContainerFolder('c42-container-env-default', {
      containerEnv: {
        MY_CONTAINER_VAR2: '${localEnv:F0416_LOCAL_VAR:my-default}',
      },
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const plain = await execEnvOf(containerId, 'MY_CONTAINER_VAR2');
      await closeWindow(name);
      deepStrictEqual(plain, 'my-default');
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-25 (u25): changing only remoteUser to root and reloading keeps the container and the images, and the terminal runs as root (ruling 15: the reload is the step, athena on #1068)', async () => {
    const lines = `${freeHostIdsLines()}${accountLines('tester', OTHER_ID)}`;
    const folder = dockerfileFolder('c42-reload-root', lines, {
      remoteUser: 'tester',
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      const before = await stateOf(containerId);
      const imagesBefore = await folderImagesOf(folder);
      editConfiguration(folder, 'remoteUser', 'root');
      await reloadWindow(name);
      await connectedToContainer(name);
      const terminalUser = await terminalUserOf(name);
      const after = await stateOf(containerId);
      const imagesAfter = await folderImagesOf(folder);
      const containers = await devContainersOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {terminalUser, created: after.created, imagesAfter, containers},
        {
          terminalUser: 'root',
          created: before.created,
          imagesAfter: imagesBefore,
          containers: [containerId],
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-34 (u34): switching remoteUser to another account in the image and reloading leaves that account its own ids (ruling 15: the reload is the step, athena on #1068)', async () => {
    const lines = `${freeHostIdsLines()}${accountLines('tester', OTHER_ID)}${accountLines('builder', THIRD_ID)}`;
    const folder = dockerfileFolder('c42-reload-switch', lines, {
      remoteUser: 'tester',
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      editConfiguration(folder, 'remoteUser', 'builder');
      await reloadWindow(name);
      await connectedToContainer(name);
      await docker('start', containerId);
      const builder = await idsOf(containerId, 'builder');
      await closeWindow(name);
      deepStrictEqual(builder, `${String(THIRD_ID)}:${String(THIRD_ID)}`);
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-35 (ruling-16): the switch connects: switching remoteUser to another account and reloading connects to the same container, running, as the new account, with no dialog (a recorded deviation, athena ruling 16 on #1068)', async () => {
    const lines = `${freeHostIdsLines()}${accountLines('tester', OTHER_ID)}${accountLines('builder', THIRD_ID)}`;
    const folder = dockerfileFolder('c42-switch-connects', lines, {
      remoteUser: 'tester',
    });
    try {
      const name = await reopened(folder);
      const containerId = await containerOf(folder);
      editConfiguration(folder, 'remoteUser', 'builder');
      await reloadWindow(name);
      await connectedToContainer(name);
      const terminalUser = await terminalUserOf(name);
      const status = (await stateOf(containerId)).status;
      const dialog = await dialogOf(name);
      const containers = await devContainersOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {terminalUser, status, dialog, containers},
        {
          terminalUser: 'builder',
          status: 'running',
          dialog: undefined,
          containers: [containerId],
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-12 (u12b): More Actions... Reload Window starts the same container and shows the dialog again, and Rebuild Container replaces it', async () => {
    const folder = devContainerFolder('c42-bad-user-pick', {
      containerUser: 'doesnotexist123',
    });
    try {
      const {name, dialog} = await failedConnect(folder);
      const [first = ''] = await devContainersOf(folder);
      const created = (await stateOf(first)).created;
      const activated = activations(name);
      await answerDialog(name, 'More Actions...');
      await waitForQuickPick(name, 30_000);
      await chooseQuickPickItem(name, 'Reload Window');
      await waitFor(
        `window ${name} to activate again`,
        () => activations(name) > activated,
        60_000,
      );
      const again = await waitForDialog(name, DIALOG_MILLISECONDS);
      const afterReload = await devContainersOf(folder);
      const createdAfter = (await stateOf(first)).created;
      const rebuilding = activations(name);
      await answerDialog(name, 'More Actions...');
      await waitForQuickPick(name, 30_000);
      await chooseQuickPickItem(name, 'Rebuild Container');
      await waitFor(
        `window ${name} to activate after the rebuild`,
        () => activations(name) > rebuilding,
        60_000,
      );
      await waitForDialog(name, DIALOG_MILLISECONDS);
      const afterRebuild = await devContainersOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {
          dialog: sayingAndButtons(again),
          reloaded: afterReload,
          created: createdAfter,
          replaced: afterRebuild.length === 1 && afterRebuild[0] !== first,
        },
        {
          dialog: sayingAndButtons(dialog),
          reloaded: [first],
          created,
          replaced: true,
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });

  it('F-0416 AC-13 (u13): a containerEnv HOME the user cannot create fails with the dialog, Retry still fails after the override is removed, and Rebuild Container connects', async () => {
    const folder = devContainerFolder('c42-bad-home', {
      containerEnv: {HOME: '/proc/c42-home'},
    });
    try {
      const {name, dialog} = await failedConnect(folder);
      editConfiguration(folder, 'containerEnv', undefined);
      const activated = activations(name);
      await answerDialog(name, 'Retry');
      await waitFor(
        `window ${name} to activate again`,
        () => activations(name) > activated,
        60_000,
      );
      const again = await waitForDialog(name, DIALOG_MILLISECONDS);
      await answerDialog(name, 'More Actions...');
      await waitForQuickPick(name, 30_000);
      await chooseQuickPickItem(name, 'Rebuild Container');
      await connectedToContainer(name, 300_000);
      const containers = await devContainersOf(folder);
      await closeWindow(name);
      deepStrictEqual(
        {
          first: sayingAndButtons(dialog),
          retried: sayingAndButtons(again),
          containers: containers.length,
        },
        {
          first: {details: S034, buttons: RECOVERY_BUTTONS},
          retried: {details: S034, buttons: RECOVERY_BUTTONS},
          containers: 1,
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder);
    }
  });
});
