import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  containersLog,
  containersLogSince,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {
  dialogOf,
  focusTerminal,
  notificationCentre,
  terminalSpans,
  terminalText,
} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  containerOf,
  inWorkspace,
  labelsOf,
  mark,
  untilLabels,
} from './lifecycle-support.ts';

const execFileAsync = promisify(execFile);

/** The text of `fileName` in `folder` on the host, or an empty string when the command has not written it. */
function hostFile(folder: string, fileName: string): string {
  try {
    return readFileSync(path.join(folder, fileName), 'utf8');
  } catch {
    return '';
  }
}

describe('F-0415 reopening, the environment, the log and the terminal (card containers-44)', function () {
  this.timeout(900_000);

  it('F-0415 AC-11 (m11): a postCreateCommand that fails after the connect keeps its output, stops postStartCommand and postAttachCommand of that run, shows no notification or dialog, ends the Configuring terminal with the red failure line and the closing line, and leaves the container running', async () => {
    const failure =
      'postCreateCommand from devcontainer.json failed with exit code 7. Skipping any further user-provided commands.';
    const folder = devContainerFolder('c58-postcreate-fails', {
      name: 'Postcreate Fails',
      postCreateCommand: 'echo c58-before-failure; exit 7',
      postStartCommand: 'touch /tmp/c58-poststart',
      postAttachCommand: 'touch /tmp/c58-postattach',
    });
    try {
      const logMark = containersLog().length;
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      await new Promise(resolve => setTimeout(resolve, 15_000));
      const containerId = await containerOf(folder);
      await focusTerminal(name);
      const text = (await terminalText(name)).replaceAll('\n', ' ');
      const spans = await terminalSpans(name);
      const lines = containersLogSince(logMark);
      const {stdout: leftBehind} = await execFileAsync('docker', [
        'exec',
        containerId,
        'sh',
        '-c',
        'ls /tmp | grep c58- || true',
      ]);
      const {stdout: status} = await execFileAsync('docker', [
        'inspect',
        '-f',
        '{{.State.Status}}',
        containerId,
      ]);
      const centre = await notificationCentre(name);
      const dialog = await dialogOf(name);
      await closeWindow(name);
      const [outputAt = -1, failureAt = -1, doneAt = -1] = [
        'c58-before-failure',
        failure,
        'Done. Press any key to close the terminal.',
      ].map(each => text.indexOf(each));
      deepStrictEqual(
        {
          outputKept: lines.includes('c58-before-failure'),
          terminalInOrder:
            outputAt >= 0 && outputAt < failureAt && failureAt < doneAt,
          failureIsRed: [1, 9].includes(
            spans.find(span => span.text.includes(failure))?.foreground ?? -1,
          ),
          laterCommandsRan: leftBehind.trim(),
          status: status.trim(),
          centre,
          dialog,
        },
        {
          outputKept: true,
          terminalInOrder: true,
          failureIsRed: true,
          laterCommandsRan: '',
          status: 'running',
          centre: [],
          dialog: undefined,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-12 (m12): a command that failed in an earlier run is not retried when the same container is reopened without a rebuild', async () => {
    const folder = devContainerFolder('c44-no-retry', {
      name: 'No Retry',
      postCreateCommand: `${mark('postCreate')}; exit 1`,
      postAttachCommand: mark('postAttach'),
    });
    try {
      const first = await openFolderWindow(folder);
      await reopenInContainer(first);
      const containerId = await containerOf(folder);
      await untilLabels(containerId, folder, ['postCreate']);
      await closeWindow(first);
      const second = await openFolderWindow(folder);
      await reopenInContainer(second);
      await waitFor(
        'the second postAttachCommand',
        async () =>
          (await labelsOf(containerId, folder)).filter(
            label => label === 'postAttach',
          ).length >= 1,
        120_000,
      );
      const labels = await labelsOf(containerId, folder);
      const containers = await devContainersOf(folder);
      await closeWindow(second);
      deepStrictEqual(
        {
          postCreateRuns: labels.filter(label => label === 'postCreate').length,
          containers,
        },
        {postCreateRuns: 1, containers: [containerId]},
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-24 (m24): containerEnv and remoteEnv reach the in-container commands, and neither reaches initializeCommand', async () => {
    const folder = devContainerFolder('c44-command-env', {
      name: 'Command Env',
      containerEnv: {C44_CONTAINER_VAR: 'container-value'},
      remoteEnv: {C44_REMOTE_VAR: 'remote-value'},
      initializeCommand:
        "env | grep '^C44_' | sort > init-env; echo done >> init-env",
      onCreateCommand:
        "env | grep '^C44_' | sort > .c44-env; echo done >> .c44-env",
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await waitFor(
        'the environment file',
        async () =>
          (
            await inWorkspace(
              containerId,
              folder,
              'cat .c44-env 2>/dev/null || true',
            )
          ).includes('done'),
        120_000,
      );
      const inside = await inWorkspace(containerId, folder, 'cat .c44-env');
      await closeWindow(name);
      deepStrictEqual(
        {inside, host: hostFile(folder, 'init-env')},
        {
          inside:
            'C44_CONTAINER_VAR=container-value\nC44_REMOTE_VAR=remote-value\ndone\n',
          host: 'done\n',
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-34 (m34): an object entry’s output shows only when it ends, after the property line, while a string command’s output shows as it runs', async () => {
    const stringFolder = devContainerFolder('c44-string-output', {
      name: 'String Output',
      onCreateCommand:
        'echo c44-early-$((6*7)); sleep 16; echo c44-late-$((6*7))',
    });
    const objectFolder = devContainerFolder('c44-entry-output', {
      name: 'Entry Output',
      updateContentCommand: {slow: 'echo c44-entry-$((6*7)); sleep 16'},
    });
    const results: Record<string, string[]> = {};
    for (const [label, folder] of [
      ['string', stringFolder],
      ['object', objectFolder],
    ] as const) {
      try {
        const name = await openFolderWindow(folder);
        const reading: string[] = [];
        const sampling = {done: false};
        const sampler = (async () => {
          while (!sampling.done) {
            try {
              await focusTerminal(name);
              reading.push((await terminalText(name)).replaceAll('\n', ''));
            } catch {
              // The window is reloading, or the terminal is not open yet.
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        })();
        await reopenInContainer(name);
        sampling.done = true;
        await sampler;
        await closeWindow(name);
        results[label] = reading;
      } finally {
        await removeContainers(folder);
      }
    }
    const stringReading = results.string ?? [];
    const objectReading = results.object ?? [];
    const propertyLine = 'json...';
    deepStrictEqual(
      {
        stringOutputWhileRunning: stringReading.some(
          text =>
            text.includes('c44-early-42') && !text.includes('c44-late-42'),
        ),
        propertyLineBeforeEntryOutput: objectReading.some(
          text => text.includes(propertyLine) && !text.includes('c44-entry-42'),
        ),
        entryOutputAtTheEnd: (objectReading.at(-1) ?? '').includes(
          'c44-entry-42',
        ),
      },
      {
        stringOutputWhileRunning: true,
        propertyLineBeforeEntryOutput: true,
        entryOutputAtTheEnd: true,
      },
    );
  });
});
