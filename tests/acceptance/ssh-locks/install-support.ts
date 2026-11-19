/**
 * @fileoverview What the lock rows share: the lock entries as the listing shows them, and an install of a fresh host in
 * legacy mode from the run's slow source, looked at once a second, with the settings a row names.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  onHost,
  openWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {
  dismissals,
  freshHost,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';
import {type Install, lookedAtWhile} from './lock-listing.ts';

/** The install lock in the install folder: 0 bytes, one name. */
export const INSTALL_LOCK =
  '<data>/bin/<commit>/vscode-remote-lock.harness.<commit>|0|1';

/** The install lock in `/tmp`: 0 bytes, one name. */
export const TEMPORARY_LOCK = '/tmp/vscode-remote-lock.harness.<commit>|0|1';

/** The two names `ln` gives the lock: 0 bytes, link count 2. */
export const LINKED_LOCKS = [
  '<data>/bin/<commit>/vscode-remote-lock.harness.<commit>.target|0|2',
  '<data>/bin/<commit>/vscode-remote-lock.harness.<commit>|0|2',
];

/** How many looks an install must have been seen through for the row to have watched it: the slow source lasts a minute. */
const LEAST_LOOKS = 10;

/** The distinct lock entries of `looks`, the commit written as `<commit>`, in order. */
export function distinctLocks(
  looks: ReadonlyArray<{locks: string[]}>,
): string[] {
  return [
    ...new Set(
      looks.flatMap(look =>
        look.locks.map(lock => lock.replaceAll(/[0-9a-f]{40}/gu, '<commit>')),
      ),
    ),
  ].toSorted();
}

/**
 * Installs on a fresh host in the window `name` with `settings` in legacy mode and gives the looks of the install; `body`
 * runs with the window still open, and the window is closed after it.
 */
export async function installedWith<Result>(
  name: string,
  settings: Readonly<Record<string, unknown>>,
  body: (install: Install) => Promise<Result>,
): Promise<Result> {
  const saved = readUserSettings();
  try {
    await freshHost();
    await onHost('sh', '-c', 'rm -f /tmp/*remote-lock.*');
    await userSettings({
      ...PLATFORMS,
      'remote.SSH.serverDownloadUrlTemplate': `${variable('HARNESS_DOWNLOADS_HTTP')}/slow/\${os}-\${arch}/\${commit}`,
      'remote.SSH.useExecServer': false,
      ...settings,
    });
    appendScript(dismissals(name));
    const install = await lookedAtWhile(
      (async () => {
        await openWindow('harness', name);
        await connectedWithin(name, INSTALL_MILLISECONDS);
      })(),
    );
    deepStrictEqual(
      install.during.length >= LEAST_LOOKS,
      true,
      `the install of ${name} was looked at ${String(install.during.length)} times, fewer than ${String(LEAST_LOOKS)}`,
    );
    return await body(install);
  } finally {
    await closeWindow(name).catch(() => undefined);
    restoreUserSettings(saved);
  }
}
