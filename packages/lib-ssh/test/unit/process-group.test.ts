import {deepStrictEqual, doesNotThrow} from 'node:assert';
import {idleGroupLeader} from '../../src/testing/idle-leader.ts';
import {
  endProcessGroup,
  GROUP_GRACE_MILLISECONDS,
  type GroupSystem,
  NODE_GROUP_SYSTEM,
  reapProcessGroup,
} from '../../src/process/process-group.ts';

/** A system that records what was done to it, and runs what was scheduled when asked. */
function recording(posix: boolean) {
  const done: string[] = [];
  const scheduled: Array<{action: () => void; milliseconds: number}> = [];
  const system: GroupSystem = {
    posix,
    signalGroup: (leader, signal) => done.push(`${signal} -${String(leader)}`),
    killTree: leader => done.push(`tree ${String(leader)}`),
    later: (action, milliseconds) => scheduled.push({action, milliseconds}),
  };
  return {system, done, scheduled};
}

describe('ending a process group', () => {
  it('#2664: on POSIX the group gets SIGTERM, and SIGKILL after the grace', () => {
    const made = recording(true);
    endProcessGroup(4321, made.system);
    made.scheduled[0]?.action();
    deepStrictEqual(
      [made.done, made.scheduled.map(entry => entry.milliseconds)],
      [['SIGTERM -4321', 'SIGKILL -4321'], [GROUP_GRACE_MILLISECONDS]],
    );
  });

  it('#2664: on Windows the process tree is ended, and nothing is scheduled', () => {
    const made = recording(false);
    endProcessGroup(4321, made.system);
    deepStrictEqual([made.done, made.scheduled.length], [['tree 4321'], 0]);
  });

  it('#2664: a process that never started has no group to end', () => {
    const made = recording(true);
    endProcessGroup(undefined, made.system);
    deepStrictEqual([made.done, made.scheduled.length], [[], 0]);
  });

  it('#2664: signalling a group that is gone is no failure; the group signalled is the one of a process this row started', async function () {
    if (!NODE_GROUP_SYSTEM.posix) {
      this.skip();
    }
    // Only the group of a process of this row is ever signalled, never a group id written in the row.
    const {leader, exited} = idleGroupLeader();
    NODE_GROUP_SYSTEM.signalGroup(leader.pid ?? 0, 'SIGTERM');
    await exited;
    doesNotThrow(() => {
      NODE_GROUP_SYSTEM.signalGroup(leader.pid ?? 0, 'SIGTERM');
    });
  });

  it('#2664: the real scheduler does not keep the process alive', () => {
    doesNotThrow(() => {
      NODE_GROUP_SYSTEM.later(() => undefined, 60_000);
    });
  });

  it('#2664: after the client exited, the group of a POSIX client is ended as when it is killed', () => {
    const made = recording(true);
    reapProcessGroup(4321, made.system);
    made.scheduled[0]?.action();
    deepStrictEqual(made.done, ['SIGTERM -4321', 'SIGKILL -4321']);
  });

  it('#2664: after the client exited, a Windows client’s process id is left alone, as another process may hold it now', () => {
    const made = recording(false);
    reapProcessGroup(4321, made.system);
    deepStrictEqual([made.done, made.scheduled.length], [[], 0]);
  });
});
