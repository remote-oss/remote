/**
 * @fileoverview Clean Up Dev Containers and Clean Up Dev Volumes (card containers-168): the pickers, the dialogs and what
 * is removed. The docker program of the window is a wrapper that lists only the objects the run made, so a daemon with
 * other containers and volumes shows the rows nothing but this run's.
 */

import {deepStrictEqual} from 'node:assert';
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {
  runLabelArguments,
  runScopedName,
  startInWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
  titleActions,
  allQuickPickRows,
  paletteRun,
  pressQuickPickTitleButton,
  pressEscape,
  pressQuickPickOk,
  quickPickChecks,
  quickPickChrome,
  quickPickFacts,
  quickPickOf,
  rememberPage,
  toggleQuickPickRow,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {clearEarlierRows, setUserSetting} from '../windows/folder-windows.ts';
import {
  docker,
  dockerWrapper,
  made,
  stateOf,
  viewed,
  VIEW,
} from '../windows/dev-containers-view.ts';

const LOCAL = 'local';
const CLEAN_CONTAINERS = 'remote-containers.cleanUpDevContainers';
const CLEAN_VOLUMES = 'remote-containers.pruneVolumes';

/** The texts of the pickers and dialogs. */
const CONTAINERS_PLACEHOLDER = 'Select stopped dev containers to delete';
const VOLUMES_PLACEHOLDER = 'Select unused dev volumes to delete';
const NOTHING_LEFT =
  'There are no stopped dev containers or unused dev volumes to delete.';
const NO_VOLUMES = 'There are no unused dev volumes to delete.';

/** The docker program that lists only the containers and the volumes of this run. */
function runOnlyDocker(): string {
  const mark = `remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`;
  return dockerWrapper(
    'clean-up-docker',
    `case "$1" in
  ps) shift; exec docker ps --filter "label=${mark}" "$@" ;;
  volume) if [ "$2" = ls ]; then shift 2; exec docker volume ls --filter "label=${mark}" "$@"; fi ;;
esac`,
  );
}

/** A stopped container of the run that the view lists by the folder name `base`; its name. */
async function stopped(base: string): Promise<string> {
  const container = await made(base, ['true']);
  await waitFor(
    `${container} to exit`,
    async () => (await stateOf(container)) === 'exited',
    30_000,
  );
  return container;
}

/** A volume of the run named `base`, with `labels`; its name. */
async function volumeOf(
  base: string,
  labels: Readonly<Record<string, string>> = {'dev.container.volume': 'true'},
  name = runScopedName(base),
): Promise<string> {
  await docker(
    'volume',
    'create',
    ...runLabelArguments(),
    ...Object.entries(labels).flatMap(([key, value]) => [
      '--label',
      `${key}=${value}`,
    ]),
    name,
  );
  return name;
}

/** Whether the volume `name` exists. */
async function volumeExists(name: string): Promise<boolean> {
  try {
    await docker('volume', 'inspect', name);
    return true;
  } catch {
    return false;
  }
}

/** The command's title as the Command Palette lists it. */
const PALETTE_TITLES: Readonly<Record<string, string>> = {
  [CLEAN_CONTAINERS]: 'Dev Containers: Clean Up Dev Containers...',
  [CLEAN_VOLUMES]: 'Dev Containers: Clean Up Dev Volumes...',
};

/** Starts `command` in the local window: by its id, or, when core's own error dialog is wanted, from the Command Palette. */
async function start(command: string, viaPalette: boolean): Promise<void> {
  if (viaPalette) {
    await paletteRun(LOCAL, PALETTE_TITLES[command] ?? command);
  } else {
    await startInWindow(LOCAL, command);
  }
}

/** Starts `command` in the local window and waits for its picker; what the picker shows. */
async function picker(
  command: string,
  viaPalette = false,
): Promise<{
  placeholder: string;
  rows: Array<{label: string; checked: boolean}>;
}> {
  await start(command, viaPalette);
  await waitFor(
    'the picker of the command',
    async () =>
      [CONTAINERS_PLACEHOLDER, VOLUMES_PLACEHOLDER].includes(
        (await quickPickFacts(LOCAL))?.placeholder ?? '',
      ),
    60_000,
  );
  await waitForQuickPick(LOCAL, 60_000);
  return {
    placeholder: (await quickPickFacts(LOCAL))?.placeholder ?? '',
    rows: await quickPickChecks(LOCAL),
  };
}

/** Closes what a row left open: a picker, a dialog. */
async function closeOpen(): Promise<void> {
  for (let presses = 0; presses < 3; presses += 1) {
    if ((await quickPickOf(LOCAL)) === undefined) {
      break;
    }
    await pressEscape(LOCAL);
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  if ((await dialogOf(LOCAL)) !== undefined) {
    await answerDialog(LOCAL, 'OK').catch(() => undefined);
  }
}

/** The containers of the run that were made by the rows of this file. */
async function removeMade(volumes: readonly string[]): Promise<void> {
  await clearEarlierRows();
  for (const name of volumes) {
    await docker('volume', 'rm', '-f', name).catch(() => undefined);
  }
}

/** The settings file and the values the extensions keep in the global state, as they are now. */
function storedNow(): string {
  const userData = variable('HARNESS_USER_DATA');
  const settings = path.join(userData, 'User', 'settings.json');
  const database = path.join(userData, 'User', 'globalStorage', 'state.vscdb');
  const opened = existsSync(database)
    ? new DatabaseSync(database, {readOnly: true})
    : undefined;
  try {
    return JSON.stringify([
      existsSync(settings) ? readFileSync(settings, 'utf8') : '',
      opened
        ?.prepare(
          "SELECT key, value FROM ItemTable WHERE key LIKE '%remote-containers%' ORDER BY key",
        )
        .all(),
    ]);
  } finally {
    opened?.close();
  }
}

describe('Clean Up Dev Containers and Dev Volumes (card containers-168)', function () {
  this.timeout(600_000);
  const volumes: string[] = [];

  before(async () => {
    await rememberPage(LOCAL);
    mkdirSync(path.join(variable('HARNESS_RUN_FOLDER')), {recursive: true});
    await setUserSetting('dev.containers.dockerPath', runOnlyDocker());
  });

  after(async () => {
    await setUserSetting('dev.containers.dockerPath', undefined);
    await removeMade(volumes);
  });

  afterEach(async () => {
    await closeOpen();
    await removeMade(volumes.splice(0));
  });

  it('F-0905 AC-1, AC-2, AC-9, AC-15, AC-33 (containers-picker): the containers picker has the placeholder, one unchecked row per stopped dev container, a single OK, no Back button, and Escape closes it with nothing removed and no dialog', async () => {
    const first = await stopped('c168-b-folder');
    const second = await stopped('c168-a-folder');
    const created = await made('c168-created', ['true'], {started: false});
    const running = await made('c168-running', ['sleep', '600']);
    const attachOnly = runScopedName('c168-attach');
    await docker(
      'run',
      '-d',
      '--name',
      attachOnly,
      ...runLabelArguments(),
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'true',
    );
    const shown = await picker(CLEAN_CONTAINERS);
    const chrome = await quickPickChrome(LOCAL);
    const icons = (await allQuickPickRows(LOCAL)).flatMap(entry => entry.icons);
    const backPressed = await pressQuickPickTitleButton(LOCAL, 'Back').then(
      () => true,
      () => false,
    );
    await pressEscape(LOCAL);
    await new Promise(resolve => setTimeout(resolve, 1_500));
    deepStrictEqual(
      [
        shown.placeholder,
        shown.rows,
        chrome.okShown,
        icons,
        backPressed,
        await quickPickOf(LOCAL),
        await dialogOf(LOCAL),
        await Promise.all(
          [first, second, created, running, attachOnly].map(stateOf),
        ),
      ],
      [
        CONTAINERS_PLACEHOLDER,
        [
          {label: 'c168-a-folder', checked: false},
          {label: 'c168-b-folder', checked: false},
        ],
        true,
        [],
        false,
        undefined,
        undefined,
        ['exited', 'exited', 'created', 'running', 'exited'],
      ],
    );
  });

  it('F-0905 AC-3, AC-5, AC-18 (containers-ok): OK removes exactly the checked containers and, with no unused volume, the dialog says there is nothing left', async () => {
    const keep = await stopped('c168-keep');
    const drop = await stopped('c168-drop');
    await picker(CLEAN_CONTAINERS);
    await toggleQuickPickRow(LOCAL, 'c168-drop');
    await pressQuickPickOk(LOCAL);
    const dialog = await waitForDialog(LOCAL, 60_000);
    await answerDialog(LOCAL, 'OK');
    deepStrictEqual(
      [
        dialog.details,
        dialog.buttons,
        await stateOf(keep),
        await stateOf(drop),
      ],
      [NOTHING_LEFT, ['OK'], 'exited', 'gone'],
    );
  });

  it('F-0905 AC-20 (chained): with an unused volume found after OK, the volumes picker follows under the same command, whether or not a container was checked, and accepting it removes the checked volume with no dialog', async () => {
    const keep = await stopped('c168-chain');
    const volume = await volumeOf('c168-chain-volume');
    volumes.push(volume);
    await picker(CLEAN_CONTAINERS);
    await pressQuickPickOk(LOCAL);
    await waitFor(
      'the volumes picker',
      async () =>
        (await quickPickFacts(LOCAL))?.placeholder === VOLUMES_PLACEHOLDER,
      60_000,
    );
    const rows = await quickPickChecks(LOCAL);
    await toggleQuickPickRow(LOCAL, volume);
    await pressQuickPickOk(LOCAL);
    await waitFor(
      'the volume to go',
      async () => !(await volumeExists(volume)),
      30_000,
    );
    await new Promise(resolve => setTimeout(resolve, 2_000));
    deepStrictEqual(
      [
        rows,
        await dialogOf(LOCAL),
        await quickPickOf(LOCAL),
        await stateOf(keep),
      ],
      [[{label: volume, checked: false}], undefined, undefined, 'exited'],
    );
  });

  it('F-0905 AC-6, AC-25 (volumes-first): with no stopped container the volumes picker comes first, and Escape on it still shows the dialog with the volume untouched', async () => {
    const volume = await volumeOf('c168-first-volume');
    volumes.push(volume);
    const shown = await picker(CLEAN_CONTAINERS);
    await pressEscape(LOCAL);
    const dialog = await waitForDialog(LOCAL, 30_000);
    await answerDialog(LOCAL, 'OK');
    deepStrictEqual(
      [shown.placeholder, dialog.details, await volumeExists(volume)],
      [VOLUMES_PLACEHOLDER, NOTHING_LEFT, true],
    );
  });

  it('F-0905 AC-7, AC-8, AC-33 (nothing-to-offer): with nothing to offer, also with only a created container left, the dialogs say so at once, with no picker', async () => {
    await made('c168-created-only', ['true'], {started: false});
    await startInWindow(LOCAL, CLEAN_CONTAINERS);
    const first = await waitForDialog(LOCAL, 30_000);
    await answerDialog(LOCAL, 'OK');
    await startInWindow(LOCAL, CLEAN_VOLUMES);
    const second = await waitForDialog(LOCAL, 30_000);
    await answerDialog(LOCAL, 'OK');
    deepStrictEqual(
      [first.details, first.buttons, second.details, second.buttons],
      [NOTHING_LEFT, ['OK'], NO_VOLUMES, ['OK']],
    );
  });

  it('F-0905 AC-2, AC-4, AC-5, AC-22, AC-30, AC-31, AC-32 (volumes-picker): the volumes picker lists each unused volume once, GitHub ones by owner/repository with their branch or pull request, in order of what is shown, and OK removes the checked one with no dialog', async () => {
    const alpha = await volumeOf('c168-alpha', {
      'vsch.local.repository': 'https://github.com/Zed/Alpha',
      'vsch.local.repository.unique': 'true',
      'vsch.local.repository.branch': 'main',
      'dev.container.volume': 'true',
    });
    const request = await volumeOf('c168-request', {
      'vsch.local.repository': 'https://github.com/bob/pr-repo/pull/8',
      'vsch.local.repository.unique': 'true',
      'vsch.local.repository.branch': 'feat',
      'vsch.local.repository.pullRequestId': '9',
    });
    const plain = await volumeOf('c168-plain', {
      'vsch.local.repository': 'https://github.com/o/r',
    });
    const last = await volumeOf(
      'c168-last',
      {
        'vsch.local.repository': 'https://github.com/zz/last',
        'vsch.local.repository.unique': 'true',
      },
      randomBytes(32).toString('hex'),
    );
    volumes.push(alpha, request, plain, last);
    const shown = await picker(CLEAN_VOLUMES);
    await toggleQuickPickRow(LOCAL, 'Zed/Alpha');
    await pressQuickPickOk(LOCAL);
    await waitFor(
      'the volume to go',
      async () => !(await volumeExists(alpha)),
      30_000,
    );
    await new Promise(resolve => setTimeout(resolve, 1_500));
    deepStrictEqual(
      [
        shown.placeholder,
        shown.rows.map(entry => entry.label),
        await dialogOf(LOCAL),
        await volumeExists(request),
        await volumeExists(plain),
      ],
      [
        VOLUMES_PLACEHOLDER,
        ['bob/pr-repo, #9', plain, 'Zed/Alpha, main', 'zz/last'],
        undefined,
        true,
        true,
      ],
    );
  });

  it('F-0905 AC-10, AC-33 (volume-in-use): a volume that a container mounts, in any state, is never offered, and is once the container is gone', async () => {
    const mounted = await volumeOf('c168-mounted');
    const free = await volumeOf('c168-free');
    volumes.push(mounted, free);
    const holder = runScopedName('c168-holder');
    await docker(
      'create',
      '--name',
      holder,
      ...runLabelArguments(),
      '--mount',
      `type=volume,source=${mounted},target=/mounted`,
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'true',
    );
    const withHolder = await picker(CLEAN_VOLUMES);
    await pressEscape(LOCAL);
    await docker('rm', '-f', holder);
    const without = await picker(CLEAN_VOLUMES);
    await pressEscape(LOCAL);
    deepStrictEqual(
      [
        withHolder.rows.map(entry => entry.label),
        without.rows.map(entry => entry.label),
      ],
      [[free], [free, mounted].sort()],
    );
  });

  it('F-0905 AC-16, AC-17, AC-18, AC-26, AC-27 (container-rows): the rows show the last segment of a folder, also a Windows one, the image of a volume label, one row for each label of a container, in order of what is shown, and a compose sibling is never offered', async () => {
    const image = variable('HARNESS_DEVCONTAINER_IMAGE');
    /** A stopped container of the run with `labels`; its name. */
    async function labelled(
      base: string,
      labels: Readonly<Record<string, string>>,
    ): Promise<string> {
      const name = runScopedName(base);
      await docker(
        'run',
        '-d',
        '--name',
        name,
        ...runLabelArguments(),
        ...Object.entries(labels).flatMap(([key, value]) => [
          '--label',
          `${key}=${value}`,
        ]),
        image,
        'true',
      );
      await waitFor(
        `${name} to exit`,
        async () => (await stateOf(name)) === 'exited',
        30_000,
      );
      return name;
    }
    const windows = await labelled('c168-windows', {
      'devcontainer.local_folder': 'c:\\Users\\me\\src\\win-dd-basic',
    });
    const recovery = await labelled('c168-recovery', {
      'vsc.devcontainer.volume.name': 'a-volume',
    });
    const both = await labelled('c168-both', {
      'devcontainer.local_folder': '/h/two-labels-folder',
      'vsch.local.folder': '/h/two-labels-legacy',
    });
    const primary = await labelled('c168-primary', {
      'devcontainer.local_folder': '/h/compose-primary',
      'com.docker.compose.project': 'c168',
      'com.docker.compose.service': 'app',
    });
    const sibling = await labelled('c168-sibling', {
      'com.docker.compose.project': 'c168',
      'com.docker.compose.service': 'db',
    });
    for (const base of [
      'c168-order_x',
      'c168-order-x',
      'c168-order.x',
      'c168-orderax',
      'c168-OrderB',
    ]) {
      await made(base, ['true']);
    }
    const shown = await picker(CLEAN_CONTAINERS);
    const labels = shown.rows.map(entry => entry.label);
    await toggleQuickPickRow(LOCAL, 'compose-primary');
    await toggleQuickPickRow(LOCAL, 'two-labels-folder');
    await pressQuickPickOk(LOCAL);
    await waitFor(
      'the primary to go',
      async () => (await stateOf(primary)) === 'gone',
      30_000,
    );
    deepStrictEqual(
      [
        labels.filter(label => label.startsWith('c168-')),
        labels.filter(
          label =>
            label === 'win-dd-basic' ||
            label === image ||
            label.endsWith('-labels-folder') ||
            label.endsWith('-labels-legacy') ||
            label === 'compose-primary',
        ),
        await stateOf(both),
        await stateOf(sibling),
        await stateOf(recovery),
        await stateOf(windows),
      ],
      [
        [
          'c168-order_x',
          'c168-order-x',
          'c168-order.x',
          'c168-orderax',
          'c168-OrderB',
        ],
        [
          'compose-primary',
          image,
          'two-labels-folder',
          'two-labels-legacy',
          'win-dd-basic',
        ],
        'gone',
        'exited',
        'exited',
        'exited',
      ],
    );
  });

  it('F-0905 AC-12 (title-action): the title bar of the Dev Containers view has Clean Up Dev Containers when it lists a container and not when it lists none, and the command stays in the palette', async () => {
    const without = await titleActions(LOCAL, VIEW);
    await stopped('c168-title');
    await viewed('c168-title');
    const withOne = await titleActions(LOCAL, VIEW);
    deepStrictEqual(
      [
        without.includes('Clean Up Dev Containers...'),
        withOne.includes('Clean Up Dev Containers...'),
        withOne.indexOf('Clean Up Dev Containers...') <
          withOne.indexOf('Refresh'),
      ],
      [false, true, true],
    );
  });

  it('F-0905 AC-11, AC-21 (race): a checked container removed by something else before OK gives core’s error dialog with the failed command, the picker already closed, the other checked container removed, and no volumes picker after it', async () => {
    const gone = await stopped('c168-race-gone');
    const rest = await stopped('c168-race-rest');
    const volume = await volumeOf('c168-race-volume');
    volumes.push(volume);
    await picker(CLEAN_CONTAINERS, true);
    await toggleQuickPickRow(LOCAL, 'c168-race-gone');
    await toggleQuickPickRow(LOCAL, 'c168-race-rest');
    await docker('rm', '-f', gone);
    await pressQuickPickOk(LOCAL);
    const dialog = await waitForDialog(LOCAL, 60_000);
    const pickerOpen = (await quickPickOf(LOCAL)) !== undefined;
    await answerDialog(LOCAL, 'OK');
    await new Promise(resolve => setTimeout(resolve, 3_000));
    deepStrictEqual(
      [
        dialog.message,
        dialog.details.startsWith('Command failed: '),
        pickerOpen,
        await stateOf(rest),
        await quickPickOf(LOCAL),
        await dialogOf(LOCAL),
        await volumeExists(volume),
      ],
      [
        "Command 'Dev Containers: Clean Up Dev Containers...' resulted in an error",
        true,
        false,
        'gone',
        undefined,
        undefined,
        true,
      ],
    );
  });

  it('F-0905 AC-11 (race-volumes): a checked volume removed by something else before OK gives the same error dialog and still removes the other checked volume', async () => {
    const gone = await volumeOf('c168-vgone');
    const rest = await volumeOf('c168-vrest');
    volumes.push(gone, rest);
    await picker(CLEAN_VOLUMES, true);
    await toggleQuickPickRow(LOCAL, gone);
    await toggleQuickPickRow(LOCAL, rest);
    await docker('volume', 'rm', gone);
    await pressQuickPickOk(LOCAL);
    const dialog = await waitForDialog(LOCAL, 60_000);
    await answerDialog(LOCAL, 'OK');
    deepStrictEqual(
      [
        dialog.message,
        dialog.details.startsWith('Command failed: '),
        await volumeExists(rest),
      ],
      [
        "Command 'Dev Containers: Clean Up Dev Volumes...' resulted in an error",
        true,
        false,
      ],
    );
  });

  it('F-0905 AC-19 (docker-unreachable): with docker failing, or no program at the configured path, Clean Up Dev Containers ends in core’s error dialog and Clean Up Dev Volumes shows nothing at all', async () => {
    const shown: unknown[] = [];
    try {
      for (const program of [
        dockerWrapper('clean-up-failing', 'exit 1'),
        '/nonexistent/docker-c168',
      ]) {
        await setUserSetting('dev.containers.dockerPath', program);
        await start(CLEAN_CONTAINERS, true);
        const dialog = await waitForDialog(LOCAL, 60_000);
        await answerDialog(LOCAL, 'OK');
        await start(CLEAN_VOLUMES, true);
        await new Promise(resolve => setTimeout(resolve, 5_000));
        shown.push([
          dialog.message,
          await dialogOf(LOCAL),
          await quickPickOf(LOCAL),
          await notifications(LOCAL),
        ]);
      }
    } finally {
      await setUserSetting('dev.containers.dockerPath', runOnlyDocker());
    }
    const expected = [
      "Command 'Dev Containers: Clean Up Dev Containers...' resulted in an error",
      undefined,
      undefined,
      [],
    ];
    deepStrictEqual(shown, [expected, expected]);
  });

  it('F-0905 AC-23, AC-24 (leaves-nothing): a clean up shows no progress indicator at any moment and changes no setting and no value the extension keeps', async () => {
    const drop = await stopped('c168-quiet');
    const before = storedNow();
    await picker(CLEAN_CONTAINERS);
    await toggleQuickPickRow(LOCAL, 'c168-quiet');
    await pressQuickPickOk(LOCAL);
    const seen: string[][] = [];
    for (let step = 0; step < 10; step += 1) {
      seen.push(await notifications(LOCAL));
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    await waitForDialog(LOCAL, 60_000);
    await answerDialog(LOCAL, 'OK');
    deepStrictEqual(
      [seen.flat(), storedNow() === before, await stateOf(drop)],
      [[], true, 'gone'],
    );
  });
});
