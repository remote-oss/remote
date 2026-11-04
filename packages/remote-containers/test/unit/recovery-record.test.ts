import {deepStrictEqual} from 'node:assert';
import {
  RECOVERY_VOLUMES_KEY,
  recordRecoveryPick,
  recoveryPicked,
} from '../../src/volumes/recovery-record.ts';

/** A memento over a map, whose updates are kept as they were written. */
function mementoOf(initial?: unknown): {
  get(key: string): unknown;
  update(key: string, value: unknown): Promise<void>;
  writes: unknown[];
} {
  const values = new Map<string, unknown>();
  if (initial !== undefined) {
    values.set(RECOVERY_VOLUMES_KEY, initial);
  }
  const writes: unknown[] = [];
  return {
    get: key => values.get(key),
    update: (key, value) => {
      values.set(key, value);
      writes.push(value);
      return Promise.resolve();
    },
    writes,
  };
}

describe('the recorded recovery picks (card containers-160, ruling-2162-recovery-gate)', () => {
  it('F-0410 AC-14: a volume is picked once the handler recorded it, and not before', async () => {
    const memento = mementoOf();
    const before = recoveryPicked(memento, 'vol-a');
    await recordRecoveryPick(memento, 'vol-a');
    deepStrictEqual(
      [
        before,
        recoveryPicked(memento, 'vol-a'),
        recoveryPicked(memento, 'vol-b'),
      ],
      [false, true, false],
    );
  });

  it('F-0410 AC-14: a volume already in the set is not written again, and a second one is added', async () => {
    const memento = mementoOf(['vol-a']);
    await recordRecoveryPick(memento, 'vol-a');
    await recordRecoveryPick(memento, 'vol-b');
    deepStrictEqual(memento.writes, [['vol-a', 'vol-b']]);
  });

  it('F-0410 AC-14: a stored value of another shape holds no name, and a name in a list with other values still counts', async () => {
    const odd = mementoOf('vol-a');
    const mixed = mementoOf(['vol-a', 3, null]);
    await recordRecoveryPick(odd, 'vol-b');
    deepStrictEqual(
      [
        recoveryPicked(odd, 'vol-a'),
        odd.writes,
        recoveryPicked(mixed, 'vol-a'),
      ],
      [false, [['vol-b']], true],
    );
  });
});
