import {connectWith} from './config-keywords-support.ts';

describe('probe: LocalCommand output (card #2598)', function () {
  this.timeout(600_000);

  it('probe: where a LocalCommand writes its stdout and stderr in both modes', async () => {
    const found: string[] = [];
    for (const mode of ['server', 'terminal'] as const) {
      const alias = `c2598-${mode}`;
      const seen = await connectWith(
        alias,
        [
          'PermitLocalCommand yes',
          `LocalCommand echo out-marker-${mode}; echo err-marker-${mode} >&2; exit 3`,
        ],
        'connects',
        outcome => outcome.connectLog,
        {
          settings:
            mode === 'terminal'
              ? {
                  'remote.SSH.useLocalServer': false,
                  'remote.SSH.remotePlatform': {[alias]: 'linux'},
                }
              : {'remote.SSH.remotePlatform': {[alias]: 'linux'}},
        },
      );
      found.push(
        `== ${mode}: ${String(seen.length)} log lines; lines naming a marker:`,
        ...seen.filter(line => /marker/.test(line)),
        `-- the [ssh] lines (${String(seen.filter(line => line.includes('[ssh]')).length}):`,
        ...seen.filter(line => line.includes('[ssh]')).slice(0, 12),
      );
    }
    throw new Error(`PROBE RESULT\n${found.join('\n')}`);
  });
});
