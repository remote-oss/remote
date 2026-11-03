/**
 * @fileoverview F-2311 (card coverage-99): what the Settings editor shows of the setting that turns the agent
 * forwarding on.
 */

import {deepStrictEqual} from 'node:assert';
import {inWindow, readUserSettings, waitFor} from '../windows/harness.ts';
import {settingRow} from '../windows/renderer.ts';

const SETTING = 'remote.SSH.enableAgentForwarding';

describe('F-2311, the setting in the Settings editor (card coverage-99)', function () {
  this.timeout(120_000);

  it('F-2311 AC-1 (c99-setting): searching the setting in the Settings editor lists one boolean setting titled Remote.SSH: Enable Agent Forwarding, applying to all profiles, checked by default, with its description, on the User tab', async () => {
    await inWindow('local', 'workbench.action.openSettings', SETTING);
    try {
      await waitFor(
        'the setting on the Settings editor list',
        async () => (await settingRow('local')) !== undefined,
        30_000,
      );
      deepStrictEqual(
        {
          listed: await settingRow('local'),
          setByUser: (readUserSettings() ?? '').includes(SETTING),
        },
        {
          listed: {
            lines: [
              'Remote.SSH: Enable Agent Forwarding(Applies to all profiles)',
              "Enable fixing the remote environment so that the SSH config option ForwardAgent will take effect as expected from VS Code's remote extension host.",
            ],
            checked: true,
            section: 'User',
            count: 1,
          },
          setByUser: false,
        },
      );
    } finally {
      await inWindow('local', 'workbench.action.closeActiveEditor').catch(
        () => undefined,
      );
    }
  });
});
