import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  reopenInContainer,
  reopenStarted,
  waitFor,
} from '../windows/harness.ts';
import {dialogOf, notifications} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  OPENING,
  containerOf,
  labelsOf,
  mark,
  signal,
  connectedState,
  stateOf,
  timeOf,
  untilLabels,
  waitForContainer,
  waitSignal,
} from './lifecycle-support.ts';

const execFileAsync = promisify(execFile);

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
      const connected = await connectedState(name);
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
      const connected = await connectedState(name);
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
      const connected = await connectedState(name);
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
