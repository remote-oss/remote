import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  activeEditorOf,
  closeWindow,
  devContainerFolder,
  devContainersOf,
  inWindow,
  recentlyOpenedIn,
  reloadWindow,
  reopenInContainer,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerDialog,
  primaryButtonOf,
  waitForDialog,
  windowTitle,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** The name of the Docker context the row creates and then deletes. */
const CONTEXT = 'c41-ctx';

/** The output of `docker` run with `parameters` in the launch's own Docker configuration, without its ends' white space. */
async function dockerIn(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters, {
    env: {
      ...process.env,
      DOCKER_CONFIG: path.join(variable('HARNESS_RUN_FOLDER'), 'docker-config'),
    },
  });
  return stdout.trim();
}

/** The message, details and sorted buttons of a dialog, as the row compares it. */
function textOf(shown: {
  message: string;
  details: string;
  buttons: string[];
}): [string, string, string[]] {
  return [shown.message, shown.details, [...shown.buttons].sort()];
}

describe('F-0502 a window whose Docker context was deleted (card containers-43)', function () {
  this.timeout(600_000);

  it('F-0502 AC-41 (c41-context): after the recorded context is deleted, Reload Window, Retry and the window’s Open Recent entry give the Docker error dialog again, Edit devcontainer.json Locally gives the local folder with devcontainer.json open, and Reopen in Container from there connects to the same container', async () => {
    const folder = devContainerFolder('c41-context', {name: 'Ctx'});
    const host = await dockerIn(
      'context',
      'inspect',
      'default',
      '--format',
      '{{.Endpoints.docker.Host}}',
    );
    await dockerIn('context', 'create', CONTEXT, '--docker', `host=${host}`);
    await dockerIn('context', 'use', CONTEXT);
    const starter = await openFolderWindow(devContainerFolder('c41-starter'));
    try {
      const window = await openFolderWindow(folder);
      await reopenInContainer(window);
      const [containerId = ''] = await devContainersOf(folder);
      const connectedTitle = await windowTitle(window);
      await dockerIn('context', 'use', 'default');
      await dockerIn('context', 'rm', '--force', CONTEXT);
      await reloadWindow(window);
      const first = await waitForDialog(window, 180_000);
      const primary = await primaryButtonOf(window);
      await answerDialog(window, 'Retry');
      const afterRetry = await waitForDialog(window, 180_000);
      await closeWindow(window);
      const entry = (await recentlyOpenedIn(starter)).find(
        each =>
          each.remoteAuthority?.startsWith('dev-container+') === true &&
          each.uri.endsWith('/workspaces/c41-context'),
      );
      void inWindow(starter, 'acceptance.agent.openWindow', entry?.uri ?? '');
      const afterEntry = await waitForDialog('c41-context', 180_000);
      await answerDialog('c41-context', 'Edit devcontainer.json Locally');
      const configuration = path.join(
        folder,
        '.devcontainer',
        'devcontainer.json',
      );
      await waitFor(
        'the configuration to be open',
        async () =>
          (await activeEditorOf('c41-context').catch(() => null)) ===
          configuration,
        60_000,
      );
      await reopenInContainer('c41-context');
      deepStrictEqual(
        {
          connectedTitle,
          dialogs: [first, afterRetry, afterEntry].map(textOf),
          primary,
          entryLabel: entry?.label,
          sameContainer: (await devContainersOf(folder)).join(),
          finalTitle: await windowTitle('c41-context'),
        },
        {
          connectedTitle: '[c41-context [Dev Container: Ctx @ c41-ctx]]',
          dialogs: [1, 2, 3].map(() => [
            '',
            'Docker returned an error. Make sure the Docker daemon is running and select an option how to proceed.',
            ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
          ]),
          primary: 'Retry',
          entryLabel: `${folder} @ ${CONTEXT} [Dev Container]`,
          sameContainer: containerId,
          finalTitle: '[c41-context [Dev Container: Ctx]]',
        },
      );
      await closeWindow('c41-context');
    } finally {
      await dockerIn('context', 'use', 'default').catch(() => undefined);
      await dockerIn('context', 'rm', '--force', CONTEXT).catch(
        () => undefined,
      );
      await closeWindow(starter).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });
});
