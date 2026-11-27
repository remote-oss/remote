import {deepStrictEqual} from 'node:assert/strict';
import {TREE_KILL_SCRIPT, type ScriptRequest} from 'lib-host';
import {createWslHostChannel} from '../../src/host-channel.ts';
import {createPathMapper} from '../../src/path-mapper.ts';
import {createWslRunner} from '../../src/runner.ts';
import {fakeWsl, type FakeRun} from '../../src/testing/fake-wsl.ts';

const DISTRO = 'Ubuntu-22.04';
const BOUND_MS = 50;

/** What a cancel at the first forwarded line did: the outcome, the lines, the tree-kill runs and the log. */
async function cancelled(
  lines: readonly string[],
  killing: FakeRun,
  spacingMs = 0,
): Promise<{
  kind: string;
  lines: string[];
  tools: string[][];
  logged: string[];
}> {
  const fake = fakeWsl(specification =>
    specification.programArguments.includes(TREE_KILL_SCRIPT)
      ? killing
      : ({kind: 'printsUntilKilled', lines} satisfies FakeRun),
  );
  const runner = createWslRunner({
    ...fake,
    spawner: async specification => {
      const handle = await fake.spawner(specification);
      return specification.programArguments.includes(TREE_KILL_SCRIPT)
        ? handle
        : {
            ...handle,
            onOutput: listener => {
              handle.onOutput(chunk => {
                new TextDecoder()
                  .decode(chunk)
                  .split('\n')
                  .filter(line => line !== '')
                  .forEach((line, index) => {
                    setTimeout(() => {
                      listener(new TextEncoder().encode(`${line}\n`));
                    }, index * spacingMs);
                  });
              });
            },
          };
    },
  });
  const logged: string[] = [];
  const channel = createWslHostChannel({
    runner,
    mapper: createPathMapper(runner),
    distro: DISTRO,
    logLine: message => logged.push(message),
    treeKillBoundMs: BOUND_MS,
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
    logged,
  };
}

const KILLED: FakeRun = {kind: 'exits', status: 0};

const TREE_KILL_RUN = [
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
];

describe('host channel over WSL: a cancel (#3282)', () => {
  it('#3282: the shell’s reported process id is not a line of the script, and a cancel ends its tree with it', async () => {
    const result = await cancelled(['4242', 'first'], KILLED);
    deepStrictEqual(
      [result.kind, result.lines, result.tools, result.logged],
      ['cancelled', ['first'], [TREE_KILL_RUN], []],
    );
  });

  it('#3282: a cancel before the process id arrives waits for it, then ends the tree', async () => {
    const result = await cancelled(['first', '4242'], KILLED, 20);
    deepStrictEqual(
      [result.kind, result.lines, result.tools, result.logged],
      ['cancelled', ['first'], [TREE_KILL_RUN], []],
    );
  });

  it('#3282: a cancel with no process id within the bound ends wsl.exe alone and says so', async () => {
    const result = await cancelled(['first'], KILLED);
    deepStrictEqual(
      [result.kind, result.lines, result.tools, result.logged],
      [
        'cancelled',
        ['first'],
        [],
        [
          `cancelled before the shell reported its process id in ${DISTRO}: only wsl.exe is ended`,
        ],
      ],
    );
  });

  it('#3282: a tree-kill that does not end within the bound is ended, wsl.exe is ended anyway, the cancel is reported and the log says so', async () => {
    const result = await cancelled(['4242', 'first'], {
      kind: 'printsUntilKilled',
      lines: [],
    });
    deepStrictEqual(
      [result.kind, result.logged],
      [
        'cancelled',
        [
          `the tree of process 4242 in ${DISTRO} was not confirmed ended within ${String(BOUND_MS)} ms: wsl.exe is ended anyway`,
        ],
      ],
    );
  });

  it('#3282: a tree-kill that fails is not confirmed, and the cancel is still reported', async () => {
    const result = await cancelled(['4242', 'first'], {
      kind: 'exits',
      status: 1,
    });
    deepStrictEqual([result.kind, result.logged.length], ['cancelled', 1]);
  });

  it('#3282: a second line that looks like a process id is a line of the script', async () => {
    const result = await cancelled(['4242', '99'], KILLED);
    deepStrictEqual(result.lines, ['99']);
  });
});
