import {
  commandsOf,
  settingIn,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
} from '../windows/harness.ts';
import {paletteItems} from '../windows/palette.ts';
import {closeQuietly, localWindowWithAi} from './support.ts';

const SIDEBAR = 'Chat Agent Sessions: Show Agent Sessions Sidebar';

describe('probe: AI-on palette (card #2520)', function () {
  this.timeout(1_800_000);

  it('probe: the AI-on palette over many new windows', async () => {
    const saved = readUserSettings();
    const lines: string[] = [];
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const started = Date.now();
      const off = await localWindowWithAi(false);
      let offSeen: string;
      try {
        const items = (await paletteItems(off, 'SSH')).map(item => item.trim());
        offSeen = items.includes(SIDEBAR) ? 'Y' : `n${String(items.length)}`;
      } finally {
        await closeQuietly(off);
      }
      const window = await localWindowWithAi(true);
      try {
        const seen: string[] = [];
        for (let read = 1; read <= 3; read += 1) {
          const items = (await paletteItems(window, 'SSH')).map(item =>
            item.trim(),
          );
          seen.push(items.includes(SIDEBAR) ? 'Y' : `n${String(items.length)}`);
          if (items.includes(SIDEBAR)) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 5_000));
        }
        const registered = (
          await commandsOf(window, 'workbench.action.chat')
        ).filter(commandId =>
          /AgentSessionsSidebar|showAgentSessions/i.test(commandId),
        );
        lines.push(
          `#${String(attempt)} +${String(Date.now() - started)}ms off=${offSeen} on=${seen.join(',')} afterReload=${afterReload} setting=${JSON.stringify(await settingIn(window, 'chat.disableAIFeatures'))} sidebarCommandRegistered=${JSON.stringify(registered)}`,
        );
      } finally {
        await closeQuietly(window);
      }
    }
    restoreUserSettings(saved);
    throw new Error(`PROBE RESULT\n${lines.join('\n')}`);
  });
});
