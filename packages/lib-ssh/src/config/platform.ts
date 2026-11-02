/**
 * @fileoverview The client platform, named here because its file locations and path separators differ from the
 * host's, and both the configuration model and the argument builder need it.
 */

/** The client platform whose file locations and path separators differ. */
export type ClientPlatform = 'linux' | 'macOS' | 'windows';

/** The client platform of a Node platform: Linux for every one that is neither macOS nor Windows. */
export function clientPlatformOf(platform: string): ClientPlatform {
  if (platform === 'darwin') {
    return 'macOS';
  }
  return platform === 'win32' ? 'windows' : 'linux';
}
