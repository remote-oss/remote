/**
 * @fileoverview What the acceptance tests share: the harness variables and commands on the SSH host.
 */

import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {promisify} from 'node:util';
import {readRecord, type RecordLine} from '../suite-local/script.ts';

const execFileAsync = promisify(execFile);

/** A harness variable the runner sets; throws when the tests run outside the harness. */
function harnessVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set; run the tests with pnpm test:acceptance`,
    );
  }
  return value;
}

/** The standard output of `command` run on the host through the harness's SSH configuration. */
export async function overSsh(command: string): Promise<string> {
  const {stdout} = await execFileAsync('ssh', [
    '-F',
    harnessVariable('HARNESS_SSH_CONFIG'),
    'harness',
    command,
  ]);
  return stdout;
}

/** The standard output of `command` run in the host container as the user harness, outside SSH. */
export async function onHost(...command: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    '--user',
    'harness',
    harnessVariable('HARNESS_CONTAINER'),
    ...command,
  ]);
  return stdout;
}

/** The lines of the log the harness reads, `REMOTE_OSS_ACCEPTANCE_LOG`, without their time stamps. */
export function connectionLog(): string[] {
  return readFileSync(harnessVariable('REMOTE_OSS_ACCEPTANCE_LOG'), 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.slice(line.indexOf('] ') + 2));
}

/** The lines of the record this window's adapters wrote, optionally of one surface. */
export function recordLines(surface?: string): RecordLine[] {
  return readRecord(harnessVariable('REMOTE_OSS_ACCEPTANCE_RECORD')).filter(
    line => surface === undefined || line.surface === surface,
  );
}
