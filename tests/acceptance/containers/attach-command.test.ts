import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  startInWindow,
  variable,
  waitFor,
  windowNames,
} from '../windows/harness.ts';
import {
  docker,
  listingOnly,
  pickedContainer,
  removeGroup,
  started,
} from '../windows/attach-support.ts';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  answerDialog,
  dialogOf,
  pressEscape,
  quickPickOf,
  quickPickRows,
  rememberPage,
  typeInQuickPick,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';

/** The command, and the setting that names the Docker program. */
const COMMAND = 'remote-containers.attachToRunningContainer';
const DOCKER_PATH = 'dev.containers.dockerPath';

/** The placeholder of the picker. */
const PLACEHOLDER = 'Select the container to attach VS Code';

describe('Attach to Running Container (card containers-162)', function () {
  this.timeout(600_000);

  before(() => rememberPage('local'));

  afterEach(async () => {
    await pressEscape('local').catch(() => undefined);
    await setUserSetting(DOCKER_PATH, undefined);
  });

  it('F-0601 AC-2, AC-3, AC-16, AC-39, F-0106 AC-9, AC-10, AC-13, AC-17, F-0906 AC-7 (c162-warning): the warning comes first with its three buttons; Cancel and Learn More end the command and keep nothing; Got It opens the picker, and later runs open it directly; Escape closes it with no window', async () => {
    await started('c162-warning', 'warning');
    await setUserSetting(DOCKER_PATH, listingOnly('c162-warn', 'warning'));
    try {
      await startInWindow('local', COMMAND);
      const first = await waitForDialog('local', 60_000);
      await answerDialog('local', 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const afterCancel = [await dialogOf('local'), await quickPickOf('local')];
      await startInWindow('local', COMMAND);
      const second = await waitForDialog('local', 60_000);
      await answerDialog('local', 'Learn More');
      const protection = await waitForDialog('local', 60_000);
      await answerDialog('local', 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const afterLearn = [await dialogOf('local'), await quickPickOf('local')];
      const windowsBefore = windowNames().length;
      await startInWindow('local', COMMAND);
      await waitForDialog('local', 60_000);
      await answerDialog('local', 'Got It');
      await waitForQuickPick('local', 60_000);
      const opened = await quickPickOf('local');
      await pressEscape('local');
      await new Promise(resolve => setTimeout(resolve, 1500));
      const afterEscape = [await quickPickOf('local'), await dialogOf('local')];
      await startInWindow('local', COMMAND);
      await waitForQuickPick('local', 60_000);
      const direct = [
        await dialogOf('local'),
        (await quickPickOf('local'))?.placeholder,
      ];
      await pressEscape('local');
      deepStrictEqual(
        {
          first: [first.message, first.details],
          buttons: first.buttons,
          second: second.message,
          afterCancel,
          protection: protection.message,
          afterLearn,
          opened: opened?.placeholder,
          afterEscape,
          direct,
          windows: windowNames().length === windowsBefore,
        },
        {
          first: [
            'Attaching to a container may execute arbitrary code.',
            'Only attach to a container if you trust its origin.',
          ],
          buttons: ['Learn More', 'Cancel', 'Got It'],
          second: 'Attaching to a container may execute arbitrary code.',
          afterCancel: [undefined, undefined],
          protection:
            'Do you want VSCodium - Insiders to open the external website?',
          afterLearn: [undefined, undefined],
          opened: PLACEHOLDER,
          afterEscape: [undefined, undefined],
          direct: [undefined, PLACEHOLDER],
          windows: true,
        },
      );
    } finally {
      await removeGroup('warning');
    }
  });

  it('F-0601 AC-1 (c162-empty): with no running container a modal says so with a single OK, and no picker was shown', async () => {
    await setUserSetting(DOCKER_PATH, listingOnly('c162-none', 'nothing'));
    await startInWindow('local', COMMAND);
    const shown = await waitForDialog('local', 60_000);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const picker = await quickPickOf('local');
    await answerDialog('local', 'OK');
    deepStrictEqual(
      [shown.message, shown.details, shown.buttons, picker],
      ['', 'There are no running containers to attach to.', ['OK'], undefined],
    );
  });

  it('F-0601 AC-4, AC-5, AC-23, AC-26, AC-49 (c162-picker): the picker lists the running containers by name in the collator’s order with image and id beside the name, leaves a paused one out, and filters on the name alone', async () => {
    const names = ['B1', 'a2', 'a10', 'a9', 'a_x', 'a-x', 'A3'];
    const fullIds = new Map<string, string>();
    for (const name of names) {
      fullIds.set(name, await started(name, 'picker'));
    }
    await started('c162-paused', 'picker');
    await docker('pause', 'c162-paused');
    await setUserSetting(DOCKER_PATH, listingOnly('c162-picker', 'picker'));
    try {
      await startInWindow('local', COMMAND);
      await waitForQuickPick('local', 60_000);
      await waitFor(
        'the picker to fill',
        async () => (await quickPickRows('local')).length === names.length,
        30_000,
      );
      const rows = await quickPickRows('local');
      const image = variable('HARNESS_DEVCONTAINER_IMAGE');
      await typeInQuickPick('local', image);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const byImage = await quickPickRows('local');
      await typeInQuickPick('local', (fullIds.get('a9') ?? '').slice(0, 12));
      await new Promise(resolve => setTimeout(resolve, 1500));
      const byId = await quickPickRows('local');
      await typeInQuickPick('local', 'a10');
      await new Promise(resolve => setTimeout(resolve, 1500));
      const byName = await quickPickRows('local');
      deepStrictEqual(
        {
          labels: rows.map(entry => entry.label),
          descriptions: rows.map(entry => entry.description),
          focused: rows.map(entry => entry.focused),
          byImage: byImage.length,
          byId: byId.length,
          byName: byName.map(entry => entry.label),
        },
        {
          labels: ['/a_x', '/a-x', '/a10', '/a2', '/A3', '/a9', '/B1'],
          descriptions: ['a_x', 'a-x', 'a10', 'a2', 'A3', 'a9', 'B1'].map(
            name => `${image} ${fullIds.get(name) ?? ''}`,
          ),
          focused: [true, false, false, false, false, false, false],
          byImage: 0,
          byId: 0,
          byName: ['/a10'],
        },
      );
    } finally {
      await pressEscape('local').catch(() => undefined);
      await removeGroup('picker');
    }
  });

  it('F-0106 AC-25 (c162-pick): a pick opens another window with no further question, and the window that ran the command stays as it is', async () => {
    await started('c162-pick', 'pick');
    await setUserSetting(DOCKER_PATH, listingOnly('c162-pick', 'pick'));
    const before = windowNames();
    try {
      await pickedContainer('/c162-pick');
      await waitFor(
        'a new window',
        () => Promise.resolve(windowNames().length > before.length),
        120_000,
      );
      const added = windowNames().filter(name => !before.includes(name));
      deepStrictEqual(
        [
          windowNames().includes('local'),
          added.length,
          await dialogOf('local'),
        ],
        [true, 1, undefined],
      );
      for (const name of added) {
        await closeWindow(name).catch(() => undefined);
      }
    } finally {
      await removeGroup('pick');
    }
  });

  it('F-0601 AC-42 (c162-missing): a Docker program that does not exist gives the version dialog with the program in its detail, and no picker', async () => {
    await setUserSetting(DOCKER_PATH, '/nonexistent/docker');
    await startInWindow('local', COMMAND);
    const first = await waitForDialog('local', 60_000);
    if (
      first.message === 'Attaching to a container may execute arbitrary code.'
    ) {
      await answerDialog('local', 'Got It');
    }
    const shown = first.message.startsWith('Docker')
      ? first
      : await waitForDialog('local', 60_000);
    const picker = await quickPickOf('local');
    await answerDialog('local', 'Cancel');
    deepStrictEqual(
      [shown.message, shown.details, picker],
      [
        'Docker version 17.12.0 or later required.',
        "Command not found: '/nonexistent/docker'. Check the license for details.",
        undefined,
      ],
    );
  });
});
