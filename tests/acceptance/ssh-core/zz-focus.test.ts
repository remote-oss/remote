import {
  closeWindow,
  openWindow,
  recordLines,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  editorHasFocus,
  outputChannelOf,
  outputPanelFocused,
} from '../windows/renderer.ts';

describe('the focus after the log reveal of a failed connect (card #2537, throwaway measurement)', function () {
  this.timeout(900_000);

  beforeEach(closeAllButLocal);

  it('six refused windows: the channel, and whether the panel or an editor holds the focus', async () => {
    const results: unknown[] = [];
    for (let round = 0; round < 6; round += 1) {
      const name = `focus-${String(round)}`;
      await openWindow('refused', name);
      await waitFor(
        `the failure dialog of ${name}`,
        () => recordLines('failureDialog', name).length > 0,
        300_000,
      );
      const channel = await waitFor(
        `the panel of ${name}`,
        async () => (await outputChannelOf(name)) === 'Remote - SSH',
        60_000,
      ).then(
        () => 'Remote - SSH',
        () => 'not shown in 60 s',
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      results.push({
        round,
        channel,
        panelFocused: await outputPanelFocused(name),
        editorFocused: await editorHasFocus(name),
      });
      await closeWindow(name).catch(() => undefined);
    }
    process.stdout.write(`FOCUS ${JSON.stringify(results)}\n`);
  });
});
