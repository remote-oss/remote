import {deepStrictEqual} from 'node:assert';
import {pickedUp} from '../tests/acceptance/windows/late-pickup.ts';

/**
 * Runs `pickedUp` with a clock that each read advances by 20 s and a read that finds the change at read number
 * `foundAt` (never when it is 0) within `limitMilliseconds`, and returns what it gave back, how many reads it made, the notes and the lines said.
 */
async function waited(foundAt: number, limitMilliseconds = 90_000) {
  let now = 0;
  let reads = 0;
  const said: string[] = [];
  const notes: string[] = [];
  const found = await pickedUp(
    'the view',
    () => {
      reads += 1;
      now += 20_000;
      return Promise.resolve(reads === foundAt);
    },
    notes,
    {now: () => now, report: line => said.push(line), limitMilliseconds},
  );
  return {found, reads, notes, said};
}

describe('a read that waits for the editor to pick a change up (card #2861)', () => {
  it('#2861: a read that finds the change at once says nothing and adds no note', async () => {
    deepStrictEqual(await waited(1), {
      found: true,
      reads: 1,
      notes: [],
      said: [],
    });
  });

  it('#2861: a read that finds the change only after the first read gave up is a late pickup, with the seconds, in the output and the notes', async () => {
    deepStrictEqual(await waited(3), {
      found: true,
      reads: 3,
      notes: ['the view: late pickup after 60 s'],
      said: ['the view: late pickup after 60 s'],
    });
  });

  it('#2861: a read that never finds the change stops after 90 s and says it was never picked up', async () => {
    deepStrictEqual(await waited(0), {
      found: false,
      reads: 5,
      notes: ['the view: never picked up in 100 s'],
      said: ['the view: never picked up in 100 s'],
    });
  });

  it('#2861: with no time beyond the first read (a platform where the editor is on time) a change found at the second read is never picked up', async () => {
    deepStrictEqual(await waited(2, 0), {
      found: false,
      reads: 1,
      notes: ['the view: never picked up in 20 s'],
      said: ['the view: never picked up in 20 s'],
    });
  });
});
