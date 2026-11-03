/**
 * @fileoverview The engine check an open command makes before it goes on, and the Docker program it passes: a relative
 * `dev.containers.dockerPath` is a file of the window's folder, which runs only once that folder is trusted.
 */

import {type Executable, executableOf} from '../engine/executable.ts';
import type {ReopenPorts} from './reopen-ports.ts';

/**
 * The Docker program the setting names, after the engine check passed with `base` (the window's folder, or none while it
 * is not trusted); none when the check stopped the command, whose own dialog has shown.
 */
export async function checkedProgramOf(
  ports: Pick<ReopenPorts, 'engine' | 'dialogs' | 'settings'>,
  base: string | undefined,
): Promise<string | undefined> {
  if ((await ports.engine.firstCheck(base, ports.dialogs)) === 'stopped') {
    return undefined;
  }
  // The passed check means the setting names a program, with the window's folder as base or none.
  return (
    executableOf(ports.settings.dockerPath(), base) as Extract<
      Executable,
      {kind: 'spawn'}
    >
  ).file;
}
