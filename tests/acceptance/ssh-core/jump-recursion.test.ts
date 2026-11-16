/**
 * @fileoverview A catch-all ProxyJump that also applies to the jump alias (card #2664, F-2310 AC-32): the connect asks for no input, fails
 * with the reason-less failure dialog, and when it has failed no ssh process of the attempt is left. The ssh the product
 * starts is a wrapper that starts at most `START_LIMIT` ssh processes, because the runner's own process limit does not
 * hold for the user.
 */

import {execFile} from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {dismissals} from '../windows/maintenance.ts';
import {harnessLines} from '../windows/config-keywords-support.ts';

const execFileAsync = promisify(execFile);

/** How many ssh processes the wrapper lets an attempt start before it fails them as a full process table would. */
const START_LIMIT = 40;

/** The lines of this user's processes whose command line names `alias`, ssh processes only. */
async function sshOf(alias: string): Promise<string[]> {
  const {stdout} = await execFileAsync('ps', [
    '-u',
    String(process.getuid?.() ?? 0),
    '-o',
    'pid=,args=',
  ]);
  return stdout
    .split('\n')
    .filter(
      line =>
        line.includes(alias) && /\bssh\b/.test(line) && !line.includes('ps -u'),
    );
}

describe('a ProxyJump that recurses (card #2664, F-2310 AC-32)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
  });

  after(() => {
    restoreUserSettings(saved);
  });

  /** The attempt of `mode`: the dialog has no reason and no ssh process of it is left. */
  async function recursionOf(
    mode: 'server' | 'terminal',
    settings: Record<string, unknown>,
  ): Promise<void> {
    const alias = `c2664-${mode}`;
    const jump = `jump2664-${mode}`;
    const runFolder = variable('HARNESS_RUN_FOLDER');
    const binFolder = path.join(runFolder, `ssh-path-${mode}`);
    const starts = path.join(runFolder, `ssh-starts-${mode}`);
    // A rerun in the same run folder starts its count at none, or the cap would be reached before the attempt.
    rmSync(starts, {recursive: true, force: true});
    mkdirSync(binFolder, {recursive: true});
    mkdirSync(starts, {recursive: true});
    const real = (await execFileAsync('which', ['ssh'])).stdout.trim();
    const wrapper = path.join(binFolder, 'ssh');
    writeFileSync(
      wrapper,
      [
        '#!/bin/bash',
        `PATH="${binFolder}:$PATH"; export PATH`,
        `started=$(ls "${starts}" | wc -l)`,
        `if [ "$started" -ge ${String(START_LIMIT)} ]; then echo "fork: Resource temporarily unavailable" >&2; exit 255; fi`,
        `: > "${starts}/$$"`,
        `exec -a ssh "${real}" "$@"`,
        '',
      ].join('\n'),
    );
    chmodSync(wrapper, 0o755);
    const file = path.join(runFolder, `${alias}.config`);
    writeFileSync(
      file,
      [
        `Host ${alias}`,
        ...harnessLines(),
        '',
        `Host ${jump}`,
        ...harnessLines(),
        '',
        'Host *',
        `  ProxyJump ${jump}`,
        '',
      ].join('\n'),
    );
    await userSettings({
      'remote.SSH.configFile': file,
      'remote.SSH.path': wrapper,
      'remote.SSH.remotePlatform': {[alias]: 'linux'},
      ...settings,
    });
    const mark = Date.now();
    appendScript(dismissals(alias));
    await openWindow(alias, alias);
    try {
      await waitFor(
        'the failure dialog',
        () =>
          recordLines('failureDialog', alias).some(line => line.time >= mark),
        180_000,
      );
      const dialog = recordLines('failureDialog', alias).find(
        line => line.time >= mark,
      );
      let left = await sshOf(alias);
      for (let attempt = 0; attempt < 20 && left.length > 0; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
        left = await sshOf(alias);
      }
      deepStrictEqual(
        {
          question: dialog?.question,
          left,
          limited: readdirSync(starts).length >= START_LIMIT,
          asked: ['maskedInput', 'pick'].flatMap(surface =>
            recordLines(surface, alias)
              .filter(line => line.time >= mark)
              .map(line => `${surface}: ${line.question}`),
          ),
        },
        {
          question: `Could not establish connection to "${alias}".`,
          left: [],
          limited: true,
          asked: [],
        },
      );
    } finally {
      await closeWindow(alias).catch(() => undefined);
      for (const line of await sshOf(alias)) {
        try {
          process.kill(Number(line.trim().split(' ')[0]), 'SIGKILL');
        } catch {
          // The process ended on its own.
        }
      }
    }
  }

  it('F-2310 AC-32 (c2664-recursion-server): in the local-server mode, with a catch-all ProxyJump that applies to the jump alias, no input is asked, the dialog has no reason and no ssh process of the attempt stays', async () => {
    await recursionOf('server', {});
  });

  it('F-2310 AC-32 (c2664-recursion-terminal): in the terminal mode, with a catch-all ProxyJump that applies to the jump alias, no input is asked, the dialog has no reason and no ssh process of the attempt stays', async () => {
    await recursionOf('terminal', {'remote.SSH.useLocalServer': false});
  });
});
