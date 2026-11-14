/**
 * @fileoverview The ssh_config keywords that pass through to ssh (card #2593, F-2109): a host entry of the run with the
 * keywords under test, plain ssh against it first, then a window. Each row has an alias of its own, so that no row
 * reuses the connection of another.
 */

import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {connectionLog, hostPort, variable} from '../windows/harness.ts';
import {connectWith, plainSsh} from './config-keywords-support.ts';

const CIPHER_LINES = [
  'Ciphers aes256-ctr',
  'MACs hmac-sha2-256',
  'KexAlgorithms curve25519-sha256',
  'Compression yes',
];

/** The buttons of the failure dialog, as the other rows of the suite name them. */
const FAILURE_BUTTONS = ['Close Remote', 'Retry', 'More Actions...'];

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
        result.outcome.indicator,
        result.outcome.progress.map(title =>
          title.replace('c2593-algs', 'c2593-base'),
        ),
      ],
      [0, baseline.indicator, baseline.progress],
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
        'Disconnected from SSH',
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

  it('F-2109 AC-7 (c2593-refuse): RefuseConnection shows the dialog without a reason, the text is not shown and the log holds ssh’s line', async () => {
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
        {...settings, 'remote.SSH.remotePlatform': {[alias]: 'linux'}},
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
        {...settings, 'remote.SSH.remotePlatform': {[alias]: 'linux'}},
      );
      deepStrictEqual(lines, [alias]);
    });
  }
});
