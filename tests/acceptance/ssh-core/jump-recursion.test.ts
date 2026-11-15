/**
 * @fileoverview A catch-all ProxyJump that also applies to the jump alias (card #2664, F-2310 AC-32): the connect fails
 * with the reason-less failure dialog, and when it has failed no ssh process of the attempt is left. The ssh the product
 * starts is a wrapper that starts at most `START_LIMIT` ssh processes, because the runner's own process limit does not
 * hold for the user.
 */

import {execFile} from 'node:child_process';
import {chmodSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
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

/** How many ssh processes the wrapper lets an attempt start before it holds the next ones. */
const BLOCK_AFTER = 6;

/** The ssh processes of `alias` that are left once they had ten seconds to end: none, when the attempt ended them. */
async function waitUntilNone(alias: string): Promise<string[]> {
  let left = await sshOf(alias);
  for (let attempt = 0; attempt < 20 && left.length > 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    left = await sshOf(alias);
  }
  return left;
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

  /**
   * The attempt of `mode` over the recursing configuration. With `blocking`, the wrapper holds every ssh it is asked to
   * start after `BLOCK_AFTER` and the window is closed while they are held; otherwise it fails them, and the attempt
   * ends with the dialog. Either way, no ssh process of the attempt is left.
   */
  async function recursionOf(
    mode: 'server' | 'terminal',
    settings: Record<string, unknown>,
    blocking: boolean,
  ): Promise<void> {
    const alias = `c2664-${mode}${blocking ? '-held' : ''}`;
    const jump = `jump-${alias}`;
    const runFolder = variable('HARNESS_RUN_FOLDER');
    const binFolder = path.join(runFolder, `ssh-path-${alias}`);
    const starts = path.join(runFolder, `ssh-starts-${alias}`);
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
        blocking
          ? `if [ "$started" -ge ${String(BLOCK_AFTER)} ]; then exec -a "ssh held ${alias}" sleep 600; fi`
          : `if [ "$started" -ge ${String(START_LIMIT)} ]; then echo "fork: Resource temporarily unavailable" >&2; exit 255; fi`,
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
      if (blocking) {
        await waitFor(
          'a held ssh',
          async () => (await sshOf(alias)).some(line => line.includes('held')),
          120_000,
        );
        await closeWindow(alias);
        const left = await waitUntilNone(alias);
        deepStrictEqual(left, []);
        return;
      }
      await waitFor(
        'the failure dialog',
        () =>
          recordLines('failureDialog', alias).some(line => line.time >= mark),
        180_000,
      );
      const dialog = recordLines('failureDialog', alias).find(
        line => line.time >= mark,
      );
      const left = await waitUntilNone(alias);
      deepStrictEqual(
        {
          question: dialog?.question,
          left,
          limited: readdirSync(starts).length >= START_LIMIT,
        },
        {
          question: `Could not establish connection to "${alias}".`,
          left: [],
          limited: true,
        },
      );
    } finally {
      await closeWindow(alias).catch(() => undefined);
    }
  }

  it('F-2310 AC-32 (c2664-recursion-server): in the local-server mode, with a catch-all ProxyJump that applies to the jump alias, the dialog has no reason and no ssh process of the attempt stays', async () => {
    await recursionOf('server', {}, false);
  });

  it('F-2310 AC-32 (c2664-recursion-terminal): in the terminal mode, with a catch-all ProxyJump that applies to the jump alias, the dialog has no reason and no ssh process of the attempt stays', async () => {
    await recursionOf('terminal', {'remote.SSH.useLocalServer': false}, false);
  });

  it('F-2310 AC-32 (c2664-held-server): in the local-server mode, when the recursion holds its ssh processes and the window is closed, no ssh process of the attempt stays', async () => {
    await recursionOf('server', {}, true);
  });

  it('F-2310 AC-32 (c2664-held-terminal): in the terminal mode, when the recursion holds its ssh processes and the window is closed, no ssh process of the attempt stays', async () => {
    await recursionOf('terminal', {'remote.SSH.useLocalServer': false}, true);
  });
});
