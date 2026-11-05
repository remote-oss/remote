import {deepStrictEqual} from 'node:assert';
import {
  recordRecoveryPick,
  recoveryPicked,
} from '../../src/volumes/recovery-record.ts';
import {mementoOf} from './memento.fixture.ts';

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
    const stranger = mementoOf('vol-a');
    const mixed = mementoOf(['vol-a', 3, null]);
    await recordRecoveryPick(stranger, 'vol-b');
    deepStrictEqual(
      [
        recoveryPicked(stranger, 'vol-a'),
        stranger.writes,
        recoveryPicked(mixed, 'vol-a'),
      ],
      [false, [['vol-b']], true],
    );
  });
});
