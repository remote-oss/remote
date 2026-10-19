import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  runLabelArguments,
  variable,
} from '../windows/harness.ts';
import {notifications} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

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

  it('F-0416 AC-26 (u26): rebuilds, also after the Dockerfile changed, leave exactly one -uid image, named by the folder’s path', async () => {
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
      const builder = await idsOf(containerId, 'builder');
      await closeWindow(name);
      deepStrictEqual(
        {serverUsers, builder},
        {
          serverUsers: ['tester'],
          builder: `${String(THIRD_ID)}:${String(THIRD_ID)}`,
        },
      );
    } finally {
      await removeContainers(folder);
      await removeImages(folder, [base]);
    }
  });
});
