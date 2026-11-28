/**
 * @fileoverview The processes of this machine as a contract harness sees them, for a channel whose scripts run here.
 * No bundle imports this module.
 */

import {spawnSync} from 'node:child_process';
import type {HostProcesses} from './channel-contract.ts';

/** Whether process `processId` runs: one that has ended and waits to be reaped counts as gone. */
function isRunning(processId: number): boolean {
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(processId)], {
    encoding: 'utf8',
  }).stdout.trim();
  return state !== '' && !state.startsWith('Z');
}

/** The processes of this machine. */
export const localProcesses: HostProcesses = {
  alive: processId => Promise.resolve(isRunning(processId)),
  end: processId => {
    process.kill(processId, 'SIGKILL');
    return Promise.resolve();
  },
};
