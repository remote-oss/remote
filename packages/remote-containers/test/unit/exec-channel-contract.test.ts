import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {ChannelFailureKind} from 'lib-host';
import {
  channelContractCases,
  type ChannelHarness,
  type ContractScenario,
} from 'lib-host/testing/channel-contract';
import {execChannelOf} from '../../src/exec/exec-channel.ts';
import {
  fakeEngine,
  type FakeProcess,
  type ProcessScript,
  type SpawnPlan,
} from './fake-engine.ts';

/** The script every staged run is given; the process reads it back before the input. */
const STAGED_SCRIPT = 'scenario';

/** Prints `lines`, then ends with `status`. */
function prints(lines: readonly string[], status: number): ProcessScript {
  return process => {
    process.print(lines.map(line => `${line}\n`).join(''));
    process.exit(status);
  };
}

/** Prints `lines` and then stays up until the client is killed. */
function printsThenWaits(lines: readonly string[]): ProcessScript {
  return process => {
    process.print(lines.map(line => `${line}\n`).join(''));
  };
}

/** Ends with `status` and a message on stderr. */
function ends(status: number, message: string): ProcessScript {
  return process => {
    process.printError(`${message}\n`);
    process.exit(status);
  };
}

/** Waits for the end of stdin, then ends with 0. */
function consumes(): ProcessScript {
  return async process => {
    await process.stdinEnded;
    process.exit(0);
  };
}

/** Prints the SHA-256 of what follows the script on stdin, then ends with 0. */
function digests(): ProcessScript {
  return async (process: FakeProcess) => {
    await process.stdinEnded;
    const prelude = Buffer.from(STAGED_SCRIPT, 'utf8');
    process.print(
      `${createHash('sha256').update(process.stdin().subarray(prelude.length)).digest('hex')}\n`,
    );
    process.exit(0);
  };
}

function scriptFailure(kind: ChannelFailureKind): SpawnPlan {
  return kind === 'spawnFailed'
    ? {failure: 'spawn docker EMFILE'}
    : ends(125, 'docker: Error response from daemon: container stopped');
}

function copyFailure(kind: ChannelFailureKind): ProcessScript {
  switch (kind) {
    case 'copyToolMissing':
      return ends(127, 'sh: tar: not found');
    case 'copyFailed':
      return ends(1, 'tar: write error');
    default:
      return ends(125, 'docker: Error response from daemon: container stopped');
  }
}

/** The plans of each kind of scenario: what the fake `docker` does on each spawn the scenario makes. */
const PLANS: {
  [Kind in ContractScenario['kind']]: (
    scenario: Extract<ContractScenario, {kind: Kind}>,
  ) => SpawnPlan[];
} = {
  printsLines: scenario => [prints(scenario.lines, scenario.status)],
  printsUntilCancelled: scenario => [printsThenWaits(scenario.lines)],
  streamsUntilCancelled: scenario => [printsThenWaits(scenario.lines)],
  scriptFails: scenario => [scriptFailure(scenario.failure)],
  failsThenSucceeds: scenario => [
    scriptFailure(scenario.failure),
    prints([], 0),
  ],
  copyFails: scenario => [copyFailure(scenario.failure)],
  copies: () => [consumes()],
  digestsInput: () => [digests()],
  missingInputFile: () => [prints([], 0)],
  clientFile: () => [prints([], 0)],
};

function scenarioScripts(scenario: ContractScenario): SpawnPlan[] {
  return (PLANS[scenario.kind] as (each: ContractScenario) => SpawnPlan[])(
    scenario,
  );
}

let folder = '';

function fileWith(content: Uint8Array): string {
  const file = path.join(folder, `file-${String(Math.random())}`);
  writeFileSync(file, content);
  return file;
}

const harness: ChannelHarness = {
  scriptFailures: ['channelClosed', 'spawnFailed'],
  copyFailures: ['copyToolMissing', 'copyFailed', 'channelClosed'],
  reachesClientFiles: false,
  stage: scenario => {
    const engine = fakeEngine(...scenarioScripts(scenario));
    const channel = execChannelOf(engine, 'c1', 'node');
    const content =
      scenario.kind === 'digestsInput' && scenario.input.kind === 'file'
        ? scenario.input.content
        : new Uint8Array(4096);
    const localFile =
      scenario.kind === 'missingInputFile'
        ? path.join(folder, 'missing')
        : fileWith(content);
    const input =
      scenario.kind === 'digestsInput' && scenario.input.kind === 'text'
        ? scenario.input
        : [
              'digestsInput',
              'missingInputFile',
              'streamsUntilCancelled',
            ].includes(scenario.kind)
          ? {kind: 'file' as const, localFile}
          : {kind: 'text' as const, text: ''};
    return Promise.resolve({
      channel,
      script: {
        script: STAGED_SCRIPT,
        interpreter: 'posixShell',
        environment: {},
        input,
      },
      copy: {localFile, remotePath: '/dest/archive.tar.gz'},
    });
  },
};

describe('the exec channel against the channel contract (card containers-02)', () => {
  before(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'exec-contract-'));
  });

  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  for (const contractCase of channelContractCases(harness)) {
    it(`contracts §1: ${contractCase.name}`, contractCase.check);
  }
});
