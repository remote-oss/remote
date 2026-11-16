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
    const batch = 1;
    for (let repeat = batch * 20; repeat < batch * 20 + 20; repeat += 1) {
      for (let wait = 1400; wait <= 1800; wait += 100) {
        const first = `lg-a-${String(wait)}-${String(repeat)}`;
        const second = `lg-b-${String(wait)}-${String(repeat)}`;
        await openWindow('harness', first);
        await connectedWithin(first, 120_000);
        await pause(1000);
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
        const changes: string[] = [
          `${new Date().toISOString()} ${JSON.stringify(await connectionHelpers())}`,
        ];
        let last = changes[0]?.slice(25) ?? '';
        const sampling = {on: true};
        const sampler = (async () => {
          while (sampling.on) {
            await pause(25);
            const text = JSON.stringify(await connectionHelpers());
            if (text !== last) {
              last = text;
              changes.push(`${new Date().toISOString()} ${text}`);
            }
          }
        })();
        await openWindow('harness', second);
        let connected = false;
        try {
          await connectedWithin(second, 40_000);
          connected = true;
        } catch {
          connected = false;
        }
        sampling.on = false;
        await sampler;
        const lines = connectionLog().slice(mark);
        const stamped = connected
          ? []
          : connectionLog({withTimes: true}).slice(-50);
        const round = {
          wait,
          repeat,
          closeTook: returnedAt - closedAt,
          sinceReturn: openedAt - returnedAt,
          connectTook: Date.now() - openedAt,
          connected,
          exits: lines.filter(line =>
            line.includes('the connection helper exits'),
          ).length,
          tail: stamped,
          changes: connected ? [] : changes,
          gone: lines.filter(line => line.includes('the helper is gone'))
            .length,
          failed: lines
            .filter(
              line =>
                line.includes('connect failed') ||
                line.includes('channelClosed'),
            )
            .map(line => line.slice(0, 120)),
        };
        results.push(round);
        process.stdout.write(
          `ROUND ${JSON.stringify(connected && round.failed.length === 0 && round.gone === 0 ? {...round, tail: undefined, changes: undefined} : round)}\n`,
        );
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
