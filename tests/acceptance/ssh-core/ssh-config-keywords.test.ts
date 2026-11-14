/**
 * @fileoverview The ssh_config keywords that pass through to ssh (card #2593, F-2109): a host entry of the run with the
 * keywords under test, plain ssh against it first, then a window. Each row has an alias of its own, so that no row
 * reuses the connection of another.
 */

import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  connectionLog,
  hostPort,
  recordLines,
  variable,
} from '../windows/harness.ts';
import {clientKnows, connectWith, plainSsh} from './config-keywords-support.ts';

const CIPHER_LINES = [
  'Ciphers aes256-ctr',
  'MACs hmac-sha2-256',
  'KexAlgorithms curve25519-sha256',
  'Compression yes',
];

/** The buttons of the failure dialog, as the other rows of the suite name them. */
const FAILURE_BUTTONS = ['Close Remote', 'Retry', 'More Actions...'];

/** `text` with the alias of its row replaced by `c2593`, so that the texts of two rows can be compared. */
function asBase(text: string, alias: string): string {
  return text.replaceAll(alias, 'c2593');
}

/** The modes of the extension: the local connection server, and one `ssh` of its own per window. */
const MODES = [
  {mode: 'server', settings: {}},
  {
    mode: 'terminal',
    settings: {'remote.SSH.useLocalServer': false},
  },
] as const;

