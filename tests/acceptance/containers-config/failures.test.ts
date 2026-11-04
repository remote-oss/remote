import {deepStrictEqual} from 'node:assert';
import {
  closeContained,
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenStarted,
  variable,
} from '../windows/harness.ts';
import {docker} from '../windows/dev-containers-view.ts';
import {
  connectedWindow,
  openFolderWindow,
  removeContainers,
} from '../windows/folder-windows.ts';
import {
  notifications,
  pressEscape,
  statusBarText,
  waitForDialog,
} from '../windows/renderer.ts';
import {imageWithLabel, noWindowLeft, textOfFile} from './support.ts';

/** The dialog of a setup that fails, as F-0410 words it. */
const FAILED_SETUP = {
  details: 'An error occurred setting up the container.',
  buttons: ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
};

/** Opens a window on a folder over `image`, reopens it in a container, and gives the window, the folder and the dialog that shows. */
async function failedOn(
  label: string,
  image: string,
): Promise<{
  name: string;
  folder: string;
  dialog: {details: string; buttons: string[]};
}> {
  const folder = devContainerFolder(label, {name: label, image});
  const name = await openFolderWindow(folder);
  await reopenStarted(name);
  const {details, buttons} = await waitForDialog(name, 180_000);
  return {name, folder, dialog: {details, buttons: [...buttons]}};
}

describe('The image label that cannot be used, and the one that is odd (card coverage-112)', function () {
  this.timeout(1_200_000);

  beforeEach(noWindowLeft);

  it('F-0306 AC-30 (c112-bad-mount): a label whose only mount is a {type, src, dst} object ends in the generic setup dialog and leaves no container', async () => {
    const mount = JSON.parse(
      '{"type": "bind", "src": "/c112-source", "dst": "/c112-target"}',
    ) as unknown;
    const image = await imageWithLabel('c112-bad-mount', [{mounts: [mount]}]);
    const {name, folder, dialog} = await failedOn('c112-bad-mount', image);
    try {
      deepStrictEqual(
        [dialog, await devContainersOf(folder)],
        [FAILED_SETUP, []],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await docker('rmi', '--force', image).catch(() => undefined);
    }
  });

  it('F-0306 AC-44 (c112-container-user): a containerUser the image lacks ends in the setup dialog and leaves the container in the state created', async () => {
    const image = await imageWithLabel('c112-container-user', [
      {containerUser: 'c112nobody'},
    ]);
    const {name, folder, dialog} = await failedOn('c112-container-user', image);
    try {
      const containers = await devContainersOf(folder);
      deepStrictEqual(
        [
          dialog,
          await Promise.all(
            containers.map(container =>
              docker('inspect', '--format', '{{.State.Status}}', container),
            ),
          ),
        ],
        [FAILED_SETUP, ['created']],
      );
    } finally {
      await closeContained(name, pressEscape);
      await removeContainers(folder);
      await docker('rmi', '--force', image).catch(() => undefined);
    }
  });

  it('F-0306 AC-17 (c112-remote-user): a remoteUser the image lacks ends in the setup dialog, with the container running and the indicator still at Opening Remote...', async () => {
    const image = await imageWithLabel('c112-remote-user', [
      {remoteUser: 'c112nobody'},
    ]);
    const {name, folder, dialog} = await failedOn('c112-remote-user', image);
    try {
      const containers = await devContainersOf(folder);
      deepStrictEqual(
        [
          dialog,
          await Promise.all(
            containers.map(container =>
              docker('inspect', '--format', '{{.State.Status}}', container),
            ),
          ),
          await statusBarText(name, 'status.host'),
        ],
        [FAILED_SETUP, ['running'], 'Opening Remote...'],
      );
    } finally {
      await closeContained(name, pressEscape);
      await removeContainers(folder);
      await docker('rmi', '--force', image).catch(() => undefined);
    }
  });

  it('F-0306 AC-22 (c112-odd-label): a label that is no JSON, or no object or array, shows nothing, connects with a label of [] and runs the server as the image’s default user', async () => {
    const results: unknown[] = [];
    for (const [label, text] of [
      ['c112-text-label', 'not json'],
      ['c112-string-label', '"a string"'],
    ] as const) {
      const image = await imageWithLabel(label, text);
      const {name, containerId, folder} = await connectedWindow(label, {
        image,
      });
      try {
        results.push([
          await docker(
            'inspect',
            '--format',
            '{{index .Config.Labels "devcontainer.metadata"}}',
            containerId,
          ),
          await notifications(name),
          await docker(
            'exec',
            containerId,
            'sh',
            '-c',
            "ps -o user,args | grep 'connection-token-fil[e]' | head -n 1 | cut -d' ' -f1",
          ),
        ]);
      } finally {
        await closeWindow(name).catch(() => undefined);
        await removeContainers(folder);
        await docker('rmi', '--force', image).catch(() => undefined);
      }
    }
    deepStrictEqual(results, [
      ['[]', [], 'root'],
      ['[]', [], 'root'],
    ]);
  });

  it('F-0306 AC-23 (c112-entrypoint): an entrypoint of the label runs once at the container’s start, and the image keeps its base image’s entrypoint and command', async () => {
    const image = await imageWithLabel('c112-entrypoint', [
      {entrypoint: 'echo c112 >> /tmp/c112-entry'},
    ]);
    const {name, containerId, folder} = await connectedWindow(
      'c112-entrypoint',
      {image},
    );
    try {
      const form = '{{json .Config.Entrypoint}}{{json .Config.Cmd}}';
      deepStrictEqual(
        [
          await textOfFile(containerId, '/tmp/c112-entry'),
          await docker('image', 'inspect', '--format', form, image),
        ],
        [
          'c112',
          await docker(
            'image',
            'inspect',
            '--format',
            form,
            variable('HARNESS_DEVCONTAINER_IMAGE'),
          ),
        ],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
      await docker('rmi', '--force', image).catch(() => undefined);
    }
  });
});
