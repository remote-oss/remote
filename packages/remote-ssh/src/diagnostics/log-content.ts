/**
 * @fileoverview The lines a resolve writes to the extension's log, as builders: what was resolved, the ports it ended
 * on, the ssh client search, the probed platform and the server's result. The connection token is masked wherever it
 * appears, and no answer is ever written.
 */

import path from 'node:path';
import type {ProbedHost, ResultBlock} from 'lib-server';

/** `token` with every digit changed to `1` and every ASCII letter to `a`. */
export function maskOf(token: string): string {
  return token.replace(/\d/g, '1').replace(/[A-Za-z]/g, 'a');
}

/** `text` with every occurrence of the connection token masked; the text as it is when there is no token. */
export function masked(text: string, token: string | undefined): string {
  return token === undefined || token === ''
    ? text
    : text.replaceAll(token, () => maskOf(token));
}

/** The line that opens a resolve: the authority, the attempt, and the word `reconnection` when it is one. */
export function resolverLine(
  authority: string,
  attempt: number,
  reconnection: boolean,
): string {
  const resolving = `Resolving ssh-remote+${authority}, attempt ${String(attempt)}`;
  return reconnection ? `${resolving}, reconnection` : resolving;
}

/** The port the remote server listens on, once the connect knows it. */
export function listeningLine(port: number): string {
  return `Remote server listening on port ${String(port)}`;
}

/** The local port the resolve ended on. */
export function resolvedLine(authority: string, port: number): string {
  return `Resolved ssh-remote+${authority} to local port ${String(port)}`;
}

/** The configuration file `ssh` is given with `-F`, as `remote.SSH.configFile` names it once `~` is expanded. */
export function configFileLine(file: string): string {
  return `SSH configuration file in use: ${file}`;
}

/** The value of `remote.SSH.path` as the log shows it: JSON text, `""` when it is unset. */
export function pathSettingLine(value: string): string {
  return `remote.SSH.path = ${JSON.stringify(value)}`;
}

/** A candidate of the client search is about to be checked. */
export function checkingLine(program: string): string {
  return `Checking ssh client: ${program}`;
}

/** The banner a check printed, or `(no banner)` when it printed none. */
export function bannerLine(banner: string): string {
  return `ssh client: ${banner}`;
}

/** A check rejected the candidate, and why. */
export function rejectedLine(program: string, reason: string): string {
  return `ssh client ${program} was rejected: ${reason}`;
}

/** The setting named a program that was rejected. */
export function notValidLine(value: string): string {
  return `remote.SSH.path "${value}" is not a valid SSH binary`;
}

/** The folders of the search path, one line each, in order. */
export function searchedLines(folders: readonly string[]): string[] {
  return folders.map(folder => `Searched for ssh in: ${folder}`);
}

/** The candidate that was accepted. */
export function usingLine(program: string): string {
  return `Using ssh client: ${program}`;
}

/** The platform the probe found on the host. */
export function hostPlatformLine(
  host: Pick<ProbedHost, 'operatingSystem' | 'architecture'>,
): string {
  return `Host platform: ${host.operatingSystem} ${host.architecture}`;
}

/** The login shell the probe found on the host, by its path and its name; none when the host reported none. */
export function loginShellLine(
  host: Pick<ProbedHost, 'loginShell'>,
): string | undefined {
  return host.loginShell === ''
    ? undefined
    : `the host's login shell is ${host.loginShell} (${path.posix.basename(host.loginShell)})`;
}

/**
 * The one line a parsed result block gives the log: its status, then the server's port, the host's system and
 * architecture, and the download and install times, each only when the block has it. No other fact is logged, so none
 * of the host's environment values reach the log.
 */
export function serverResultLine(block: ResultBlock): string {
  const parts = [
    block.status,
    ...(block.serverFacts.port === undefined
      ? []
      : [`port ${block.serverFacts.port}`]),
    ...(block.hostFacts.os === undefined ? [] : [`os ${block.hostFacts.os}`]),
    ...(block.hostFacts.arch === undefined
      ? []
      : [`architecture ${block.hostFacts.arch}`]),
    ...(block.timings.download === undefined
      ? []
      : [`download ${String(block.timings.download)} ms`]),
    ...(block.timings.install === undefined
      ? []
      : [`install ${String(block.timings.install)} ms`]),
  ];
  return `Server result: ${parts.join(', ')}`;
}
