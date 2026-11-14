/**
 * @fileoverview Remote - SSH beside core's own SSH agent hosts, with AI features on (F-2008 AC-2). It is the first file
 * of the launch on purpose: in VSCodium 1.140.0 a window with AI features on offers the sessions command in every
 * window opened before an AI-off window of the launch, and in only some of those opened after one (card #2520).
 */

import {deepStrictEqual} from 'node:assert';
import {readUserSettings, restoreUserSettings} from '../windows/harness.ts';
import {paletteItems} from '../windows/palette.ts';
import {
  AGENT_HOST_TITLES,
  closeQuietly,
  localWindowWithAi,
  paletteItemsWith,
  titlesOf,
} from './support.ts';

/** The sidebar command core adds for the sessions when AI features are on. */
const SESSIONS = 'Chat Agent Sessions: Show Agent Sessions Sidebar';

describe('the palette with AI features on beside core’s SSH agent hosts (card #2500, F-2008)', function () {
  this.timeout(300_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
  });

  after(() => {
    restoreUserSettings(saved);
  });

  it('F-2008 AC-2 (c2500-palette-on): with AI features on, the "SSH" list is the AI-off list of the launch’s first window plus the agent sessions sidebar, with no agent-host title', async () => {
    const offList = titlesOf(await paletteItems('local', 'SSH'));
    const window = await localWindowWithAi(true);
    let onList: string[];
    try {
      onList = titlesOf(await paletteItemsWith(window, 'SSH', [SESSIONS]));
    } finally {
      await closeQuietly(window);
    }
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
});
