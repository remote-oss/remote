import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {ChannelFailureKind} from 'lib-host';
import {
  channelContractCases,
  type ChannelHarness,
  type ContractScenario,
  LARGE_COPY_LENGTH,
  LONG_LINE_LENGTH,
  type StagedChannel,
} from 'lib-host/testing/channel-contract';
import {localProcesses} from 'lib-host/testing/local-processes';
import {execChannelOf, execChannelOver} from '../../src/exec/exec-channel.ts';
import {
  fakeEngine,
  type FakeProcess,
  type ProcessScript,
  type SpawnPlan,
} from './fake-engine.ts';
import {localCommandsOver, localEngine} from './local-engine.ts';

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
  backgroundsThenWaits: () => [],
  detachesThenWaits: () => [],
  printsBothStreams: () => [],
  printsLongLine: () => [],
  copiesLarge: () => [consumes()],
};

/**
 * The sh text that starts a long `sleep` from a subshell that ends at once, so that the `sleep` is re-parented and leaves
 * the shell's tree, and prints its pid once that has happened.
 */
function detachedSleep(pidFile: string): string {
  return [
    `rm -f '${pidFile}'`,
    `( sleep 600 >/dev/null 2>&1 & echo $! > '${pidFile}' )`,
    `cat '${pidFile}'`,
    'sleep 600',
  ].join('\n');
}

/** The script a scenario that runs on real processes gives the shell, or none for a scenario that runs on the fake. */
function realScriptOf(scenario: ContractScenario): string | undefined {
  switch (scenario.kind) {
    case 'backgroundsThenWaits':
      return 'sleep 600 &\nprintf "%s\\n" "$!"\nwait';
    case 'detachesThenWaits':
      return detachedSleep(path.join(folder, 'detached.pid'));
    case 'printsBothStreams':
      return "printf 'out one\\n'\nprintf 'err one\\n' >&2\nprintf 'out two\\n'";
    case 'printsLongLine':
      return `head -c ${String(LONG_LINE_LENGTH)} /dev/zero | tr '\\0' x`;
    default:
      return undefined;
  }
}

/** The engine the last fake-backed stage used, whose writes the bounded-copy case measures. */
let lastEngine: ReturnType<typeof fakeEngine> | undefined;

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

/** The shells the real-process cases run under: the system's `sh` and, where there is one, `dash`. */
const SHELLS = ['/bin/sh', '/usr/bin/dash'].filter(shell => existsSync(shell));

/** The harness whose real-process cases run under `shell`. */
function harnessFor(shell: string): ChannelHarness {
  return {
    processes: localProcesses,
    boundedCopy: {
      kind: 'measured',
      largestWrite: () =>
        Math.max(
          0,
          ...(lastEngine?.processes ?? []).flatMap(each => each.writeSizes),
        ),
    },
    scriptFailures: ['channelClosed', 'spawnFailed'],
    copyFailures: ['copyToolMissing', 'copyFailed', 'channelClosed'],
    reachesClientFiles: false,
    stage: scenario => {
      const real = realScriptOf(scenario);
      if (real !== undefined) {
        const staged: StagedChannel = {
          channel: execChannelOver(localEngine(), localCommandsOver(shell)),
          script: {
            script: real,
            interpreter: 'posixShell',
            environment: {},
            input: {kind: 'text', text: ''},
          },
          copy: {localFile: fileWith(new Uint8Array(1)), remotePath: '/dest/x'},
        };
        return Promise.resolve(staged);
      }
      const engine = fakeEngine(...scenarioScripts(scenario));
      lastEngine = engine;
      const channel = execChannelOf(engine, 'c1', 'node');
      const content =
        scenario.kind === 'digestsInput' && scenario.input.kind === 'file'
          ? scenario.input.content
          : new Uint8Array(
              scenario.kind === 'copiesLarge' ? LARGE_COPY_LENGTH : 4096,
            );
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
}

describe('the exec channel against the channel contract (card containers-02)', () => {
  before(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'exec-contract-'));
  });

  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  for (const shell of SHELLS) {
    describe(`under ${shell}`, () => {
      for (const contractCase of channelContractCases(harnessFor(shell))) {
        it(
          `contracts §1: ${contractCase.name}`,
          contractCase.pending === true ? undefined : contractCase.check,
        );
      }
    });
  }
});
