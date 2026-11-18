/**
 * @fileoverview What a row sees of the host's lock files while a window installs: the install folders of the server's data
 * folder and every file named `remote-lock.*` in them and in `/tmp`, looked at once a second until the window has
 * connected, and once more after. The pattern holds both names a lock may have (`remote-lock.` and `vscode-remote-lock.`),
 * so a row that expects no lock cannot pass for want of the right name.
 */

import {DATA_FOLDER} from '../windows/maintenance.ts';
import {onHost} from '../windows/harness.ts';

/** One look at the host. */
export interface Look {
  /** The install folders `bin/<commit>` that exist, by name. */
  installs: string[];
  /** The files named `*remote-lock.*` in the install folders and in `/tmp`, as paths with the data folder cut off. */
  locks: string[];
}

/** The separator the listing's two parts are told apart by. */
const SEPARATOR = '--';

/** Looks once at the host. */
export async function lookAtHost(): Promise<Look> {
  const listing = await onHost(
    'sh',
    '-c',
    `ls -1 ${DATA_FOLDER}/bin 2>/dev/null; echo '${SEPARATOR}'; find ${DATA_FOLDER}/bin /tmp -maxdepth 2 -name '*remote-lock.*' 2>/dev/null; true`,
  );
  const [installs = '', locks = ''] = listing.split(`${SEPARATOR}\n`);
  return {
    installs: installs.split('\n').filter(line => line !== ''),
    locks: locks
      .split('\n')
      .filter(line => line !== '')
      .map(line => line.replace(DATA_FOLDER, '<data>')),
  };
}

/** Pauses for `milliseconds`. */
function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** What the looks of an install held. */
export interface Install {
  /** The looks taken while the window was not yet connected, one a second. */
  during: Look[];
  /** The look taken once it was. */
  after: Look;
}

/**
 * Looks at the host once a second until `connecting` settles, then once more. A `connecting` that fails fails the call,
 * after its looks have been taken.
 */
export async function lookedAtWhile(
  connecting: Promise<void>,
): Promise<Install> {
  const state = {settled: false};
  const outcome = connecting.finally(() => {
    state.settled = true;
  });
  const during: Look[] = [];
  while (!state.settled) {
    during.push(await lookAtHost());
    await Promise.race([pause(1000), outcome.catch(() => undefined)]);
  }
  await outcome;
  return {during, after: await lookAtHost()};
}
