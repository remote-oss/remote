import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  isOpen,
  onHost,
  variable,
  windowNames,
} from '../windows/harness.ts';

/** The display name of Remote - SSH, as its manifest gives it. */
export const DISPLAY_NAME = (
  JSON.parse(
    readFileSync(
      path.join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'packages',
        'remote-ssh',
        'package.json',
      ),
      'utf8',
    ),
  ) as {displayName: string}
).displayName;

/** The setting that names where the server comes from. */
export const TEMPLATE_SETTING = 'remote.SSH.serverDownloadUrlTemplate';

/** The dialog of a host whose editor names no server source (§5a `noServerSource`): {0} is the client's application name. */
export function noServerSourceText(applicationName: string): string {
  return `${DISPLAY_NAME} knows no download location for the server of ${applicationName}. Set ${TEMPLATE_SETTING} to a URL template for this editor's server builds.`;
}

/** Closes every window but the local one, then removes the host's VS Code server and the folders the rows made. */
export async function freshHost(): Promise<void> {
  for (const name of windowNames()) {
    if (name !== 'local' && isOpen(name)) {
      await closeWindow(name);
    }
  }
  await onHost(
    'sh',
    '-c',
    'rm -rf /home/harness/.vscode-server /home/harness/genuine-*',
  );
}

/** The lines of the log in the variable `logVariable`, or none before the file exists. */
function linesOf(logVariable: string): string[] {
  try {
    return readFileSync(variable(logVariable), 'utf8')
      .split('\n')
      .filter(line => line !== '');
  } catch {
    return [];
  }
}

/** The number of lines each of the download host's two logs holds now: the requests, then the TLS handshakes. */
export function logMarks(): {requests: number; handshakes: number} {
  return {
    requests: linesOf('HARNESS_DOWNLOADS_LOG').length,
    handshakes: linesOf('HARNESS_DOWNLOADS_TLS_LOG').length,
  };
}

/** The requests the download host logged after the first `mark` of them. */
export function requestsSince(mark: number): string[] {
  return linesOf('HARNESS_DOWNLOADS_LOG').slice(mark);
}

/** The TLS handshakes the download host logged after the first `mark` of them. */
export function tlsNamesSince(mark: number): string[] {
  return linesOf('HARNESS_DOWNLOADS_TLS_LOG').slice(mark);
}

/** The names in the harness user's home folder on the host, hidden ones included. */
export async function homeNames(): Promise<string[]> {
  return (await onHost('ls', '-A', '/home/harness'))
    .split('\n')
    .filter(line => line !== '');
}

/** The download host's two logs, as text, for the run's output: the requests, then the TLS handshakes. */
export function downloadLogsText(): string {
  return [
    'download host requests:',
    ...linesOf('HARNESS_DOWNLOADS_LOG'),
    'download host TLS handshakes:',
    ...linesOf('HARNESS_DOWNLOADS_TLS_LOG'),
  ].join('\n');
}
