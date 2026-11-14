/**
 * @fileoverview Jump hosts and proxy commands (card #2601, F-2310): entries of the run with a ProxyJump or a
 * ProxyCommand, each written to a file of its own, plain ssh against it where the criterion names it, then a window.
 */

import {execFile} from 'node:child_process';
import {deepStrictEqual} from 'node:assert';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {hostPort, recordLines, variable} from '../windows/harness.ts';
import {
  connectWith,
  hostBlock,
  plainSsh,
  writeConfig,
} from './config-keywords-support.ts';

const execFileAsync = promisify(execFile);

/** The dialog without a reason that a failed connect of `alias` shows. */
function reasonless(alias: string): string {
  return `Could not establish connection to "${alias}".`;
}

/** The target behind a jump host: the harness host's own sshd, at its port inside. */
function target(alias: string, jump: string): string[] {
  return hostBlock(alias, [`ProxyJump ${jump}`, 'Port 22'], ['Port']);
}

/** The `ssh` lines of a row whose host keys are unknown: it asks, and its known-hosts file is `known`. */
function askLines(known: string): string[] {
  return ['StrictHostKeyChecking ask', `UserKnownHostsFile ${known}`];
}

/** The keywords of the harness block that `ASK` replaces. */
const ASK_WITHOUT = [
  'BatchMode',
  'StrictHostKeyChecking',
  'UserKnownHostsFile',
];

/** An empty known-hosts file of the run for row `alias`. */
function freshKnown(alias: string): string {
  const file = path.join(variable('HARNESS_RUN_FOLDER'), `${alias}.known`);
  writeFileSync(file, '');
  return file;
}

/** What window `alias` asked, in order: surface, question and answer. */
function asked(alias: string): string[] {
  return recordLines(undefined, alias).map(
    line => `${line.surface}|${line.question.slice(0, 140)}|${line.answer}`,
  );
}

/** The pids of the processes whose command line holds `fragment`, other than the search itself. */
async function processesWith(fragment: string): Promise<string[]> {
  try {
    const {stdout} = await execFileAsync('pgrep', ['-f', '--', fragment]);
    return stdout.split('\n').filter(line => line !== '');
  } catch {
    return [];
  }
}

