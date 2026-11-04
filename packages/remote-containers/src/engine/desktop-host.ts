/**
 * @fileoverview Docker Desktop on this host over `child_process`, with no shell: whether it is installed, whether its
 * process is listed, how it is started in the background, and the waits between the re-checks. The programs and paths
 * come from the table of `docker-desktop.ts` alone.
 */

import {execFile, spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {type DesktopData, desktopDataOf} from './docker-desktop.ts';
import type {DesktopPorts} from './check-and-start.ts';

/** The ports of `platform`'s Docker Desktop; none for a host with no automatic start. */
export function desktopPortsOf(platform: string): DesktopPorts | undefined {
  const data = desktopDataOf(platform);
  return data === undefined ? undefined : desktopPortsOver(data);
}

/** The ports over `data`'s programs and paths. */
export function desktopPortsOver(data: DesktopData): DesktopPorts {
  return {
    data,
    installed: () =>
      access(data.application).then(
        () => true,
        () => false,
      ),
    running: () =>
      new Promise(resolve => {
        execFile(
          data.listing.program,
          [...data.listing.args],
          {windowsHide: true},
          (error, stdout) => {
            resolve(
              error === null && stdout.includes(data.listing.processName),
            );
          },
        );
      }),
    start: () =>
      new Promise(resolve => {
        const child = spawn(data.start.program, [...data.start.args], {
          shell: false,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        // A program that cannot be started is no failure of the step: the re-checks run anyway.
        child.once('error', () => {
          resolve();
        });
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      }),
    wait: (milliseconds, cancellation) =>
      new Promise(resolve => {
        const timer = setTimeout(resolve, milliseconds);
        cancellation.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          {once: true},
        );
      }),
    now: Date.now,
  };
}
