/**
 * @fileoverview The `wsl` launch's WSL distros on a Windows client. The job's installed `Ubuntu-24.04` (WSL 2, the
 * default) is used as it is. The run imports two distros of its own from a pinned
 * Alpine minirootfs, one at WSL 2 and one at WSL 1, named after the run so they never meet a user's distro, and
 * unregisters them when it ends; the clean-up unregisters the run's own that a killed run left.
 */

import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {checked, type CommandRunner} from './command-runner.ts';

/** A file the run downloads, pinned by its digest. */
export interface PinnedFile {
  readonly url: string;
  readonly sha256: string;
}

/** The minirootfs the run imports, as #2348's probe 43155251398 fetched and measured it. */
export const MINIROOTFS: PinnedFile = {
  url: 'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-minirootfs-3.24.4-x86_64.tar.gz',
  sha256: 'cdaa38cb8de3537967ee5b6c9b6cd00cc962da2b018e6eea48696bb274923012',
};

/** The distro the Windows job installs: WSL 2, and the default. */
export const INSTALLED_DISTRO = 'Ubuntu-24.04';

/** The start of every distro a run imports, which the clean-up sweeps. */
export const RUN_DISTRO_PREFIX = 'acceptance-';

/** The distros the `wsl` launch's rows use, by role; the rows read them from HARNESS_WSL_DISTROS. */
export interface WslDistros {
  readonly installed: string;
  readonly wsl2: string;
  readonly wsl1: string;
}

/** The run's distros, and the step that unregisters the two it imported. */
export interface RunWslDistros {
  readonly distros: WslDistros;
  unregister(): Promise<void>;
}

/** One line of `wsl.exe -l -v`: the distro's name, its WSL version and whether it is the default. */
export interface ListedDistro {
  readonly name: string;
  readonly version: string;
  readonly isDefault: boolean;
}

/** The distros of run `runId`: the installed one and the run's own two. */
export function runDistros(runId: string): WslDistros {
  return {
    installed: INSTALLED_DISTRO,
    wsl2: `${RUN_DISTRO_PREFIX}${runId}-wsl2`,
    wsl1: `${RUN_DISTRO_PREFIX}${runId}-wsl1`,
  };
}

/**
 * wsl.exe's own output as plain text. It writes UTF-16LE with no byte-order mark unless WSL_UTF8 is 1, and its lines
 * end in CR LF; read as UTF-8, a UTF-16LE text keeps a NUL after each ASCII character, so the NULs, a byte-order mark
 * and the CRs are dropped either way.
 */
export function wslText(output: string): string {
  return output
    .replaceAll('\u0000', '')
    .replaceAll('\uFEFF', '')
    .replaceAll('\r', '');
}

/** The distros `wsl.exe -l -v` lists, from its text after `wslText`; the header and blank lines are skipped. */
export function listedDistros(text: string): ListedDistro[] {
  return text
    .split('\n')
    .slice(1)
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => {
      const isDefault = line.startsWith('*');
      const [name = '', , version = ''] = line
        .replace(/^\*/u, '')
        .trim()
        .split(/\s+/u);
      return {name, version, isDefault};
    });
}

/** The listed distros a run imported: those whose name starts with `acceptance-`. */
export function staleDistros(listed: readonly ListedDistro[]): string[] {
  return listed
    .map(distro => distro.name)
    .filter(name => name.startsWith(RUN_DISTRO_PREFIX));
}

/** Throws unless `bytes` have the digest `pinned` names. */
export function checkPinned(bytes: Uint8Array, pinned: PinnedFile): void {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== pinned.sha256) {
    throw new Error(
      `${pinned.url} has sha256 ${digest}, not its pin ${pinned.sha256}`,
    );
  }
}

/**
 * Prepares the `wsl` launch's distros: refuses a client that is not Windows, downloads the `minirootfs` once through
 * `download` and checks its digest, and imports it under the run's two names at WSL 2 and WSL 1, into the run folder.
 * The unregister step it gives removes both and reports a failure without throwing, so the run's later stops and its
 * folder's removal still run.
 */
export async function prepareRunDistros(
  command: CommandRunner,
  platform: NodeJS.Platform,
  runFolder: string,
  runId: string,
  minirootfs: PinnedFile,
  download: (url: string) => Promise<Uint8Array>,
  report: (line: string) => void,
): Promise<RunWslDistros> {
  if (platform !== 'win32') {
    throw new Error(
      `the wsl launch needs a Windows client with WSL; this run's client is ${platform}`,
    );
  }
  const bytes = await download(minirootfs.url);
  checkPinned(bytes, minirootfs);
  const folder = path.join(runFolder, 'wsl');
  mkdirSync(folder, {recursive: true});
  const rootfs = path.join(folder, 'alpine-minirootfs.tar.gz');
  writeFileSync(rootfs, bytes);
  const distros = runDistros(runId);
  const imported: string[] = [];
  function unregister(): Promise<void> {
    for (const name of imported) {
      const result = command('wsl.exe', ['--unregister', name]);
      if (result.status !== 0) {
        report(
          `acceptance: wsl.exe --unregister ${name} failed (${String(result.status)}): ${wslText(result.stderr || result.stdout).trim()}`,
        );
      }
    }
    return Promise.resolve();
  }
  try {
    for (const [name, version] of [
      [distros.wsl2, '2'],
      [distros.wsl1, '1'],
    ] as const) {
      checked(command, 'wsl.exe', [
        '--import',
        name,
        path.join(folder, name),
        rootfs,
        '--version',
        version,
      ]);
      imported.push(name);
    }
  } catch (error) {
    await unregister();
    throw error;
  }
  return {distros, unregister};
}

/**
 * Unregisters the distros of run `runId` that the client still lists, which a killed run left, and names the
 * `acceptance-*` distros of other runs, which stay because another run on the machine may still use them; both go to
 * `report`. A client with no distro, or no WSL, lists none (wsl.exe fails), and another platform has none.
 */
export function sweepRunDistros(
  command: CommandRunner,
  platform: NodeJS.Platform,
  runId: string,
  report: (line: string) => void,
): string[] {
  if (platform !== 'win32') {
    return [];
  }
  const listing = command('wsl.exe', ['-l', '-v']);
  if (listing.status !== 0) {
    return [];
  }
  const own = `${RUN_DISTRO_PREFIX}${runId}-`;
  const stale = staleDistros(listedDistros(wslText(listing.stdout)));
  const unregistered = stale.filter(name => name.startsWith(own));
  for (const name of unregistered) {
    checked(command, 'wsl.exe', ['--unregister', name]);
    report(`acceptance: unregistered ${name}, a WSL distro this run left`);
  }
  const others = stale.filter(name => !name.startsWith(own));
  if (others.length > 0) {
    report(
      `acceptance: the WSL distros of other runs stay: ${others.join(', ')} (wsl.exe --unregister <name> removes one)`,
    );
  }
  return unregistered;
}
