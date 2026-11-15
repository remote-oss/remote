/**
 * @fileoverview F-2310's host-key rows in the wording of OpenSSH 10.2 (card #2610): the launch's Remote - SSH runs the
 * pinned client through `remote.SSH.path`, which asks the host-key question of every hop as a free-text input and not
 * as the fingerprint pick of the classic wording.
 */

import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {recordLines, variable} from '../windows/harness.ts';
import {
  ASK_WITHOUT,
  askLines,
  connectWith,
  freshKnown,
  hostBlock,
  launchSsh,
  MODES,
  writeConfig,
} from '../windows/config-keywords-support.ts';

describe('F-2310 host-key questions in the wording of OpenSSH 10.2 (card #2610)', function () {
  this.timeout(300_000);

  it('PROBE c2610-probe-client: the text of the host-key questions the pinned client asks through SSH_ASKPASS', async () => {
    const alias = 'c2610-probe-client';
    const known = freshKnown(alias);
    const file = writeConfig(alias, [
      hostBlock(
        alias,
        [`ProxyJump ${alias}-hop`, 'Port 22', ...askLines(known)],
        ['Port', ...ASK_WITHOUT],
      ),
      hostBlock(`${alias}-hop`, askLines(known), ASK_WITHOUT),
    ]);
    const folder = variable('HARNESS_RUN_FOLDER');
    const logged = path.join(folder, `${alias}.asked`);
    const askpass = path.join(folder, `${alias}-askpass`);
    writeFileSync(
      askpass,
      `#!/bin/sh\nprintf '%s\\n----\\n' "$1" >> ${logged}\nprintf 'no\\n'\n`,
    );
    chmodSync(askpass, 0o755);
    const version = spawnSync(launchSsh(), ['-V'], {encoding: 'utf8'});
    spawnSync(launchSsh(), ['-F', file, alias, 'true'], {
      encoding: 'utf8',
      env: {...process.env, SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force'},
      timeout: 30_000,
    });
    deepStrictEqual(
      [
        version.stderr.trim(),
        existsSync(logged) ? readFileSync(logged, 'utf8') : '',
      ],
      [],
      'PROBE',
    );
  });

  for (const {mode, settings} of MODES) {
    it(`PROBE c2610-probe-${mode}: what a window asks with unknown keys behind a jump host`, async () => {
      const alias = `c2610-probe-${mode}`;
      const known = freshKnown(alias);
      const file = writeConfig(alias, [
        hostBlock(
          alias,
          [`ProxyJump ${alias}-hop`, 'Port 22', ...askLines(known)],
          ['Port', ...ASK_WITHOUT],
        ),
        hostBlock(`${alias}-hop`, askLines(known), ASK_WITHOUT),
      ]);
      const result = await connectWith(
        alias,
        [],
        'fails',
        () =>
          recordLines(undefined, alias).map(
            line =>
              `${line.surface}|${line.question.slice(0, 200)}|${line.answer}`,
          ),
        {
          file,
          script: [],
          settings: {
            ...settings,
            'remote.SSH.remotePlatform': {[alias]: 'linux'},
          },
        },
      );
      deepStrictEqual(result, [], 'PROBE');
    });
  }
});
