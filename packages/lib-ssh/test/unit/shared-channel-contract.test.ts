import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {type HostChannel, failFrom, type ScriptInput} from 'lib-host';
import {
  channelContractCases,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from 'lib-host/testing/channel-contract';
import {type HelperParameters} from 'lib-helper';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {MemoryFilePort} from 'lib-helper/testing/memory-file-port';
import {
  acquireConnection,
  nodeLocalFiles,
  nodeProcessSpawner,
  type ProcessHandle,
  runConnectionHelper,
  SharedSessionChannel,
} from '../../src/index.ts';
import {AUTHENTICATED, SSH_REQUEST} from './connection-fixture.ts';

const PARAMETERS = 'REMOTE_OSS_HELPER_PARAMETERS';
const DIGEST_SCRIPT =
  "if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1";
const CONTRACT_DEADLINE = 2000;
const TIMEOUT_DEADLINE = 300;

/** A local shell standing in for the login shell of the host: it reads its commands from standard input. */
async function localShell(): Promise<ProcessHandle> {
  const handle = await nodeProcessSpawner({
    program: '/bin/sh',
    programArguments: ['-s'],
    environment: {PATH: process.env.PATH ?? '/usr/bin:/bin'},
  });
  return {
    ...handle,
    onOutput: listener => {
      handle.onOutput(listener);
    },
    onError: listener => {
      handle.onError(listener);
      // The login is the one thing the stand-in does not do for real.
      setImmediate(() => {
        listener(AUTHENTICATED);
      });
    },
  };
}

/** A shell script that prints the lines and ends with the status. */
function printing(lines: readonly string[], tail: string): string {
  return [...lines.map(line => `printf '%s\\n' '${line}'`), tail].join('\n');
}

/** The script that stages a scenario on the shell. */
function scriptFor(scenario: ContractScenario, flagFile: string): string {
  switch (scenario.kind) {
    case 'printsLines':
      return printing(scenario.lines, `exit ${String(scenario.status)}`);
    case 'printsUntilCancelled':
    case 'streamsUntilCancelled':
      return printing(scenario.lines, 'sleep 30');
    case 'scriptFails':
      return scenario.failure === 'timeout' ? 'sleep 30' : 'kill -9 $PPID';
    case 'failsThenSucceeds':
      return `if [ -e '${flagFile}' ]; then exit 0; fi\n: > '${flagFile}'\nkill -9 $PPID`;
    case 'digestsInput':
      return DIGEST_SCRIPT;
    default:
      return 'exit 0';
  }
}

/** The direct channel, which is not under test: it names the host, and copies or has been cancelled. */
const DIRECT: Pick<HostChannel, 'copyToHost' | 'identity' | 'platformHint'> = {
  identity: () => 'harness',
  platformHint: () => 'linux',
  copyToHost: request =>
    Promise.resolve(
      request.cancellation.aborted
        ? failFrom('cancelled', 'cancelled before the copy')
        : {kind: 'copied'},
    ),
};

describe('host channel over the shared ssh session: the lib-host contract', () => {
  const folders: string[] = [];
  const disposers: Array<() => void> = [];

  /** The input of a scenario: a text, a local file with its content, or a file that is not there. */
  function inputFor(scenario: ContractScenario, folder: string): ScriptInput {
    if (scenario.kind === 'missingInputFile') {
      return {kind: 'file', localFile: path.join(folder, 'missing')};
    }
    if (scenario.kind === 'digestsInput' && scenario.input.kind === 'text') {
      return scenario.input;
    }
    if (
      scenario.kind === 'digestsInput' ||
      scenario.kind === 'streamsUntilCancelled'
    ) {
      const localFile = path.join(folder, 'input');
      writeFileSync(
        localFile,
        scenario.kind === 'digestsInput' && scenario.input.kind === 'file'
          ? scenario.input.content
          : new Uint8Array(4096),
      );
      return {kind: 'file', localFile};
    }
    return {kind: 'text', text: ''};
  }

  /** A helper over a local shell, a window connected to it, and the channel of that window. */
  async function channelFor(scenario: ContractScenario): Promise<HostChannel> {
    const files = new MemoryFilePort();
    const endpoints = new FakeEndpointPort();
    let markers = 0;
    function newNonce(): string {
      markers += 1;
      return `nonce${String(markers)}`;
    }
    const shells: ProcessHandle[] = [];
    const environment = {
      freePort: () => Promise.resolve(41000),
      helper: {
        files,
        endpoints,
        spawn: (specification: {environment: Record<string, string>}) => {
          const parameters = JSON.parse(
            specification.environment[PARAMETERS] ?? '',
          ) as HelperParameters;
          void runConnectionHelper({
            parameters,
            port: endpoints,
            clock: Date.now,
            scheduler: {
              setTimer: (milliseconds, callback) => {
                const timer = setTimeout(callback, milliseconds);
                return () => {
                  clearTimeout(timer);
                };
              },
            },
            files,
            launcherFiles: {writeExecutable: () => Promise.resolve()},
            newNonce,
            spawner: async () => {
              const shell = await localShell();
              shells.push(shell);
              return shell;
            },
            editorEnvironment: {},
            helloLimitMilliseconds: 500,
            logLine: () => undefined,
          });
          return Promise.resolve();
        },
        timer: (milliseconds: number, callback: () => void) => {
          const timer = setTimeout(callback, milliseconds);
          return () => {
            clearTimeout(timer);
          };
        },
        clock: Date.now,
        newNonce,
        runtime: '/editor',
        endpointFolder: '/run',
        processId: 1,
        parentEnvironment: {},
        helloLimitMilliseconds: 500,
        startLimitMilliseconds: 2000,
        retryMilliseconds: 10,
      },
    };
    const acquired = await acquireConnection(
      environment,
      {
        folder: '/registry',
        hostString: 'harness',
        script: '/helper.js',
        options: {
          request: JSON.stringify(SSH_REQUEST),
          unboundedWaitSeconds: 120,
          runtimeFolder: '/run',
          runtime: '/editor',
          askpassProgram: '/askpass.js',
          displayHost: 'harness',
          externalAskpass: false,
          askpassFirstMessageMilliseconds: 5000,
        },
        policy: {kind: 'graceAfterLastLease', milliseconds: 50},
        cancellation: new AbortController().signal,
      },
      {requestMilliseconds: 5000, loginMilliseconds: 10000},
    );
    if (acquired.kind !== 'acquired') {
      throw new Error(`no lease: ${acquired.failure}`);
    }
    const {connection} = acquired;
    disposers.push(() => {
      connection.release();
      for (const shell of shells) {
        shell.kill();
      }
    });
    await connection.connect(new AbortController().signal);
    return new SharedSessionChannel({
      session: connection,
      direct: DIRECT,
      files: nodeLocalFiles,
      runDeadlineMilliseconds:
        scenario.kind === 'scriptFails' && scenario.failure === 'timeout'
          ? TIMEOUT_DEADLINE
          : CONTRACT_DEADLINE,
      runWaitMilliseconds: 10000,
      maximumInputBytes: 1_000_000,
    });
  }

  const HARNESS: ChannelHarness = {
    scriptFailures: ['channelClosed', 'timeout'],
    copyFailures: [],
    reachesClientFiles: false,
    stage: async (scenario: ContractScenario): Promise<StagedChannel> => {
      const folder = mkdtempSync(path.join(tmpdir(), 'shared-channel-'));
      folders.push(folder);
      return {
        channel: await channelFor(scenario),
        script: {
          script: scriptFor(scenario, path.join(folder, 'flag')),
          interpreter: 'posixShell',
          environment: {},
          input: inputFor(scenario, folder),
        },
        copy: {localFile: '/local/archive.tar.gz', remotePath: '/remote/x'},
      };
    },
  };

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    for (const folder of folders.splice(0)) {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  for (const contractCase of channelContractCases(HARNESS)) {
    it(contractCase.name, contractCase.check);
  }
});
