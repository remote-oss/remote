import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reloadingCommand,
  reopenInContainer,
  reopenStarted,
  variable,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  type ShownDialog,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

const WORKTREE_SETTING = 'dev.containers.experimentalMountGitWorktreeCommonDir';
const CONSISTENCY_SETTING = 'dev.containers.workspaceMountConsistency';

/** How long the connect to a container takes, up to the dialog that may replace it. */
const DIALOG_MILLISECONDS = 180_000;

const S034 = 'An error occurred setting up the container.';

/** One mount of a container, as `docker inspect -f '{{json .Mounts}}'` gives it. */
interface Mount {
  Type: string;
  Source: string;
  Destination: string;
}

/** The mounts of container `containerId` whose destination is under /workspaces, as this file's Mount fields. */
async function workspaceMountsOf(containerId: string): Promise<Mount[]> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    '{{json .Mounts}}',
    containerId,
  ]);
  return (JSON.parse(stdout) as Mount[])
    .filter(mount => mount.Destination.startsWith('/workspaces'))
    .map(mount => ({
      Type: mount.Type,
      Source: mount.Source,
      Destination: mount.Destination,
    }));
}

/** The `HostConfig.Mounts` of container `containerId` that are under /workspaces, as Docker records the request. */
async function requestedMountsOf(
  containerId: string,
): Promise<Array<Record<string, unknown>>> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    '{{json .HostConfig.Mounts}}',
    containerId,
  ]);
  return (
    (JSON.parse(stdout) as Array<Record<string, unknown>> | null) ?? []
  ).filter(mount => String(mount.Target).startsWith('/workspaces'));
}

/** The one id `devContainersOf` gives for `folder`; it fails when the number is not one. */
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

/** Runs `git` in `directory`, as a user who has a name. */
async function runGit(
  directory: string,
  ...parameters: string[]
): Promise<void> {
  await execFileAsync(
    'git',
    ['-c', 'user.name=Row', '-c', 'user.email=row@example.com', ...parameters],
    {cwd: directory},
  );
}

/**
 * Makes the dev container folder `<run>/<main>` a repository with its configuration committed, and a linked worktree
 * `<run>/<linked>` of it with a relative path (`git worktree add --relative-paths`); gives the two folders.
 */
async function worktreeOf(
  main: string,
  linked: string,
): Promise<{main: string; linked: string}> {
  const mainFolder = devContainerFolder(main);
  const linkedFolder = path.join(variable('HARNESS_RUN_FOLDER'), linked);
  mkdirSync(path.dirname(linkedFolder), {recursive: true});
  await runGit(mainFolder, 'init', '-q');
  await runGit(mainFolder, 'add', '.');
  await runGit(mainFolder, 'commit', '-q', '-m', 'configuration');
  await runGit(
    mainFolder,
    'worktree',
    'add',
    '-q',
    '--relative-paths',
    '-b',
    'linked',
    linkedFolder,
  );
  return {main: mainFolder, linked: linkedFolder};
}

/** Runs `work` with `setting` at `value`, and sets it back afterwards. */
async function withSetting(
  setting: string,
  value: unknown,
  work: () => Promise<void>,
): Promise<void> {
  await setUserSetting(setting, value);
  try {
    await work();
  } finally {
    await setUserSetting(setting, undefined);
  }
}

/** Reopens `folder` in its container and gives the window's name and the folder's container. */
async function reopened(
  folder: string,
): Promise<{name: string; containerId: string}> {
  const name = await openFolderWindow(folder);
  await reopenInContainer(name);
  return {name, containerId: await containerOf(folder)};
}

/** A dialog as the rows compare it: its message and its detail. */
function sayingOf(dialog: ShownDialog): {message: string; details: string} {
  return {message: dialog.message, details: dialog.details};
}

