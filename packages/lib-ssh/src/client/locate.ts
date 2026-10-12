/**
 * @fileoverview Which `ssh` programs to try, in which order, and whether a program's version banner makes it
 * acceptable. Running the programs is the caller's: each candidate is run once with `-V` and judged here. Nothing
 * is remembered between lookups.
 */

import path from 'node:path';
import type {ClientPlatform} from '../config/platform.ts';
import {pathsFor} from '../config/files.ts';

/** A program to try and where it came from. */
export interface ClientCandidate {
  program: string;
  origin: 'setting' | 'path' | 'gitForWindows';
}

/** The word a banner must contain, in any letter case. */
const CLIENT_NAME = 'openssh';

/** The environment values the lookup depends on, each empty when unset. */
export interface ClientEnvironment {
  /** The program search path. */
  searchPath: string;
  /** The Windows `ProgramFiles` folder; unused on other platforms. */
  programFilesFolder: string;
}

/** Git for Windows' default place for its `ssh`, under the Program Files folder. */
const GIT_FOR_WINDOWS_SSH = ['Git', 'usr', 'bin', 'ssh.exe'];

/** The only argument a candidate is checked with. */
export const VERSION_ARGUMENTS: readonly string[] = ['-V'];

/**
 * The candidates in the order they are tried: the setting's value exactly as written when it is not empty, the
 * bare program name that the platform looks up on the search path when that is not empty, and on Windows Git for
 * Windows' default place when the Program Files folder is known.
 */
export function candidates(
  settingValue: string,
  environment: ClientEnvironment,
  platform: ClientPlatform,
): ClientCandidate[] {
  const list: ClientCandidate[] = [];
  if (settingValue !== '') {
    list.push({program: settingValue, origin: 'setting'});
  }
  if (environment.searchPath !== '') {
    list.push({
      program: platform === 'windows' ? 'ssh.exe' : 'ssh',
      origin: 'path',
    });
  }
  if (platform === 'windows' && environment.programFilesFolder !== '') {
    list.push({
      program: path.win32.join(
        environment.programFilesFolder,
        ...GIT_FOR_WINDOWS_SSH,
      ),
      origin: 'gitForWindows',
    });
  }
  return list;
}

/**
 * Whether a candidate's check accepts it: it started, exited with status 0 and printed a banner naming OpenSSH on
 * either stream. An empty banner names nothing and is rejected like any other. An exit status of undefined means
 * the program could not be started.
 */
export function judge(exitStatus: number | undefined, output: string): boolean {
  return exitStatus === 0 && output.toLowerCase().includes(CLIENT_NAME);
}

/** Where `scp` is looked for: beside a configured `ssh` given as a path, otherwise the bare name on PATH. */
export function scpProgram(
  accepted: ClientCandidate,
  platform: ClientPlatform,
): string {
  const paths = pathsFor(platform);
  const name = platform === 'windows' ? 'scp.exe' : 'scp';
  const folder = paths.dirname(accepted.program);
  if (accepted.origin === 'path' || folder === '.') {
    return name;
  }
  return paths.join(folder, name);
}
