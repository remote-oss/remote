import {deepStrictEqual} from 'node:assert';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenStarted,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  notificationCentre,
  chooseQuickPickRow,
  quickPickFacts,
  quickPickRows,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {installBrowser, openedUrls} from '../windows/web-ui-support.ts';
import {noDaemonDocker} from './resolve-support.ts';

/** The dialog of a setup that fails, as F-0410 words it. */
const FAILED_SETUP = 'An error occurred setting up the container.';

/** The title of the quick pick that More Actions... opens. */
const PICK_PLACEHOLDER = 'Pick an action to help resolve the problem.';

/** The placeholder of core's Open Recent picker. */
const RECENT_PLACEHOLDER =
  'Select to open (hold Ctrl-key to force new window or Alt-key for same window)';

/** A folder whose image build fails, so that no container is created. */
function failingBuildFolder(label: string): string {
  const folder = devContainerFolder(label, {
    name: label,
    image: undefined,
    build: {dockerfile: 'Dockerfile'},
  });
  writeFileSync(
    path.join(folder, '.devcontainer', 'Dockerfile'),
    `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nRUN false\n`,
  );
  return folder;
}

/** Opens a window on `folder`, reopens it in a container and gives the window once the setup-failure dialog shows. */
async function failedSetup(folder: string): Promise<string> {
  const name = await openFolderWindow(folder);
  await reopenStarted(name);
  const dialog = await waitForDialog(name, 180_000);
  deepStrictEqual(dialog.details, FAILED_SETUP);
  return name;
}

describe('F-0502 the failures of the resolution (card containers-43)', function () {
  this.timeout(900_000);

  it('F-0502 AC-18 (c43-no-daemon): Reopen in Container with a Docker endpoint that does not answer shows the engine error with Cancel and Show Log, and either leaves the local folder window and creates no container', async () => {
    await setUserSetting('dev.containers.dockerPath', noDaemonDocker());
    try {
      const results: unknown[] = [];
      for (const button of ['Cancel', 'Show Log']) {
        const folder = devContainerFolder(
          `c43-no-daemon-${button.replace(' ', '-').toLowerCase()}`,
        );
        const name = await openFolderWindow(folder);
        try {
          const running = inWindow(name, 'remote-containers.reopenInContainer');
          const dialog = await waitForDialog(name);
          await answerDialog(name, button);
          await running;
          results.push({
            message: dialog.message,
            details: dialog.details,
            buttons: [...dialog.buttons],
            remoteName: (await windowState(name)).remoteName,
            containers: await devContainersOf(folder),
          });
        } finally {
          await closeWindow(name);
          await removeContainers(folder);
        }
      }
      const expected = {
        message: 'Docker returned an error.',
        details: 'Make sure the Docker daemon is running.',
        buttons: ['Cancel', 'Show Log'],
        remoteName: null,
        containers: [],
      };
      deepStrictEqual(results, [expected, expected]);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0502 AC-28 (c43-more-actions): More Actions... after a failed image build lists its four actions with Reload Window focused, and Open Documentation opens our troubleshooting page, not the reference’s aka.ms one', async () => {
    installBrowser();
    const folder = failingBuildFolder('c43-build-fails');
    const name = await failedSetup(folder);
    try {
      await answerDialog(name, 'More Actions...');
      const pick = await waitForQuickPick(name, 30_000);
      const rows = (await quickPickRows(name)).map(entry => [
        entry.label,
        entry.focused,
      ]);
      await chooseQuickPickRow(name, 'Open Documentation');
      const confirmation = await waitForDialog(name, 30_000);
      await answerDialog(name, 'Open');
      await waitFor(
        'the page to be opened',
        () => openedUrls().length > 0,
        30_000,
      );
      deepStrictEqual(
        {
          placeholder: pick.placeholder,
          rows,
          asked: confirmation.message.endsWith('to open the external website?'),
          opened: openedUrls(),
          containers: await devContainersOf(folder),
        },
        {
          placeholder: PICK_PLACEHOLDER,
          rows: [
            ['Reload Window', true],
            ['Edit devcontainer.json Locally', false],
            ['Open Recent...', false],
            ['Open Documentation', false],
          ],
          asked: true,
          opened: [
            'https://github.com/remote-oss/remote/blob/main/docs/remote-containers/README.md#when-the-dev-container-cant-be-set-up',
          ],
          containers: [],
        },
      );
    } finally {
      await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-30 (c43-rebuild-item): after a setup that fails with a container, More Actions... Rebuild Container removes the old container and makes a new one before the resolution runs again, and Open Recent... opens the Open Recent picker', async () => {
    const folder = devContainerFolder('c43-has-container', {
      name: 'Has Container',
      containerUser: 'doesnotexist123',
    });
    const name = await openFolderWindow(folder);
    try {
      await reopenStarted(name);
      await waitForDialog(name, 180_000);
      const [oldId = ''] = await devContainersOf(folder);
      await answerDialog(name, 'More Actions...');
      await waitForQuickPick(name, 30_000);
      await chooseQuickPickRow(name, 'Rebuild Container');
      await waitFor(
        'a new container to replace the old one',
        async () => {
          const containerIds = await devContainersOf(folder);
          return containerIds.length === 1 && containerIds[0] !== oldId;
        },
        180_000,
      );
      await waitForDialog(name, 180_000);
      const oldGone = !(await devContainersOf(folder)).includes(oldId);
      await answerDialog(name, 'More Actions...');
      await waitForQuickPick(name, 30_000);
      await chooseQuickPickRow(name, 'Open Recent...');
      await waitFor(
        'the Open Recent picker',
        async () =>
          ((await quickPickFacts(name))?.placeholder ?? PICK_PLACEHOLDER) !==
          PICK_PLACEHOLDER,
        30_000,
      );
      const recent = await quickPickFacts(name);
      deepStrictEqual(
        {oldGone, recent: recent?.placeholder},
        {oldGone: true, recent: RECENT_PLACEHOLDER},
      );
    } finally {
      await closeWindow(name);
      await removeContainers(folder);
    }
  });

  it('F-0502 AC-12 (c43-slow-create): an onCreateCommand of 600 s is waited for in full: no timeout dialog, no S375, and the window connects only after it', async () => {
    const folder = devContainerFolder('c43-slow-create', {
      name: 'Slow Create',
      onCreateCommand: 'sleep 600',
    });
    const name = await openFolderWindow(folder);
    try {
      const began = Date.now();
      await reopenStarted(name);
      await new Promise(resolve => setTimeout(resolve, 560_000));
      const during = {
        dialog: await dialogOf(name),
        remoteName: (await windowState(name)).remoteName,
      };
      await connectedToContainer(name, 300_000);
      const seconds = (Date.now() - began) / 1000;
      const texts = await notificationCentre(name);
      deepStrictEqual(
        {
          during,
          afterTheCommand: seconds >= 600,
          timeout: texts.some(text => text.includes('Timeout after')),
          dialog: await dialogOf(name),
        },
        {
          during: {dialog: undefined, remoteName: 'dev-container'},
          afterTheCommand: true,
          timeout: false,
          dialog: undefined,
        },
      );
    } finally {
      await closeWindow(name);
      await removeContainers(folder);
    }
  });
});
