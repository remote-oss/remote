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
import {createWslHostChannel} from '../../../packages/lib-wsl/src/host-channel.ts';
import {createPathMapper} from '../../../packages/lib-wsl/src/path-mapper.ts';
import type {
  WslProcess,
  WslProcessSpawner,
} from '../../../packages/lib-wsl/src/process-port.ts';
import {createWslRunner} from '../../../packages/lib-wsl/src/runner.ts';
import {
  localFiles,
  localSession,
  localSpawner,
} from '../../../packages/remote-wsl/src/process/local-process.ts';
import {runCommand} from '../../../tools/command-runner.ts';
import type {WslDistros} from '../../../tools/acceptance-wsl.ts';
import {variable} from '../windows/harness.ts';

/** The cases of the rules of `ruling-3269-channel-contract`: the cancel, the error stream and the bounds. */
const RULE_CASES = 5;

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
  const distro = (JSON.parse(variable('HARNESS_WSL_DISTROS')) as WslDistros)
    .installed;
  const folder = mkdtempSync(path.join(tmpdir(), 'wsl-channel-'));
  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  /** What `command` prints in the distro, and its status. */
  function inDistro(...command: string[]): {status: number; text: string} {
    const result = runCommand('wsl.exe', ['-d', distro, '--exec', ...command]);
    return {status: result.status, text: result.stdout.trim()};
  }

  /** A line of the run's readout: the time, and what the distro's init and uptime were. */
  function readout(what: string): void {
    const init = inDistro(
      'sh',
      '-c',
      'stat -c %Y /proc/1; cut -d" " -f1 /proc/uptime',
    ).text.replaceAll('\n', ' uptime ');
    process.stdout.write(
      `readout ${new Date().toISOString()} ${what}: init started ${init}\n`,
    );
  }

  const harness: ChannelHarness = {
    processes: {
      alive: processId => {
        const alive = inDistro('kill', '-0', String(processId)).status === 0;
        readout(`process ${String(processId)} alive ${String(alive)}`);
        return Promise.resolve(alive);
      },
      end: processId => {
        readout(`process ${String(processId)} ended by the case`);
        inDistro('kill', '-9', String(processId));
        return Promise.resolve();
      },
    },
    boundedCopy: {kind: 'measured', largestWrite: () => largestWriteSeen},
    scriptFailures: [],
    copyFailures: [],
    reachesClientFiles: false,
    stage: (scenario: ContractScenario): Promise<StagedChannel> => {
      readout(`staging ${scenario.kind}`);
      largestWriteSeen = 0;
      const localFile = path.join(folder, `local-${String(Date.now())}`);
      writeFileSync(
        localFile,
        new Uint8Array(scenario.kind === 'copiesLarge' ? LARGE_COPY_LENGTH : 0),
      );
      const runner = createWslRunner({
        spawner: measuringSpawner,
        files: localFiles,
        session: localSession(process.env),
      });
      return Promise.resolve({
        channel: createWslHostChannel({
          runner,
          mapper: createPathMapper(runner),
          distro,
          logLine: message => {
            process.stderr.write(`${message}\n`);
          },
        }),
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
    it(`contracts §1: ${contractCase.name}`, contractCase.check);
  }
});
