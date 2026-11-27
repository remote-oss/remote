import {spawn, spawnSync} from 'node:child_process';
import {type ChannelFailureKind} from 'lib-host';
import {
  channelContractCases,
  LONG_LINE_LENGTH,
  stagedInputOf,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from 'lib-host/testing/channel-contract';
import {
  SshHostChannel,
  type LocalFiles,
  type ProcessHandle,
  type ProcessSpecification,
} from '../../src/index.ts';
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

/** The scenarios that play out on a real shell standing in for the host: the cancel, the error stream and the bounds. */
const REAL_SCENARIOS: ReadonlyArray<ContractScenario['kind']> = [
  'backgroundsThenWaits',
  'detachesThenWaits',
  'printsBothStreams',
  'printsLongLine',
];

/** The script that plays a real scenario out on the shell. */
function realScriptOf(scenario: ContractScenario): string {
  switch (scenario.kind) {
    case 'backgroundsThenWaits':
      return `sleep 40 & printf '%s\\n' "$!"; wait`;
    case 'detachesThenWaits':
      return `(sleep 40 >/dev/null 2>&1 & printf '%s\\n' "$!"); sleep 30`;
    case 'printsBothStreams':
      return "printf 'out one\\n'; printf 'err one\\n' >&2; printf 'out two\\n'";
    default:
      return `head -c ${String(LONG_LINE_LENGTH)} /dev/zero | tr '\\0' x`;
  }
}

/**
 * A spawner whose `ssh` runs the remote command it is given on this machine, in a session of its own as a host's sshd
 * would: ending the client drops the connection and leaves whatever the command started running, which only a run that
 * ends the tree on the host can end.
 */
function localHostSpawner(
  specification: ProcessSpecification,
): Promise<ProcessHandle> {
  const remoteCommand = specification.programArguments.at(-1) ?? '';
  const child = spawn('sh', ['-c', remoteCommand], {
    env: {PATH: process.env.PATH ?? '/usr/bin:/bin'},
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdin.on('error', () => undefined);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const handle: ProcessHandle = {
    onOutput: listener => child.stdout.on('data', listener),
    onError: listener => child.stderr.on('data', listener),
    onExit: listener => {
      child.once('close', (status: number | null) => {
        listener(status ?? undefined);
      });
    },
    write: data =>
      new Promise<void>(resolve => {
        child.stdin.write(data, () => {
          resolve();
        });
      }),
    endInput: () => {
      child.stdin.end();
    },
    kill: () => {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    },
  };
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      resolve(handle);
    });
  });
}

/** Whether the process `processId` of this machine runs: one that has ended and is not yet reaped is gone. */
function runs(processId: number): boolean {
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(processId)], {
    encoding: 'utf8',
  }).stdout.trim();
  return state !== '' && !state.startsWith('Z');
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
  processes: {
    alive: processId => Promise.resolve(runs(processId)),
    end: processId => {
      process.kill(processId, 'SIGKILL');
      return Promise.resolve();
    },
  },
  boundedCopy: {
    kind: 'notApplicable',
    reason:
      'met by scp, which reads the file itself; the channel writes none of it',
  },
  scriptFailures: ['channelClosed', 'spawnFailed', 'timeout'],
  copyFailures: ['copyToolMissing', 'copyFailed', 'channelClosed', 'timeout'],
  reachesClientFiles: false,
  stage: (scenario: ContractScenario): Promise<StagedChannel> => {
    const real = REAL_SCENARIOS.includes(scenario.kind);
    const spawner = new ScriptedSpawner(...scenarioScripts(scenario));
    return Promise.resolve({
      channel: new SshHostChannel({
        ...channelBase(),
        spawner: real ? localHostSpawner : spawner.spawn,
        files: filesFor(scenario),
        scheduler: schedulerFor(scenario),
        timeoutMilliseconds: 1000,
      }),
      script: {
        script: real ? realScriptOf(scenario) : STAGED_SCRIPT,
        interpreter: 'posixShell',
        environment: {},
        input: stagedInputOf(scenario, LOCAL_FILE),
      },
      copy: {localFile: LOCAL_FILE, remotePath: '/home/user/archive.tar.gz'},
    });
  },
};

describe('host channel over SSH: a PowerShell host', () => {
  // The tree-kill mechanism is measured on a Windows host (run 46038744923): `taskkill /T /F /PID <pid>` leaves no
  // descendant of a cancelled PowerShell run, and host-channel.test.ts runs it for the PowerShell plan. Pending: the
  // same measurement of a start that ended, whose server must survive a later cancel.
  it(
    'leaves a server whose start ended running after a cancel (pending #3308)',
  );
});

describe('host channel over SSH: the lib-host contract', function () {
  this.timeout(20000);
  for (const contractCase of channelContractCases(SSH_HARNESS)) {
    it(
      contractCase.name,
      contractCase.pending === true ? undefined : contractCase.check,
    );
  }
});

export type {FakeClientProcess};
