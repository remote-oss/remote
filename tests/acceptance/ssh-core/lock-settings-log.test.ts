/**
 * @fileoverview The two lock settings in the Remote - SSH log (card #2819, F-2408 AC-3): the settings list of the
 * log of any connect shows the current value of both, `remote.SSH.<name> = <JSON value>`.
 */

import {deepStrictEqual} from 'node:assert';
import {connectWith} from '../windows/config-keywords-support.ts';

describe('the lock settings in the Remote - SSH log (card #2819, F-2408 AC-3)', function () {
  this.timeout(300_000);

  /** The log lines of the connect of `alias` that show a lock setting, under `settings`. */
  async function lockLines(
    alias: string,
    settings: Readonly<Record<string, unknown>>,
  ): Promise<string[]> {
    return connectWith(
      alias,
      [],
      'connects',
      outcome =>
        outcome.connectLog
          .filter(line =>
            /^remote\.SSH\.(lockfilesInTmp|useFlock) = /u.test(line),
          )
          .toSorted(),
      {settings},
    );
  }

  it('F-2408 AC-3 (c2819-log-default): the log of a connect shows both settings at their defaults', async () => {
    deepStrictEqual(await lockLines('c2819-log-default', {}), [
      'remote.SSH.lockfilesInTmp = false',
      'remote.SSH.useFlock = true',
    ]);
  });

  it('F-2408 AC-3 (c2819-log-changed): after both are changed the log of the next connect shows the new values', async () => {
    deepStrictEqual(
      await lockLines('c2819-log-changed', {
        'remote.SSH.lockfilesInTmp': true,
        'remote.SSH.useFlock': false,
      }),
      ['remote.SSH.lockfilesInTmp = true', 'remote.SSH.useFlock = false'],
    );
  });
});
