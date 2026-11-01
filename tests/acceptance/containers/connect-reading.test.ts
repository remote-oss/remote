import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  containersLogSince,
  devContainerFolder,
  editorLogsFolder,
  reloadingAction,
  reloadingCommand,
  reopenInContainer,
  startInWindow,
  variable,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  answerFolderDialog,
  answerToast,
  connectSurface,
  editorTabs,
} from '../windows/renderer.ts';
import {
  connectingOf,
  sampled,
  sampling,
  slowBuildFolder,
} from '../windows/sampling.ts';

const execFileAsync = promisify(execFile);

const CONNECTING = 'Connecting to Dev Container (show log)';
const LOG_LINK = 'command:remote-containers.revealLogTerminal';
const DISCOVERY = 'Folder contains a Dev Container configuration file.';

/** What athena ruled (#1204) for the spec's 1 s of a connect to a running container and of its S087. */
const TOLERANCE_MILLISECONDS = 1500;

/** The pause between two readings of the rows that time the progress. */
const FAST_SAMPLE_MILLISECONDS = 25;

/** The Dev Containers log files the editor has written so far, one for each window that ran the extension. */
function windowLogFiles(): string[] {
  const logs = editorLogsFolder();
  return existsSync(logs)
    ? readdirSync(logs, {recursive: true, encoding: 'utf8'}).filter(
        file => path.basename(file) === '1-Dev Containers.log',
      )
    : [];
}

/** One reading of window `name` with the time it was taken. */
async function timedSurface(
  name: string,
): Promise<{takenAt: number; indicator: string; toasts: string[]}> {
  const surface = await connectSurface(name);
  return {takenAt: Date.now(), ...surface};
}

