import {deepStrictEqual} from 'node:assert';
import {
  docker,
  listingOnly,
  openedPicker,
  removeGroup,
  started,
} from '../windows/attach-support.ts';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  closeWindow,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {
  chooseQuickPickRow,
  pressEscape,
  rememberPage,
  answerDialogAt,
  waitForDialogElsewhere,
} from '../windows/renderer.ts';

const DOCKER_PATH = 'dev.containers.dockerPath';

/** Picks the one row `label` after `change` has altered the container behind it. */
async function pickedAfter(
  label: string,
  change: () => Promise<unknown>,
): Promise<void> {
  await openedPicker();
  await change();
  await chooseQuickPickRow('local', label);
}

/** Closes the windows that opened since `before`, as far as their agents name them. */
async function closedSince(before: readonly string[]): Promise<void> {
  for (const name of windowNames().filter(each => !before.includes(each))) {
    await closeWindow(name).catch(() => undefined);
  }
}

describe('Attached containers that changed after the pick (card containers-163, #2030)', function () {
  this.timeout(600_000);

  before(() => rememberPage('local'));

  afterEach(async () => {
    await pressEscape('local').catch(() => undefined);
    await setUserSetting(DOCKER_PATH, undefined);
  });

  it('F-0601 AC-11, AC-12 (c163-stopped): a container stopped after the pick gives the not-running dialog in the new window, and Start Container starts it and attaches in that window', async () => {
    await started('c163-stopped', 'stopped');
    await setUserSetting(DOCKER_PATH, listingOnly('c163-stopped', 'stopped'));
    const before = windowNames();
    try {
      await pickedAfter('/c163-stopped', () =>
        docker('stop', '-t', '0', 'c163-stopped'),
      );
      const image = await docker(
        'inspect',
        '--format',
        '{{.Config.Image}}',
        'c163-stopped',
      );
      const {dialog, address} = await waitForDialogElsewhere('local', 120_000);
      await answerDialogAt(address, 'Start Container');
      await waitFor(
        'the window to attach after Start Container',
        () =>
          Promise.resolve(
            windowNames().some(
              name => !before.includes(name) && name !== 'local',
            ),
          ),
        240_000,
      );
      const opened = windowNames().filter(name => !before.includes(name));
      await waitFor(
        'the new window to show the attached remote',
        async () =>
          (await windowState(opened[0] ?? '')).remoteName ===
          'attached-container',
        240_000,
      );
      deepStrictEqual(
        [
          dialog.details,
          dialog.buttons,
          opened.length,
          await docker(
            'inspect',
            '--format',
            '{{.State.Running}}',
            'c163-stopped',
          ),
        ],
        [
          `Cannot attach to the container ${image} (c163-stopped), it is not running.`,
          ['Close Remote', 'More Actions...', 'Start Container'],
          1,
          'true',
        ],
      );
    } finally {
      await closedSince(before);
      await removeGroup('stopped');
    }
  });

  it('F-0601 AC-13 (c163-removed): a container removed after the pick gives the no-longer-exists dialog in the new window, with its name', async () => {
    await started('c163-removed', 'removed');
    await setUserSetting(DOCKER_PATH, listingOnly('c163-removed', 'removed'));
    const before = windowNames();
    try {
      await pickedAfter('/c163-removed', () =>
        docker('rm', '-f', 'c163-removed'),
      );
      const {dialog, address} = await waitForDialogElsewhere('local', 120_000);
      await answerDialogAt(address, 'Close Remote');
      deepStrictEqual(
        [dialog.details, dialog.buttons],
        [
          'Cannot attach to the container with name/id /c163-removed, it no longer exists.',
          ['Close Remote', 'More Actions...', 'Choose Container'],
        ],
      );
    } finally {
      await closedSince(before);
      await removeGroup('removed');
    }
  });
});
