/**
 * @fileoverview F-2310's host-key rows in the wording of OpenSSH 10.2 (card #2610): the launch's Remote - SSH runs the
 * pinned client through `remote.SSH.path`, which asks the host-key question of every hop as a free-text input and not
 * as the fingerprint pick of the classic wording.
 */

import {deepStrictEqual} from 'node:assert';
import {recordLines} from '../windows/harness.ts';
import {
  ASK_WITHOUT,
  askLines,
  connectWith,
  freshKnown,
  hostBlock,
  MODES,
  writeConfig,
} from '../windows/config-keywords-support.ts';

describe('F-2310 host-key questions in the wording of OpenSSH 10.2 (card #2610)', function () {
  this.timeout(300_000);

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