describe('F-0408 the reading step, the pull and the entry points (card coverage-68)', function () {
  this.timeout(900_000);

  it('F-0408 AC-8 (c68-reading-step): the local window’s log records Reading configuration and the time it took before the window reloads', async () => {
    const folder = devContainerFolder('c68-reading', {name: 'Reading Step'});
    const mark = containersLog().length;
    const name = await openFolderWindow(folder);
    try {
      await reopenInContainer(name);
      const lines = containersLogSince(mark);
      const starts = lines.indexOf('Reading configuration');
      const ends = lines.findIndex(line =>
        /^Reading configuration: \d+ ms$/.test(line),
      );
      const resolving = lines.indexOf('Resolving Remote');
      deepStrictEqual(
        [starts >= 0, ends > starts, resolving > ends],
        [true, true, true],
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0408 AC-14 (ruling-1557-tolerance): reopening a folder whose container runs connects, by the log’s Resolving Remote, and shows S087, each within 1.5 s (athena’s ruling on #1204 for the spec’s 1 s), with no Starting container and no Starting VS Code Server in the log', async () => {
    const folder = devContainerFolder('c68-running', {
      name: 'Running Reuse',
      shutdownAction: 'none',
    });
    const name = await openFolderWindow(folder);
    try {
      await reopenInContainer(name);
      await closeWindow(name);
      const mark = containersLog().length;
      const again = await openFolderWindow(folder);
      const sampler = sampled(
        () => timedSurface(again),
        FAST_SAMPLE_MILLISECONDS,
      );
      await reopenInContainer(again);
      const samples = await sampler.stop();
      const shown = samples.filter(sample =>
        sample.toasts.some(toast => toast.startsWith('Connecting')),
      );
      const onScreen =
        shown.length === 0
          ? 0
          : (shown.at(-1)?.takenAt ?? 0) -
            (shown[0]?.takenAt ?? 0) +
            FAST_SAMPLE_MILLISECONDS;
      const lines = containersLogSince(mark);
      const connectMilliseconds = Number(
        lines
          .map(line => /^Resolving Remote: (\d+) ms$/.exec(line)?.[1])
          .find(each => each !== undefined) ?? Infinity,
      );
      console.log(
        `F-0408 AC-14: connect ${String(connectMilliseconds)} ms, S087 on screen ${String(onScreen)} ms`,
      );
      deepStrictEqual(
        {
          already: lines.some(line => line.endsWith('was already running')),
          steps: lines.filter(
            line =>
              line === 'Starting container' ||
              line === 'Starting VS Code Server',
          ),
          connectWithin: connectMilliseconds < TOLERANCE_MILLISECONDS,
          shownWithin: onScreen < TOLERANCE_MILLISECONDS,
        },
        {
          already: true,
          steps: [],
          connectWithin: true,
          shownWithin: true,
        },
      );
      await closeWindow(again);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0408 AC-9 (c116-pause): after the window reloads, about half a second passes with no notification and Opening Remote... in the status bar before S087 appears, and the reloaded window writes a new log file', async () => {
    const folder = slowBuildFolder('c116-pause', 'Pause Row');
    const name = await openFolderWindow(folder);
    const logFilesBefore = windowLogFiles();
    const sampler = sampled(() => timedSurface(name), FAST_SAMPLE_MILLISECONDS);
    try {
      await reopenInContainer(name);
      const samples = await sampler.stop();
      const newLogFiles = windowLogFiles().filter(
        file => !logFilesBefore.includes(file),
      );
      // The harness cannot read a window while it reloads, so the pause is counted from the resolve's own log line.
      const resolving = newLogFiles
        .flatMap(file =>
          readFileSync(path.join(editorLogsFolder(), file), 'utf8').split('\n'),
        )
        .map(line => /^(\S+) \[info\] Resolving Remote$/.exec(line)?.[1])
        .find(each => each !== undefined);
      const resolvedAt = Date.parse(resolving ?? '');
      const firstToast = samples.find(sample =>
        sample.toasts.some(toast => toast.startsWith('Connecting')),
      );
      const before = samples.filter(
        sample =>
          sample.takenAt >= resolvedAt &&
          sample.takenAt < (firstToast?.takenAt ?? Infinity),
      );
      const toastsBefore = before.flatMap(sample => sample.toasts);
      deepStrictEqual(
        {
          newLogFile: newLogFiles.length > 0,
          firstToast: firstToast !== undefined,
          noToastBefore: toastsBefore,
          pauseAtLeast400:
            firstToast !== undefined && firstToast.takenAt - resolvedAt >= 400,
          quietSamplesAllOpening: before.every(sample =>
            sample.indicator.includes('Opening Remote'),
          ),
          indicatorSeen: samples.some(sample =>
            sample.indicator.includes('Opening Remote'),
          ),
        },
        {
          newLogFile: true,
          firstToast: true,
          noToastBefore: [],
          pauseAtLeast400: true,
          quietSamplesAllOpening: true,
          indicatorSeen: true,
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });

  it('F-0408 AC-15 (c68-pull): an image that is not local is pulled inside the Starting container step, and no notification, suffix, title or editor names the pull', async () => {
    const imageTag = `${variable('HARNESS_REGISTRY')}/c68-pull:${String(Date.now())}`;
    await execFileAsync('docker', [
      'tag',
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      imageTag,
    ]);
    await execFileAsync('docker', ['push', imageTag]);
    await execFileAsync('docker', ['image', 'rm', imageTag]);
    const folder = devContainerFolder('c68-pull', {
      name: 'Remote Image',
      image: imageTag,
    });
    const mark = containersLog().length;
    const name = await openFolderWindow(folder);
    const sampler = sampled(async () => [
      (await connectSurface(name)).indicator,
      ...(await connectSurface(name)).toasts,
      ...(await editorTabs(name)).map(editor => editor.label),
    ]);
    try {
      await reopenInContainer(name);
      const surfaces = (await sampler.stop()).flat();
      const lines = containersLogSince(mark);
      const step = lines.indexOf('Starting container');
      const started = lines.indexOf('Container started');
      const pull = lines.findIndex(line =>
        line.startsWith(
          `${imageTag.slice(imageTag.lastIndexOf(':') + 1)}: Pulling from`,
        ),
      );
      const downloaded = lines.findIndex(line =>
        line.startsWith('Status: Downloaded newer image'),
      );
      deepStrictEqual(
        {
          inside: [step, pull, downloaded, started].every(
            (position, index, all) =>
              position >= 0 &&
              (index === 0 || position > (all[index - 1] ?? 0)),
          ),
          named: surfaces.filter(
            text => /pull/i.test(text) || text.includes('c68-pull'),
          ),
        },
        {inside: true, named: []},
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
      await execFileAsync('docker', ['image', 'rm', '--force', imageTag]).catch(
        () => undefined,
      );
    }
  });

  it('F-0408 AC-21 (c68-entry-points): Open Folder in Container, Rebuild Container, Rebuild Container Without Cache and the F-0402 notification’s button each show the same S087 as a plain Reopen, with no editor open before the connect', async () => {
    const seen: Record<string, unknown> = {};
    const first = devContainerFolder('c68-entry-a', {name: 'Entry A'});
    const second = devContainerFolder('c68-entry-b', {name: 'Entry B'});
    /** What the connect that `start` begins showed: its S087 toasts, and every editor tab it saw. */
    async function shown(
      name: string,
      start: () => Promise<void>,
    ): Promise<unknown> {
      const sampler = sampling(name);
      const tabs = sampled(async () =>
        (await editorTabs(name)).map(editor => editor.label),
      );
      await start();
      await connectedToContainer(name);
      const toasts = connectingOf(await sampler.stop());
      const editors = (await tabs.stop()).flat();
      return {
        links: [
          ...new Set(
            toasts.map(toast => JSON.stringify([toast.links, toast.buttons])),
          ),
        ],
        shown: toasts.length > 0,
        editors,
      };
    }
    await setUserSetting('workbench.startupEditor', 'none');
    /** The notification’s button, on a folder with a slow build so that S087 outlasts its half second. */
    async function viaNotification(): Promise<unknown> {
      const folder = slowBuildFolder('c68-entry-n', 'Entry N');
      const opened = await openFolderWindow(folder);
      try {
        const outcome = await shown(opened, () =>
          reloadingAction(opened, 'the notification’s button', () =>
            answerToast(opened, DISCOVERY, 'Reopen in Container'),
          ),
        );
        await closeWindow(opened);
        return outcome;
      } finally {
        await removeContainers(folder);
      }
    }
    seen.notification = await viaNotification();
    const window = await openFolderWindow(first);
    try {
      await reopenInContainer(window);
      seen.rebuild = await shown(window, () =>
        reloadingCommand(window, 'remote-containers.rebuildContainer'),
      );
      seen.rebuildNoCache = await shown(window, () =>
        reloadingCommand(window, 'remote-containers.rebuildContainerNoCache'),
      );
      await closeWindow(window);
      const home = await openFolderWindow(second);
      seen.openFolder = await shown(path.basename(first), async () => {
        await startInWindow(home, 'remote-containers.openFolder');
        await answerFolderDialog(home, first);
      });
      await closeWindow(path.basename(first));
    } finally {
      await setUserSetting('workbench.startupEditor', undefined);
      await removeContainers(first);
      await removeContainers(second);
    }
    const same = {
      links: [JSON.stringify([[{text: CONNECTING, href: LOG_LINK}], []])],
      shown: true,
      editors: [],
    };
    deepStrictEqual(seen, {
      notification: same,
      rebuild: same,
      rebuildNoCache: same,
      openFolder: same,
    });
  });
});
