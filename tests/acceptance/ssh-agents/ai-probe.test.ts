import {
  commandsOf,
  readUserSettings,
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
      const window = await localWindowWithAi(true);
      try {
        const registered = (
          await commandsOf(window, 'workbench.action.chat')
        ).filter(commandId => /ession/i.test(commandId));
        const seen: string[] = [];
        for (let read = 1; read <= 8; read += 1) {
          const items = (await paletteItems(window, 'Agent Sessions')).map(
            item => item.trim(),
          );
          seen.push(items.includes(SIDEBAR) ? 'Y' : `n${String(items.length)}`);
          if (items.includes(SIDEBAR)) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 5_000));
        }
        const sessionsCommands = (
          await commandsOf(window, 'workbench.action.chat')
        ).length;
        lines.push(
          `#${String(attempt)} +${String(Date.now() - started)}ms reads=${seen.join(',')} registeredSessionCommands=${JSON.stringify(registered)} chatCommands=${String(sessionsCommands)}`,
        );
      } finally {
        await closeQuietly(window);
      }
    }
    restoreUserSettings(saved);
    throw new Error(`PROBE RESULT\n${lines.join('\n')}`);
  });
});
