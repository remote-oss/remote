import {
  commandsOf,
  settingIn,
  variable,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
} from '../windows/harness.ts';
import path from 'node:path';
import {readStateDatabase} from '../windows/state-database.ts';
import {paletteItems} from '../windows/palette.ts';
import {closeQuietly, localWindowWithAi} from './support.ts';

/** The values of the chat keys that decide whether chat is enabled, as the application storage holds them. */
function valuesOf(): Record<string, string> {
  const rows = readStateDatabase(
    path.join(variable('HARNESS_USER_DATA'), 'User/globalStorage/state.vscdb'),
    database =>
      database
        .prepare(
          "SELECT key, value FROM ItemTable WHERE key IN ('chat.setupContext','workbench.panel.chat.hidden','chat.hasByokModels.lastKnown')",
        )
        .all() as Array<{key: string; value: string}>,
  );
  return Object.fromEntries(
    rows.map(row => [row.key, row.value.slice(0, 200)]),
  );
}

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
      let offValues: Record<string, string>;
      try {
        const items = (await paletteItems(off, 'SSH')).map(item => item.trim());
        offSeen = items.includes(SIDEBAR) ? 'Y' : `n${String(items.length)}`;
        offValues = valuesOf();
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
        let afterReload = 'not needed';
        if (!seen.includes('Y')) {
          await reloadWindow(window);
          const items = (await paletteItems(window, 'SSH')).map(item =>
            item.trim(),
          );
          afterReload = items.includes(SIDEBAR)
            ? 'Y'
            : `n${String(items.length)}`;
          if (afterReload !== 'Y') {
            await new Promise(resolve => setTimeout(resolve, 10_000));
            const later = (await paletteItems(window, 'SSH')).map(item =>
              item.trim(),
            );
            afterReload += later.includes(SIDEBAR) ? '+Y10s' : '+n10s';
          }
        }
        const registered = (
          await commandsOf(window, 'workbench.action.chat')
        ).filter(commandId =>
          /AgentSessionsSidebar|showAgentSessions/i.test(commandId),
        );
        lines.push(
          `#${String(attempt)} +${String(Date.now() - started)}ms off=${offSeen} on=${seen.join(',')} afterReload=${afterReload} setting=${JSON.stringify(await settingIn(window, 'chat.disableAIFeatures'))} sidebarCommandRegistered=${JSON.stringify(registered)} offValues=${JSON.stringify(offValues)} onValues=${JSON.stringify(valuesOf())}`,
        );
      } finally {
        await closeQuietly(window);
      }
    }
    restoreUserSettings(saved);
    throw new Error(`PROBE RESULT\n${lines.join('\n')}`);
  });
});
