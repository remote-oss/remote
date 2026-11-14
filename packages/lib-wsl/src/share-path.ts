/**
 * @fileoverview The path forms of a distro's share: a Windows path on the share as a Linux path in the distro, a Linux
 * path as a path on the share, the shape of a Windows drive under `/mnt`, and the output of `wslpath`. Nothing here
 * starts a process.
 */

import {validDistroName} from './distro-name.ts';
import type {ShareHost} from './windows-build.ts';

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

const DRIVE_PREFIX = /^[A-Za-z]:[\\/]/;

const MOUNT_PATTERN = /^\/mnt\/[a-z]\/./;

const NOT_SHARE: ShareResult = {kind: 'notShare'};

/** The distro and the Linux path of a Windows path on a distro's share; `notShare` for any other path. */
export function shareToDistro(windowsPath: string): ShareResult {
  const match = SHARE_PREFIX.exec(windowsPath);
  if (match === null) {
    return NOT_SHARE;
  }
  const prefix = match[0];
  const distro = prefix.slice(prefix.lastIndexOf('\\') + 1);
  if (!validDistroName(distro)) {
    return NOT_SHARE;
  }
  const rest = windowsPath.slice(prefix.length).replace(/^\\/, '');
  return {
    kind: 'share',
    distro,
    linuxPath: `/${rest.replaceAll('\\', '/')}`,
  };
}

/** The path on the share of `distro` at `shareHost` for the Linux path `linuxPath`, which starts with `/`. */
export function distroToShare(
  distro: string,
  linuxPath: string,
  shareHost: ShareHost,
): string {
  return `\\\\${shareHost}\\${distro}${linuxPath.replaceAll('/', '\\')}`;
}

/** What a Windows path is for the translation: a drive path, a path on a distro's share, or neither. */
export function translatableWindowsPath(
  windowsPath: string,
): 'drive' | 'share' | 'other' {
  if (DRIVE_PREFIX.test(windowsPath)) {
    return 'drive';
  }
  return shareToDistro(windowsPath).kind === 'share' ? 'share' : 'other';
}

/** Whether a Linux path is under the mount of a Windows drive: `/mnt/`, a lower-case letter, `/` and more. */
export function isWindowsMountShape(linuxPath: string): boolean {
  return MOUNT_PATTERN.test(linuxPath);
}

/** The Windows path of a Linux path under a drive's mount: `/mnt/c/a/b` is `c:\a\b`; none for any other path. */
export function mountToWindows(linuxPath: string): string | undefined {
  return isWindowsMountShape(linuxPath)
    ? `${linuxPath.slice(5, 6)}:\\${linuxPath.slice(7).replaceAll('/', '\\')}`
    : undefined;
}

/** The path in the output of `wslpath`, without its one line end; `unusable` when it is empty or has more lines. */
export function parseWslpathOutput(text: string): WslpathResult {
  const path = text.replace(/\r?\n$/, '');
  return path === '' || path.includes('\n')
    ? {kind: 'unusable'}
    : {kind: 'path', path};
}
