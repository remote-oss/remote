import {deepStrictEqual} from 'node:assert';
import {closeWindow, variable} from '../windows/harness.ts';
import {docker} from '../windows/dev-containers-view.ts';
import {noWindowLeft} from './support.ts';
import {connectedWindow, removeContainers} from '../windows/folder-windows.ts';
import {notifications} from '../windows/renderer.ts';

/** The entries of the container's `devcontainer.metadata` label. */
async function metadataOf(containerId: string): Promise<unknown[]> {
  return JSON.parse(
    (await docker(
      'inspect',
      '--format',
      '{{index .Config.Labels "devcontainer.metadata"}}',
      containerId,
    )) || '[]',
  ) as unknown[];
}

describe('The configuration in the container’s metadata label (card coverage-112)', function () {
  this.timeout(900_000);

  beforeEach(noWindowLeft);

  it('F-0305 AC-1, AC-2, AC-7, AC-14, AC-16 (c112-label): the last entry of the label holds the customizations in resolved form, with the legacy extensions after the customizations’ and the legacy settings folded under the customizations’; the legacy devPort loses to the customizations’; no secret becomes a variable or a notification', async () => {
    const label = 'c112-label';
    const {name, containerId, folder} = await connectedWindow(label, {
      extensions: ['legacy.extension'],
      settings: {'files.autoSave': 'off', 'editor.tabSize': 3},
      devPort: 9999,
      secrets: {C112_SECRET: {description: 'a secret'}},
      customizations: {
        vscode: {
          extensions: ['new.extension'],
          settings: {'files.autoSave': 'afterDelay'},
          devPort: 8888,
        },
      },
    });
    try {
      const environment = await docker(
        'inspect',
        '--format',
        '{{json .Config.Env}}',
        containerId,
      );
      const entries = await metadataOf(containerId);
      deepStrictEqual(
        {
          last: entries.at(-1),
          secret: environment.includes('C112_SECRET'),
          notices: await notifications(name),
        },
        {
          last: {
            customizations: {
              vscode: {
                extensions: ['new.extension', 'legacy.extension'],
                settings: {'files.autoSave': 'afterDelay', 'editor.tabSize': 3},
                devPort: 8888,
              },
            },
          },
          secret: false,
          notices: [],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });

  it('F-0305 AC-17 (c112-none): none of secrets, an unrecognized top-level property, $schema, a top-level additionalProperties object and the legacy codespaces reaches the label, and a file with no property the label carries adds no entry to it', async () => {
    const label = 'c112-none';
    const image = variable('HARNESS_DEVCONTAINER_IMAGE');
    const {name, containerId, folder} = await connectedWindow(label, {
      $schema: 'https://example.invalid/devcontainer.schema.json',
      additionalProperties: {kept: false},
      secrets: {C112_SECRET: {description: 'a secret'}},
      codespaces: {repositories: {}},
      c112Unknown: 'unknown',
    });
    try {
      const imageEntries = JSON.parse(
        (await docker(
          'image',
          'inspect',
          '--format',
          '{{index .Config.Labels "devcontainer.metadata"}}',
          image,
        )) || '[]',
      ) as unknown[];
      deepStrictEqual(await metadataOf(containerId), imageEntries);
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
