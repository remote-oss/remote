/**
 * @fileoverview A LocalCommand's output in the log (card #2598, F-2109 AC-12): its standard output as `[local command]`
 * lines and, in the local-server mode, its standard error as `[ssh]` lines (a terminal merges the two streams, so
 * there both are `[local command]` lines). The rows assert the command's own text and nothing around it.
 */

import {deepStrictEqual} from 'node:assert';
import {connectWith} from '../windows/config-keywords-support.ts';

describe('a LocalCommand’s output in the log (card #2598)', function () {
  this.timeout(300_000);

  /** The log lines that hold the markers of `command` run as a `LocalCommand` in `mode`, sorted. */
  async function markersIn(
    mode: 'server' | 'terminal',
    command = `echo out-marker-${mode}; echo err-marker-${mode} >&2; exit 3`,
    alias = `c2598-${mode}`,
  ): Promise<string[]> {
    const lines = await connectWith(
      alias,
      ['PermitLocalCommand yes', `LocalCommand ${command}`],
      'connects',
      outcome => outcome.connectLog.filter(line => line.includes('-marker-')),
      {
        settings: {
          ...(mode === 'terminal' ? {'remote.SSH.useLocalServer': false} : {}),
          'remote.SSH.remotePlatform': {[alias]: 'linux'},
        },
      },
    );
    return lines.sort();
  }

  it('F-2109 AC-12 (c2598-localcommand-log-server): in the local-server mode the output of the LocalCommand is in the log, its standard output as a [local command] line and its standard error as an [ssh] line', async () => {
    deepStrictEqual(await markersIn('server'), [
      '[local command] out-marker-server',
      '[ssh] err-marker-server',
    ]);
  });

  it('F-2109 AC-12 (c2598-localcommand-log-terminal): in the terminal mode both streams of the LocalCommand are [local command] lines in the log', async () => {
    deepStrictEqual(await markersIn('terminal'), [
      '[local command] err-marker-terminal',
      '[local command] out-marker-terminal',
    ]);
  });

  it('F-2109 AC-12 (c2598-localcommand-printf-terminal): in the terminal mode the last words of a LocalCommand that writes no line end are a [local command] line in the log, and the connection works', async () => {
    deepStrictEqual(
      await markersIn(
        'terminal',
        'printf out-marker-tail',
        'c2598-printf-terminal',
      ),
      ['[local command] out-marker-tail'],
    );
  });
});
