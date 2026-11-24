import {deepStrictEqual} from 'node:assert';
import {
  mismatchReport,
  READ_AGAIN_SECONDS,
  REPORTED_ROWS,
  type ReportedRow,
} from '../tests/acceptance/containers-ports/mismatch-report.ts';

function noPause(): Promise<void> {
  return Promise.resolve();
}

function rowsOf(count: number): ReportedRow[] {
  return Array.from(Array(count).keys(), index => ({
    port: String(index),
    forwardedAddress: `localhost:${String(index)}`,
    origin: 'Auto Forwarded',
  }));
}

describe('the report of a mismatch of the Ports readout (card #2980)', () => {
  it('#2980: a mismatch gives its text, the rows and the status text of each later read', async () => {
    let read = 0;
    deepStrictEqual(
      await mismatchReport(
        'it differed',
        rowsOf(1),
        () => Promise.resolve(`Forwarded Ports: ${String((read += 1))}`),
        noPause,
      ),
      `it differed\nthe Ports rows at the read: [["0","localhost:0","Auto Forwarded"]]\nthe status text over the next ${String(READ_AGAIN_SECONDS)} s: ${JSON.stringify(
        Array.from(
          Array(READ_AGAIN_SECONDS).keys(),
          index => `Forwarded Ports: ${String(index + 1)}`,
        ),
      )}`,
    );
  });

  it('#2980: a status read that fails shows as unreadable and the report still gives the mismatch', async () => {
    const report = await mismatchReport(
      'it differed',
      [],
      () => Promise.reject(new Error('no item')),
      noPause,
    );
    deepStrictEqual(
      report.split('\n')[2],
      `the status text over the next ${String(READ_AGAIN_SECONDS)} s: ${JSON.stringify(Array<string>(READ_AGAIN_SECONDS).fill('(unreadable: Error: no item)'))}`,
    );
  });

  it('#2980: more rows than the cap list the cap and count the rest', async () => {
    const report = await mismatchReport(
      'it differed',
      rowsOf(REPORTED_ROWS + 3),
      () => Promise.resolve(''),
      noPause,
    );
    deepStrictEqual(
      [
        (
          JSON.parse(
            report.split('\n')[1]?.split(': ')[1]?.split(' and ')[0] ?? 'null',
          ) as unknown[]
        ).length,
        report.split('\n')[1]?.endsWith(' and 3 more'),
      ],
      [REPORTED_ROWS, true],
    );
  });

  it('#2980: the pause comes before each of the reads', async () => {
    const order: string[] = [];
    await mismatchReport(
      'it differed',
      [],
      () => Promise.resolve(order.push('read')).then(() => ''),
      () => Promise.resolve(order.push('pause')).then(() => undefined),
    );
    deepStrictEqual(
      order,
      Array.from({length: READ_AGAIN_SECONDS}, () => ['pause', 'read']).flat(),
    );
  });
});
