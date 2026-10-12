/**
 * @fileoverview The lines one resolve writes to the extension's log: what was resolved, the settings, the ssh client
 * and its lines, the prompts without their answers, the remote output, the ports, the failure, the session summary and
 * the server output. The connection token is masked wherever it appears, and no answer is ever written.
 */

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
  prompts: Array<{text: string; answer: string}>;
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

function windowLines(start: WindowStart): string[] {
  return [
    `VS Code version: ${start.editorVersion}`,
    `Extension: ${start.extensionName} ${start.extensionVersion}`,
    `Platform: ${start.platform} ${start.architecture}`,
    ...start.searchedFolders.map(folder => `Searched for ssh in: ${folder}`),
    `ssh client: ${start.clientBanner}`,
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
      issue => `[${issue.status}]: ${masked(issue.message, token)}`,
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
    record.level === 'trace' ? record.sshLines : logLinesOf(record.sshLines);
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
      'Answer: ***',
    ]),
    ...prefixed('[remote] ', record.remoteOutput, token),
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
      : [`Resolution failed: ${masked(record.failure, token)}`]),
    RULE,
    '',
    '',
    '',
    '',
    ...summaryLines(record.summary, token),
    ...prefixed('[server] ', record.serverOutput, token),
  ];
}
