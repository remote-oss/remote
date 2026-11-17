import {deepStrictEqual, doesNotThrow} from 'node:assert';
import {EventEmitter} from 'node:events';
import {idleGroupLeader} from '../../src/testing/idle-leader.ts';
import {
  endProcessGroup,
  GROUP_GRACE_MILLISECONDS,
  type GroupSystem,
  killClientAlone,
  NODE_GROUP_SYSTEM,
  reapProcessGroup,
  treeKillerOver,
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

  it('#2664: the tree kill starts taskkill for the client, and ends the client alone only when taskkill cannot start', () => {
    const taskkill = new EventEmitter();
    const done: string[] = [];
    const killer = treeKillerOver(
      leader => {
        done.push(`taskkill ${String(leader)}`);
        return taskkill;
      },
      leader => {
        done.push(`alone ${String(leader)}`);
      },
    );
    killer(4321);
    const before = [...done];
    taskkill.emit('error', new Error('spawn taskkill ENOENT'));
    deepStrictEqual(
      [before, done],
      [['taskkill 4321'], ['taskkill 4321', 'alone 4321']],
    );
  });

  it('#2664: ending a client alone asks the system once, and a client that is gone is no failure', () => {
    const asked: number[] = [];
    killClientAlone(4321, processId => asked.push(processId));
    let failure: unknown = 'none';
    try {
      killClientAlone(4321, () => {
        throw new Error('no such process');
      });
    } catch (caught) {
      failure = caught;
    }
    deepStrictEqual([asked, failure], [[4321], 'none']);
  });

  it('#2664: the system’s tree kill ends a client of this row when taskkill cannot start, with no path to find it by', async function () {
    if (!NODE_GROUP_SYSTEM.posix) {
      this.skip();
    }
    const {leader, exited} = idleGroupLeader();
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      NODE_GROUP_SYSTEM.killTree(leader.pid ?? 0);
      await exited;
    } finally {
      process.env.PATH = path;
    }
    deepStrictEqual(leader.signalCode, 'SIGTERM');
  });
});
