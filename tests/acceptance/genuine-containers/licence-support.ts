import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {editorProduct} from '../windows/harness.ts';

const execFileAsync = promisify(execFile);

/** The display name of Dev Containers, as its manifest gives it. */
const DISPLAY_NAME = (
  JSON.parse(
    readFileSync(
      path.join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'packages',
        'remote-containers',
        'package.json',
      ),
      'utf8',
    ),
  ) as {displayName: string}
).displayName;

/** The pids of the VS Code server processes in container `containerId`, by their connection-token argument. */
export async function serversIn(containerId: string): Promise<string[]> {
  // A container that is not running has no server in it.
  const {stdout} = await execFileAsync('docker', [
    'exec',
    containerId,
    'sh',
    '-c',
    'for each in /proc/[0-9]*; do if tr "\\0" " " < "$each/cmdline" 2>/dev/null | grep -q -- "--connection-token-fil[e]"; then echo "${each#/proc/}"; fi; done',
  ]).catch(() => ({stdout: ''}));
  return stdout.split('\n').filter(line => line !== '');
}

/** The message of the licence modal for the genuine client, and its detail with the client's terms address. */
export function licenceTexts(): {message: string; details: string} {
  const product = editorProduct();
  return {
    message: `${DISPLAY_NAME} needs you to accept the license terms of the ${product.applicationName} server before installing it.`,
    details: `Read the terms at ${product.serverLicenseUrl}.`,
  };
}

/** The state of container `containerId` (`running`, `exited`, …). */
export async function statusOf(containerId: string): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    '{{.State.Status}}',
    containerId,
  ]);
  return stdout.trim();
}

/** The commit folders the `vscode` volume holds, as `/vscode/<server>/bin/<platform>/<commit>` lists them. */
export async function volumeCommits(): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'run',
    '--rm',
    '--volume',
    'vscode:/vscode:ro',
    'alpine',
    'sh',
    '-c',
    'ls -d /vscode/*/bin/*/* 2>/dev/null; true',
  ]);
  return stdout.split('\n').filter(line => line !== '');
}

/** The modification time of each commit folder of the `vscode` volume, which an install of the server would change. */
export async function volumeStamp(): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'run',
    '--rm',
    '--volume',
    'vscode:/vscode:ro',
    'alpine',
    'sh',
    '-c',
    'for each in /vscode/*/bin/*/*; do [ -e "$each" ] && stat -c "%n %Y" "$each"; done; true',
  ]);
  return stdout.split('\n').filter(line => line !== '');
}