describe('ssh_config keywords passed through to ssh (card #2593)', function () {
  this.timeout(300_000);

  it('F-2109 AC-1, AC-2 (c2593-algorithms): Ciphers, MACs, KexAlgorithms and Compression the server supports connect as plain ssh does, with the progress and indicator of a connect without them', async () => {
    await connectWith('c2593-warm', [], 'connects', outcome => outcome);
    const baseline = await connectWith(
      'c2593-base',
      [],
      'connects',
      outcome => outcome,
    );
    const result = await connectWith(
      'c2593-algs',
      CIPHER_LINES,
      'connects',
      async (outcome, file) => ({
        plain: await plainSsh(file, 'c2593-algs'),
        outcome,
      }),
    );
    deepStrictEqual(
      [
        result.plain.status,
        asBase(result.outcome.indicator, 'c2593-algs'),
        result.outcome.progress.map(title => asBase(title, 'c2593-algs')),
      ],
      [
        0,
        asBase(baseline.indicator, 'c2593-base'),
        baseline.progress.map(title => asBase(title, 'c2593-base')),
      ],
    );
  });

  for (const level of ['QUIET', 'ERROR', 'DEBUG3']) {
    it(`F-2109 AC-3 (c2593-loglevel-${level.toLowerCase()}): LogLevel ${level} connects with no message of its own`, async () => {
      const result = await connectWith(
        `c2593-ll-${level.toLowerCase()}`,
        [`LogLevel ${level}`],
        'connects',
        outcome => outcome,
      );
      deepStrictEqual(
        [result.connected, result.toasts, result.dialog],
        [true, [], undefined],
      );
    });
  }

  it('F-2109 AC-3, AC-5 (c2593-quiet-cipher): LogLevel QUIET with a cipher the server does not offer shows the failure dialog, with no ssh message in the window, and the log holds the Unable to negotiate line', async () => {
    const result = await connectWith(
      'c2593-quiet-cipher',
      ['LogLevel QUIET', 'Ciphers 3des-cbc'],
      'fails',
      outcome => ({
        outcome,
        negotiate: connectionLog().some(line =>
          line.includes('Unable to negotiate'),
        ),
      }),
    );
    deepStrictEqual(
      [
        result.outcome.dialog,
        result.outcome.buttons,
        result.outcome.indicator,
        result.outcome.toasts,
        result.negotiate,
      ],
      [
        'Could not establish connection to "c2593-quiet-cipher".',
        FAILURE_BUTTONS,
        'Disconnected from SSH: c2593-quiet-cipher',
        [],
        true,
      ],
    );
  });

  it('F-2109 AC-5 (c2593-revoked): RevokedHostKeys listing the server key shows the failure dialog and no ssh message', async () => {
    const keys = execFileSync(
      'ssh-keyscan',
      ['-p', String(hostPort()), '127.0.0.1'],
      {
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter(line => line !== '' && !line.startsWith('#'))
      .map(line => line.split(' ').slice(1).join(' '))
      .join('\n');
    const revoked = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'c2593-revoked-keys',
    );
    execFileSync('sh', [
      '-c',
      `printf '%s\\n' "$1" > "$2"`,
      'sh',
      keys,
      revoked,
    ]);
    const result = await connectWith(
      'c2593-revoked',
      [`RevokedHostKeys ${revoked}`],
      'fails',
      async (outcome, file) => ({
        outcome,
        plain: (await plainSsh(file, 'c2593-revoked')).status,
      }),
    );
    deepStrictEqual(
      [
        result.plain,
        result.outcome.dialog,
        result.outcome.buttons,
        result.outcome.toasts,
      ],
      [
        255,
        'Could not establish connection to "c2593-revoked".',
        FAILURE_BUTTONS,
        [],
      ],
    );
  });

  it('F-2109 AC-7 (c2593-refuse): RefuseConnection shows the dialog without a reason, the text is not shown and the log holds ssh’s line', async function () {
    if (!(await clientKnows('RefuseConnection "c2593-refused-text"'))) {
      this.skip();
    }
    const result = await connectWith(
      'c2593-refuse',
      ['RefuseConnection "c2593-refused-text"'],
      'fails',
      async (outcome, file) => ({
        outcome,
        plain: await plainSsh(file, 'c2593-refuse'),
        logged: connectionLog().some(line =>
          line.includes('c2593-refused-text'),
        ),
      }),
    );
    deepStrictEqual(
      [
        result.plain.status,
        result.outcome.dialog,
        result.outcome.toasts,
        result.logged,
      ],
      [255, 'Could not establish connection to "c2593-refuse".', [], true],
      result.plain.stderr,
    );
  });

  it('F-2109 AC-10 (c2593-unknown): a keyword unknown to ssh shows the dialog without a reason, and the log holds the Bad configuration option line', async () => {
    const result = await connectWith(
      'c2593-unknown',
      ['NoSuchKeywordC2593 yes'],
      'fails',
      async (outcome, file) => ({
        outcome,
        plain: await plainSsh(file, 'c2593-unknown'),
        badOption: connectionLog().some(line =>
          line.includes('Bad configuration option'),
        ),
      }),
    );
    deepStrictEqual(
      [result.plain.status, result.outcome.dialog, result.badOption],
      [255, 'Could not establish connection to "c2593-unknown".', true],
    );
  });

  it('F-2109 AC-11 (c2593-providers): PKCS11Provider and SecurityKeyProvider naming missing files connect with no notification and no dialog', async () => {
    const result = await connectWith(
      'c2593-providers',
      [
        'PKCS11Provider /c2593/missing.so',
        'SecurityKeyProvider /c2593/missing.so',
      ],
      'connects',
      async (outcome, file) => ({
        outcome,
        plain: (await plainSsh(file, 'c2593-providers')).status,
      }),
    );
    deepStrictEqual(
      [result.plain, result.outcome.toasts, result.outcome.dialog],
      [0, [], undefined],
    );
  });

  for (const {mode, settings} of MODES) {
    it(`F-2109 AC-4 (c2593-logverbose-${mode}): LogVerbose naming ssh source functions puts debug2 or debug3 lines in the log in ${mode} mode`, async () => {
      const alias = `c2593-lv-${mode}`;
      const result = await connectWith(
        alias,
        ['LogVerbose kex.c:*,packet.c:*'],
        'connects',
        () =>
          connectionLog().filter(line => /debug[23]:/.test(line)).length > 0,
        {
          settings: {
            ...settings,
            'remote.SSH.remotePlatform': {[alias]: 'linux'},
          },
        },
      );
      deepStrictEqual(result, true);
    });

    it(`F-2109 AC-12, AC-18 (c2593-localcommand-${mode}): PermitLocalCommand runs the LocalCommand once in ${mode} mode`, async () => {
      const alias = `c2593-lc-${mode}`;
      const output = path.join(variable('HARNESS_RUN_FOLDER'), `${alias}.out`);
      const lines = await connectWith(
        alias,
        ['PermitLocalCommand yes', `LocalCommand echo "%n" >> ${output}`],
        'connects',
        () =>
          existsSync(output)
            ? readFileSync(output, 'utf8')
                .split('\n')
                .filter(line => line !== '')
            : [],
        {
          settings: {
            ...settings,
            'remote.SSH.remotePlatform': {[alias]: 'linux'},
          },
        },
      );
      deepStrictEqual(lines, [alias]);
    });
  }

  it('F-2109 AC-9 (c2593-canon-fails): canonicalization with CanonicalizeFallbackLocal no and an alias that does not resolve shows the dialog without a reason', async () => {
    const result = await connectWith(
      'c2593-canon-fails',
      ['CanonicalizeHostname yes', 'CanonicalizeFallbackLocal no'],
      'fails',
      async (outcome, file) => ({
        outcome,
        plain: await plainSsh(file, 'c2593-canon-fails'),
      }),
      {without: ['HostName']},
    );
    deepStrictEqual(
      [result.plain.status, result.outcome.dialog],
      [255, 'Could not establish connection to "c2593-canon-fails".'],
      result.plain.stderr,
    );
  });

  it('F-2109 AC-9 (c2593-canon-address): the same canonicalization keywords with HostName set to an address connect', async () => {
    const result = await connectWith(
      'c2593-canon-address',
      ['CanonicalizeHostname yes', 'CanonicalizeFallbackLocal no'],
      'connects',
      async (outcome, file) => ({
        outcome,
        plain: (await plainSsh(file, 'c2593-canon-address')).status,
      }),
    );
    deepStrictEqual(
      [result.plain, result.outcome.toasts, result.outcome.dialog],
      [0, [], undefined],
    );
  });

  it('F-2109 AC-16 (c2593-harmless): the harmless keywords of the specification together connect as without them', async () => {
    const result = await connectWith(
      'c2593-harmless',
      [
        'CASignatureAlgorithms ssh-ed25519',
        'RequiredRSASize 1024',
        'TCPKeepAlive yes',
        'IPQoS lowdelay throughput',
        'EscapeChar ~',
        'VerifyHostKeyDNS no',
        'GSSAPIAuthentication no',
        'GSSAPIDelegateCredentials no',
        'HostbasedAuthentication no',
        'RekeyLimit 1M 20s',
      ],
      'connects',
      async (outcome, file) => ({
        outcome,
        plain: await plainSsh(file, 'c2593-harmless'),
      }),
    );
    deepStrictEqual(
      [result.plain.status, result.outcome.toasts, result.outcome.dialog],
      [0, [], undefined],
      result.plain.stderr,
    );
  });

  it('F-2109 AC-19 (c2593-weak-default): KexAlgorithms restricted to a non-post-quantum method the server offers, with WarnWeakCrypto at its default, connects with no notification and no dialog', async () => {
    const result = await connectWith(
      'c2593-weak-default',
      ['KexAlgorithms curve25519-sha256'],
      'connects',
      async (outcome, file) => ({
        outcome,
        plain: (await plainSsh(file, 'c2593-weak-default')).status,
      }),
    );
    deepStrictEqual(
      [result.plain, result.outcome.toasts, result.outcome.dialog],
      [0, [], undefined],
    );
  });

  it('F-2109 AC-19 (c2593-weak-no-pq): the same with WarnWeakCrypto no-pq-kex', async function () {
    if (!(await clientKnows('WarnWeakCrypto no-pq-kex'))) {
      this.skip();
    }
    const result = await connectWith(
      'c2593-weak-no-pq',
      ['KexAlgorithms curve25519-sha256', 'WarnWeakCrypto no-pq-kex'],
      'connects',
      async (outcome, file) => ({
        outcome,
        plain: await plainSsh(file, 'c2593-weak-no-pq'),
      }),
    );
    deepStrictEqual(
      [result.plain.status, result.outcome.toasts, result.outcome.dialog],
      [0, [], undefined],
      result.plain.stderr,
    );
  });

  it('F-2109 AC-6 (c2593-more-actions): More Actions... on the failure dialog lists the actions that help resolve the problem', async () => {
    const alias = 'c2593-more';
    const result = await connectWith(
      alias,
      ['Ciphers 3des-cbc'],
      'fails',
      () =>
        recordLines('mitigationPick', alias).map(line => [
          line.question,
          line.items,
        ]),
      {
        script: [
          {
            surface: 'failureDialog',
            match: 'Could not establish connection',
            answer: {button: 'More Actions...'},
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
    deepStrictEqual(result, [
      [
        'Pick an action to help resolve the problem.',
        [
          'Reload Window',
          'Open Recent...',
          'Open Documentation',
          'Open SSH Configuration File',
          'Open Settings',
        ],
      ],
    ]);
  });

  it('F-2109 AC-6 (c2593-retry): Retry on the failure dialog reloads the window, which fails the same way', async () => {
    const alias = 'c2593-retry';
    const questions = await connectWith(
      alias,
      ['Ciphers 3des-cbc'],
      'fails',
      () => recordLines('failureDialog', alias).map(line => line.question),
      {
        script: [
          {
            surface: 'failureDialog',
            match: 'Could not establish connection',
            answer: {button: 'Retry'},
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
    deepStrictEqual(questions.slice(0, 2), [
      'Could not establish connection to "c2593-retry".',
      'Could not establish connection to "c2593-retry".',
    ]);
  });

  it('F-2109 AC-17 (c2593-nothing-written): a connect with keywords writes no setting and shows no notification of its own', async () => {
    const result = await connectWith(
      'c2593-nothing',
      ['LogLevel ERROR', 'Compression yes', 'LogVerbose kex.c:*'],
      'connects',
      outcome => outcome,
    );
    deepStrictEqual(
      [result.settingsAfter, result.toasts],
      [result.settingsBefore, []],
    );
  });

  it('F-2109 AC-14 (c2593-hashed): HashKnownHosts yes with a host missing from the known-hosts file connects once the key question is answered yes, and ssh writes one hashed line', async () => {
    const alias = 'c2593-hashed';
    const known = path.join(variable('HARNESS_RUN_FOLDER'), `${alias}.known`);
    writeFileSync(known, '');
    const lines = await connectWith(
      alias,
      [
        'HashKnownHosts yes',
        'StrictHostKeyChecking ask',
        `UserKnownHostsFile ${known}`,
      ],
      'connects',
      () =>
        readFileSync(known, 'utf8')
          .split('\n')
          .filter(line => line !== ''),
      {
        without: ['BatchMode', 'StrictHostKeyChecking', 'UserKnownHostsFile'],
        script: [
          {
            surface: 'pick',
            match: 'fingerprint',
            answer: 'yes',
            window: alias,
          },
        ],
      },
    );
    deepStrictEqual([lines.length, lines[0]?.startsWith('|1|')], [1, true]);
  });

  it('F-2109 AC-14 (c2593-knownhostscommand): KnownHostsCommand supplying the key connects with no question and writes nothing', async () => {
    const alias = 'c2593-khc';
    const known = path.join(variable('HARNESS_RUN_FOLDER'), `${alias}.known`);
    const keys = path.join(variable('HARNESS_RUN_FOLDER'), `${alias}.keys`);
    writeFileSync(known, '');
    writeFileSync(
      keys,
      execFileSync(
        'ssh-keyscan',
        ['-t', 'ed25519', '-p', String(hostPort()), '127.0.0.1'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ),
    );
    const result = await connectWith(
      alias,
      [
        'StrictHostKeyChecking yes',
        `UserKnownHostsFile ${known}`,
        `KnownHostsCommand /bin/cat ${keys}`,
      ],
      'connects',
      () => ({
        written: readFileSync(known, 'utf8'),
        questions: recordLines('pick', alias).length,
      }),
      {without: ['StrictHostKeyChecking', 'UserKnownHostsFile']},
    );
    deepStrictEqual(result, {written: '', questions: 0});
  });

  it('F-2109 AC-8 (c2593-other-key-type): a keyword that makes ssh select a host key type the known-hosts file lacks shows the dialog about the changed host key', async () => {
    const alias = 'c2593-keytype';
    const known = path.join(variable('HARNESS_RUN_FOLDER'), `${alias}.known`);
    writeFileSync(
      known,
      execFileSync(
        'ssh-keyscan',
        ['-t', 'ed25519', '-p', String(hostPort()), '127.0.0.1'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ),
    );
    const result = await connectWith(
      alias,
      ['HostKeyAlgorithms ecdsa-sha2-nistp256', `UserKnownHostsFile ${known}`],
      'fails',
      async (outcome, file) => ({outcome, plain: await plainSsh(file, alias)}),
      {without: ['UserKnownHostsFile']},
    );
    deepStrictEqual(
      result.outcome.dialog,
      'Could not establish connection to "c2593-keytype": Remote host key has changed, port forwarding is disabled.',
      result.plain.stderr,
    );
  });
});
