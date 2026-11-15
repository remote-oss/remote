import {
  closeWindow,
  connectedWithin,
  connectionHelpers,
  connectionLog,
  openWindow,
  waitFor,
} from './harness.ts';
import {closeAllButLocal} from './maintenance.ts';

const OFFSETS = [
  0, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 7000,
];

describe('a window opened after the last one closed, at offsets around the local server’s exit (card #2466, throwaway)', function () {
  this.timeout(1_800_000);

  beforeEach(closeAllButLocal);

  it('each offset twice', async () => {
    const results: unknown[] = [];
    for (const repeat of [0, 1]) {
      for (const offset of OFFSETS) {
        const first = `lg-a-${String(offset)}-${String(repeat)}`;
        const second = `lg-b-${String(offset)}-${String(repeat)}`;
        await openWindow('harness', first);
        await connectedWithin(first, 90_000);
        await new Promise(resolve => setTimeout(resolve, 2000));
        const mark = connectionLog().length;
        const closedAt = Date.now();
        await closeWindow(first);
        await new Promise(resolve => setTimeout(resolve, offset));
        const openedAt = Date.now();
        await openWindow('harness', second);
        let connected = false;
        try {
          await connectedWithin(second, 45_000);
          connected = true;
        } catch {
          connected = false;
        }
        const lines = connectionLog().slice(mark);
        results.push({
          offset,
          repeat,
          connected,
          afterMs: Date.now() - openedAt,
          sinceClose: openedAt - closedAt,
          exits: lines.filter(line =>
            line.includes('the connection helper exits'),
          ).length,
          gone: lines.filter(line => line.includes('the helper is gone'))
            .length,
          failed: lines
            .filter(line => line.includes('connect failed'))
            .map(line => line.slice(0, 80)),
        });
        await closeWindow(second).catch(() => undefined);
        await waitFor(
          'the helper to be gone',
          async () => (await connectionHelpers()).length === 0,
          30_000,
        ).catch(() => undefined);
      }
    }
    process.stdout.write(`LINGER ${JSON.stringify(results)}\n`);
  });
});
