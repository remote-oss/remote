/**
 * @fileoverview Jump hosts and proxy commands (card #2601, F-2310): entries of the run with a ProxyJump or a
 * ProxyCommand, each written to a file of its own, plain ssh against it where the criterion names it, then a window.
 */

import {execFile, execFileSync} from 'node:child_process';
import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {dismissals} from '../windows/maintenance.ts';
import {answerInputBox, inputBoxOf, pressEscape} from '../windows/renderer.ts';
import {
  connectedWithin,
  hostPassword,
  hostPort,
  recordLines,
  reloadWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
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

/** What is wrong with the password hosts of a row: only passwords are tried, three times for a jump that is told so. */
const PASSWORD_ONLY = [
  'PubkeyAuthentication no',
  'PreferredAuthentications password',
];

/** The keywords of the run's `password` block that a row sets itself. */
const PASSWORD_WITHOUT = [
  'PreferredAuthentications',
  'NumberOfPasswordPrompts',
  'HostName',
  'Port',
  'ProxyCommand',
];

/**
 * The file of a row with a password jump host (the harness host at its published port) and a password target behind it
 * (the host's own sshd, at 127.0.0.2 inside, so that its prompt names another address than the jump host's).
 */
function passwordChain(alias: string, prompts: number): string {
  return writeConfig(alias, [
    hostBlock(
      alias,
      [
        `ProxyJump ${alias}-hop`,
        'HostName 127.0.0.2',
        'Port 22',
        ...PASSWORD_ONLY,
        'NumberOfPasswordPrompts 1',
      ],
      PASSWORD_WITHOUT,
      'password',
    ),
    hostBlock(
      `${alias}-hop`,
      [...PASSWORD_ONLY, `NumberOfPasswordPrompts ${String(prompts)}`],
      ['PreferredAuthentications', 'NumberOfPasswordPrompts', 'ProxyCommand'],
      'password',
    ),
  ]);
}

/** The answer of the script to a password input that names `address`. */
function passwordAt(alias: string, address: string, text: string) {
  return {
    surface: 'maskedInput',
    match: `harness-pw@${address}`,
    answer: {text},
    window: alias,
  } as const;
}

/** Waits until window `name` shows an input whose placeholder is `placeholder` (and whose message holds `message`), and gives it. */
async function untilInput(name: string, placeholder: string, message = '') {
  await waitFor(
    `the input ${placeholder} of ${name}`,
    async () => {
      const shown = await inputBoxOf(name);
      return (
        shown?.placeholder === placeholder && shown.message.includes(message)
      );
    },
    90_000,
  );
  const shown = await inputBoxOf(name);
  if (shown === undefined) {
    throw new Error(`the input of ${name} closed`);
  }
  return shown;
}

/** The questions window `alias` was asked on `surface`, in order. */
function questionsOn(alias: string, surface: string): string[] {
  return recordLines(surface, alias).map(line => line.question);
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

  it('F-2310 AC-5, AC-26 (c2601-password-chain): a password jump host and a password target ask for their passwords in hop order, the window connects, and the extension writes no setting and no configuration entry', async () => {
    const alias = 'c2601-pwchain';
    const file = passwordChain(alias, 1);
    const before = readFileSync(file, 'utf8');
    const result = await connectWith(
      alias,
      [],
      'connects',
      outcome => ({
        asked: questionsOn(alias, 'maskedInput'),
        settings: outcome.settingsAfter === outcome.settingsBefore,
        config: readFileSync(file, 'utf8') === before,
      }),
      {
        file,
        script: [
          passwordAt(alias, '127.0.0.1', hostPassword()),
          passwordAt(alias, '127.0.0.2', hostPassword()),
        ],
      },
    );
    deepStrictEqual(result, {
      asked: [
        'Enter password for harness-pw@127.0.0.1',
        'Enter password for harness-pw@127.0.0.2',
      ],
      settings: true,
      config: true,
    });
  });

  it('F-2310 AC-7 (c2601-password-wrong): a wrong password at the jump host re-opens the input with the same placeholder and the message that the permission was denied', async () => {
    const alias = 'c2601-pwwrong';
    const file = passwordChain(alias, 3);
    const seen: Array<{placeholder: string; message: string | undefined}> = [];
    await connectWith(alias, [], 'fails', () => undefined, {
      file,
      script: dismissals(alias),
      during: async name => {
        const first = await untilInput(
          name,
          'Enter password for harness-pw@127.0.0.1',
        );
        seen.push({placeholder: first.placeholder, message: first.message});
        await answerInputBox(name, 'wrong');
        const second = await untilInput(
          name,
          'Enter password for harness-pw@127.0.0.1',
          'Permission denied',
        );
        seen.push({placeholder: second.placeholder, message: second.message});
        await pressEscape(name);
      },
    });
    deepStrictEqual(seen, [
      {
        placeholder: 'Enter password for harness-pw@127.0.0.1',
        message: "Press 'Enter' to confirm your input or 'Escape' to cancel",
      },
      {
        placeholder: 'Enter password for harness-pw@127.0.0.1',
        message:
          "Permission denied, please try again. (Press 'Enter' to confirm or 'Escape' to cancel)",
      },
    ]);
  });

  it('F-2310 AC-8 (c2601-password-three-wrong): three wrong passwords at the jump host fail with the permission dialog and its three buttons', async () => {
    const alias = 'c2601-pw3';
    const file = passwordChain(alias, 3);
    const result = await connectWith(
      alias,
      [],
      'fails',
      outcome => ({
        dialog: outcome.dialog,
        buttons: outcome.buttons,
        asked: questionsOn(alias, 'maskedInput').length,
      }),
      {
        file,
        settings: {'remote.SSH.connectTimeout': 120},
        script: [
          passwordAt(alias, '127.0.0.1', 'wrong1'),
          passwordAt(alias, '127.0.0.1', 'wrong2'),
          passwordAt(alias, '127.0.0.1', 'wrong3'),
          {
            surface: 'failureDialog',
            match: 'Could not establish connection',
            answer: 'dismiss',
            window: alias,
          },
          {
            surface: 'mitigationPick',
            match: 'Pick an action',
            answer: 'dismiss',
            window: alias,
          },
        ],
      },
    );
    deepStrictEqual(result, {
      dialog: `Could not establish connection to "${alias}": Permission denied (password,keyboard-interactive).`,
      buttons: ['Close Remote', 'Retry', 'More Actions...'],
      asked: 3,
    });
  });

  it('F-2310 AC-9 (c2601-password-escape): Escape on the jump host input asks nothing more for that hop and the permission dialog follows within about a second', async () => {
    const alias = 'c2601-pwescape';
    const file = passwordChain(alias, 3);
    let escapedAt = 0;
    const result = await connectWith(
      alias,
      [],
      'fails',
      async outcome => ({
        dialog: outcome.dialog,
        asked: questionsOn(alias, 'maskedInput').length,
        input: await inputBoxOf(alias),
        quick: (outcome.dialogTime ?? Infinity) - escapedAt < 3000,
      }),
      {
        file,
        script: dismissals(alias),
        during: async name => {
          await untilInput(name, 'Enter password for harness-pw@127.0.0.1');
          escapedAt = Date.now();
          await pressEscape(name);
        },
      },
    );
    deepStrictEqual(result, {
      dialog: `Could not establish connection to "${alias}": Permission denied (password,keyboard-interactive).`,
      asked: 1,
      input: undefined,
      quick: true,
    });
  });

  it('F-2310 AC-12 (c2601-jump-blackhole): a jump host that drops all packets fails after about the connect timeout with the timed out reason', async () => {
    const alias = 'c2601-blackhole';
    const file = writeConfig(alias, [
      target(alias, `${alias}-hop`),
      hostBlock(`${alias}-hop`, ['HostName 192.0.2.1'], ['HostName']),
    ]);
    const result = await connectWith(
      alias,
      [],
      'fails',
      outcome => ({
        dialog: outcome.dialog,
        waited:
          (outcome.failedAfter ?? 0) >= 8000 &&
          (outcome.failedAfter ?? 0) < 25_000,
      }),
      {file},
    );
    deepStrictEqual(result, {
      dialog: `Could not establish connection to "${alias}": The connection timed out.`,
      sshLines: [],
      waited: true,
    });
  });

  it('F-2310 AC-24 (c2601-hostkey-picks): unknown host keys behind a jump host ask the fingerprint pick for each hop, and Continue records both keys', async () => {
    const alias = 'c2601-picks';
    const known = freshKnown(alias);
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [
          `ProxyJump ${alias}-hop`,
          'HostName 127.0.0.2',
          'Port 22',
          ...askLines(known),
        ],
        ['Port', 'HostName', ...ASK_WITHOUT],
      ),
      hostBlock(`${alias}-hop`, askLines(known), ASK_WITHOUT),
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      () => ({
        picks: questionsOn(alias, 'pick').map(question =>
          question.replace(/SHA256:\S+/, 'SHA256:x'),
        ),
        recorded: readFileSync(known, 'utf8')
          .split('\n')
          .filter(line => line !== '').length,
      }),
      {
        file,
        script: [
          {surface: 'pick', match: 'fingerprint', answer: 'yes', window: alias},
          {surface: 'pick', match: 'fingerprint', answer: 'yes', window: alias},
        ],
      },
    );
    deepStrictEqual(result, {
      picks: [
        `"${alias}" has fingerprint "SHA256:x`,
        `"${alias}" has fingerprint "SHA256:x`,
      ],
      recorded: 2,
    });
  });

  it('F-2310 AC-19 (c2601-hostkey-changed): a known-hosts line for the jump host that does not match its key fails with the changed host key dialog', async () => {
    const alias = 'c2601-changed';
    const known = freshKnown(alias);
    const keyFile = `${known}.key`;
    execFileSync('ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-f',
      keyFile,
    ]);
    writeFileSync(
      known,
      `[127.0.0.1]:${String(hostPort())} ${readFileSync(`${keyFile}.pub`, 'utf8')}`,
    );
    const file = writeConfig(alias, [
      target(alias, `${alias}-hop`),
      hostBlock(
        `${alias}-hop`,
        [`UserKnownHostsFile ${known}`],
        ['UserKnownHostsFile'],
      ),
    ]);
    const result = await connectWith(
      alias,
      [],
      'fails',
      outcome => outcome.dialog,
      {file},
    );
    deepStrictEqual(
      result,
      `Could not establish connection to "${alias}": Remote host key has changed, port forwarding is disabled.`,
    );
  });

  it('F-2310 AC-20 (c2601-password-reload): a window connected through a password jump host reloads and connects with no input', async () => {
    const alias = 'c2601-pwreload';
    const file = passwordChain(alias, 1);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async () => {
        const before = questionsOn(alias, 'maskedInput').length;
        await reloadWindow(alias);
        await connectedWithin(alias, 120_000);
        return {before, after: questionsOn(alias, 'maskedInput').length};
      },
      {
        file,
        script: [
          passwordAt(alias, '127.0.0.1', hostPassword()),
          passwordAt(alias, '127.0.0.2', hostPassword()),
        ],
      },
    );
    deepStrictEqual(result, {before: 2, after: 2});
  });

  it('F-2310 AC-22 (c2601-password-terminal): without the local server a password jump host and a password target ask in hop order and the window connects', async () => {
    const alias = 'c2601-pwterminal';
    const file = passwordChain(alias, 1);
    const result = await connectWith(
      alias,
      [],
      'connects',
      () => questionsOn(alias, 'maskedInput'),
      {
        file,
        settings: {
          'remote.SSH.useLocalServer': false,
          'remote.SSH.remotePlatform': {[alias]: 'linux'},
        },
        script: [
          passwordAt(alias, '127.0.0.1', hostPassword()),
          passwordAt(alias, '127.0.0.2', hostPassword()),
        ],
      },
    );
    deepStrictEqual(result, [
      'Enter password for harness-pw@127.0.0.1',
      'Enter password for harness-pw@127.0.0.2',
    ]);
  });
});
