import {type ChannelFailureKind, type ScriptInput} from 'lib-host';
import {
  channelContractCases,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from 'lib-host/testing/channel-contract';
import {SshHostChannel, type LocalFiles} from '../../src/index.ts';
import {
  type ClientScript,
  type FakeClientProcess,
  ScriptedSpawner,
  startError,
} from './fake-client-process.ts';
import {asyncPieces, channelBase} from './host-channel-fixture.ts';

const LOCAL_FILE = '/local/archive.tar.gz';

/** The script every staged run is given; with no environment staged, its prelude is the script plus a line end. */
const STAGED_SCRIPT = 'scenario';
const STAGED_PRELUDE = `${STAGED_SCRIPT}\n`;

/** Prints `lines`, then ends with `status`. */
function prints(lines: readonly string[], status: number): ClientScript {
  return process => {
    process.output(lines.map(line => `${line}\n`).join(''));
    process.exit(status);
  };
}

/** Prints `lines` and then stays up until the client is killed. */
function printsThenWaits(lines: readonly string[]): ClientScript {
  return process => {
    process.output(lines.map(line => `${line}\n`).join(''));
  };
}

/** A client that never answers. */
function silent(): void {
  // It answers nothing; only a kill or a timeout ends it.
}

function ends(status: number, message: string): ClientScript {
  return process => {
    process.error(message);
    process.exit(status);
  };
}

/** The script of a failed `ssh` run of the given kind, or the error that fails its start. */
function scriptFailure(kind: ChannelFailureKind): ClientScript | Error {
  switch (kind) {
    case 'channelClosed':
      return ends(255, 'Connection closed by remote host');
    case 'spawnFailed':
      return startError('EMFILE', 'too many open files');
    default:
      return silent;
  }
}

/** The script of a failed `scp` run of the given kind, or the error that fails its start. */
function copyFailure(kind: ChannelFailureKind): ClientScript | Error {
  switch (kind) {
    case 'copyToolMissing':
      return startError('ENOENT', 'spawn scp ENOENT');
    case 'copyFailed':
      return ends(1, 'scp: /remote: Permission denied');
    case 'channelClosed':
      return ends(255, 'Connection closed by remote host');
    default:
      return silent;
  }
}

function scenarioScripts(
  scenario: ContractScenario,
): Array<ClientScript | Error> {
  switch (scenario.kind) {
    case 'printsLines':
      return [prints(scenario.lines, scenario.status)];
    case 'printsUntilCancelled':
    case 'streamsUntilCancelled':
      return [printsThenWaits(scenario.lines)];
    case 'scriptFails':
      return [scriptFailure(scenario.failure)];
    case 'failsThenSucceeds':
      return [scriptFailure(scenario.failure), prints([], 0)];
    case 'copyFails':
      return [copyFailure(scenario.failure)];
    case 'digestsInput':
      return [
        process => {
          process.digestInputThenExit(Buffer.from(STAGED_PRELUDE, 'utf8'));
        },
      ];
    default:
      return [prints([], 0)];
  }
}

const FILE_INPUT_SCENARIOS = new Set<string>([
  'digestsInput',
  'missingInputFile',
  'streamsUntilCancelled',
]);

function inputFor(scenario: ContractScenario): ScriptInput {
  if (scenario.kind === 'digestsInput' && scenario.input.kind === 'text') {
    return scenario.input;
  }
  return FILE_INPUT_SCENARIOS.has(scenario.kind)
    ? {kind: 'file', localFile: LOCAL_FILE}
    : {kind: 'text', text: ''};
}

/** `content` cut into pieces of 100 bytes. */
function pieces(content: Uint8Array): Uint8Array[] {
  const result: Uint8Array[] = [];
  for (let offset = 0; offset < content.length; offset += 100) {
    result.push(content.subarray(offset, offset + 100));
  }
  return result;
}

function filesFor(scenario: ContractScenario): LocalFiles {
  const content =
    scenario.kind === 'digestsInput' && scenario.input.kind === 'file'
      ? scenario.input.content
      : new Uint8Array(4096);
  return {
    exists: file =>
      Promise.resolve(
        scenario.kind !== 'missingInputFile' && file === LOCAL_FILE,
      ),
    // The file arrives in pieces, as a stream delivers it.
    read: () => asyncPieces(pieces(content)),
  };
}

/** A scheduler on which a timer fires at once (a run with no end), or never. */
function schedulerFor(scenario: ContractScenario): {
  setTimer: (milliseconds: number, callback: () => void) => () => void;
} {
  const failsByTimeout =
    (scenario.kind === 'scriptFails' || scenario.kind === 'copyFails') &&
    scenario.failure === 'timeout';
  return {
    setTimer: (milliseconds, callback) => {
      const handle = failsByTimeout ? setImmediate(callback) : undefined;
      return () => {
        if (handle !== undefined) {
          clearImmediate(handle);
        }
      };
    },
  };
}

const SSH_HARNESS: ChannelHarness = {
  scriptFailures: ['channelClosed', 'spawnFailed', 'timeout'],
  copyFailures: ['copyToolMissing', 'copyFailed', 'channelClosed', 'timeout'],
  reachesClientFiles: false,
  stage: (scenario: ContractScenario): Promise<StagedChannel> => {
    const spawner = new ScriptedSpawner(...scenarioScripts(scenario));
    return Promise.resolve({
      channel: new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
        files: filesFor(scenario),
        scheduler: schedulerFor(scenario),
        timeoutMilliseconds: 1000,
      }),
      script: {
        script: STAGED_SCRIPT,
        interpreter: 'posixShell',
        environment: {},
        input: inputFor(scenario),
      },
      copy: {localFile: LOCAL_FILE, remotePath: '/home/user/archive.tar.gz'},
    });
  },
};

describe('host channel over SSH: the lib-host contract', () => {
  for (const contractCase of channelContractCases(SSH_HARNESS)) {
    it(contractCase.name, contractCase.check);
  }
});

export type {FakeClientProcess};
