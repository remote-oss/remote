/**
 * @fileoverview Remote - SSH beside core's own SSH agent hosts, in the Command Palette (F-2008 AC-1, AC-3 and AC-10): with AI features off and on, the palette holds no agent-host command of the reimplementation and none of
 * core's agent-host commands.
 */

import {deepStrictEqual} from 'node:assert';
import {
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from '../windows/harness.ts';
import {paletteItems, runFromPalette} from '../windows/palette.ts';
import {
  closeQuietly,
  localWindowWithAi,
  paletteItemsWith,
  pickerItems,
} from './support.ts';
import {
  answerDialogAt,
  pressEscape,
  waitForDialogElsewhere,
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

/** What an item of the list is: its label, without the keybinding or the source core adds. */
function titlesOf(items: readonly string[]): string[] {
  return items.map(item => item.trim());
}

describe('the palette beside core’s SSH agent hosts (card #2500, F-2008)', function () {
  this.timeout(300_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
  });

  after(() => {
    restoreUserSettings(saved);
  });

  /** The titles the palette lists for `text` in a new empty window that starts with AI features on or off. */
  async function listedIn(enabled: boolean, text: string): Promise<string[]> {
    const window = await localWindowWithAi(enabled);
    try {
      return titlesOf(await paletteItems(window, text));
    } finally {
      await closeQuietly(window);
    }
  }

  it('F-2008 AC-1 (c2500-palette-off): with AI features off, "SSH" lists only Remote-SSH commands and unrelated core items, and "Agents" finds no command', async () => {
    const sshList = await listedIn(false, 'SSH');
    const agents = await listedIn(false, 'Agents');
    deepStrictEqual(
      {
        agentHostTitles: sshList.filter(title =>
          AGENT_HOST_TITLES.some(banned => title.includes(banned)),
        ),
        agentMentions: sshList.filter(
          title => title.startsWith(CATEGORY) && /agent/i.test(title),
        ),
        agents,
        listed: sshList,
      },
      {
        agentHostTitles: [],
        agentMentions: [],
        agents: ['No matching commands'],
        listed: sshList,
      },
    );
  });

  it('F-2008 AC-3 (c2500-palette-window): in an SSH window with AI features on, the window commands are listed under Remote-SSH and no agent-host command is', async () => {
    await userSettings({'chat.disableAIFeatures': false});
    await openWindow('harness', 'f2008-palette');
    try {
      const wanted = [
        `${CATEGORY} Kill Current VS Code Server`,
        `${CATEGORY} New Window on Active Host`,
        `${CATEGORY} Provide Feedback`,
      ];
      const sshList = titlesOf(
        await paletteItemsWith('f2008-palette', 'SSH', wanted),
      );
      deepStrictEqual(
        {
          listed: wanted.filter(title => sshList.includes(title)),
          agentHostTitles: sshList.filter(title =>
            AGENT_HOST_TITLES.some(banned => title.includes(banned)),
          ),
        },
        {listed: wanted, agentHostTitles: []},
      );
    } finally {
      await closeQuietly('f2008-palette');
    }
  });

  it('F-2008 AC-10 (c2500-agents-window): after Chat: Open Agents Window shows "Sign in to use Agents", the Remote-SSH configuration file picker is the one measured before', async () => {
    const window = await localWindowWithAi(true);
    try {
      await runFromPalette(
        window,
        'Remote-SSH: Open SSH Configuration File...',
      );
      const before = await pickerItems(window);
      await pressEscape(window);
      await runFromPalette(window, 'Chat: Open Agents Window');
      const agents = await waitForDialogElsewhere(window);
      const answer = agents.dialog.buttons.includes('Cancel')
        ? 'Cancel'
        : (agents.dialog.buttons[0] ?? 'Cancel');
      await answerDialogAt(agents.address, answer);
      await runFromPalette(
        window,
        'Remote-SSH: Open SSH Configuration File...',
      );
      const after = await pickerItems(window);
      deepStrictEqual(
        {
          message: agents.dialog.message,
          buttons: agents.dialog.buttons,
          after,
        },
        {
          message: 'Sign in to use Agents',
          buttons: agents.dialog.buttons,
          after: before,
        },
      );
    } finally {
      await closeQuietly(window);
    }
  });
});
