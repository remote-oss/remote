/**
 * @fileoverview Ending what a client process started: on POSIX the client leads a process group, which gets SIGTERM and,
 * two seconds later, SIGKILL; on Windows the client's process tree is ended with `taskkill /T /F`.
 */

import {spawn} from 'node:child_process';
import {sep} from 'node:path';

/** How long a process group has to end on SIGTERM before it gets SIGKILL. */
export const GROUP_GRACE_MILLISECONDS = 2000;

/** What ending a group does to the system, which a row replaces. */
export interface GroupSystem {
  /** Whether a client leads a process group of its own, which only a POSIX system has. */
  posix: boolean;
  /** Sends `signal` to the group `leader` leads; a group that is gone is no failure. */
  signalGroup(leader: number, signal: 'SIGTERM' | 'SIGKILL'): void;
  /** Ends the process tree of `leader` and all it started. */
  killTree(leader: number): void;
  /** Runs `action` after `milliseconds` without keeping the process alive. */
  later(action: () => void, milliseconds: number): void;
}

/** The system of this Node.js process; the path separator tells the platform. */
export const NODE_GROUP_SYSTEM: GroupSystem = {
  posix: sep === '/',
  signalGroup: (leader, signal) => {
    try {
      process.kill(-leader, signal);
    } catch {
      // The group is already gone.
    }
  },
  killTree: leader => {
    spawn('taskkill', ['/pid', String(leader), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }).once('error', () => undefined);
  },
  later: (action, milliseconds) => {
    setTimeout(action, milliseconds).unref();
  },
};

/** Ends every process `leader` started: its group, which is what a client's own children (ProxyCommand, ProxyJump) are in. */
export function endProcessGroup(
  leader: number | undefined,
  system: GroupSystem = NODE_GROUP_SYSTEM,
): void {
  if (leader === undefined) {
    return;
  }
  if (!system.posix) {
    system.killTree(leader);
    return;
  }
  system.signalGroup(leader, 'SIGTERM');
  system.later(() => {
    system.signalGroup(leader, 'SIGKILL');
  }, GROUP_GRACE_MILLISECONDS);
}
