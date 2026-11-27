import {strictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type ChannelHarness,
  type ContractScenario,
  LARGE_COPY_LENGTH,
  ruleCases,
  ruleScriptOf,
  stagedInputOf,
  type StagedChannel,
} from 'lib-host/testing/channel-contract';
import type {
  WslProcess,
  WslProcessSpawner,
} from '../../../packages/lib-wsl/src/process-port.ts';
import {localSpawner} from '../../../packages/remote-wsl/src/process/local-process.ts';
import {
  inDistro,
  installedDistro,
  readout,
  realChannel,
} from './channel-support.ts';

/** The cases of the rules of `ruling-3269-channel-contract`: the cancel, the error stream and the bounds. */
const RULE_CASES = 5;

/** The case that stays pending on real WSL until athena rules on what its readouts show. */
const DETACHED =
  'leaves a process an ended run started with nohup running after a later run is cancelled';

/** The largest write the staged run's `wsl.exe` was handed, which the bounded-copy case reads. */
let largestWriteSeen = 0;

/** Starts `specification` for real, with each write to its process measured. */
async function measuringSpawner(
  specification: Parameters<WslProcessSpawner>[0],
): Promise<WslProcess> {
  const live = await localSpawner(specification);
  return {
    ...live,
    write: data => {
      largestWriteSeen = Math.max(largestWriteSeen, data.length);
      return live.write(data);
    },
  };
}

describe('the host channel over real WSL meets the shared contract (card #3312)', function () {
  this.timeout(180_000);
  const distro = installedDistro();
  const folder = mkdtempSync(path.join(tmpdir(), 'wsl-channel-'));
  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  const harness: ChannelHarness = {
    processes: {
      alive: processId => {
        const alive =
          inDistro(distro, 'kill', '-0', String(processId)).status === 0;
        readout(distro, `process ${String(processId)} alive ${String(alive)}`);
        return Promise.resolve(alive);
      },
      end: processId => {
        readout(distro, `process ${String(processId)} ended by the case`);
        inDistro(distro, 'kill', '-9', String(processId));
        return Promise.resolve();
      },
    },
    boundedCopy: {kind: 'measured', largestWrite: () => largestWriteSeen},
    scriptFailures: [],
    copyFailures: [],
    reachesClientFiles: false,
    stage: (scenario: ContractScenario): Promise<StagedChannel> => {
      readout(distro, `staging ${scenario.kind}`);
      largestWriteSeen = 0;
      const localFile = path.join(folder, `local-${String(Date.now())}`);
      writeFileSync(
        localFile,
        new Uint8Array(scenario.kind === 'copiesLarge' ? LARGE_COPY_LENGTH : 0),
      );
      return Promise.resolve({
        channel: realChannel(distro, measuringSpawner),
        script: {
          script: ruleScriptOf(scenario) ?? 'true',
          interpreter: 'posixShell',
          environment: {},
          input: stagedInputOf(scenario, localFile),
        },
        copy: {localFile, remotePath: '/tmp/wsl-channel-contract.bin'},
      });
    },
  };

  const cases = ruleCases(harness);

  it('the rule cases are the five of the contract', () => {
    strictEqual(cases.length, RULE_CASES);
  });

  for (const contractCase of cases) {
    it(
      `contracts §1: ${contractCase.name}${contractCase.name === DETACHED ? ' (pending ruling-3312-detached-case: see detached-readout.test.ts)' : ''}`,
      contractCase.name === DETACHED ? undefined : contractCase.check,
    );
  }
});
