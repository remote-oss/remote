import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  reopenStarted,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  notifications,
  pageText,
  statusItem,
} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** The status bar text F-0408 shows while background commands run. */
const CONFIGURING = 'Configuring Dev Container (show log)';

/** The remote indicator while the connect is not done. */
const OPENING = 'Opening Remote...';

/** The file the commands of a row append to, in the workspace folder where each command starts. */
const ORDER_FILE = '.c44-order';

/** A command that appends `label` and the time in seconds to the order file. */
function mark(label: string): string {
  return `echo "${label} $(date +%s)" >> ${ORDER_FILE}`;
}

/** A command that waits until the signal file `signalName` exists in the workspace folder. */
function waitSignal(signalName: string): string {
  return `while [ ! -e .c44-${signalName} ]; do sleep 0.2; done`;
}

/** The container workspace folder of `folder`'s container. */
function workspaceOf(folder: string): string {
  return `/workspaces/${path.basename(folder)}`;
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

/** Runs `command` in `folder`'s workspace folder in container `containerId` and gives its standard output. */
async function inWorkspace(
  containerId: string,
  folder: string,
  command: string,
): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    '--workdir',
    workspaceOf(folder),
    containerId,
    'sh',
    '-c',
    command,
  ]);
  return stdout;
}

/** The labels of the order file's lines, in file order; a file not written yet is empty. */
async function labelsOf(
  containerId: string,
  folder: string,
): Promise<string[]> {
  const text = await inWorkspace(
    containerId,
    folder,
    `cat ${ORDER_FILE} 2>/dev/null || true`,
  );
  return text
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.split(' ')[0] ?? '');
}

/** The time in seconds of the order file's line labelled `label`. */
async function timeOf(
  containerId: string,
  folder: string,
  label: string,
): Promise<number> {
  const text = await inWorkspace(containerId, folder, `cat ${ORDER_FILE}`);
  const line = text.split('\n').find(each => each.startsWith(`${label} `));
  if (line === undefined) {
    throw new Error(`no line ${label} in ${text}`);
  }
  return Number(line.split(' ')[1]);
}

/** Makes the signal file `signalName` in `folder`'s workspace folder, which the waiting command is looking for. */
async function signal(
  containerId: string,
  folder: string,
  signalName: string,
): Promise<void> {
  await inWorkspace(containerId, folder, `touch .c44-${signalName}`);
}

/** Waits until the order file holds at least the labels `wanted`. */
async function untilLabels(
  containerId: string,
  folder: string,
  wanted: readonly string[],
): Promise<void> {
  await waitFor(
    `the order file to hold ${wanted.join(', ')}`,
    async () => {
      const labels = await labelsOf(containerId, folder);
      return wanted.every(label => labels.includes(label));
    },
    120_000,
  );
}

/** The connect's state in window `name`: the remote indicator and whether the Configuring text shows. */
async function stateOf(
  name: string,
): Promise<{indicator: string; configuring: boolean}> {
  return {
    indicator: (await statusItem(name, 'status.host')).text,
    configuring: (await pageText(name)).includes(CONFIGURING),
  };
}

/**
 * Whether, among the samples that read Opening Remote..., the first ones show no Configuring text and the text shows
 * only in the last ones: it may appear a moment before the indicator flips (F-0415 AC-4).
 */
function configuringOnlyAtTheEnd(
  samples: ReadonlyArray<{indicator: string; configuring: boolean}>,
): boolean {
  const flags = samples
    .filter(sample => sample.indicator === OPENING)
    .map(sample => sample.configuring);
  const firstShown = flags.indexOf(true);
  return (
    flags[0] === false &&
    (firstShown === -1 || flags.slice(firstShown).every(Boolean))
  );
}

