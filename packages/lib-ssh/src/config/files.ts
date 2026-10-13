/**
 * @fileoverview Which configuration files are in effect, and the port through which the library reads them.
 */

import path from 'node:path';
import type {ClientPlatform} from './platform.ts';

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
 * A path with a leading `~/` (or `~\` on Windows), or a lone `~`, with the home folder in place of the `~`, joined
 * with the platform's separator; any other path unchanged.
 */
export function expandHome(
  file: string,
  homeFolder: string,
  platform: ClientPlatform,
): string {
  if (file === '~') {
    return homeFolder;
  }
  const windows = platform === 'windows';
  if (file.startsWith('~/') || (windows && file.startsWith('~\\'))) {
    return `${homeFolder}${windows ? '\\' : '/'}${file.slice(2)}`;
  }
  return file;
}

/** What `remote.SSH.configFile` names: no file, an absolute file, or an invalid value. */
export type ConfigFileSetting =
  | {kind: 'unset'} // ''
  | {kind: 'file'; path: string} // absolute after `~` expansion
  | {kind: 'invalid'; value: string}; // anything else, `value` as written

/** The one check of the setting's value, shared by every reader of it. */
export function configFilePath(
  value: string,
  homeFolder: string,
  platform: ClientPlatform,
): ConfigFileSetting {
  if (value === '') {
    return {kind: 'unset'};
  }
  const expanded = expandHome(value, homeFolder, platform);
  if (pathsFor(platform).isAbsolute(expanded)) {
    return {kind: 'file', path: expanded};
  }
  return {kind: 'invalid', value};
}

/**
 * The files in effect, in reading order: the one configured file when the setting names a file, the user file and
 * the system file when it is unset, and nothing when its value is neither.
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
  const setting = configFilePath(
    configFile,
    locations.homeFolder,
    locations.platform,
  );
  if (setting.kind === 'file') {
    const file = setting.path;
    return [
      {
        file,
        role: 'configured',
        includeBase: paths.dirname(file),
        exists: exists(file),
      },
    ];
  }
  if (setting.kind === 'invalid') {
    return [];
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