describe('F-0411 mount settings (card containers-28)', function () {
  this.timeout(900_000);

  it('F-0411 AC-14 (m1): with no setting a sibling worktree is mounted alone, and no .git is mounted', async () => {
    const {main, linked} = await worktreeOf('c28-main', 'c28-linked');
    try {
      const {name, containerId} = await reopened(linked);
      const mounts = await workspaceMountsOf(containerId);
      await closeWindow(name);
      deepStrictEqual(mounts, [
        {Type: 'bind', Source: linked, Destination: '/workspaces/c28-linked'},
      ]);
    } finally {
      await removeContainers(linked);
      await removeContainers(main);
    }
  });

  it('F-0411 AC-9 (m2): with the setting false only the worktree is mounted, at its own name', async () => {
    const {main, linked} = await worktreeOf('c28-main-off', 'c28-linked-off');
    try {
      await withSetting(WORKTREE_SETTING, false, async () => {
        const {name, containerId} = await reopened(linked);
        const mounts = await workspaceMountsOf(containerId);
        await closeWindow(name);
        deepStrictEqual(mounts, [
          {
            Type: 'bind',
            Source: linked,
            Destination: '/workspaces/c28-linked-off',
          },
        ]);
      });
    } finally {
      await removeContainers(linked);
      await removeContainers(main);
    }
  });

  it('F-0411 AC-10, AC-37 (m3): with the setting true, and written as the text "true", the main repository’s .git is a second bind', async () => {
    const seen: Mount[][] = [];
    for (const [value, suffix] of [
      [true, 'bool'],
      ['true', 'text'],
    ] as const) {
      const {main, linked} = await worktreeOf(
        `c28-main-${suffix}`,
        `c28-linked-${suffix}`,
      );
      try {
        await withSetting(WORKTREE_SETTING, value, async () => {
          const {name, containerId} = await reopened(linked);
          seen.push(await workspaceMountsOf(containerId));
          await closeWindow(name);
        });
      } finally {
        await removeContainers(linked);
        await removeContainers(main);
      }
    }
    function expected(suffix: string): Mount[] {
      return [
        {
          Type: 'bind',
          Source: path.join(
            variable('HARNESS_RUN_FOLDER'),
            `c28-linked-${suffix}`,
          ),
          Destination: `/workspaces/c28-linked-${suffix}`,
        },
        {
          Type: 'bind',
          Source: path.join(
            variable('HARNESS_RUN_FOLDER'),
            `c28-main-${suffix}`,
            '.git',
          ),
          Destination: `/workspaces/c28-main-${suffix}/.git`,
        },
      ];
    }
    deepStrictEqual(
      seen.map(mounts =>
        [...mounts].sort((left, right) =>
          left.Destination.localeCompare(right.Destination),
        ),
      ),
      [expected('bool'), expected('text')].map(mounts =>
        [...mounts].sort((left, right) =>
          left.Destination.localeCompare(right.Destination),
        ),
      ),
    );
  });

  it('F-0411 AC-28 (m4): a worktree whose repository is not its sibling is mounted at its path from the nearest common folder, and the window opens there', async () => {
    const {main, linked} = await worktreeOf('x1/deep/main', 'x1/wt-rel/wt');
    try {
      await withSetting(WORKTREE_SETTING, true, async () => {
        const {name, containerId} = await reopened(linked);
        const mounts = await workspaceMountsOf(containerId);
        const folders = (await windowState(name)).folders.map(folder =>
          decodeURIComponent(folder),
        );
        await closeWindow(name);
        deepStrictEqual(
          [
            mounts.map(mount => mount.Destination).sort(),
            folders.every(folder => folder.endsWith('/workspaces/wt-rel/wt')),
          ],
          [['/workspaces/deep/main/.git', '/workspaces/wt-rel/wt'], true],
        );
      });
    } finally {
      await removeContainers(linked);
      await removeContainers(main);
    }
  });

  it('F-0411 AC-35 (m5): turning the setting on without a rebuild reuses the container with its mounts, and core says the new workspace does not exist', async () => {
    const {main, linked} = await worktreeOf('x2/deep/main', 'x2/wt-rel/wt');
    try {
      const first = await reopened(linked);
      const mounts = await workspaceMountsOf(first.containerId);
      await closeWindow(first.name);
      await withSetting(WORKTREE_SETTING, true, async () => {
        const name = await openFolderWindow(linked);
        await reopenStarted(name);
        const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
        const reused = await devContainersOf(linked);
        const after = await workspaceMountsOf(first.containerId);
        await answerDialog(name, 'Cancel');
        await closeWindow(name);
        deepStrictEqual(
          {
            saying: sayingOf(dialog),
            reused,
            unchanged: JSON.stringify(after) === JSON.stringify(mounts),
          },
          {
            saying: {
              message: 'Workspace does not exist',
              details: 'Please select another workspace to open.',
            },
            reused: [first.containerId],
            unchanged: true,
          },
        );
      });
    } finally {
      await removeContainers(linked);
      await removeContainers(main);
    }
  });

  it('F-0411 AC-36 (m6): a sibling worktree that the repository no longer lists is still mounted with the repository’s .git, and the window connects', async () => {
    const {main, linked} = await worktreeOf('c28-main-gone', 'c28-linked-gone');
    rmSync(path.join(main, '.git', 'worktrees'), {recursive: true});
    try {
      await withSetting(WORKTREE_SETTING, true, async () => {
        const {name, containerId} = await reopened(linked);
        const mounts = await workspaceMountsOf(containerId);
        await closeWindow(name);
        deepStrictEqual(mounts.map(mount => mount.Destination).sort(), [
          '/workspaces/c28-linked-gone',
          '/workspaces/c28-main-gone/.git',
        ]);
      });
    } finally {
      await removeContainers(linked);
      await removeContainers(main);
    }
  });

  it('F-0411 AC-8 (m7): each consistency, rebuilt after each change, leaves no consistency on a native Linux engine’s workspace mount', async () => {
    const folder = devContainerFolder('c28-consistency');
    const seen: unknown[] = [];
    try {
      const {name} = await reopened(folder);
      for (const value of ['cached', 'consistent', 'delegated']) {
        await setUserSetting(CONSISTENCY_SETTING, value);
        await reloadingCommand(name, 'remote-containers.rebuildContainer');
        await connectedToContainer(name);
        const requested = await requestedMountsOf(await containerOf(folder));
        seen.push(requested.map(mount => 'Consistency' in mount));
      }
      await closeWindow(name);
      deepStrictEqual(seen, [[false], [false], [false]]);
    } finally {
      await setUserSetting(CONSISTENCY_SETTING, undefined);
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-19 (m8): a workspaceMount that names its consistency keeps it, whatever the setting says, also after a rebuild', async () => {
    const folder = devContainerFolder('c28-explicit', {
      workspaceMount:
        'source=${localWorkspaceFolder},target=/workspaces/c28-explicit,type=bind,consistency=delegated',
      workspaceFolder: '/workspaces/c28-explicit',
    });
    const seen: unknown[] = [];
    try {
      await setUserSetting(CONSISTENCY_SETTING, 'consistent');
      const {name} = await reopened(folder);
      seen.push(await requestedMountsOf(await containerOf(folder)));
      await setUserSetting(CONSISTENCY_SETTING, 'cached');
      await reloadingCommand(name, 'remote-containers.rebuildContainer');
      await connectedToContainer(name);
      seen.push(await requestedMountsOf(await containerOf(folder)));
      await closeWindow(name);
      deepStrictEqual(
        seen.map(mounts =>
          (mounts as Array<Record<string, unknown>>).map(
            mount => mount.Consistency,
          ),
        ),
        [['delegated'], ['delegated']],
      );
    } finally {
      await setUserSetting(CONSISTENCY_SETTING, undefined);
      await removeContainers(folder);
    }
  });

  it('F-0411 AC-38 (m9): a consistency outside the list makes no container and shows the generic dialog', async () => {
    const folder = devContainerFolder('c28-fast');
    try {
      await withSetting(CONSISTENCY_SETTING, 'fast', async () => {
        const name = await openFolderWindow(folder);
        await reopenStarted(name);
        const dialog = await waitForDialog(name, DIALOG_MILLISECONDS);
        const containers = await devContainersOf(folder);
        await closeWindow(name);
        deepStrictEqual(
          {saying: sayingOf(dialog), containers},
          {saying: {message: '', details: S034}, containers: []},
        );
      });
    } finally {
      await removeContainers(folder);
    }
  });
});
