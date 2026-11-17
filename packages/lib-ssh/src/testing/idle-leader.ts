/**
 * @fileoverview A process that leads a process group of its own and does nothing, for a row that ends groups: the row
 * signals the group of this process, never a group id written in the row.
 */

import {type ChildProcess, spawn} from 'node:child_process';

/** An idle process that leads its own group, and the promise of its exit. */
export function idleGroupLeader(): {
  leader: ChildProcess;
  exited: Promise<unknown>;
} {
  const leader = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => undefined, 30000)'],
    {detached: true, stdio: 'ignore'},
  );
  return {leader, exited: new Promise(resolve => leader.once('exit', resolve))};
}
