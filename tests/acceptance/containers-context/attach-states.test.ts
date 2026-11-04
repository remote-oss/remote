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
  answerDialog,
  chooseQuickPickRow,
  pressEscape,
  rememberPage,
  waitForDialog,
} from '../windows/renderer.ts';

const DOCKER_PATH = 'dev.containers.dockerPath';

/** Picks the one row `label` after `change` has altered the container behind it, and gives the window that opens. */
async function pickedAfter(
  label: string,
  change: () => Promise<unknown>,
): Promise<string> {
  const before = windowNames();
  await openedPicker();
  await change();
  await chooseQuickPickRow('local', label);
  await waitFor(
    'a new window',
    () => Promise.resolve(windowNames().length > before.length),
    120_000,
  );
  return windowNames().find(name => !before.includes(name)) ?? '';
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
    let opened = '';
    try {
      opened = await pickedAfter('/c163-stopped', () =>
        docker('stop', '-t', '0', 'c163-stopped'),
      );
      const image = await docker(
        'inspect',
        '--format',
        '{{.Config.Image}}',
        'c163-stopped',
      );
      const shown = await waitForDialog(opened, 120_000);
      const windowsBefore = windowNames().length;
      await answerDialog(opened, 'Start Container');
      await waitFor(
        'the window to attach after Start Container',
        async () =>
          (await windowState(opened)).remoteName === 'attached-container',
        240_000,
      );
      deepStrictEqual(
        [
          shown.details,
          shown.buttons,
          windowNames().length,
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
          windowsBefore,
          'true',
        ],
      );
    } finally {
      await closeWindow(opened).catch(() => undefined);
      await removeGroup('stopped');
    }
  });

  it('F-0601 AC-13 (c163-removed): a container removed after the pick gives the no-longer-exists dialog in the new window, with its name', async () => {
    await started('c163-removed', 'removed');
    await setUserSetting(DOCKER_PATH, listingOnly('c163-removed', 'removed'));
    let opened = '';
    try {
      opened = await pickedAfter('/c163-removed', () =>
        docker('rm', '-f', 'c163-removed'),
      );
      const shown = await waitForDialog(opened, 120_000);
      deepStrictEqual(
        [shown.details, shown.buttons],
        [
          'Cannot attach to the container with name/id /c163-removed, it no longer exists.',
          ['Close Remote', 'More Actions...', 'Choose Container'],
        ],
      );
      await answerDialog(opened, 'Close Remote');
    } finally {
      await closeWindow(opened).catch(() => undefined);
      await removeGroup('removed');
    }
  });
});
