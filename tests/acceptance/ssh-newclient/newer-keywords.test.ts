/**
 * @fileoverview The ssh_config keywords newer than the runners' OpenSSH (card #2600, F-2109): the launch's Remote - SSH
 * runs the pinned client through `remote.SSH.path`, and each row runs plain `ssh` through the same path first.
 */

import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  connectWith,
  launchSsh,
  MODES,
  plainSsh,
} from '../windows/config-keywords-support.ts';
import {variable} from '../windows/harness.ts';

describe('ssh_config keywords newer than the runners’ OpenSSH (card #2600)', function () {
  this.timeout(300_000);

  it('contracts harness: the launch’s remote.SSH.path is the pinned client the run built, and it reports OpenSSH 10.6p2', () => {
    const client = launchSsh();
    const version = spawnSync(client, ['-V'], {encoding: 'utf8'});
    deepStrictEqual(
      [client, version.status, /^OpenSSH_10\.6p2,/.test(version.stderr)],
      [variable('HARNESS_SSH_CLIENT'), 0, true],
      version.stderr,
    );
  });

  it('F-2109 AC-7 (c2593-refuse): RefuseConnection shows the dialog without a reason in either mode, the text is not shown and the log holds ssh’s line', async () => {
    const results = [];
    for (const {mode, settings} of MODES) {
      const alias = `c2593-refuse-${mode}`;
      results.push(
        await connectWith(
          alias,
          ['RefuseConnection "c2593-refused-text"'],
          'fails',
          async (outcome, file) => ({
            plain: (await plainSsh(file, alias)).status,
            dialog: outcome.dialog,
            toasts: outcome.toasts,
            logged: outcome.connectLog.some(line =>
              line.includes('c2593-refused-text'),
            ),
          }),
          {
            settings: {
              ...settings,
              'remote.SSH.remotePlatform': {[alias]: 'linux'},
            },
          },
        ),
      );
    }
    deepStrictEqual(
      results,
      MODES.map(({mode}) => ({
        plain: 255,
        dialog: `Could not establish connection to "c2593-refuse-${mode}".`,
        toasts: [],
        logged: true,
      })),
    );
  });

  it('F-2109 AC-19 (c2593-weak-default): KexAlgorithms restricted to a non-post-quantum method the server offers, with WarnWeakCrypto at its default, connects with no notification and no dialog', async () => {
    const result = await connectWith(
      'c2593-weak-default',
      ['KexAlgorithms curve25519-sha256'],
      'connects',
      async (outcome, file) => ({
        outcome,
        plain: await plainSsh(file, 'c2593-weak-default'),
      }),
    );
    deepStrictEqual(
      [result.plain.status, result.outcome.toasts, result.outcome.dialog],
      [0, [], undefined],
      result.plain.stderr,
    );
  });

  it('F-2109 AC-19 (c2593-weak-no-pq): the same with WarnWeakCrypto no-pq-kex', async () => {
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
});
