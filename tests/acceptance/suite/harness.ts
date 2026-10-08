/**
 * @fileoverview What the acceptance tests share: the harness variables and commands on the SSH host.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

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
