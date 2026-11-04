import {deepStrictEqual} from 'node:assert';
import {closeWindow, waitFor} from '../windows/harness.ts';
import {connectedWindow, removeContainers} from '../windows/folder-windows.ts';
import {statusItemText} from '../windows/renderer.ts';
import {docker} from '../windows/dev-containers-view.ts';

/** How long a file written by a lifecycle command is waited for in the container, in milliseconds. */
const FILE_MILLISECONDS = 90_000;

/** The shortest time the indicator is given to follow a connect, in milliseconds. */
const INDICATOR_MILLISECONDS = 30_000;

/** The text of `file` in container `containerId`, once it exists. */
async function textOfFile(containerId: string, file: string): Promise<string> {
  await waitFor(
    `${file} to exist in the container`,
    async () =>
      (await docker(
        'exec',
        containerId,
        'sh',
        '-c',
        `test -f ${file} && echo y`,
      ).catch(() => '')) === 'y',
    FILE_MILLISECONDS,
  );
  return docker('exec', containerId, 'cat', file);
}

/** The command that writes the text of a reference to /tmp/`file`. */
function probe(file: string, text: string): string {
  return `printf '%s' "${text}" > /tmp/${file}`;
}

describe('Container references in remoteEnv and in lifecycle commands (card coverage-112)', function () {
  this.timeout(900_000);

  it('F-0304 AC-2, AC-25, AC-45, AC-52, AC-67 (c112-container): containerEnv references give the container’s values, the default of an unset variable and an empty string for an empty one, in remoteEnv, in the post-create, post-start and post-attach commands and in the name', async () => {
    const label = 'c112-container';
    const {name, containerId, folder} = await connectedWindow(label, {
      name: '${containerEnv:C112_NAME:dflt}',
      containerEnv: {
        C112_NAME: 'from-container',
        C112_BASE: 'base',
        C112_EMPTY: '',
      },
      remoteEnv: {
        C112_PATH: '${containerEnv:PATH}:/c112',
        C112_DFLT: '${containerEnv:C112_UNSET:dflt}',
        C112_NODFLT: '[${containerEnv:C112_UNSET}]',
        C112_EMPTY: '[${containerEnv:C112_EMPTY:dflt}]',
        C112_ABSENT: '${containerEnv:C112_ABSENT:dflt}',
      },
      postCreateCommand:
        'printf "%s|%s|%s|%s|%s|%s" "$C112_PATH" "$C112_DFLT" "$C112_NODFLT" "$C112_EMPTY" "$C112_ABSENT" "${containerEnv:C112_BASE}" > /tmp/c112-post-create',
      postStartCommand: probe('c112-post-start', '${containerEnv:C112_BASE}'),
      postAttachCommand: probe('c112-post-attach', '${containerEnv:C112_BASE}'),
    });
    try {
      const containerPath = await docker(
        'exec',
        containerId,
        'printenv',
        'PATH',
      );
      deepStrictEqual(
        {
          commands: [
            await textOfFile(containerId, '/tmp/c112-post-start'),
            await textOfFile(containerId, '/tmp/c112-post-attach'),
          ],
          postCreate: await textOfFile(containerId, '/tmp/c112-post-create'),
          indicator: await statusItemText(
            name,
            'status.host',
            'Dev Container: from-container',
            INDICATOR_MILLISECONDS,
          ),
        },
        {
          commands: ['base', 'base'],
          postCreate: `${containerPath}:/c112|dflt|[]|[]|dflt|base`,
          indicator: 'Dev Container: from-container',
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
