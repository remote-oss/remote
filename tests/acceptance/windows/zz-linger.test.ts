import {
  closeWindow,
  connectedWithin,
  connectionHelpers,
  connectionLog,
  onHost,
  openWindow,
  waitFor,
} from './harness.ts';
import {closeAllButLocal, DATA_FOLDER} from './maintenance.ts';

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('a window opened 0.2 to 1.7 s after the last one closed, with the server ended and its folder removed in between (card #2466, throwaway)', function () {
  this.timeout(2_400_000);

  beforeEach(closeAllButLocal);

  it('the sweep', async () => {
    const results: unknown[] = [];
    for (const repeat of [0, 1, 2]) {
      for (let wait = 0; wait <= 1500; wait += 100) {
        const first = `lg-a-${String(wait)}-${String(repeat)}`;
        const second = `lg-b-${String(wait)}-${String(repeat)}`;
        await openWindow('harness', first);
        await connectedWithin(first, 120_000);
        await pause(2000);
        const closedAt = Date.now();
        await closeWindow(first);
        const returnedAt = Date.now();
        await pause(wait);
        const mark = connectionLog().length;
        await onHost(
          'sh',
          '-c',
          `pkill -u harness -f 'server-mai[n].js'; rm -rf '${DATA_FOLDER}/bin'; true`,
        ).catch(() => undefined);
        const openedAt = Date.now();
        await openWindow('harness', second);
        let connected = false;
        try {
          await connectedWithin(second, 90_000);
          connected = true;
        } catch {
          connected = false;
        }
        const lines = connectionLog().slice(mark);
        results.push({
          wait,
          repeat,
          closeTook: returnedAt - closedAt,
          sinceReturn: openedAt - returnedAt,
          connectTook: Date.now() - openedAt,
          connected,
          exits: lines.filter(line =>
            line.includes('the connection helper exits'),
          ).length,
          gone: lines.filter(line => line.includes('the helper is gone'))
            .length,
          failed: lines
            .filter(
              line =>
                line.includes('connect failed') ||
                line.includes('channelClosed'),
            )
            .map(line => line.slice(0, 120)),
        });
        await closeWindow(second).catch(() => undefined);
        await waitFor(
          'the helper to be gone',
          async () => (await connectionHelpers()).length === 0,
          30_000,
        ).catch(() => undefined);
      }
    }
    process.stdout.write(`LINGER ${JSON.stringify({results})}\n`);
  });
});
