import {deepStrictEqual} from 'node:assert';
import {pulledWithRetries} from '../tests/acceptance/windows/image-pull.ts';

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
      [await pulledWithRetries(world.pull, 3, world.pause), world.pauses],
      [1, []],
    );
  });

  it('#2525: a pull that fails twice and then succeeds takes three tries with a pause after each failure', async () => {
    const world = flaky(2);
    deepStrictEqual(
      [await pulledWithRetries(world.pull, 3, world.pause), world.pauses],
      [3, [1, 2]],
    );
  });

  it('#2525: a pull that fails every try throws the last try’s error, with no pause after it', async () => {
    const world = flaky(3);
    const thrown = await pulledWithRetries(world.pull, 3, world.pause).then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : 'other'),
    );
    deepStrictEqual(
      [thrown, world.pauses],
      ['502 Bad Gateway on try 3', [1, 2]],
    );
  });
});
