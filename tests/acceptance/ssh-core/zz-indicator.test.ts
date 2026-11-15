import {
  appendScript,
  closeWindow,
  openWindow,
  recordLines,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {statusBarText} from '../windows/renderer.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';

const FAILURE = 'Could not establish connection';

describe('the remote indicator after the failure dialog (card #2537, throwaway measurement)', function () {
  this.timeout(900_000);

  beforeEach(closeAllButLocal);

  it('the time from the failure dialog to Disconnected, twelve windows', async () => {
    await keepingSettings(async () => {
      await userSettings({
        'remote.SSH.preferredLocalPortRange': '80-80',
        'remote.SSH.remotePlatform': {harness: 'linux'},
      });
      const results: unknown[] = [];
      for (let round = 0; round < 12; round += 1) {
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
        const samples: Array<[number, string]> = [];
        let disconnectedAfterMs = -1;
        for (let poll = 0; poll < 600 && disconnectedAfterMs < 0; poll += 1) {
          const text = await statusBarText(name, 'status.host');
          const offset = Date.now() - shown;
          samples.push([offset, text.slice(0, 1)]);
          if (text.startsWith('Disconnected')) {
            disconnectedAfterMs = offset;
          } else {
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        }
        results.push({
          round,
          firstSampleAfterDialogMs: samples[0]?.[0],
          firstSampleText: samples[0]?.[1],
          disconnectedSampledAfterDialogMs: disconnectedAfterMs,
          samples: samples.length,
        });
        await closeWindow(name);
      }
      process.stdout.write(`IND ${JSON.stringify(results)}\n`);
    });
  });
});
