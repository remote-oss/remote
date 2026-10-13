/**
 * @fileoverview acceptance-clients: the fake `ssh` clients of the client-search launches. Each is a POSIX `sh` script in
 * the run's folder that notes its own name and the kind of its call (a check with `-V`, the lookup of the host's options
 * with `-G`, or the connection) in one log, answers a check with its banner and status, and runs the real `ssh` for any
 * other call, so a connection through it works.
 */

import {chmodSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

/** The real client every fake hands its non-check calls to. */
const REAL_SSH = '/usr/bin/ssh';

/** The stream a fake prints its banner to. */
type Stream = 'stderr' | 'stdout';

/** One fake client: its place under `clients/`, what a check prints and where, how a check ends, and its file mode. */
export interface FakeClient {
  /** The folder under `clients/`; the program is `<folder>/ssh`. */
  folder: string;
  banner: string;
  stream: Stream;
  status: number;
  mode: number;
  /** What the log calls it when it differs from the folder. */
  loggedName?: string;
}

const OPENSSH_BANNER = 'OpenSSH_9.6p1, OpenSSL 3.0.13';

/** The fake clients. */
export const FAKE_CLIENTS: readonly FakeClient[] = [
  {
    folder: 'path',
    banner: OPENSSH_BANNER,
    stream: 'stderr',
    status: 0,
    mode: 0o755,
  },
  {
    folder: 'configured',
    banner: OPENSSH_BANNER,
    stream: 'stderr',
    status: 0,
    mode: 0o755,
  },
  {
    folder: 'with space',
    banner: OPENSSH_BANNER,
    stream: 'stderr',
    status: 0,
    mode: 0o755,
  },
  {
    folder: 'fails',
    banner: 'OpenSSH_9.6p1',
    stream: 'stderr',
    status: 1,
    mode: 0o755,
  },
  {
    folder: 'putty',
    banner: 'PuTTY Release 0.81',
    stream: 'stdout',
    status: 0,
    mode: 0o755,
  },
  {
    folder: 'lower',
    banner: 'openssh_9.0p1 lowercase fake',
    stream: 'stderr',
    status: 0,
    mode: 0o755,
  },
  {
    folder: 'stdout',
    banner: 'OpenSSH_9.0p1, fake on stdout',
    stream: 'stdout',
    status: 0,
    mode: 0o755,
  },
  {
    folder: 'old',
    banner: 'OpenSSH_6.5p1, OpenSSL 1.0.1 14 Mar 2012',
    stream: 'stderr',
    status: 0,
    mode: 0o755,
  },
  {
    folder: 'windows',
    banner: 'OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2',
    stream: 'stderr',
    status: 0,
    mode: 0o755,
  },
  {
    folder: 'notexec',
    banner: OPENSSH_BANNER,
    stream: 'stderr',
    status: 0,
    mode: 0o644,
  },
];

/** The folder the fakes live in. */
export function clientsFolder(runFolder: string): string {
  return path.join(runFolder, 'clients');
}

/** The log every fake appends to: one line for each call. */
export function callsLogOf(runFolder: string): string {
  return path.join(clientsFolder(runFolder), 'calls.log');
}

/** A text as one word of a POSIX shell. */
function quoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/** The script of a fake client. */
export function clientScript(client: FakeClient, callsLog: string): string {
  const name = client.loggedName ?? `${client.folder}/ssh`;
  const stream = client.stream === 'stderr' ? ' >&2' : '';
  return [
    '#!/bin/sh',
    'kind=connect',
    'for argument in "$@"; do',
    '  [ "$argument" = -G ] && kind=options',
    'done',
    '[ "${1:-}" = -V ] && kind=check',
    `printf '%s\\t%s\\n' ${quoted(name)} "$kind" >> ${quoted(callsLog)}`,
    'if [ "$kind" = check ]; then',
    `  printf '%s\\n' ${quoted(client.banner)}${stream}`,
    `  exit ${String(client.status)}`,
    'fi',
    `exec ${REAL_SSH} "$@"`,
    '',
  ].join('\n');
}

/** Writes the fakes into the run's folder, a directory named `adir` beside them, and an empty log. */
export function writeClients(runFolder: string): void {
  const clients = clientsFolder(runFolder);
  const callsLog = callsLogOf(runFolder);
  mkdirSync(path.join(clients, 'adir'), {recursive: true});
  for (const client of FAKE_CLIENTS) {
    const folder = path.join(clients, client.folder);
    mkdirSync(folder, {recursive: true});
    const file = path.join(folder, 'ssh');
    writeFileSync(file, clientScript(client, callsLog));
    chmodSync(file, client.mode);
  }
  writeFileSync(callsLog, '');
}

/**
 * Writes the copy of the configured client that `~/clients-copy/ssh` names, in the `home` folder of the run, logged as
 * `tilde/ssh`: it is never expected to run.
 */
export function writeTildeCopy(runFolder: string): void {
  const configured = FAKE_CLIENTS.find(
    client => client.folder === 'configured',
  );
  if (configured === undefined) {
    throw new Error('the configured fake client is missing');
  }
  const folder = path.join(runFolder, 'home', 'clients-copy');
  mkdirSync(folder, {recursive: true});
  const file = path.join(folder, 'ssh');
  writeFileSync(
    file,
    clientScript(
      {...configured, loggedName: 'tilde/ssh'},
      callsLogOf(runFolder),
    ),
  );
  chmodSync(file, 0o755);
}

/** Empties the log before a launch, so the launch finds only its own calls. */
export function clearCalls(runFolder: string): void {
  writeFileSync(callsLogOf(runFolder), '');
}
