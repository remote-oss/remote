/**
 * @fileoverview The ssh_config keywords that pass through to ssh (card #2593, F-2109): a host entry of the run with the
 * keywords under test, plain ssh against it first, then a window.
 */

import {deepStrictEqual} from 'node:assert';
import {connectionLog} from '../windows/harness.ts';
import {connectWith, plainSsh} from './config-keywords-support.ts';

const CIPHER_LINES = [
  'Ciphers aes256-ctr',
  'MACs hmac-sha2-256',
  'KexAlgorithms curve25519-sha256',
  'Compression yes',
];

describe('ssh_config keywords passed through to ssh (card #2593)', function () {
  this.timeout(300_000);

  it('F-2109 AC-1, AC-2 (c2593-algorithms): Ciphers, MACs, KexAlgorithms and Compression the server supports connect as plain ssh does, with the title and indicator of a connect without them', async () => {
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
        plain: await plainSsh(file),
        outcome,
      }),
    );
    deepStrictEqual(
      [result.plain.status, result.outcome.indicator, result.outcome.progress],
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

  it('F-2109 AC-3 (c2593-quiet-cipher): LogLevel QUIET with a cipher the server does not offer shows the failure dialog, and the log holds the Unable to negotiate line', async () => {
    const result = await connectWith(
      'c2593-quiet-cipher',
      ['LogLevel QUIET', 'Ciphers 3des-cbc'],
      'fails',
      outcome => outcome,
    );
    deepStrictEqual(
      [
        result.dialog,
        connectionLog().some(line => line.includes('Unable to negotiate')),
      ],
      ['Could not establish connection to "c2593".', true],
    );
  });
});
