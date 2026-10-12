/**
 * @fileoverview The path forms of a distro's share: a Windows path on the share as a Linux path in the distro, a Linux
 * path as a path on the share, the shape of a Windows drive under `/mnt`, and the output of `wslpath`. Nothing here
 * starts a process.
 */

/** A Windows path that is on a distro's share, or is not. */
export type ShareResult =
  | {
      readonly kind: 'share';
      readonly distro: string;
      readonly linuxPath: string;
    }
  | {readonly kind: 'notShare'};

/** The path `wslpath` printed, or why nothing can be used. */
export type WslpathResult =
  {readonly kind: 'path'; readonly path: string} | {readonly kind: 'unusable'};

const SHARE_PREFIX = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)/i;

const MOUNT_PATTERN = /^\/mnt\/[a-z]\/./;

const NOT_SHARE: ShareResult = {kind: 'notShare'};

/** The distro and the Linux path of a Windows path on a distro's share; `notShare` for any other path. */
export function shareToDistro(windowsPath: string): ShareResult {
  const match = SHARE_PREFIX.exec(windowsPath);
  if (match === null) {
    return NOT_SHARE;
  }
  const prefix = match[0];
  const rest = windowsPath.slice(prefix.length).replace(/^\\/, '');
  return {
    kind: 'share',
    distro: prefix.slice(prefix.lastIndexOf('\\') + 1),
    linuxPath: `/${rest.replaceAll('\\', '/')}`,
  };
}

/** The path on the share of `distro` for the Linux path `linuxPath`, which starts with `/`. */
export function distroToShare(distro: string, linuxPath: string): string {
  return `\\\\wsl.localhost\\${distro}${linuxPath.replaceAll('/', '\\')}`;
}

/** Whether a Linux path is under the mount of a Windows drive: `/mnt/`, a lower-case letter, `/` and more. */
export function isWindowsMountShape(linuxPath: string): boolean {
  return MOUNT_PATTERN.test(linuxPath);
}

/** The path in the output of `wslpath`, without its one line end; `unusable` when it is empty or has more lines. */
export function parseWslpathOutput(text: string): WslpathResult {
  const path = text.replace(/\r?\n$/, '');
  return path === '' || path.includes('\n')
    ? {kind: 'unusable'}
    : {kind: 'path', path};
}
