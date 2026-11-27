import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {ChannelFailureKind} from 'lib-host';
import {
  channelContractCases,
  ruleScriptOf,
  LARGE_COPY_LENGTH,
  stagedInputOf,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from 'lib-host/testing/channel-contract';
import {wslProcessOf} from '../../src/child-process.ts';
import {createWslHostChannel} from '../../src/host-channel.ts';
import type {
  WslProcess,
  WslProcessSpecification,
} from '../../src/process-port.ts';
import {createPathMapper} from '../../src/path-mapper.ts';
import {createWslRunner} from '../../src/runner.ts';
import {
  type FakeRun,
  fakeWsl,
  utf16Output,
  utf8Output,
} from '../../src/testing/fake-wsl.ts';

const DISTRO = 'Ubuntu-22.04';
const LOCAL_FILE = 'C:\\Users\\me\\archive.tar.gz';
const MOUNTED_FILE = '/mnt/c/Users/me/archive.tar.gz';

/** The run of a program that prints `lines`, then ends with `status`. */
function prints(lines: readonly string[], status: number): FakeRun {
  return {
    kind: 'exits',
    stdout: utf8Output(lines.map(line => `${line}\n`).join('')),
    status,
  };
}

/** The run `wsl.exe` itself fails with when it does not know the distro. */
const UNKNOWN_DISTRO: FakeRun = {
  kind: 'exits',
  stdout: utf16Output('There is no distribution with the supplied name.\r\n'),
  status: 0xffffffff,
};

/** The run for a failure of `kind`, or the start error it comes from. */
function failureRun(kind: ChannelFailureKind): FakeRun {
  switch (kind) {
    case 'channelClosed':
      return UNKNOWN_DISTRO;
    case 'spawnFailed':
      return {
        kind: 'failsToStart',
        error: {code: 'EMFILE', message: 'too many open files'},
      };
    default:
      return {kind: 'printsUntilKilled', lines: []};
  }
}

/** The run of a copy that fails with `kind`. */
function copyRun(kind: ChannelFailureKind): FakeRun {
  return kind === 'copyFailed'
    ? {
        kind: 'afterInput',
        then: {
          kind: 'exits',
          stderr: utf8Output('Permission denied\n'),
          status: 1,
        },
      }
    : failureRun(kind);
}

/** The run each started process gets, in order: `runs`, the last one repeated. */
function inOrder(...runs: FakeRun[]): () => FakeRun {
  let index = 0;
  return () => {
    const next = runs[Math.min(index, runs.length - 1)] ?? runs[0];
    index += 1;
    return next ?? prints([], 0);
  };
}

function runsFor(scenario: ContractScenario): () => FakeRun {
  switch (scenario.kind) {
    case 'printsLines':
      return inOrder(prints(scenario.lines, scenario.status));
    case 'printsUntilCancelled':
    case 'streamsUntilCancelled':
      return inOrder({kind: 'printsUntilKilled', lines: scenario.lines});
    case 'scriptFails':
      return inOrder(failureRun(scenario.failure));
    case 'failsThenSucceeds':
      return inOrder(failureRun(scenario.failure), prints([], 0));
    case 'copyFails':
      return inOrder(copyRun(scenario.failure));
    case 'copies':
      return inOrder({kind: 'writesInput'});
    case 'digestsInput':
      return inOrder({kind: 'digestsInput'});
    case 'clientFile':
      return inOrder(prints(scenario.reachable ? [MOUNTED_FILE] : [], 0));
    default:
      return inOrder(prints([], 0));
  }
}

/** The scenarios a real shell plays out: the distro's side, on this machine's `sh`. */
const REAL_SHELL_SCENARIOS = new Set<ContractScenario['kind']>([
  'backgroundsThenWaits',
  'detachesThenWaits',
  'printsBothStreams',
  'printsLongLine',
  'copiesLarge',
]);

/** Whether the process `processId` runs on this machine. */
function isRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

/** The script of a scenario: a real-shell scenario's own, else a placeholder the fake does not run. */
function scriptOf(scenario: ContractScenario): string {
  return ruleScriptOf(scenario) ?? 'scenario';
}

/** The largest write any real-shell process of the current staging was handed. */
let largestWriteSeen = 0;

/**
 * `wsl.exe` on this machine's shell: the program after `--exec` runs here, with the arguments the runner made, so that a
 * script's processes, streams and lines are real. Its writes are measured.
 */
function localShellSpawner(
  specification: WslProcessSpecification,
): Promise<WslProcess> {
  const shellWords = specification.programArguments;
  const [program = 'sh', ...rest] = shellWords.slice(
    shellWords.indexOf('--exec') + 1,
  );
  const child = spawn(program, rest, {env: process.env, shell: false});
  return new Promise<WslProcess>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      const live = wslProcessOf(child);
      resolve({
        ...live,
        write: data => {
          largestWriteSeen = Math.max(largestWriteSeen, data.length);
          return live.write(data);
        },
      });
    });
  });
}

const WSL_HARNESS: ChannelHarness = {
  processes: {
    alive: processId => Promise.resolve(isRunning(processId)),
    end: processId => {
      process.kill(processId, 'SIGKILL');
      return Promise.resolve();
    },
  },
  boundedCopy: {kind: 'measured', largestWrite: () => largestWriteSeen},
  scriptFailures: ['channelClosed', 'spawnFailed'],
  copyFailures: ['channelClosed', 'copyFailed'],
  reachesClientFiles: true,
  stage: async (scenario: ContractScenario): Promise<StagedChannel> => {
    const next = runsFor(scenario);
    const fake = fakeWsl(() => next());
    const real = REAL_SHELL_SCENARIOS.has(scenario.kind);
    largestWriteSeen = 0;
    const copied = real
      ? path.join(await mkdtemp(path.join(tmpdir(), 'wsl-channel-')), 'copied')
      : '/home/me/archive.tar.gz';
    if (scenario.kind !== 'missingInputFile') {
      const content =
        scenario.kind === 'digestsInput' && scenario.input.kind === 'file'
          ? scenario.input.content
          : new Uint8Array(
              scenario.kind === 'copiesLarge' ? LARGE_COPY_LENGTH : 4096,
            );
      fake.local.set(LOCAL_FILE, content);
    }
    const runner = createWslRunner(
      real ? {...fake, spawner: localShellSpawner} : fake,
    );
    return {
      channel: createWslHostChannel({
        runner,
        mapper: createPathMapper(runner),
        distro: DISTRO,
        logLine: () => undefined,
        ...(real ? {} : {treeKillBoundMs: 100}),
      }),
      script: {
        script: scriptOf(scenario),
        interpreter: 'posixShell',
        environment: {},
        input: stagedInputOf(scenario, LOCAL_FILE),
      },
      copy: {localFile: LOCAL_FILE, remotePath: copied},
      ...(scenario.kind === 'clientFile' && scenario.reachable
        ? {hostPath: MOUNTED_FILE}
        : {}),
    };
  },
};

describe('host channel over WSL: the lib-host contract (D4 on D4f)', function () {
  this.timeout(20000);
  for (const contractCase of channelContractCases(WSL_HARNESS)) {
    it(
      contractCase.name,
      contractCase.pending === true ? undefined : contractCase.check,
    );
  }
  it(
    'the shared contract runs against real WSL on the Windows job (pending #3312)',
  );
});
