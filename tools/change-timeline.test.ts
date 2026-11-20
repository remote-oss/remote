import {deepStrictEqual} from 'node:assert';
import {changeTimeline} from '../tests/acceptance/windows/change-timeline.ts';

/** A clock that each pause moves on by the pause, and the values a read gives in turn. */
function environmentOf() {
  let now = 1000;
  return {
    now: () => now,
    pause: (milliseconds: number) => {
      now += milliseconds;
      return Promise.resolve();
    },
  };
}

describe('the changes of a read taken over time (card #2753)', () => {
  it('#2753: only the reads that differ from the one before are kept, with their seconds from the start', async () => {
    const values = ['none', 'none', 'dialog', 'dialog', 'none'];
    let index = 0;
    const timeline = changeTimeline(
      () => Promise.resolve(values[index++] ?? 'none'),
      1000,
      250,
      1000,
      environmentOf(),
    );
    await timeline.finished;
    deepStrictEqual(timeline.lines(), [
      '[+0.00 s] none',
      '[+0.50 s] dialog',
      '[+1.00 s] none',
    ]);
  });

  it('#2753: a read that throws is kept as its text, once while it keeps throwing', async () => {
    const timeline = changeTimeline(
      () => Promise.reject(new Error('page gone')),
      1000,
      250,
      500,
      environmentOf(),
    );
    await timeline.finished;
    deepStrictEqual(timeline.lines(), [
      '[+0.00 s] (unreadable: Error: page gone)',
    ]);
  });

  it('#2753: stop ends the sampling before its time is up', async () => {
    let reads = 0;
    const timeline = changeTimeline(
      () => {
        reads += 1;
        return Promise.resolve(String(reads));
      },
      1000,
      250,
      60_000,
      environmentOf(),
    );
    await timeline.stop();
    deepStrictEqual(reads <= 1, true);
  });
});
