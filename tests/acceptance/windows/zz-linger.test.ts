import {
  closeWindow,
  connectedWithin,
  onHost,
  connectionHelpers,
  connectionLog,
  openWindow,
  waitFor,
} from './harness.ts';
import {closeAllButLocal} from './maintenance.ts';

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function helperGone(): Promise<number> {
  const began = Date.now();
  while (Date.now() - began < 15_000) {
    if ((await connectionHelpers()).length === 0) {
      return Date.now();
    }
    await pause(20);
  }
  return -1;
}

describe('the local server’s exit after the last window closed, and a window opened right at it (card #2466, throwaway)', function () {
  this.timeout(2_400_000);

  beforeEach(closeAllButLocal);

  it('the exit delay, then a scan around it with the server killed after the close', async () => {
    const delays: number[] = [];
    for (let round = 0; round < 8; round += 1) {
      const name = `lg-m-${String(round)}`;
      await openWindow('harness', name);
      await connectedWithin(name, 90_000);
      await pause(2000);
      const closedAt = Date.now();
      await closeWindow(name);
      const gone = await helperGone();
      delays.push(gone < 0 ? -1 : gone - closedAt);
    }
    const sorted = delays.filter(each => each > 0).sort((a, b) => a - b);
    const middle = sorted[Math.floor(sorted.length / 2)] ?? 1800;
    const results: unknown[] = [];
    for (const repeat of [0, 1, 2]) {
      for (const step of [
        -120, -80, -40, -24, -12, -6, -3, 0, 3, 6, 12, 24, 40, 80, 120,
      ]) {
        const offset = Math.max(0, middle + step * 10 - 200);
        const first = `lg-a-${String(step)}-${String(repeat)}`;
        const second = `lg-b-${String(step)}-${String(repeat)}`;
        await openWindow('harness', first);
        await connectedWithin(first, 90_000);
        await pause(2000);
        const mark = connectionLog().length;
        const closedAt = Date.now();
        await closeWindow(first);
        await onHost(
          'pkill',
          '-u',
          'harness',
          '-f',
          '--',
          'server-main.js',
        ).catch(() => undefined);
        // closeWindow returns when the helper has ended too, so this offset counts from the return, not from the close.
        const returnedAt = Date.now();
        await pause(Math.max(0, offset - (returnedAt - closedAt)));
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
          step,
          repeat,
          offset,
          closeTook: returnedAt - closedAt,
          sinceClose: openedAt - closedAt,
          connected,
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
    process.stdout.write(
      `LINGER ${JSON.stringify({delays, middle, results})}\n`,
    );
  });
});
