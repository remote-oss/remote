import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  containersLogSince,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reloadWindow,
  reopenInContainer,
  reopenStarted,
  startInWindow,
  variable,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  answerDialog,
  editorTabs,
  focusToasts,
  notificationCentre,
  notificationProgress,
  pressDelete,
  statusBarText,
  terminalText,
  toastDetails,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';
import {
  connectingOf,
  sampled,
  sampling,
  slowBuildFolder,
} from '../windows/sampling.ts';

const CONNECTING = 'Connecting to Dev Container (show log)';
const LOG_LINK = 'command:remote-containers.revealLogTerminal';

/** The strings F-0408 says never reach the user (BR-4, AC-12). */
const NEVER_SHOWN = [
  'Building image',
  'Configuring...',
  'Dev Containers waiting for connection request',
  'Setting up Dev Containers',
  'Creating Dev Container',
  'Starting container',
];

/** What window `name` showed on its surfaces and the log held while `connect` went on, and the log terminal's text after it. */
async function flowOf(name: string, connect: () => Promise<void>) {
  const logMark = containersLog().length;
  const sampler = sampled(async () => [
    await statusBarText(name, 'status.host'),
    await windowTitle(name),
    ...(await toastDetails(name)).map(toast => toast.message),
    ...(await editorTabs(name)).map(editor => editor.label),
  ]);
  await connect();
  const surfaces = (await sampler.stop()).flat();
  await startInWindow(name, 'remote-containers.revealLogTerminal');
  await new Promise(resolve => setTimeout(resolve, 2000));
  const terminal = await terminalText(name);
  const lines = containersLogSince(logMark);
  return {
    onSurfaces: surfaces.filter(text =>
      NEVER_SHOWN.some(shown => text.includes(shown)),
    ),
    inTerminal: NEVER_SHOWN.filter(
      shown => shown !== 'Starting container' && terminal.includes(shown),
    ),
    inLog: NEVER_SHOWN.filter(
      shown =>
        shown !== 'Starting container' &&
        lines.some(line => line.includes(shown)),
    ),
    stepInLog: lines.includes('Starting container'),
  };
}

/** The ids of the host's processes whose command line holds `needle`: the image build of a folder holds the folder's image tag. */
async function buildersOf(needle: string): Promise<number[]> {
  try {
    const {stdout} = await promisify(execFile)('pgrep', ['-f', needle]);
    return stdout
      .split('\n')
      .filter(line => line !== '')
      .map(Number)
      .filter(processId => processId !== process.pid);
  } catch {
    return [];
  }
}

