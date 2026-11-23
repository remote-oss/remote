import {deepStrictEqual} from 'node:assert';
import {
  pulledWithRetries,
  retryablePull,
} from '../tests/acceptance/windows/image-pull.ts';

/** A pull that fails its first `failures` tries with the try's number, and the pauses it was given. */
function flaky(failures: number): {
  pull: () => Promise<void>;
  pause: () => Promise<void>;
  pauses: number[];
} {
  let tries = 0;
  const pauses: number[] = [];
  return {
    pull: () => {
      tries += 1;
      return tries <= failures
        ? Promise.reject(new Error(`502 Bad Gateway on try ${String(tries)}`))
        : Promise.resolve();
    },
    pause: () => {
      pauses.push(tries);
      return Promise.resolve();
    },
    pauses,
  };
}

describe('an image pull that tries again (card #2525)', () => {
  it('#2525: a pull that succeeds at once takes one try and no pause', async () => {
    const world = flaky(0);
    deepStrictEqual(
      [
        await pulledWithRetries(world.pull, 3, world.pause, retryablePull),
        world.pauses,
      ],
      [1, []],
    );
  });

  it('#2525: a pull that fails twice and then succeeds takes three tries with a pause after each failure', async () => {
    const world = flaky(2);
    deepStrictEqual(
      [
        await pulledWithRetries(world.pull, 3, world.pause, retryablePull),
        world.pauses,
      ],
      [3, [1, 2]],
    );
  });

  it('#2525: a pull that fails every try throws the last try’s error, with no pause after it', async () => {
    const world = flaky(3);
    const thrown = await pulledWithRetries(
      world.pull,
      3,
      world.pause,
      retryablePull,
    ).then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : 'other'),
    );
    deepStrictEqual(
      [thrown, world.pauses],
      ['502 Bad Gateway on try 3', [1, 2]],
    );
  });

  it('#2530: a failure the registry will give again, an unknown image, fails at its first try with no pause', async () => {
    const pauses: number[] = [];
    let tries = 0;
    const thrown = await pulledWithRetries(
      () => {
        tries += 1;
        return Promise.reject(new Error('manifest unknown'));
      },
      3,
      () => {
        pauses.push(tries);
        return Promise.resolve();
      },
      retryablePull,
    ).then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : 'other'),
    );
    deepStrictEqual([thrown, tries, pauses], ['manifest unknown', 1, []]);
  });

  it('#2530: a 5xx, a gateway timeout and a dropped connection are worth another try; an unknown image, a refused login and a thrown string are not', () => {
    deepStrictEqual(
      [
        new Error('unexpected status code …: 502 Bad Gateway'),
        new Error('received unexpected HTTP status: 503 Service Unavailable'),
        new Error('Gateway Timeout'),
        new Error('read tcp 10.0.0.2:443: read: connection reset by peer'),
        new Error('manifest unknown: manifest unknown'),
        new Error('unauthorized: authentication required'),
        'a string',
      ].map(error => retryablePull(error)),
      [true, true, true, true, false, false, false],
    );
  });
});
