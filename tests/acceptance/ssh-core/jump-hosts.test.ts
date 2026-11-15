/**
 * @fileoverview Jump hosts and proxy commands (card #2601, F-2310): entries of the run with a ProxyJump or a
 * ProxyCommand, each written to a file of its own, plain ssh against it where the criterion names it, then a window.
 */

import {execFile, execFileSync} from 'node:child_process';
import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {linesSince, runWith} from '../windows/maintenance.ts';
import {notifications, statusItem} from '../windows/renderer.ts';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  cutHostNetwork,
  hostAnswer,
  hostPassword,
  hostPort,
  inWindow,
  isQuestion,
  nextEmptyWindow,
  onHostAs,
  recordLines,
  readUserSettings,
  reloadWindow,
  restoreHostNetwork,
  restoreUserSettings,
  signal,
  startInWindow,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {
  connectWith,
  hostBlock,
  plainSsh,
  writeConfig,
} from '../windows/config-keywords-support.ts';

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
function passwordChain(
  alias: string,
  prompts: number,
  extra: readonly string[] = [],
): string {
  return writeConfig(alias, [
    hostBlock(
      alias,
      [
        `ProxyJump ${alias}-hop`,
        'HostName 127.0.0.2',
        'Port 22',
        ...PASSWORD_ONLY,
        'NumberOfPasswordPrompts 1',
        ...extra,
      ],
      PASSWORD_WITHOUT,
      'password',
    ),
    hostBlock(
      `${alias}-hop`,
      [
        ...PASSWORD_ONLY,
        `NumberOfPasswordPrompts ${String(prompts)}`,
        ...extra,
      ],
      ['PreferredAuthentications', 'NumberOfPasswordPrompts', 'ProxyCommand'],
      'password',
    ),
  ]);
}

/** The keywords that make ssh notice a lost network within about ten seconds. */
const NOTICES_LOSS = ['ServerAliveInterval 4', 'ServerAliveCountMax 2'];

/** The answer of the script to a password input that names `address`. */
function passwordAt(alias: string, address: string, text: string) {
  return {
    surface: 'maskedInput',
    match: `harness-pw@${address}`,
    answer: {text},
    window: alias,
  } as const;
}

/** The questions window `alias` was asked on `surface`, in order. */
function questionsOn(alias: string, surface: string): string[] {
  return recordLines(surface, alias).map(line => line.question);
}

/** The names in `listing`, a line each, that have `server` in them. */
function serverNamesOf(listing: string): string[] {
  return listing.split('\n').filter(name => name.includes('server'));
}

/** The fingerprint (SHA256:...) of the public key file `publicKey` on the host. */
async function fingerprintOf(publicKey: string): Promise<string | undefined> {
  return (await onHostAs('harness', 'ssh-keygen', '-lf', publicKey)).split(
    ' ',
  )[1];
}

