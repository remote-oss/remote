/**
 * @fileoverview Which engine host a command uses: the local one, or a WSL distro. One pure function,
 * read for every command, so a setting changed since the last one applies without a reload.
 */

import {isWindowsMountShape, mountToWindows, shareToDistro} from 'lib-wsl';

/** What the window is. */
export interface EngineWindow {
  /** The window's remote: `wsl` for a Remote - WSL window, otherwise another remote or none. */
  remoteName: string | undefined;
  /** The distro a `wsl+<d>` window names. */
  distro: string | undefined;
}

/** The three settings, each already read through its legacy twin. */
export interface EngineWslSettings {
  executeInWSL: boolean;
  /** The configured distro; empty when none is, which asks for WSL's default. */
  executeInWSLDistro: string;
}

/** Where a command's engine lives and which folder it acts on. */
export type EngineHostChoice =
  | {
      kind: 'local';
      /** The folder, a Windows folder when a `wsl` window's `/mnt/<drive>/` folder was handed off. */
      folder: string;
    }
  | {
      kind: 'distro';
      /** The registered name when it is known, else the typed one; none asks for WSL's default distro. */
      distro: string | undefined;
      /** The folder: in the distro for a share or a `wsl` window, the Windows folder for `executeInWSL`. */
      folder: string;
      /** What chose the distro: the folder's share, the `wsl` window, or the settings. */
      chosenBy: 'share' | 'window' | 'settings';
    };

/** The engine host for the folder in the window, under the settings, on the platform of the editor. */
export function engineHostOf(
  window: EngineWindow,
  folder: string,
  settings: EngineWslSettings,
  platform: NodeJS.Platform,
): EngineHostChoice {
  const local: EngineHostChoice = {kind: 'local', folder};
  if (platform !== 'win32') {
    return local;
  }
  const share = shareToDistro(folder);
  if (share.kind === 'share') {
    return {
      kind: 'distro',
      distro: share.distro,
      folder: share.linuxPath,
      chosenBy: 'share',
    };
  }
  if (window.remoteName === 'wsl' && window.distro !== undefined) {
    return isWindowsMountShape(folder)
      ? {kind: 'local', folder: mountToWindows(folder) ?? folder}
      : {
          kind: 'distro',
          distro: window.distro,
          folder,
          chosenBy: 'window',
        };
  }
  if (window.remoteName === undefined && settings.executeInWSL) {
    return {
      kind: 'distro',
      distro:
        settings.executeInWSLDistro === ''
          ? undefined
          : settings.executeInWSLDistro,
      folder,
      chosenBy: 'settings',
    };
  }
  return local;
}