/** Whether the process `processId` still runs. */
function isAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits, for up to `milliseconds`, until `read` gives something. */
async function eventually<Value>(
  what: string,
  read: () => Promise<Value | undefined>,
  milliseconds = 120_000,
): Promise<Value> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    try {
      const value = await read();
      if (value !== undefined) {
        return value;
      }
    } catch {
      // The window is reloading.
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

describe('F-0408 the connect progress (card containers-53)', function () {
  this.timeout(900_000);

  it('F-0408 AC-1, AC-2, AC-3, AC-5, AC-10, AC-11, AC-12 (p1): a first open with a slow build shows one S087 link toast with no buttons, a suffix only with a determinate bar, nothing for the build, a gap with no toast, and ends clean', async () => {
    const folder = slowBuildFolder('c53-first', 'Progress One');
    const name = await openFolderWindow(folder);
    try {
      const sampler = sampling(name);
      await reopenInContainer(name);
      const samples = await sampler.stop();
      const connecting = connectingOf(samples);
      const first = connecting[0];
      const lastToastAt = Math.max(
        ...samples
          .filter(sample =>
            sample.toasts.some(toast => toast.message.startsWith('Connecting')),
          )
          .map(sample => sample.takenAt),
      );
      const quiet = samples.filter(
        sample =>
          sample.takenAt > lastToastAt &&
          sample.indicator === 'Opening Remote...' &&
          sample.toasts.length === 0,
      );
      const staged = connecting.filter(toast => toast.message.includes(': '));
      const thisFeature = samples.flatMap(sample =>
        sample.toasts.filter(
          toast => !toast.message.startsWith('Folder contains'),
        ),
      );
      const everything = samples.flatMap(sample => [
        sample.indicator,
        ...sample.toasts.map(toast => toast.message),
      ]);
      const centre = await notificationCentre(name);
      deepStrictEqual(
        {
          first: first && {
            links: first.links,
            buttons: first.buttons,
            toolbar: first.toolbar,
            progress: first.progress,
          },
          texts: [...new Set(connecting.map(toast => toast.message))].filter(
            text =>
              ![
                CONNECTING,
                `${CONNECTING}: Installing server`,
                `${CONNECTING}: Starting server`,
              ].includes(text),
          ),
          doubled: samples.some(
            sample =>
              sample.toasts.filter(toast =>
                toast.message.startsWith('Connecting'),
              ).length > 1,
          ),
          stagedBars: [...new Set(staged.map(toast => toast.progress))],
          plainDuringBuild:
            connecting.filter(toast => toast.message === CONNECTING).length >=
            10,
          otherToasts: thisFeature.filter(
            toast => !toast.message.startsWith('Connecting'),
          ),
          neverShown: everything.filter(text =>
            NEVER_SHOWN.some(shown => text.includes(shown)),
          ),
          configuringToast: thisFeature.some(toast =>
            toast.message.includes('Configuring Dev Container'),
          ),
          quietGap: quiet.length >= 1,
          indicator: await statusBarText(name, 'status.host'),
          title: await windowTitle(name),
          containers: (await devContainersOf(folder)).length,
          centreOfThisFeature: centre.filter(text =>
            /^(Connecting|Reading|Configuring) /.test(text),
          ),
        },
        {
          first: {
            links: [{text: CONNECTING, href: LOG_LINK}],
            buttons: [],
            toolbar: ['More Actions...', 'Expand Notification'],
            progress: 'infinite',
          },
          texts: [],
          doubled: false,
          stagedBars: ['discrete'],
          plainDuringBuild: true,
          otherToasts: [],
          neverShown: [],
          configuringToast: false,
          quietGap: true,
          indicator: 'Dev Container: Progress One',
          title: '[c53-first [Dev Container: Progress One]]',
          containers: 1,
          centreOfThisFeature: [],
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0408 AC-12 (p12): in a first open, a rebuild and the reopening of a stopped container, none of the strings that never show is in a notification, the indicator, the title, an editor tab, the log terminal or the log, and Starting container is a step of the log alone', async () => {
    const folder = slowBuildFolder('c58-surfaces', 'Surfaces');
    try {
      const first = await openFolderWindow(folder);
      const opened = await flowOf(first, () => reopenInContainer(first));
      const rebuilt = await flowOf(first, () =>
        reopenInContainer(first, 300_000, 'remote-containers.rebuildContainer'),
      );
      const [containerId = ''] = await devContainersOf(folder);
      await closeWindow(first);
      await promisify(execFile)('docker', ['stop', containerId]);
      const second = await openFolderWindow(folder);
      const restarted = await flowOf(second, () => reopenInContainer(second));
      await closeWindow(second);
      const clean = {
        onSurfaces: [],
        inTerminal: [],
        inLog: [],
        stepInLog: true,
      };
      deepStrictEqual(
        {opened, rebuilt, restarted},
        {
          opened: clean,
          rebuilt: clean,
          restarted: clean,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0408 AC-18 (p18): Delete on the focused S087 leaves it in place, in the toasts and in the centre, and its toolbar never offers Clear Notification (Del)', async () => {
    const folder = slowBuildFolder('c53-del', 'Progress Delete', 'sleep 12');
    const name = await openFolderWindow(folder);
    try {
      const connecting = reopenInContainer(name);
      await eventually('the S087 toast', async () =>
        (await notificationProgress(name, CONNECTING)) === undefined
          ? undefined
          : true,
      );
      const focused = await focusToasts(name);
      await pressDelete(name);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const toasts = (await toastDetails(name)).filter(toast =>
        toast.message.startsWith('Connecting'),
      );
      const centre = await notificationCentre(name);
      await connecting;
      deepStrictEqual(
        {
          focused,
          toasts: toasts.length,
          clear: toasts
            .flatMap(toast => toast.toolbar)
            .filter(label => label.startsWith('Clear')),
          centre,
        },
        {focused: true, toasts: 1, clear: [], centre: [CONNECTING]},
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0408 AC-19 (p19): a build that fails shows the dialog with S087 already gone, and nothing of the connect is left in the centre', async () => {
    const folder = slowBuildFolder('c53-fail', 'Progress Fail', 'exit 7');
    const name = await openFolderWindow(folder);
    try {
      const sampler = sampling(name);
      await startInWindow(name, 'remote-containers.reopenInContainer');
      const dialog = await waitForDialog(name, 300_000);
      const samples = await sampler.stop();
      const atDialog = await toastDetails(name);
      const centre = await notificationCentre(name);
      await answerDialog(name, 'Cancel').catch(() => undefined);
      deepStrictEqual(
        {
          shownBefore: connectingOf(samples).length > 0,
          dialog: dialog.details,
          connectingAtDialog: atDialog.filter(toast =>
            toast.message.startsWith('Connecting'),
          ),
          centre: centre.filter(text => text.startsWith('Connecting')),
        },
        {
          shownBefore: true,
          dialog: 'An error occurred setting up the container.',
          connectingAtDialog: [],
          centre: [],
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0408 AC-20 (p20): reloading the window during the build starts the whole sequence again, with S087, ending in one container and no dialog', async () => {
    const folder = slowBuildFolder('c53-reload', 'Progress Reload', 'sleep 15');
    const name = await openFolderWindow(folder);
    try {
      const started = reopenStarted(name);
      await started;
      await eventually('the first S087', async () =>
        (await notificationProgress(name, CONNECTING)) === undefined
          ? undefined
          : true,
      );
      const building = await eventually('the build to start', async () => {
        const found = await buildersOf('vsc-c53-reload');
        return found.length > 0 ? found : undefined;
      });
      await reloadWindow(name);
      const again = await eventually('S087 again', async () =>
        (await notificationProgress(name, CONNECTING)) === undefined
          ? undefined
          : true,
      );
      const rebuilding = await eventually(
        'the build to start again',
        async () => {
          const found = (await buildersOf('vsc-c53-reload')).filter(
            processId => !building.includes(processId),
          );
          return found.length > 0 ? found : undefined;
        },
      );
      await eventually(
        'the first build to stop',
        () =>
          Promise.resolve(
            building.every(processId => !isAlive(processId)) ? true : undefined,
          ),
        20_000,
      );
      const stopped = building.filter(processId => isAlive(processId));
      await connectedToContainer(name, 400_000);
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        {
          started: building.length > 0,
          stopped,
          restarted: rebuilding.length > 0,
          again,
          containers: (await devContainersOf(folder)).length,
          indicator: await statusBarText(name, 'status.host'),
        },
        {
          started: true,
          stopped: [],
          restarted: true,
          again: true,
          containers: 1,
          indicator: 'Dev Container: Progress Reload',
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0408 AC-23 (p23): with a docker that does not exist none of the feature’s strings show before the pre-flight dialog', async () => {
    const bogus = path.join(variable('HARNESS_RUN_FOLDER'), 'no-such-docker');
    const folder = devContainerFolder('c53-pre', {name: 'Progress Pre'});
    await setUserSetting('dev.containers.dockerPath', bogus);
    try {
      const name = await openFolderWindow(folder);
      const sampler = sampling(name);
      const running = inWindow(name, 'remote-containers.reopenInContainer');
      const dialog = await waitForDialog(name);
      const samples = await sampler.stop();
      await answerDialog(name, 'Cancel');
      await running;
      deepStrictEqual(
        {
          dialog: dialog.message,
          strings: samples
            .flatMap(sample => sample.toasts.map(toast => toast.message))
            .filter(text =>
              /Connecting|Reading Dev Container|Configuring Dev Container/.test(
                text,
              ),
            ),
        },
        {
          dialog: 'Docker version 17.12.0 or later required.',
          strings: [],
        },
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
      await removeContainers(folder);
    }
  });
});
