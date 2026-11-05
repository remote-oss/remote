/**
 * @fileoverview D3, the path mapper's process half: a Windows path on a distro's share is read without a process
 * (`shareToDistro`), and a path on a drive is asked of `wslpath -u` in the target distro, which honours that distro's
 * automount root.
 */

import {parseWslpathOutput, shareToDistro} from './share-path.ts';
import type {RunFailed, WslRunner} from './runner.ts';

/** A Windows path as a path in a distro. */
export interface DistroPath {
  distro: string;
  linuxPath: string;
}

/** A path that cannot be translated: `wslpath` printed nothing usable, or failed. */
export interface NotTranslatable {
  kind: 'notTranslatable';
  detail: string;
}

/** The mapper of Windows paths to paths in a distro. */
export interface PathMapper {
  /** The distro and Linux path of `windowsPath`; a drive path is asked of `wslpath -u` in `distro`. */
  toDistro(
    windowsPath: string,
    distro: string,
    cancellation: AbortSignal,
  ): Promise<
    {kind: 'mapped'; mapped: DistroPath} | NotTranslatable | RunFailed
  >;
}

/** The mapper over `runner`. */
export function createPathMapper(runner: WslRunner): PathMapper {
  return {
    toDistro: async (windowsPath, distro, cancellation) => {
      const share = shareToDistro(windowsPath);
      if (share.kind === 'share') {
        return {
          kind: 'mapped',
          mapped: {distro: share.distro, linuxPath: share.linuxPath},
        };
      }
      let printed = '';
      const outcome = await runner.exec(
        {
          distro,
          folder: '~',
          program: 'wslpath',
          programArguments: ['-u', windowsPath],
          environment: {},
          input: {kind: 'none'},
          cancellation,
        },
        line => {
          printed += `${line}\n`;
        },
      );
      if (outcome.kind === 'failed') {
        return outcome;
      }
      const path = parseWslpathOutput(printed);
      return outcome.status === 0 && path.kind === 'path'
        ? {kind: 'mapped', mapped: {distro, linuxPath: path.path}}
        : {
            kind: 'notTranslatable',
            detail: `wslpath -u gave status ${String(outcome.status)} for ${windowsPath}`,
          };
    },
  };
}
