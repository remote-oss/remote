/**
 * @fileoverview D3, the path mapper's process half: a Windows path on a distro's share is read without a process
 * (`shareToDistro`), and a path on a drive is asked of `wslpath -u` in the target distro, which honours that distro's
 * automount root.
 */

import {posix} from 'node:path';
import {
  distroToShare,
  parseWslpathOutput,
  shareToDistro,
  translatableWindowsPath,
} from './share-path.ts';
import type {RunFailed, WslRunner} from './runner.ts';
import type {ShareHost} from './windows-build.ts';

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
  /**
   * The Windows path of `linuxPath` in `distro`, which starts with `/`: a drive path as `wslpath -w` prints it, and a
   * path on the share rebuilt from `distro`, `linuxPath` and `shareHost`, never from what `wslpath` printed.
   */
  toWindows(
    distro: string,
    linuxPath: string,
    shareHost: ShareHost,
    cancellation: AbortSignal,
  ): Promise<
    {kind: 'mapped'; windowsPath: string} | NotTranslatable | RunFailed
  >;
}

const DRIVE_FORM = /^[A-Za-z]:\\/;

const SHARE_FORM = /^\\\\(?:wsl\.localhost|wsl\$)\\/i;

/** The mapper over `runner`. */
export function createPathMapper(runner: WslRunner): PathMapper {
  /** The one line `wslpath` printed for `programArguments` in `distro`, or why there is none. */
  async function questionOf(
    distro: string,
    option: '-u' | '-w',
    path: string,
    cancellation: AbortSignal,
  ): Promise<{kind: 'line'; line: string} | NotTranslatable | RunFailed> {
    let printed = '';
    const outcome = await runner.exec(
      {
        distro,
        folder: '~',
        program: 'wslpath',
        programArguments: [option, '--', path],
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
    const line = parseWslpathOutput(printed);
    return outcome.status === 0 && line.kind === 'path'
      ? {kind: 'line', line: line.path}
      : {
          kind: 'notTranslatable',
          detail: `wslpath ${option} gave status ${String(outcome.status)} for ${path}`,
        };
  }

  return {
    toDistro: async (windowsPath, distro, cancellation) => {
      const share = shareToDistro(windowsPath);
      if (share.kind === 'share') {
        return {
          kind: 'mapped',
          mapped: {distro: share.distro, linuxPath: share.linuxPath},
        };
      }
      if (translatableWindowsPath(windowsPath) !== 'drive') {
        return {
          kind: 'notTranslatable',
          detail: `${windowsPath} is neither a drive path nor a path on a distro's share`,
        };
      }
      const answer = await questionOf(distro, '-u', windowsPath, cancellation);
      if (answer.kind !== 'line') {
        return answer;
      }
      return answer.line.startsWith('/')
        ? {kind: 'mapped', mapped: {distro, linuxPath: answer.line}}
        : {
            kind: 'notTranslatable',
            detail: `wslpath -u printed no Linux path for ${windowsPath}`,
          };
    },
    toWindows: async (distro, linuxPath, shareHost, cancellation) => {
      if (!linuxPath.startsWith('/')) {
        return {
          kind: 'notTranslatable',
          detail: `${linuxPath} is not an absolute Linux path`,
        };
      }
      const answer = await questionOf(distro, '-w', linuxPath, cancellation);
      if (answer.kind !== 'line') {
        return answer;
      }
      if (SHARE_FORM.test(answer.line)) {
        return {
          kind: 'mapped',
          windowsPath: distroToShare(
            distro,
            posix.normalize(linuxPath),
            shareHost,
          ),
        };
      }
      return DRIVE_FORM.test(answer.line) && !/\p{Cc}/u.test(answer.line)
        ? {kind: 'mapped', windowsPath: answer.line}
        : {
            kind: 'notTranslatable',
            detail: `wslpath -w printed no Windows path for ${linuxPath}`,
          };
    },
  };
}
