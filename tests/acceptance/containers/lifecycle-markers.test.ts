import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  containersLog,
  containersLogSince,
  devContainerFolder,
  reloadWindow,
  reopenInContainer,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  containerOf,
  inWorkspace,
  labelsOf,
  mark,
  untilLabels,
} from './lifecycle-support.ts';

const execFileAsync = promisify(execFile);

/** The lines of the Dev Containers log after the line `running`, the ones `prefix` starts, in order. */
function writtenAfter(
  lines: readonly string[],
  running: string,
  prefix: string,
): string[] {
  return lines
    .slice(lines.indexOf(running) + 1)
    .filter(line => line.startsWith(prefix));
}

/** The Dockerfile line that frees the host's ids from the run's `node` account when it holds them, so the synced account takes them. */
function freeHostIds(): string {
  return process.getuid?.() === 1000 && process.getgid?.() === 1000
    ? 'RUN deluser node\n'
    : '';
}

describe('F-0415 the markers and the output of the lifecycle commands (card coverage-77)', function () {
  this.timeout(900_000);

  it('F-0415 AC-27 (c77-output): every line a host and an in-container command wrote to standard output and to standard error is in the log after the command’s Running line, in order', async () => {
    const folder = devContainerFolder('c77-output', {
      name: 'Output',
      initializeCommand:
        'echo c77-host-1; sleep 0.4; echo c77-host-2 >&2; sleep 0.4; echo c77-host-3',
      postCreateCommand:
        'echo c77-inside-1; sleep 0.4; echo c77-inside-2 >&2; sleep 0.4; echo c77-inside-3',
    });
    try {
      const mark = containersLog().length;
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await waitFor(
        'the postCreateCommand output in the log',
        () =>
          Promise.resolve(
            containersLogSince(mark).some(line => line === 'c77-inside-3'),
          ),
        120_000,
      );
      const lines = containersLogSince(mark);
      await closeWindow(name);
      deepStrictEqual(
        {
          host: writtenAfter(
            lines,
            'Running the initializeCommand from devcontainer.json...',
            'c77-host',
          ),
          inside: writtenAfter(
            lines,
            'Running the postCreateCommand from devcontainer.json...',
            'c77-inside',
          ),
          container: containerId.length > 0,
        },
        {
          host: ['c77-host-1', 'c77-host-2', 'c77-host-3'],
          inside: ['c77-inside-1', 'c77-inside-2', 'c77-inside-3'],
          container: true,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-9b (c77-first-start): a container whose earlier run failed before postStartCommand ran runs postStartCommand and postAttachCommand when the window is merely reloaded', async () => {
    const folder = devContainerFolder('c77-first-start', {
      name: 'First Start',
      postCreateCommand: `${mark('postCreate')}; exit 1`,
      postStartCommand: mark('postStart'),
      postAttachCommand: mark('postAttach'),
    });
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await untilLabels(containerId, folder, ['postCreate']);
      const before = await labelsOf(containerId, folder);
      await reloadWindow(name);
      await untilLabels(containerId, folder, ['postStart', 'postAttach']);
      const after = await labelsOf(containerId, folder);
      await closeWindow(name);
      deepStrictEqual(
        {
          beforeReload: before.filter(label => label !== 'postCreate'),
          postCreateRuns: after.filter(label => label === 'postCreate').length,
          postStartRuns: after.filter(label => label === 'postStart').length,
          postAttachRuns: after.filter(label => label === 'postAttach').length,
        },
        {
          beforeReload: [],
          postCreateRuns: 1,
          postStartRuns: 1,
          postAttachRuns: 1,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0415 AC-28 (c77-markers): the first connect leaves the four marker files in the remote user’s home, none for postAttachCommand, and a deleted onCreateCommand marker makes only onCreateCommand run again', async () => {
    const folder = devContainerFolder('c77-markers', {
      name: 'Markers',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
      remoteUser: 'vscode',
      onCreateCommand: mark('onCreate'),
      updateContentCommand: mark('updateContent'),
      postCreateCommand: mark('postCreate'),
      postAttachCommand: mark('postAttach'),
    });
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n${freeHostIds()}RUN addgroup -g 4713 vscode && adduser -D -u 4713 -G vscode -s /bin/sh vscode\n`,
    );
    const markers = '/home/vscode/.devcontainer';
    try {
      const name = await openFolderWindow(folder);
      await reopenInContainer(name);
      const containerId = await containerOf(folder);
      await untilLabels(containerId, folder, [
        'onCreate',
        'updateContent',
        'postCreate',
        'postAttach',
      ]);
      const listed = (
        await inWorkspace(containerId, folder, `ls -A ${markers}`)
      )
        .split('\n')
        .filter(each => each !== '')
        .sort();
      await execFileAsync('docker', [
        'exec',
        containerId,
        'rm',
        `${markers}/.onCreateCommandMarker`,
      ]);
      await reloadWindow(name);
      await waitFor(
        'the second onCreateCommand',
        async () =>
          (await labelsOf(containerId, folder)).filter(
            label => label === 'onCreate',
          ).length === 2,
        180_000,
      );
      const labels = await labelsOf(containerId, folder);
      const back = (
        await inWorkspace(containerId, folder, `ls -A ${markers}`)
      ).split('\n');
      await closeWindow(name);
      deepStrictEqual(
        {
          listed,
          runs: ['onCreate', 'updateContent', 'postCreate'].map(
            label => labels.filter(each => each === label).length,
          ),
          markerBack: back.includes('.onCreateCommandMarker'),
        },
        {
          listed: [
            '.onCreateCommandMarker',
            '.postCreateCommandMarker',
            '.postStartCommandMarker',
            '.updateContentCommandMarker',
          ],
          runs: [2, 1, 1],
          markerBack: true,
        },
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
