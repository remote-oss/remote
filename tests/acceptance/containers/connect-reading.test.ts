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
import {connectingOf, sampled, sampling} from '../windows/sampling.ts';

const execFileAsync = promisify(execFile);

const CONNECTING = 'Connecting to Dev Container (show log)';
const LOG_LINK = 'command:remote-containers.revealLogTerminal';
const DISCOVERY = 'Folder contains a Dev Container configuration file.';

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

  it('F-0408 AC-14 (c68-running-reuse): reopening a folder whose container runs connects with no Starting container and no Starting VS Code Server in the log (its time clauses wait for card containers-116)', async () => {
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
      await reopenInContainer(again);
      const lines = containersLogSince(mark);
      deepStrictEqual(
        {
          already: lines.some(line => line.endsWith('was already running')),
          steps: lines.filter(
            line =>
              line === 'Starting container' ||
              line === 'Starting VS Code Server',
          ),
        },
        {
          already: true,
          steps: [],
        },
      );
      await closeWindow(again);
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
    /**
     * The notification’s button on a folder of its own, tried up to three times: the harness reads a window that
     * reloads only when its page can be reached, and now and then it cannot be reached until the connect is over,
     * which leaves no sample of the toast to judge.
     */
    async function viaNotification(): Promise<unknown> {
      let outcome: unknown;
      for (const attempt of [1, 2, 3]) {
        const folder = devContainerFolder(`c68-entry-n${String(attempt)}`, {
          name: `Entry N${String(attempt)}`,
        });
        const opened = await openFolderWindow(folder);
        try {
          outcome = await shown(opened, () =>
            answerToast(opened, DISCOVERY, 'Reopen in Container'),
          );
          await closeWindow(opened);
        } finally {
          await removeContainers(folder);
        }
        if ((outcome as {shown: boolean}).shown) {
          break;
        }
      }
      return outcome;
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
