/**
 * @fileoverview What the rows of F-2406 (the manual local bootstrap of the server) share: the bootstrap folder the
 * product reads from the home of the editor's process, set aside while a row runs and put back after, the server archive
 * a row places in it, and the texts the product shows for this mode, as the spec gives them.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {onHost, variable} from './harness.ts';
import {DATA_FOLDER} from './maintenance.ts';

/** The folder the product reads the archive from: the editor of a launch runs with the test process's home. */
export const BOOTSTRAP_FOLDER = path.join(
  homedir(),
  'vscode-remote-ssh-bootstrap',
);

/** The archive the product expects in it. */
export const BOOTSTRAP_FILE = path.join(
  BOOTSTRAP_FOLDER,
  'vscode-server.tar.gz',
);

/** STR:S088, the warning that the mode is on, verbatim with its trailing quote. */
export const S088 =
  "Local download mode is configured as 'manual-bootstrap'. Exec server mode will be disabled.'";

/** STR:S087, the message of the hint of a bootstrap that failed, its spelling included. */
export const BOOTSTRAP_MESSAGE =
  'Local bootstrap of the VS Code Server failed. This is an advanced feature for use in environments with limited internet acccess.';

/** The six steps of the hint, in order: S016, S036, S040, S106, S051 and S124. */
export const BOOTSTRAP_MITIGATIONS: readonly string[] = [
  "Change value of setting remote.SSH.localServerDownload to 'auto'",
  'Disable remote.SSH.useExecServer',
  'Download the correct VS Code that corresponds both to your local installation and the remote architecture',
  'Place the VS Code Server in the bootstrap location specified in settings',
  "Ensure 'scp' operates between local and remote machines",
  'See output log for server installation URL',
];

/** The reason of the dialog when the archive is missing, for the host `alias`. */
export function missingReason(alias: string): string {
  return reason(alias, `Expected tarball at local path ${BOOTSTRAP_FILE}.`);
}

/** The reason of a failure dialog for the host `alias`: `Could not establish connection to "<alias>": <text>`. */
export function reason(alias: string, text: string): string {
  return `Could not establish connection to "${alias}": ${text}`;
}

/** The commit of the server the host holds: the one folder of `bin`, which an install makes; it fails when there is not exactly one. */
export async function installedCommit(): Promise<string> {
  const found = (
    await onHost('sh', '-c', `ls -A '${DATA_FOLDER}/bin' 2>/dev/null; true`)
  )
    .split('\n')
    .filter(line => line !== '');
  const [commit] = found;
  if (found.length !== 1 || commit === undefined) {
    throw new Error(
      `the host holds ${String(found.length)} install folders, not one: ${JSON.stringify(found)}`,
    );
  }
  return commit;
}

/** The install folder `bin/<commit>` of the server the host holds. */
export async function installFolder(): Promise<string> {
  return `${DATA_FOLDER}/bin/${await installedCommit()}`;
}

/** `text` with every space and bullet taken out, which the table's wrapping and list marks leave unlike the strings. */
export function compact(text: string): string {
  return text.replaceAll(/[\s•]/gu, '');
}

/**
 * Runs `body` with the bootstrap folder set aside: a folder of the developer's own is renamed first and put back after,
 * and whatever the rows placed is removed, so that nothing of either is lost or left behind.
 */
export async function withBootstrapFolderAside(
  body: () => Promise<void>,
): Promise<void> {
  const aside = `${BOOTSTRAP_FOLDER}.aside-${String(process.pid)}`;
  const hadFolder = existsSync(BOOTSTRAP_FOLDER);
  if (hadFolder) {
    renameSync(BOOTSTRAP_FOLDER, aside);
  }
  try {
    await body();
  } finally {
    if (existsSync(BOOTSTRAP_FILE)) {
      // A row that made the archive unreadable leaves a file the removal could not touch.
      chmodSync(BOOTSTRAP_FILE, 0o644);
    }
    rmSync(BOOTSTRAP_FOLDER, {recursive: true, force: true});
    if (hadFolder) {
      renameSync(aside, BOOTSTRAP_FOLDER);
    }
  }
}

/**
 * Places the run's server archive in the bootstrap folder: the body of the download host's `/ok/x`, which gives a path
 * that names no platform the run's Alpine server for this machine's architecture, as the host is Alpine. It fails naming the
 * status when the download host does not answer 200.
 */
export async function placeServerArchive(): Promise<void> {
  const response = await fetch(`${variable('HARNESS_DOWNLOADS_LOCAL')}/ok/x`);
  if (response.status !== 200) {
    throw new Error(
      `the download host answered ${String(response.status)} for the server archive of the bootstrap`,
    );
  }
  mkdirSync(BOOTSTRAP_FOLDER, {recursive: true});
  writeFileSync(BOOTSTRAP_FILE, Buffer.from(await response.arrayBuffer()));
}
