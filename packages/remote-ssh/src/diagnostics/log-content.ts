/**
 * @fileoverview The lines one resolve writes to the extension's log: what was resolved, the settings, the ssh client
 * and its lines, the prompts without their answers, the remote output, the ports, the failure, the session summary and
 * the server output. The connection token is masked wherever it appears, and no answer is ever written.
 */

import type {ProbedHost} from 'lib-server';
import {logLinesOf} from 'lib-ssh';

interface WindowStart {
  editorVersion: string;
  extensionName: string;
  extensionVersion: string;
  platform: string;
  architecture: string;
  searchedFolders: string[];
  clientBanner: string;
}

type Summary =
  | {kind: 'none'}
  | {kind: 'disabled'}
  | {kind: 'issues'; issues: Array<{status: string; message: string}>};

/** Everything one resolve knows, as plain values. */
export interface ResolveRecord {
  authority: string;
  attempt: number;
  reconnection: boolean;
  level: 'debug' | 'trace';
  windowStart?: WindowStart;
  settings: Array<{name: string; value: string}>;
  sshStarted: boolean;
  sshLines: string[];
  prompts: Array<{text: string; answer?: string}>;
  connectionToken?: string;
  remoteOutput: string[];
  listeningPort?: number;
  resolvedPort?: number;
  failure?: string;
  summary: Summary;
  serverOutput: string[];
}

const RULE = '-'.repeat(40);

const SUMMARY_HEADING = `${'-'.repeat(10)} [Session Summary] ${'-'.repeat(10)}`;

const LINE_BREAK = /\r\n|\n|\r/;

/** The non-empty lines of the entries, each entry split at its line breaks. */
function linesOfEntries(entries: readonly string[]): string[] {
  return entries
    .flatMap(entry => entry.split(LINE_BREAK))
    .filter(part => part !== '');
}

/** `token` with every digit changed to `1` and every ASCII letter to `a`. */
function maskOf(token: string): string {
  return token.replace(/\d/g, '1').replace(/[A-Za-z]/g, 'a');
}

/** Each line of `lines` after `prefix`, with the connection token masked. */
function prefixed(
  prefix: string,
  lines: readonly string[],
  token: string | undefined,
): string[] {
  return lines.map(line => `${prefix}${masked(line, token)}`);
}

function masked(text: string, token: string | undefined): string {
  return token === undefined || token === ''
    ? text
    : text.replaceAll(token, () => maskOf(token));
}

/** `text` with the token masked and each line break made one space. */
function onOneLine(text: string, token: string | undefined): string {
  return masked(text, token).replaceAll(new RegExp(LINE_BREAK, 'g'), ' ');
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

function windowLines(start: WindowStart): string[] {
  return [
    `VS Code version: ${start.editorVersion}`,
    `Extension: ${start.extensionName} ${start.extensionVersion}`,
    `Platform: ${start.platform} ${start.architecture}`,
    ...searchedLines(start.searchedFolders),
    bannerLine(start.clientBanner),
  ];
}

function summaryLines(summary: Summary, token: string | undefined): string[] {
  if (summary.kind === 'none') {
    return ['No hints found in the recent session.'];
  }
  if (summary.kind === 'disabled') {
    return ['Enhanced session logs are disabled.'];
  }
  return [
    SUMMARY_HEADING,
    ...summary.issues.map(
      issue => `[${issue.status}]: ${onOneLine(issue.message, token)}`,
    ),
    RULE,
  ];
}

/** The lines the resolve writes to the log, in order, without times. */
export function resolveLogLines(record: ResolveRecord): string[] {
  const token = record.connectionToken;
  const start = record.windowStart;
  const resolving = `Resolving ssh-remote+${record.authority}, attempt ${String(record.attempt)}`;
  const sshLines =
    record.level === 'trace'
      ? linesOfEntries(record.sshLines)
      : logLinesOf(linesOfEntries(record.sshLines));
  return [
    ...(start === undefined ? [] : [`Log level: ${record.level}`]),
    record.reconnection ? `${resolving}, reconnection` : resolving,
    ...prefixed(
      'remote.SSH.',
      record.settings.map(setting => `${setting.name} = ${setting.value}`),
      token,
    ),
    ...(start === undefined ? [] : windowLines(start)),
    ...(record.sshStarted ? ['Started ssh'] : []),
    ...prefixed('[ssh] ', sshLines, token),
    ...record.prompts.flatMap(prompt => [
      `Prompt: ${masked(prompt.text, token)}`,
      prompt.answer === undefined ? 'Answer: (none)' : 'Answer: ***',
    ]),
    ...prefixed('[remote] ', linesOfEntries(record.remoteOutput), token),
    ...(record.listeningPort === undefined
      ? []
      : [`Remote server listening on port ${String(record.listeningPort)}`]),
    ...(record.resolvedPort === undefined
      ? []
      : [
          `Resolved ssh-remote+${record.authority} to local port ${String(record.resolvedPort)}`,
        ]),
    ...(record.failure === undefined
      ? []
      : [`Resolution failed: ${onOneLine(record.failure, token)}`]),
    RULE,
    '',
    '',
    '',
    '',
    ...summaryLines(record.summary, token),
    ...prefixed('[server] ', linesOfEntries(record.serverOutput), token),
  ];
}