describe('F-0415 the order of the commands and waitFor (card containers-44)', function () {
  this.timeout(900_000);

  it('F-0415 AC-2 (o2): the five in-container commands run in their fixed order', async () => {
    const folder = devContainerFolder('c44-order', {
      name: 'Order',
      onCreateCommand: mark('onCreate'),
      updateContentCommand: mark('updateContent'),
      postCreateCommand: mark('postCreate'),
      postStartCommand: mark('postStart'),
      postAttachCommand: mark('postAttach'),
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await untilLabels(containerId, folder, ['postAttach']);
      const labels = await labelsOf(containerId, folder);
      await closeWindow(name);
      deepStrictEqual(labels, [
        'onCreate',
        'updateContent',
        'postCreate',
        'postStart',
        'postAttach',
      ]);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-3 (o3): the entries of an object command start together and each ends by its own duration', async () => {
    const folder = devContainerFolder('c44-object', {
      name: 'Object',
      updateContentCommand: {
        slow: `${mark('slow-start')}; sleep 4; ${mark('slow-end')}`,
        fast: `${mark('fast-start')}; ${mark('fast-end')}`,
      },
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      const times = {
        slowStart: await timeOf(containerId, folder, 'slow-start'),
        fastStart: await timeOf(containerId, folder, 'fast-start'),
        slowEnd: await timeOf(containerId, folder, 'slow-end'),
        fastEnd: await timeOf(containerId, folder, 'fast-end'),
      };
      await closeWindow(name);
      const together = Math.abs(times.slowStart - times.fastStart) < 2;
      deepStrictEqual(
        {
          together,
          fastEndsFirst: times.fastEnd < times.slowEnd,
          slowTakesItsTime: times.slowEnd - times.slowStart >= 3,
        },
        {together: true, fastEndsFirst: true, slowTakesItsTime: true},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-4 (o4): by default the window connects when updateContentCommand ends, while the later commands are still to run, and Configuring shows until they end', async () => {
    const folder = devContainerFolder('c44-default-wait', {
      name: 'Default Wait',
      onCreateCommand: mark('onCreate'),
      updateContentCommand: `sleep 8; ${mark('updateContent')}`,
      postCreateCommand: `${waitSignal('go')}; ${mark('postCreate')}`,
    });
    try {
      const name = await openFolderWindow(folder);
      const samples: Array<{indicator: string; configuring: boolean}> = [];
      const sampling = {done: false};
      const sampler = (async () => {
        while (!sampling.done) {
          try {
            samples.push(await stateOf(name));
          } catch {
            // The window is reloading; skip the sample.
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      })();
      await reopenInContainer(name);
      sampling.done = true;
      await sampler;
      const containerId = await containerOf(folder);
      const connected = await stateOf(name);
      const labelsBefore = await labelsOf(containerId, folder);
      const toasts = (await notifications(name)).filter(text =>
        text.startsWith('Connecting'),
      );
      await signal(containerId, folder, 'go');
      await untilLabels(containerId, folder, ['postCreate']);
      await waitFor(
        'the Configuring text to go',
        async () => !(await stateOf(name)).configuring,
        60_000,
      );
      await closeWindow(name);
      deepStrictEqual(
        {
          configuringOnlyAtTheEnd: configuringOnlyAtTheEnd(samples),
          sawOpening: samples.some(sample => sample.indicator === OPENING),
          connected,
          labelsBefore,
          toasts,
        },
        {
          configuringOnlyAtTheEnd: true,
          sawOpening: true,
          connected: {
            indicator: 'Dev Container: Default Wait',
            configuring: true,
          },
          labelsBefore: ['onCreate', 'updateContent'],
          toasts: [],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-5 (o5): waitFor onCreateCommand connects before a slow updateContentCommand ends, and the rest continues in the background', async () => {
    const folder = devContainerFolder('c44-wait-create', {
      name: 'Wait Create',
      waitFor: 'onCreateCommand',
      onCreateCommand: mark('onCreate'),
      updateContentCommand: `${waitSignal('go')}; ${mark('updateContent')}`,
      postCreateCommand: mark('postCreate'),
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      const connected = await stateOf(name);
      const labelsBefore = await labelsOf(containerId, folder);
      await signal(containerId, folder, 'go');
      await untilLabels(containerId, folder, ['postCreate']);
      const labelsAfter = await labelsOf(containerId, folder);
      await closeWindow(name);
      deepStrictEqual(
        {connected, labelsBefore, labelsAfter},
        {
          connected: {
            indicator: 'Dev Container: Wait Create',
            configuring: true,
          },
          labelsBefore: ['onCreate'],
          labelsAfter: ['onCreate', 'updateContent', 'postCreate'],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-15 (o15): waitFor initializeCommand connects right after the host step, and Configuring stays until updateContentCommand ends', async () => {
    const folder = devContainerFolder('c44-wait-init', {
      name: 'Wait Init',
      waitFor: 'initializeCommand',
      onCreateCommand: mark('onCreate'),
      updateContentCommand: `${waitSignal('go')}; ${mark('updateContent')}`,
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      const connected = await stateOf(name);
      const labelsBefore = await labelsOf(containerId, folder);
      await signal(containerId, folder, 'go');
      await untilLabels(containerId, folder, ['updateContent']);
      await waitFor(
        'the Configuring text to go',
        async () => !(await stateOf(name)).configuring,
        60_000,
      );
      await closeWindow(name);
      deepStrictEqual(
        {connected, labelsBefore},
        {
          connected: {indicator: 'Dev Container: Wait Init', configuring: true},
          labelsBefore: ['onCreate'],
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-16 (o16): a waitFor outside the five values shows no Configuring phase, and the window stays on Opening Remote... until every command ends', async () => {
    const folder = devContainerFolder('c44-wait-bad', {
      name: 'Wait Bad',
      waitFor: 'postAttachCommand',
      postAttachCommand: `${waitSignal('go')}; ${mark('postAttach')}`,
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenStarted(name);
      const containerId = await waitForContainer(folder);
      await new Promise(resolve => setTimeout(resolve, 30_000));
      const waiting = await stateOf(name);
      await signal(containerId, folder, 'go');
      await connectedToContainer(name);
      const done = await stateOf(name);
      await closeWindow(name);
      deepStrictEqual(
        {waiting, done},
        {
          waiting: {indicator: OPENING, configuring: false},
          done: {indicator: 'Dev Container: Wait Bad', configuring: false},
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-20 (o20): a waitFor target that never ends hangs the connect with no error on any surface, and the container stays up', async () => {
    const folder = devContainerFolder('c44-never-ends', {
      name: 'Never Ends',
      updateContentCommand: 'sleep 100000',
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenStarted(name);
      const containerId = await waitForContainer(folder);
      await new Promise(resolve => setTimeout(resolve, 60_000));
      const waiting = await stateOf(name);
      const dialog = await dialogOf(name);
      const toasts = (await notifications(name)).filter(
        text => !text.startsWith('Connecting to Dev Container'),
      );
      const running = (
        await execFileAsync('docker', [
          'inspect',
          '-f',
          '{{.State.Status}}',
          containerId,
        ])
      ).stdout.trim();
      await closeWindow(name);
      deepStrictEqual(
        {waiting, dialog, toasts, running},
        {
          waiting: {indicator: OPENING, configuring: false},
          dialog: undefined,
          toasts: [],
          running: 'running',
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });
});

/** Waits until `folder` has its container and gives its id. */
async function waitForContainer(folder: string): Promise<string> {
  await waitFor(
    `the container of ${folder}`,
    async () => (await devContainersOf(folder)).length === 1,
    180_000,
  );
  return containerOf(folder);
}
