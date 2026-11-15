import {
  appendScript,
  closeWindow,
  openWindow,
  recordLines,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {statusItem} from '../windows/renderer.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';

const FAILURE = 'Could not establish connection';

describe('the remote indicator after the failure dialog (card #2537, throwaway measurement)', function () {
  this.timeout(900_000);

  beforeEach(closeAllButLocal);

  it('the time from the failure dialog to Disconnected, ten windows', async () => {
    await keepingSettings(async () => {
      await userSettings({
        'remote.SSH.preferredLocalPortRange': '80-80',
        'remote.SSH.remotePlatform': {harness: 'linux'},
      });
      const results: unknown[] = [];
      for (let round = 0; round < 10; round += 1) {
        const name = `ind-${String(round)}`;
        appendScript([
          {
            surface: 'failureDialog',
            match: FAILURE,
            answer: {button: 'More Actions...'},
            window: name,
          },
          {
            surface: 'mitigationPick',
            match: 'Pick an action',
            answer: 'dismiss',
            window: name,
          },
        ]);
        await openWindow('harness', name);
        await waitFor(
          `the dialog of ${name}`,
          () => recordLines('failureDialog', name).length >= 1,
          120_000,
        );
        const shown = recordLines('failureDialog', name)[0]?.time ?? 0;
        const first = (await statusItem(name, 'status.host')).text;
        const readAt = Date.now();
        let disconnectedAt = -1;
        for (let poll = 0; poll < 400 && disconnectedAt < 0; poll += 1) {
          const text = (await statusItem(name, 'status.host')).text;
          if (text.startsWith('Disconnected')) {
            disconnectedAt = Date.now();
          } else {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        results.push({
          round,
          firstRead: first,
          firstReadAfterDialogMs: readAt - shown,
          disconnectedAfterDialogMs:
            disconnectedAt < 0 ? 'never in 20 s' : disconnectedAt - shown,
        });
        await closeWindow(name);
      }
      process.stdout.write(`IND ${JSON.stringify(results)}\n`);
    });
  });
});