/** The non-empty lines of `file`. */
function linesOf(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line !== '');
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
    const before = readFileSync(file, 'utf8');
    const result = await connectWith(
      alias,
      [],
      'fails',
      outcome => ({
        dialog: outcome.dialog,
        quick: (outcome.failedAfter ?? Infinity) < 5000,
        settings: outcome.settingsAfter === outcome.settingsBefore,
        config: readFileSync(file, 'utf8') === before,
      }),
      {file},
    );
    deepStrictEqual(result, {
      dialog: `Could not establish connection to "${alias}": Could not resolve hostname.`,
      quick: true,
      settings: true,
      config: true,
    });
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

  it('F-2310 AC-14 (c2601-target-refused): a target that refuses the forwarded connection fails with the dialog without a reason', async () => {
    const alias = 'c2601-tgtrefused';
    const file = writeConfig(alias, [
      hostBlock(alias, [`ProxyJump ${alias}-hop`, 'Port 9'], ['Port']),
      hostBlock(`${alias}-hop`, []),
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

  it('F-2310 AC-7 (c2601-password-wrong-part): a wrong password at the jump host asks the same input again, and the next input is the target’s', async () => {
    const alias = 'c2601-pwwrong';
    const file = passwordChain(alias, 3);
    const result = await connectWith(
      alias,
      [],
      'connects',
      () => questionsOn(alias, 'maskedInput'),
      {
        file,
        script: [
          passwordAt(alias, '127.0.0.1', 'wrong'),
          passwordAt(alias, '127.0.0.1', hostPassword()),
          passwordAt(alias, '127.0.0.2', hostPassword()),
        ],
      },
    );
    deepStrictEqual(result, [
      'Enter password for harness-pw@127.0.0.1',
      'Enter password for harness-pw@127.0.0.1',
      'Enter password for harness-pw@127.0.0.2',
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

  it('F-2310 AC-9 (c2601-password-escape): cancelling the jump host input asks nothing more for that hop and the permission dialog follows within about a second', async () => {
    const alias = 'c2601-pwescape';
    const file = passwordChain(alias, 3);
    const result = await connectWith(
      alias,
      [],
      'fails',
      outcome => ({
        dialog: outcome.dialog,
        asked: questionsOn(alias, 'maskedInput').length,
        quick:
          (outcome.dialogTime ?? Infinity) -
            (recordLines('maskedInput', alias)[0]?.time ?? 0) <
          3000,
      }),
      {file},
    );
    deepStrictEqual(result, {
      dialog: `Could not establish connection to "${alias}": Permission denied (password,keyboard-interactive).`,
      asked: 1,
      quick: true,
    });
  });

  it('F-2310 AC-24 (c2614-hostkey-picks): unknown host keys behind a jump host ask the fingerprint pick for each hop, and Continue records both keys', async () => {
    const alias = 'c2614-picks';
    const port = 22022;
    const folder = '/tmp/c2614-sshd';
    const known = freshKnown(alias);
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [
          `ProxyJump ${alias}-hop`,
          'HostName 127.0.0.1',
          `Port ${String(port)}`,
          ...askLines(known),
        ],
        ['Port', 'HostName', ...ASK_WITHOUT],
      ),
      hostBlock(`${alias}-hop`, askLines(known), ASK_WITHOUT),
    ]);
    await onHostAs(
      'harness',
      'sh',
      '-c',
      `rm -rf ${folder}; mkdir -p ${folder} && ssh-keygen -q -t ed25519 -N '' -f ${folder}/hostkey && printf '%s\\n' 'HostKey ${folder}/hostkey' 'PidFile ${folder}/sshd.pid' 'UsePAM no' 'StrictModes no' 'AuthorizedKeysFile /home/harness/.ssh/authorized_keys' 'ListenAddress 127.0.0.1' > ${folder}/sshd_config && (setsid /usr/sbin/sshd -D -e -f ${folder}/sshd_config -p ${String(port)} > ${folder}/sshd.log 2>&1 < /dev/null &)`,
    );
    const saved = readUserSettings();
    try {
      await waitFor(
        'the second sshd to listen',
        async () =>
          onHostAs(
            'harness',
            'sh',
            '-c',
            `nc -z 127.0.0.1 ${String(port)} && echo up`,
          )
            .then(text => text.includes('up'))
            .catch(() => false),
        30_000,
      );
      const jumpKey = await fingerprintOf('/etc/ssh/ssh_host_ed25519_key.pub');
      const targetKey = await fingerprintOf(`${folder}/hostkey.pub`);
      await userSettings({'remote.SSH.configFile': file});
      const next = await nextEmptyWindow(() =>
        inWindow('local', 'workbench.action.newWindow'),
      );
      // The command turns the window into a remote one, which ends the extension host before it can answer: it is started, not awaited.
      appendScript(
        [
          hostAnswer(next, {label: alias}),
          {surface: 'pick', match: 'fingerprint', answer: 'yes'},
          {surface: 'pick', match: 'fingerprint', answer: 'yes'},
        ].map(entry => ({...entry, window: next})),
      );
      await startInWindow(
        next,
        'opensshremotes.openEmptyWindowInCurrentWindow',
      );
      await waitFor(
        `${next} to be on the host`,
        async () => (await windowState(next)).remoteName === 'ssh-remote',
        120_000,
      );
      const result = {
        picks: recordLines('pick', next)
          .filter(line => line.answer !== 'held')
          .map(line => line.question),
        recorded: linesOf(known).length,
      };
      await closeWindow(next);
      deepStrictEqual(result, {
        picks: [
          `"${alias}" has fingerprint "${String(jumpKey)}".`,
          `"${alias}" has fingerprint "${String(targetKey)}".`,
        ],
        recorded: 2,
      });
    } finally {
      restoreUserSettings(saved);
      await onHostAs(
        'harness',
        'sh',
        '-c',
        `kill $(cat ${folder}/sshd.pid) 2>/dev/null; rm -rf ${folder}; true`,
      );
    }
  });

  it('F-2310 AC-17 (c2614-fdpass): ProxyUseFdpass yes with a helper that passes a connected socket back connects', async () => {
    const alias = 'c2614-fdpass';
    const script = path.join(variable('HARNESS_RUN_FOLDER'), 'fdpass-proxy.py');
    writeFileSync(
      script,
      'import socket\nimport sys\n\nconnection = socket.create_connection((sys.argv[1], int(sys.argv[2])))\nsocket.send_fds(socket.socket(fileno=1), [b"\\0"], [connection.fileno()])\n',
    );
    const file = writeConfig(alias, [
      hostBlock(alias, [
        `ProxyCommand python3 -I ${script} %h %p`,
        'ProxyUseFdpass yes',
      ]),
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async (outcome, written) => ({
        outcome: outcome.dialog,
        plain: (await plainSsh(written, alias)).status,
      }),
      {file},
    );
    deepStrictEqual(result, {outcome: undefined, plain: 0});
  });

  it('F-2310 AC-17 (c2614-fdpass-relay): ProxyUseFdpass yes with a relaying proxy fails with the dialog without a reason', async () => {
    const alias = 'c2614-fdrelay';
    const file = writeConfig(alias, [
      hostBlock(alias, ['ProxyCommand nc %h %p', 'ProxyUseFdpass yes']),
    ]);
    const result = await connectWith(
      alias,
      [],
      'fails',
      outcome => outcome.dialog,
      {
        file,
      },
    );
    deepStrictEqual(result, reasonless(alias));
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

  it('F-2310 AC-20 (c2601-password-reload-part): a window connected through a password jump host reloads and connects with no input', async () => {
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

  /** The chain `ProxyJump a,b` of a row that asks every host key; no ConnectTimeout, which ssh would apply to the jump hosts' own handshakes. */
  function chain(alias: string, known: string): string {
    return writeConfig(alias, [
      hostBlock(
        alias,
        [
          `ProxyJump ${alias}-first,${alias}-second`,
          'HostName 127.0.0.2',
          'Port 22',
          ...askLines(known),
        ],
        ['Port', 'HostName', 'ConnectTimeout', ...ASK_WITHOUT],
      ),
      hostBlock(`${alias}-first`, askLines(known), [
        'ConnectTimeout',
        ...ASK_WITHOUT,
      ]),
      hostBlock(
        `${alias}-second`,
        ['HostName 127.0.0.3', 'Port 22', ...askLines(known)],
        ['Port', 'HostName', 'ConnectTimeout', ...ASK_WITHOUT],
      ),
    ]);
  }

  it('F-2310 AC-11 (c2601-keys-answered-slowly): with the connect timeout at 60 the same chain connects when each jump host pick is answered within about 20 seconds', async () => {
    const alias = 'c2601-slowok';
    const file = chain(alias, freshKnown(alias));
    const timers = [
      setTimeout(() => {
        signal('c2601-answer-first');
      }, 20_000),
      setTimeout(() => {
        signal('c2601-answer-second');
      }, 40_000),
    ];
    try {
      const result = await connectWith(
        alias,
        [],
        'connects',
        outcome => ({
          dialog: outcome.dialog,
          picks: recordLines('pick', alias).filter(
            line => line.answer !== 'held',
          ).length,
        }),
        {
          file,
          settings: {'remote.SSH.connectTimeout': 60},
          script: [
            {
              surface: 'pick',
              match: 'fingerprint',
              answer: 'yes',
              window: alias,
              after: 'c2601-answer-first',
            },
            {
              surface: 'pick',
              match: 'fingerprint',
              answer: 'yes',
              window: alias,
              after: 'c2601-answer-second',
            },
            {
              surface: 'pick',
              match: 'fingerprint',
              answer: 'yes',
              window: alias,
            },
          ],
        },
      );
      deepStrictEqual(result, {dialog: undefined, picks: 3});
    } finally {
      timers.forEach(clearTimeout);
    }
  });

  it('F-2310 AC-16 (c2601-proxycommand-ssh-w): ProxyCommand ssh -W through a bastion with unknown keys asks the bastion first and the target second, and connects', async () => {
    const alias = 'c2601-sshw';
    const known = freshKnown(alias);
    const written = path.join(
      variable('HARNESS_RUN_FOLDER'),
      `${alias}.config`,
    );
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [
          `ProxyCommand ssh -F ${written} -W %h:%p ${alias}-bastion`,
          'HostName 127.0.0.2',
          'Port 22',
          ...askLines(known),
        ],
        ['Port', 'HostName', ...ASK_WITHOUT],
      ),
      hostBlock(`${alias}-bastion`, askLines(known), ASK_WITHOUT),
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      () => linesOf(known).map(line => line.split(' ')[0]),
      {
        file,
        script: [
          {surface: 'pick', match: 'fingerprint', answer: 'yes', window: alias},
          {surface: 'pick', match: 'fingerprint', answer: 'yes', window: alias},
        ],
      },
    );
    deepStrictEqual(result, [`[127.0.0.1]:${String(hostPort())}`, '127.0.0.2']);
  });

  it('F-2310 AC-29 (c2601-hostkey-left-open): the target host key pick left open for 60 seconds is still open, with no dialog and the indicator still Opening Remote...', async () => {
    const alias = 'c2601-leftopen';
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
      hostBlock(`${alias}-hop`, []),
    ]);
    const seen: Array<{dialogs: number; indicator: string; picks: number}> = [];
    const timer = setTimeout(() => {
      void (async () => {
        seen.push({
          dialogs: recordLines('failureDialog', alias).length,
          indicator: (await statusItem(alias, 'status.host')).text,
          picks: questionsOn(alias, 'pick').length,
        });
        signal('c2601-answer-late');
      })();
    }, 60_000);
    try {
      await connectWith(alias, [], 'connects', () => undefined, {
        file,
        script: [
          {
            surface: 'pick',
            match: 'fingerprint',
            answer: 'yes',
            window: alias,
            after: 'c2601-answer-late',
          },
        ],
      });
    } finally {
      clearTimeout(timer);
    }
    deepStrictEqual(seen, [
      {dialogs: 0, indicator: 'Opening Remote...', picks: 1},
    ]);
  });

  it('F-2310 AC-36 (c2601-jump-leaves-no-server): the account of the jump host has no server folder and runs no server process, while the final account has both', async () => {
    const alias = 'c2601-noserver';
    await onHostAs(
      'harness-pw',
      'sh',
      '-c',
      'rm -rf "$HOME"/.*server*; pkill -u harness-pw -f "[v]scodium-server"; true',
    );
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [`ProxyJump ${alias}-hop`, 'HostName 127.0.0.2', 'Port 22'],
        ['Port', 'HostName'],
      ),
      hostBlock(
        `${alias}-hop`,
        [...PASSWORD_ONLY, 'NumberOfPasswordPrompts 1'],
        ['PreferredAuthentications', 'NumberOfPasswordPrompts', 'ProxyCommand'],
        'password',
      ),
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async () => ({
        jumpFolders: serverNamesOf(
          await onHostAs('harness-pw', 'ls', '-a', '/home/harness-pw'),
        ),
        finalFolders:
          serverNamesOf(await onHostAs('harness', 'ls', '-a', '/home/harness'))
            .length > 0,
        jumpProcesses: (await onHostAs('harness', 'ps', '-eo', 'user,args'))
          .split('\n')
          .filter(
            line => line.startsWith('harness-pw') && line.includes('server'),
          ),
        finalProcesses: (await onHostAs('harness', 'ps', '-eo', 'user,args'))
          .split('\n')
          .some(line => line.startsWith('harness ') && line.includes('server')),
      }),
      {file, script: [passwordAt(alias, '127.0.0.1', hostPassword())]},
    );
    deepStrictEqual(result, {
      jumpFolders: [],
      finalFolders: true,
      jumpProcesses: [],
      finalProcesses: true,
    });
  });

  it('F-2310 AC-28 (c2601-password-left-open): a key-only jump host with a known key and a password target, the target password input left open for 45 seconds and then answered, shows no dialog and connects', async () => {
    const alias = 'c2601-pwopen';
    const file = writeConfig(alias, [
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
      hostBlock(`${alias}-hop`, []),
    ]);
    const timer = setTimeout(() => {
      signal('c2601-answer-password');
    }, 45_000);
    try {
      const result = await connectWith(
        alias,
        [],
        'connects',
        outcome => ({
          dialog: outcome.dialog,
          dialogs: recordLines('failureDialog', alias).length,
        }),
        {
          file,
          script: [
            {
              ...passwordAt(alias, '127.0.0.2', hostPassword()),
              after: 'c2601-answer-password',
            },
          ],
        },
      );
      deepStrictEqual(result, {dialog: undefined, dialogs: 0});
    } finally {
      clearTimeout(timer);
    }
  });

  /** The remote indicator of window `alias`. */
  async function indicatorOf(alias: string): Promise<string> {
    return (await statusItem(alias, 'status.host')).text;
  }

  /** Waits until the remote indicator of window `alias` starts with `text`, and gives the milliseconds it took from `since`. */
  async function indicatorAfter(
    alias: string,
    text: string,
    since: number,
  ): Promise<number> {
    await waitFor(
      `the indicator of ${alias} to start with ${text}`,
      async () => (await indicatorOf(alias)).startsWith(text),
      120_000,
    );
    return Date.now() - since;
  }

  it('F-2310 AC-25 (c2601-jump-reconnect-key): a window connected through a key-only jump host whose network is cut shows Reconnecting after about 20 seconds, and returns to SSH: <alias> without a reload and without input', async () => {
    const alias = 'c2601-rekey';
    const file = writeConfig(alias, [
      hostBlock(alias, [`ProxyJump ${alias}-hop`, 'Port 22'], ['Port']),
      hostBlock(`${alias}-hop`, []),
    ]);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async () => {
        const activations = windowEvents(alias).filter(
          each => each.event === 'activated',
        ).length;
        const asked = recordLines(undefined, alias).filter(isQuestion).length;
        const cutAt = Date.now();
        cutHostNetwork();
        let reconnecting: number;
        try {
          reconnecting = await indicatorAfter(
            alias,
            'Reconnecting to SSH',
            cutAt,
          );
        } finally {
          restoreHostNetwork();
        }
        await connectedWithin(alias, 180_000);
        return {
          reconnectingAfter: Math.round(reconnecting / 1000),
          indicator: await indicatorOf(alias),
          reloads:
            windowEvents(alias).filter(each => each.event === 'activated')
              .length - activations,
          inputs:
            recordLines('maskedInput', alias).length +
            recordLines('pick', alias).length,
          asked:
            recordLines(undefined, alias).filter(isQuestion).length - asked,
        };
      },
      {file},
    );
    deepStrictEqual(
      {
        ...result,
        reconnectingAfter:
          result.reconnectingAfter >= 18 && result.reconnectingAfter <= 28,
      },
      {
        reconnectingAfter: true,
        indicator: `SSH: ${alias}`,
        reloads: 0,
        inputs: 0,
        asked: 0,
      },
      `reconnecting after ${String(result.reconnectingAfter)} s`,
    );
  });

  it('F-2310 AC-30 (c2601-jump-reconnect-password): a window connected through a password jump host asks the jump host and then the target for their passwords when the host comes back, and returns to SSH: <alias> without a reload', async () => {
    const alias = 'c2601-repw';
    const file = passwordChain(alias, 1, NOTICES_LOSS);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async () => {
        const activations = windowEvents(alias).filter(
          each => each.event === 'activated',
        ).length;
        const asked = recordLines('maskedInput', alias).length;
        appendScript([
          {...passwordAt(alias, '127.0.0.1', hostPassword())},
          {...passwordAt(alias, '127.0.0.2', hostPassword())},
        ]);
        const cutAt = Date.now();
        cutHostNetwork();
        try {
          await indicatorAfter(alias, 'Reconnecting to SSH', cutAt);
        } finally {
          restoreHostNetwork();
        }
        await connectedWithin(alias, 180_000);
        return {
          indicator: await indicatorOf(alias),
          reloads:
            windowEvents(alias).filter(each => each.event === 'activated')
              .length - activations,
          asked: recordLines('maskedInput', alias)
            .slice(asked)
            .map(line => line.question),
        };
      },
      {
        file,
        script: [
          passwordAt(alias, '127.0.0.1', hostPassword()),
          passwordAt(alias, '127.0.0.2', hostPassword()),
        ],
      },
    );
    deepStrictEqual(result, {
      indicator: `SSH: ${alias}`,
      reloads: 0,
      asked: [
        'Enter password for harness-pw@127.0.0.1',
        'Enter password for harness-pw@127.0.0.2',
      ],
    });
  });

  it('F-2310 AC-31 (c2601-jump-reconnect-cancel-part): cancelling the jump host input of a reconnection stops it, the indicator reads Disconnected from SSH and nothing more is asked', async () => {
    const alias = 'c2601-recancel';
    const file = passwordChain(alias, 1, NOTICES_LOSS);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async () => {
        const asked = recordLines('maskedInput', alias).length;
        appendScript([
          {
            surface: 'maskedInput',
            match: 'harness-pw@127.0.0.1',
            answer: 'dismiss',
            window: alias,
          },
        ]);
        const cutAt = Date.now();
        cutHostNetwork();
        try {
          await indicatorAfter(alias, 'Reconnecting to SSH', cutAt);
        } finally {
          restoreHostNetwork();
        }
        await indicatorAfter(alias, 'Disconnected from SSH', Date.now());
        await new Promise(resolve => setTimeout(resolve, 20_000));
        return {
          indicator: await indicatorOf(alias),
          toasts: await notifications(alias),
          asked: recordLines('maskedInput', alias).length - asked,
        };
      },
      {
        file,
        script: [
          passwordAt(alias, '127.0.0.1', hostPassword()),
          passwordAt(alias, '127.0.0.2', hostPassword()),
        ],
      },
    );
    deepStrictEqual(result, {
      indicator: `Disconnected from SSH: ${alias}`,
      toasts: [],
      asked: 1,
    });
  });

  it('F-2310 AC-33 (c2601-retry-platform): without the local server and a jump alias whose first attempt failed, Retry asks the platform pick again', async () => {
    const alias = 'c2601-replatform';
    const file = writeConfig(alias, [
      target(alias, `${alias}-hop`),
      hostBlock(`${alias}-hop`, ['Port 9'], ['Port']),
    ]);
    const result = await connectWith(
      alias,
      [],
      'fails',
      () => recordLines('platformPick', alias).length,
      {
        file,
        settings: {'remote.SSH.useLocalServer': false},
        script: [
          {
            surface: 'platformPick',
            match: 'platform',
            answer: 'linux',
            window: alias,
          },
          {
            surface: 'failureDialog',
            match: 'Could not establish connection',
            answer: {button: 'Retry'},
            window: alias,
          },
          {
            surface: 'platformPick',
            match: 'platform',
            answer: 'linux',
            window: alias,
          },
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
    deepStrictEqual(result, 2);
  });

  it('F-2310 AC-27 (c2601-kill-password-jump): Kill VS Code Server on Host... on a password jump alias asks the per-hop passwords and tells that the server was killed', async () => {
    const alias = 'c2601-killpw';
    const file = passwordChain(alias, 1);
    const saved = readUserSettings();
    await userSettings({'remote.SSH.configFile': file});
    try {
      const mark = await runWith('local', 'opensshremotes.cleanRemoteServer', [
        hostAnswer('local', {label: alias}),
        passwordAt('local', '127.0.0.1', hostPassword()),
        passwordAt('local', '127.0.0.2', hostPassword()),
        {surface: 'notice', match: 'VS Code Server on', answer: 'dismiss'},
      ]);
      const lines = linesSince(mark, 'local');
      deepStrictEqual(
        [
          lines
            .filter(line => line.surface === 'maskedInput')
            .map(line => line.question),
          lines
            .filter(line => line.surface === 'notice')
            .map(line => line.question),
        ],
        [
          [
            'Enter password for harness-pw@127.0.0.1',
            'Enter password for harness-pw@127.0.0.2',
          ],
          [`Killed VS Code Server on ${alias}.`],
        ],
      );
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2310 AC-21 (c2601-server-copy): with the server fetched by the client and copied to the target, a password jump host asks its password a second time for the copy, and the window connects', async () => {
    const alias = 'c2601-copy';
    const file = passwordChain(alias, 1);
    const result = await connectWith(
      alias,
      [],
      'connects',
      () => questionsOn(alias, 'maskedInput'),
      {
        file,
        settings: {'remote.SSH.localServerDownload': 'always'},
        script: [
          passwordAt(alias, '127.0.0.1', hostPassword()),
          passwordAt(alias, '127.0.0.2', hostPassword()),
          passwordAt(alias, '127.0.0.1', hostPassword()),
          passwordAt(alias, '127.0.0.2', hostPassword()),
        ],
      },
    );
    deepStrictEqual(result, [
      'Enter password for harness-pw@127.0.0.1',
      'Enter password for harness-pw@127.0.0.2',
      'Enter password for harness-pw@127.0.0.1',
      'Enter password for harness-pw@127.0.0.2',
    ]);
  });

  it('F-2310 AC-20 (c2601-password-new-window-part): New Window on Active Host through a password jump host connects with no input', async () => {
    const alias = 'c2601-pwnew';
    const file = passwordChain(alias, 1);
    const result = await connectWith(
      alias,
      [],
      'connects',
      async () => {
        const before = questionsOn(alias, 'maskedInput').length;
        const next = await nextEmptyWindow(() =>
          inWindow(alias, 'opensshremotes.openEmptyWindowOnCurrentHost'),
        );
        await waitFor(
          `${next} to be on the host`,
          async () => (await windowState(next)).remoteName === 'ssh-remote',
          120_000,
        );
        const asked = recordLines('maskedInput', next).length;
        await closeWindow(next);
        return {before, asked};
      },
      {
        file,
        script: [
          passwordAt(alias, '127.0.0.1', hostPassword()),
          passwordAt(alias, '127.0.0.2', hostPassword()),
        ],
      },
    );
    deepStrictEqual(result, {before: 2, asked: 0});
  });
});