describe('jump hosts and proxy commands (card #2601)', function () {
  this.timeout(300_000);

  it('PROBE c2601-probe-keys: what a window asks with unknown keys behind a jump host', async () => {
    const alias = 'c2601-probekeys';
    const known = freshKnown(alias);
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [`ProxyJump ${alias}-hop`, 'Port 22', ...askLines(known)],
        ASK_WITHOUT,
      ),
      hostBlock(`${alias}-hop`, askLines(known), ASK_WITHOUT),
    ]);
    const result = await connectWith(alias, [], 'fails', () => asked(alias), {
      file,
      script: [],
    });
    deepStrictEqual(result, [], 'PROBE');
  });

  it('PROBE c2601-probe-password: what a window asks with a password jump host and a password target', async () => {
    const alias = 'c2601-probepw';
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [`ProxyJump ${alias}-hop`, 'Port 22'],
        ['Port', 'HostName', 'ProxyCommand'],
        'password',
      ),
      hostBlock(`${alias}-hop`, [], [], 'password'),
    ]);
    const result = await connectWith(alias, [], 'fails', () => asked(alias), {
      file,
      script: [],
    });
    deepStrictEqual(result, [], 'PROBE');
  });

  it('F-2310 AC-13 (c2601-jump-unresolved): a jump host whose name does not resolve fails at once with the resolve reason', async () => {
    const alias = 'c2601-nores';
    const file = writeConfig(alias, [
      target(alias, `${alias}-hop`),
      hostBlock(`${alias}-hop`, ['HostName nowhere.invalid'], ['HostName']),
    ]);
    const result = await connectWith(alias, [], 'fails', outcome => outcome, {
      file,
    });
    deepStrictEqual(
      [result.dialog, (result.failedAfter ?? Infinity) < 5000],
      [
        `Could not establish connection to "${alias}": Could not resolve hostname.`,
        true,
      ],
    );
  });

  it('F-2310 AC-14 (c2601-jump-refused-port): a jump host that refuses the port fails with the dialog without a reason, and no ssh of the attempt stays', async () => {
    const alias = 'c2601-refport';
    const file = writeConfig(alias, [
      target(alias, `${alias}-hop`),
      hostBlock(`${alias}-hop`, ['Port 9'], ['Port']),
    ]);
    const result = await connectWith(
      alias,
      [],
      'fails',
      async outcome => ({outcome, left: await processesWith(file)}),
      {file},
    );
    deepStrictEqual(
      [result.outcome.dialog, result.left],
      [reasonless(alias), []],
    );
  });

  it('F-2310 AC-14 (c2601-jump-nofwd): a jump host that forbids TCP forwarding fails with the dialog without a reason', async () => {
    const alias = 'c2601-nofwd';
    const file = writeConfig(alias, [
      target(alias, `${alias}-hop`),
      hostBlock(`${alias}-hop`, ['User harness-nofwd'], ['User']),
    ]);
    const result = await connectWith(alias, [], 'fails', outcome => outcome, {
      file,
    });
    deepStrictEqual(result.dialog, reasonless(alias));
  });

  it('F-2310 AC-14 (c2601-target-refused): a target that refuses the forwarded connection fails with the dialog without a reason', async () => {
    const alias = 'c2601-tgtrefused';
    const file = writeConfig(alias, [
      hostBlock(alias, [`ProxyJump ${alias}-hop`, 'Port 9'], ['Port']),
      hostBlock(`${alias}-hop`, []),
    ]);
    const result = await connectWith(alias, [], 'fails', outcome => outcome, {
      file,
    });
    deepStrictEqual(result.dialog, reasonless(alias));
  });

  it('F-2310 AC-15 (c2601-proxycommand-nc): a ProxyCommand nc %h %p connects', async () => {
    const alias = 'c2601-nc';
    const file = writeConfig(alias, [
      hostBlock(alias, ['ProxyCommand nc %h %p']),
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async (outcome, written) => ({
        outcome,
        plain: (await plainSsh(written, alias)).status,
      }),
      {file},
    );
    deepStrictEqual([result.plain, result.outcome.dialog], [0, undefined]);
  });

  it('F-2310 AC-15 (c2601-proxycommand-false): a ProxyCommand that is false fails with the dialog without a reason', async () => {
    const alias = 'c2601-pcfalse';
    const file = writeConfig(alias, [hostBlock(alias, ['ProxyCommand false'])]);
    const result = await connectWith(alias, [], 'fails', outcome => outcome, {
      file,
    });
    deepStrictEqual(result.dialog, reasonless(alias));
  });

  it('F-2310 AC-15 (c2601-proxycommand-missing): a ProxyCommand naming a missing program fails with the dialog without a reason', async () => {
    const alias = 'c2601-pcmissing';
    const file = writeConfig(alias, [
      hostBlock(alias, ['ProxyCommand c2601-no-such-program %h %p']),
    ]);
    const result = await connectWith(alias, [], 'fails', outcome => outcome, {
      file,
    });
    deepStrictEqual(result.dialog, reasonless(alias));
  });

  it('F-2310 AC-18 (c2601-jump-form-userhostport): ProxyJump in the form user@host:port connects', async () => {
    const alias = 'c2601-form1';
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [`ProxyJump harness@127.0.0.1:${String(hostPort())}`, 'Port 22'],
        ['Port'],
      ),
      hostBlock('127.0.0.1', []),
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async (outcome, written) => ({
        outcome,
        plain: (await plainSsh(written, alias)).status,
      }),
      {file},
    );
    deepStrictEqual([result.plain, result.outcome.dialog], [0, undefined]);
  });

  it('F-2310 AC-18 (c2601-jump-form-ssh-url): ProxyJump in the form ssh://user@host:port connects', async () => {
    const alias = 'c2601-form2';
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [`ProxyJump ssh://harness@127.0.0.1:${String(hostPort())}`, 'Port 22'],
        ['Port'],
      ),
      hostBlock('127.0.0.1', []),
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async (outcome, written) => ({
        outcome,
        plain: (await plainSsh(written, alias)).status,
      }),
      {file},
    );
    deepStrictEqual([result.plain, result.outcome.dialog], [0, undefined]);
  });

  it('F-2310 AC-18 (c2601-jump-none): a first block with ProxyJump none wins over a later ProxyJump to a host that does not resolve, and the window connects directly', async () => {
    const alias = 'c2601-none';
    const file = writeConfig(alias, [
      hostBlock(alias, ['ProxyJump none']),
      [`Host ${alias}`, '  ProxyJump nowhere.invalid', ''],
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async (outcome, written) => ({
        outcome,
        plain: (await plainSsh(written, alias)).status,
      }),
      {file},
    );
    deepStrictEqual([result.plain, result.outcome.dialog], [0, undefined]);
  });

  it('F-2310 AC-18 (c2601-jump-and-proxycommand): a ProxyJump line followed by ProxyCommand false connects through the jump', async () => {
    const alias = 'c2601-jumpfalse';
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [`ProxyJump ${alias}-hop`, 'ProxyCommand false', 'Port 22'],
        ['Port'],
      ),
      hostBlock(`${alias}-hop`, []),
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async (outcome, written) => ({
        outcome,
        plain: (await plainSsh(written, alias)).status,
      }),
      {file},
    );
    deepStrictEqual([result.plain, result.outcome.dialog], [0, undefined]);
  });
});
