import {deepStrictEqual} from 'node:assert/strict';
import {TREE_KILL_SCRIPT, type ScriptRequest} from 'lib-host';
import {createWslHostChannel} from '../../src/host-channel.ts';
import {createPathMapper} from '../../src/path-mapper.ts';
import {createWslRunner} from '../../src/runner.ts';
import {fakeWsl, type FakeRun} from '../../src/testing/fake-wsl.ts';

const DISTRO = 'Ubuntu-22.04';

/** What a cancel at the first forwarded line did: the outcome, the lines, and the programs run in the distro. */
async function cancelled(
  lines: readonly string[],
): Promise<{kind: string; lines: string[]; tools: string[][]}> {
  const fake = fakeWsl(specification =>
    specification.programArguments.includes(TREE_KILL_SCRIPT)
      ? ({kind: 'exits', status: 0} satisfies FakeRun)
      : ({kind: 'printsUntilKilled', lines} satisfies FakeRun),
  );
  const runner = createWslRunner(fake);
  const channel = createWslHostChannel({
    runner,
    mapper: createPathMapper(runner),
    distro: DISTRO,
  });
  const controller = new AbortController();
  const seen: string[] = [];
  const request: ScriptRequest = {
    script: 'true',
    interpreter: 'posixShell',
    environment: {},
    input: {kind: 'text', text: ''},
    cancellation: controller.signal,
  };
  const outcome = await channel.runScript(request, line => {
    seen.push(line);
    controller.abort();
  });
  return {
    kind: outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
    lines: seen,
    tools: fake.started
      .filter(started => started.programArguments.includes(TREE_KILL_SCRIPT))
      .map(started => [...started.programArguments]),
  };
}

describe('host channel over WSL: a cancel (#3282)', () => {
  it('#3282: the shell’s reported process id is not a line of the script, and a cancel ends its tree with it', async () => {
    const result = await cancelled(['4242', 'first']);
    deepStrictEqual(
      [result.kind, result.lines, result.tools],
      [
        'cancelled',
        ['first'],
        [
          [
            '-d',
            DISTRO,
            '--cd',
            '~',
            '--exec',
            'sh',
            '-c',
            TREE_KILL_SCRIPT,
            'sh',
            '4242',
          ],
        ],
      ],
    );
  });

  it('#3282: a cancel before the process id arrives ends only wsl.exe', async () => {
    const result = await cancelled(['first']);
    deepStrictEqual(
      [result.kind, result.lines, result.tools],
      ['cancelled', ['first'], []],
    );
  });

  it('#3282: a second line that looks like a process id is a line of the script', async () => {
    const result = await cancelled(['4242', '99']);
    deepStrictEqual(result.lines, ['99']);
  });
});
