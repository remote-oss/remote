import {deepStrictEqual} from 'node:assert';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {hasNoTty, ptyConnect, type PtyConnect} from '../windows/pty-support.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';

/** The setting that lets the connection's ssh allocate a pseudo-terminal. */
const PERMIT = 'remote.SSH.permitPtyAllocation';

/** What a connect showed of its allocation: whether it connected, whether ssh carried -T, and the host's terminals. */
function summary(found: PtyConnect): [boolean, boolean[], string[]] {
  return [found.connected, found.commands.map(hasNoTty), found.sessions];
}

describe('F-2106: pseudo-terminal allocation', function () {
  this.timeout(900_000);
  beforeEach(closeAllButLocal);

  it('F-2106 AC-1 (c86-default): by default the ssh command carries -T, the host session has no terminal and the connection succeeds', async () => {
    await keepingSettings(async () => {
      deepStrictEqual(summary(await ptyConnect('c86-default', 'harness', {})), [
        true,
        [true],
        ['notty'],
      ]);
    });
  });

  it('F-2106 AC-2 (c86-off-force): with the setting off, a RequestTTY force in the host entry allocates no terminal in the shared, the terminal and the second-ssh modes', async () => {
    await keepingSettings(async () => {
      const seen: Array<ReturnType<typeof summary>> = [];
      for (const settings of [
        {},
        {'remote.SSH.useLocalServer': false},
        {'remote.SSH.useExecServer': false},
      ]) {
        await closeAllButLocal();
        seen.push(
          summary(await ptyConnect('c86-off-force', 'pty-force', settings)),
        );
      }
      deepStrictEqual(seen, [
        [true, [true], ['notty']],
        [true, [true], ['notty']],
        [true, [true], ['notty']],
      ]);
    });
  });

  it('F-2106 AC-3 (c86-on): with the setting on and no RequestTTY the new connection has no -T and the session has no terminal', async () => {
    await keepingSettings(async () => {
      deepStrictEqual(
        summary(await ptyConnect('c86-on', 'harness', {[PERMIT]: true})),
        [true, [false], ['notty']],
      );
    });
  });

  it('F-2106 AC-4 (c86-on-request): with the setting on, RequestTTY yes and RequestTTY no both leave the session without a terminal', async () => {
    await keepingSettings(async () => {
      const seen: Array<ReturnType<typeof summary>> = [];
      for (const alias of ['pty-yes', 'pty-no']) {
        await closeAllButLocal();
        seen.push(
          summary(await ptyConnect('c86-on-request', alias, {[PERMIT]: true})),
        );
      }
      deepStrictEqual(seen, [
        [true, [false], ['notty']],
        [true, [false], ['notty']],
      ]);
    });
  });

  it('F-2106 AC-5 (c86-on-terminal): with the setting on and the local server off the command has no -T, the session no terminal, and it connects', async () => {
    await keepingSettings(async () => {
      deepStrictEqual(
        summary(
          await ptyConnect('c86-on-terminal', 'harness', {
            [PERMIT]: true,
            'remote.SSH.useLocalServer': false,
          }),
        ),
        [true, [false], ['notty']],
      );
    });
  });

  it('F-2106 AC-10 (c86-values): a value that is not a boolean acts by truthiness: "yes", "false" and 1 as on; "" and 0 as off', async () => {
    await keepingSettings(async () => {
      const seen: boolean[] = [];
      for (const value of ['yes', 'false', 1, '', 0]) {
        await closeAllButLocal();
        const found = await ptyConnect('c86-values', 'harness', {
          [PERMIT]: value,
        });
        seen.push(found.commands.some(hasNoTty));
      }
      deepStrictEqual(seen, [false, false, false, true, true]);
    });
  });

  it('F-2106 AC-14 (c86-warning): with the setting on and RequestTTY yes in the shared mode the ssh client’s own warning about the pseudo-terminal is in the log, unaltered', async () => {
    await keepingSettings(async () => {
      const found = await ptyConnect('c86-warning', 'pty-yes', {
        [PERMIT]: true,
      });
      deepStrictEqual(
        found.logged.filter(line => line.includes('Pseudo-terminal')),
        [
          '[ssh] Pseudo-terminal will not be allocated because stdin is not a terminal.',
        ],
      );
    });
  });
});
