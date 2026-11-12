import type {ChannelFailureKind} from 'lib-host';
import {
  channelContractCases,
  stagedInputOf,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from 'lib-host/testing/channel-contract';
import {createWslHostChannel} from '../../src/host-channel.ts';
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

const WSL_HARNESS: ChannelHarness = {
  scriptFailures: ['channelClosed', 'spawnFailed'],
  copyFailures: ['channelClosed', 'copyFailed'],
  reachesClientFiles: true,
  stage: (scenario: ContractScenario): Promise<StagedChannel> => {
    const next = runsFor(scenario);
    const fake = fakeWsl(() => next());
    if (scenario.kind !== 'missingInputFile') {
      const content =
        scenario.kind === 'digestsInput' && scenario.input.kind === 'file'
          ? scenario.input.content
          : new Uint8Array(4096);
      fake.local.set(LOCAL_FILE, content);
    }
    const runner = createWslRunner(fake);
    return Promise.resolve({
      channel: createWslHostChannel({
        runner,
        mapper: createPathMapper(runner),
        distro: DISTRO,
      }),
      script: {
        script: 'scenario',
        interpreter: 'posixShell',
        environment: {},
        input: stagedInputOf(scenario, LOCAL_FILE),
      },
      copy: {localFile: LOCAL_FILE, remotePath: '/home/me/archive.tar.gz'},
      ...(scenario.kind === 'clientFile' && scenario.reachable
        ? {hostPath: MOUNTED_FILE}
        : {}),
    });
  },
};

describe('host channel over WSL: the lib-host contract (D4 on D4f)', function () {
  this.timeout(20000);
  for (const contractCase of channelContractCases(WSL_HARNESS)) {
    it(contractCase.name, contractCase.check);
  }
});
