/**
 * @fileoverview Remote - SSH beside core's own SSH agent hosts, in the Command Palette (F-2008 AC-1, AC-2, AC-3 and
 * AC-10): with AI features off and on, the palette holds no agent-host command of the reimplementation and none of
 * core's agent-host commands.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  openWindow,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {paletteItems, runFromPalette} from '../windows/palette.ts';
import {
  answerDialog,
  quickPickOf,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';

/** The titles of core's agent-host commands, which the palette never lists for "SSH". */
const AGENT_HOST_TITLES = [
  'Connect to Remote Agent Host via SSH',
  'Add Remote Agent Host...',
  'Forget SSH Host Key',
  'Agents: Add New SSH Host...',
  'Agents: Configure SSH Hosts...',
];

/** The category the extension's commands show. */
const CATEGORY = 'Remote-SSH:';

/** The sidebar command core adds for the sessions when AI features are on. */
const SESSIONS = 'Chat Agent Sessions: Show Agent Sessions Sidebar';

/** What an item of the list is: its label, without the keybinding or the source core adds. */
function titlesOf(items: readonly string[]): string[] {
  return items.map(item => item.trim());
}

/** Switches the AI features of the local window with the setting `chat.disableAIFeatures` and reloads the window. */
async function switchAi(enabled: boolean): Promise<void> {
  await userSettings({'chat.disableAIFeatures': !enabled});
  await reloadWindow('local');
}

describe('the palette beside core’s SSH agent hosts (card #2500, F-2008)', function () {
  this.timeout(300_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
  });

  after(async () => {
    restoreUserSettings(saved);
    await reloadWindow('local');
  });

  it('F-2008 AC-1 (c2500-palette-off): with AI features off, "SSH" lists only Remote-SSH commands and unrelated core items, and "Agents" finds no command', async () => {
    await switchAi(false);
    const sshList = titlesOf(await paletteItems('local', 'SSH'));
    const agents = titlesOf(await paletteItems('local', 'Agents'));
    deepStrictEqual(
      {
        agentHostTitles: sshList.filter(title =>
          AGENT_HOST_TITLES.some(banned => title.includes(banned)),
        ),
        agentMentions: sshList.filter(
          title => title.startsWith(CATEGORY) && /agent/i.test(title),
        ),
        agents,
      },
      {
        agentHostTitles: [],
        agentMentions: [],
        agents: ['No matching commands'],
      },
    );
  });

  it('F-2008 AC-2 (c2500-palette-on): with AI features on, the "SSH" list is the AI-off list plus the agent sessions sidebar, with no agent-host title', async () => {
    await switchAi(false);
    const offList = titlesOf(await paletteItems('local', 'SSH'));
    await switchAi(true);
    const onList = titlesOf(await paletteItems('local', 'SSH'));
    deepStrictEqual(
      {
        added: onList.filter(title => !offList.includes(title)),
        removed: offList.filter(title => !onList.includes(title)),
        agentHostTitles: onList.filter(title =>
          AGENT_HOST_TITLES.some(banned => title.includes(banned)),
        ),
      },
      {added: [SESSIONS], removed: [], agentHostTitles: []},
    );
  });

  it('F-2008 AC-3 (c2500-palette-window): in an SSH window with AI features on, the window commands are listed under Remote-SSH and no agent-host command is', async () => {
    await switchAi(true);
    await openWindow('harness', 'f2008-palette');
    try {
      const sshList = titlesOf(await paletteItems('f2008-palette', 'SSH'));
      deepStrictEqual(
        {
          listed: [
            `${CATEGORY} Kill Current VS Code Server`,
            `${CATEGORY} New Window on Active Host`,
            `${CATEGORY} Provide Feedback`,
          ].filter(title => sshList.includes(title)),
          agentHostTitles: sshList.filter(title =>
            AGENT_HOST_TITLES.some(banned => title.includes(banned)),
          ),
        },
        {
          listed: [
            `${CATEGORY} Kill Current VS Code Server`,
            `${CATEGORY} New Window on Active Host`,
            `${CATEGORY} Provide Feedback`,
          ],
          agentHostTitles: [],
        },
      );
    } finally {
      await closeWindow('f2008-palette');
    }
  });

  it('F-2008 AC-10 (c2500-agents-window): after Chat: Open Agents Window shows "Sign in to use Agents", the Remote-SSH configuration file picker is the one measured before', async () => {
    await switchAi(true);
    await runFromPalette('local', 'Remote-SSH: Open SSH Configuration File...');
    await waitForQuickPick('local', 30_000);
    const before = (await quickPickOf('local'))?.items ?? [];
    await runFromPalette('local', 'Chat: Open Agents Window');
    const trust = await waitForDialog('local');
    await answerDialog('local', 'Cancel');
    await runFromPalette('local', 'Remote-SSH: Open SSH Configuration File...');
    await waitForQuickPick('local', 30_000);
    const after = (await quickPickOf('local'))?.items ?? [];
    deepStrictEqual(
      {trust: trust.message.length > 0, after},
      {trust: true, after: before},
    );
  });
});
