import {deepStrictEqual} from 'node:assert';
import {installedIn} from '../windows/container-extensions.ts';
import {waitFor} from '../windows/harness.ts';
import {featureBuilds, writeLocalFeature} from './features-support.ts';

/** The extension a Feature lists and the configuration removes. */
const REMOVED_ID = 'dracula-theme.theme-dracula';

/** The extension a Feature lists and nothing removes, which shows the install ran. */
const KEPT_ID = 'redhat.vscode-yaml';

describe('the extensions a Feature lists (card coverage-101)', function () {
  this.timeout(1_800_000);
  const {build} = featureBuilds();

  it('F-0505 AC-26 (c101-feature-removal): an extension a Feature lists in its customizations is not installed when the configuration lists it with a leading minus, and another one the Feature lists is', async () => {
    const built = await build(
      'c101-ac26',
      {
        features: {'./ext-feature': {}},
        customizations: {vscode: {extensions: [`-${REMOVED_ID}`]}},
      },
      folder => {
        writeLocalFeature(folder, 'ext-feature', {
          metadata: {
            customizations: {
              vscode: {extensions: [REMOVED_ID, `${KEPT_ID}@2.0.0`]},
            },
          },
        });
      },
    );
    await waitFor(
      `the extension folder of ${KEPT_ID}`,
      async () =>
        (await installedIn(built.containerId)).some(entry =>
          entry.startsWith(`${KEPT_ID}-`),
        ),
      90_000,
    );
    // The installs run side by side: the removed extension would have appeared with the kept one.
    await new Promise(resolve => setTimeout(resolve, 5000));
    const installed = await installedIn(built.containerId);
    deepStrictEqual(
      [
        installed.some(entry => entry.startsWith(`${KEPT_ID}-`)),
        installed.some(entry => entry.startsWith(`${REMOVED_ID}-`)),
      ],
      [true, false],
    );
  });
});
