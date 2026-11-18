/**
 * @fileoverview The two lock settings in the Remote - SSH log (card #2819, F-2408 AC-3): the settings list of the
 * log of any connect shows the current value of both, `remote.SSH.<name> = <JSON value>`.
 */

import {deepStrictEqual} from 'node:assert';
import {connectWith} from '../windows/config-keywords-support.ts';

describe('the lock settings in the Remote - SSH log (card #2819, F-2408 AC-3)', function () {
  this.timeout(300_000);

  /** The log lines of the connect of `alias` that show a lock setting under `settings`, and every settings line it shows. */
  async function lockLines(
    alias: string,
    settings: Readonly<Record<string, unknown>>,
  ): Promise<{locks: string[]; shown: string[]}> {
    return connectWith(
      alias,
      [],
      'connects',
      outcome => {
        const shown = outcome.connectLog.filter(line =>
          line.startsWith('remote.SSH.'),
        );
        return {
          locks: shown
            .filter(line =>
              /^remote\.SSH\.(lockfilesInTmp|useFlock) = /u.test(line),
            )
            .toSorted(),
          shown,
        };
      },
      {settings},
    );
  }

  /** What the row says when the log does not list the settings: which settings lines it does show. */
  function listing(found: {shown: string[]}): string {
    return `the settings list of the log must show both lock settings; the log shows only these settings lines: ${JSON.stringify(found.shown)}`;
  }

  it('F-2408 AC-3 (c2819-log-default): the log of a connect shows both settings at their defaults', async () => {
    const found = await lockLines('c2819-log-default', {});
    deepStrictEqual(
      found.locks,
      ['remote.SSH.lockfilesInTmp = false', 'remote.SSH.useFlock = true'],
      listing(found),
    );
  });

  it('F-2408 AC-3 (c2819-log-changed): after both are changed the log of the next connect shows the new values', async () => {
    const found = await lockLines('c2819-log-changed', {
      'remote.SSH.lockfilesInTmp': true,
      'remote.SSH.useFlock': false,
    });
    deepStrictEqual(
      found.locks,
      ['remote.SSH.lockfilesInTmp = true', 'remote.SSH.useFlock = false'],
      listing(found),
    );
  });
});
