import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  waitFor,
} from '../windows/harness.ts';
import {focusTerminal, terminalText} from '../windows/renderer.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  containerOf,
  inWorkspace,
  labelsOf,
  mark,
  untilLabels,
} from './lifecycle-support.ts';

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
