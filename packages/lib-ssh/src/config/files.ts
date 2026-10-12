/**
 * @fileoverview Which configuration files are in effect, and the port through which the library reads them.
 */

import path from 'node:path';
import type {ClientPlatform} from './platform.ts';
import {expandHome} from '../arguments/invocation.ts';

/** Read access to the client's files; the library never touches the file system itself. */
export interface ConfigFileReader {
  /** The text of a readable file; undefined for a missing, unreadable or non-file path. */
  readText(file: string): string | undefined;
  /** The entry names of a readable folder; undefined for anything else. */
  listFolder(folder: string): string[] | undefined;
}

/** Where the client's files are. */
export interface ClientLocations {
  homeFolder: string;
  platform: ClientPlatform;
  /** The Windows `ProgramData` folder; unused on other platforms. */
  programDataFolder?: string;
}

/** A file in effect: where it is, what it is, the folder its relative `Include` paths resolve against. */
export interface FileInEffect {
  file: string;
  role: 'user' | 'system' | 'configured';
  includeBase: string;
  exists: boolean;
}

/** The system file's place per platform family, relative to its root folder. */
const SYSTEM_FILES = {
  posix: '/etc/ssh/ssh_config',
  windowsUnderProgramData: ['ssh', 'ssh_config'],
} as const;

/** The Windows program-data folder, when the client names none. */
const WINDOWS_PROGRAM_DATA = 'C:\\ProgramData';

/** The path functions of a platform. */
export function pathsFor(platform: ClientPlatform): path.PlatformPath {
  return platform === 'windows' ? path.win32 : path.posix;
}

/**
 * The files in effect, in reading order: the one configured file when the setting holds anything, otherwise the
 * user file and then the system file. A configured `~` or `~/` path is expanded; any other form is used as written.
 */
export function filesInEffect(
  configFile: string,
  locations: ClientLocations,
  reader: ConfigFileReader,
): FileInEffect[] {
  const paths = pathsFor(locations.platform);
  function exists(file: string): boolean {
    return reader.readText(file) !== undefined;
  }
  if (configFile !== '') {
    const file = expandHome(
      configFile,
      locations.homeFolder,
      locations.platform,
    );
    return [
      {
        file,
        role: 'configured',
        includeBase: paths.dirname(file),
        exists: exists(file),
      },
    ];
  }
  const sshFolder = paths.join(locations.homeFolder, '.ssh');
  const userFile = paths.join(sshFolder, 'config');
  const systemFile =
    locations.platform === 'windows'
      ? paths.join(
          locations.programDataFolder ?? WINDOWS_PROGRAM_DATA,
          ...SYSTEM_FILES.windowsUnderProgramData,
        )
      : SYSTEM_FILES.posix;
  return [
    {
      file: userFile,
      role: 'user',
      includeBase: sshFolder,
      exists: exists(userFile),
    },
    {
      file: systemFile,
      role: 'system',
      includeBase: paths.dirname(systemFile),
      exists: exists(systemFile),
    },
  ];
}
