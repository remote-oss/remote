import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {localChannel} from '../../src/index.ts';
import {
  channelContractCases,
  LARGE_COPY_LENGTH,
  LONG_LINE_LENGTH,
  ruleScriptOf,
  stagedInputOf,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from '../../src/testing/channel-contract.ts';
import {localProcesses} from '../../src/testing/local-processes.ts';

/** The folders the harness made, which the suite removes. */
const folders: string[] = [];

/** The shells the contract runs under: the system's `sh` and, where there is one, `dash`. */
const SHELLS = ['/bin/sh', '/usr/bin/dash'].filter(shell => existsSync(shell));

/** The sh text of a script that prints `lines`, one each, then ends with `status`. */
function printing(lines: readonly string[], status: number): string {
  const prints = lines.map(line => `printf '%s\\n' '${line}'`);
  return [...prints, `exit ${String(status)}`].join('\n');
}

/** The sh text of the script that `scenario` asks the shell to run. */
function scriptOf(scenario: ContractScenario): string {
  switch (scenario.kind) {
    case 'printsLines':
      return printing(scenario.lines, scenario.status);
    case 'printsUntilCancelled':
    case 'streamsUntilCancelled':
      return `${printing(scenario.lines, 0).replace(/\nexit 0$/, '')}\nsleep 30`;
    case 'digestsInput':
      return "sha256sum | cut -d ' ' -f 1";
    case 'backgroundsThenWaits':
      return 'sleep 600 &\nprintf "%s\\n" "$!"\nwait';
    case 'startsDetached':
      return ruleScriptOf(scenario) ?? 'exit 0';
    case 'printsBothStreams':
      return "printf 'out one\\n'\nprintf 'err one\\n' >&2\nprintf 'out two\\n'";
    case 'printsLongLine':
      return `head -c ${String(LONG_LINE_LENGTH)} /dev/zero | tr '\\0' x`;
    default:
      return 'exit 0';
  }
}

/** The harness that runs the contract on the local channel with `shell` as its shell. */
function harnessFor(shell: string): ChannelHarness {
  return {
    scriptFailures: [],
    copyFailures: ['copyFailed'],
    reachesClientFiles: true,
    processes: localProcesses,
    boundedCopy: {
      kind: 'notApplicable',
      reason:
        "met by Node's stream pipeline, which waits for drain and reads 64 KiB pieces; the channel makes no writes of its own to measure",
    },
    stage: (scenario: ContractScenario): Promise<StagedChannel> => {
      const folder = mkdtempSync(path.join(tmpdir(), 'lib-host-local-'));
      folders.push(folder);
      const localFile = path.join(folder, 'archive.tar.gz');
      if (
        scenario.kind !== 'missingInputFile' &&
        scenario.kind !== 'clientFile'
      ) {
        writeFileSync(
          localFile,
          scenario.kind === 'digestsInput' && scenario.input.kind === 'file'
            ? scenario.input.content
            : new Uint8Array(
                scenario.kind === 'copiesLarge' ? LARGE_COPY_LENGTH : 4096,
              ),
        );
      }
      if (scenario.kind === 'clientFile' && scenario.reachable) {
        writeFileSync(localFile, 'content');
      }
      mkdirSync(path.join(folder, 'target'));
      return Promise.resolve({
        channel: localChannel({
          identity: 'this-machine',
          platform: 'linux',
          shell,
        }),
        script: {
          script: scriptOf(scenario),
          interpreter: 'posixShell',
          environment: {},
          input: stagedInputOf(scenario, localFile),
        },
        copy: {
          localFile,
          remotePath: path.join(
            folder,
            scenario.kind === 'copyFails' ? 'missing-folder' : 'target',
            'archive.tar.gz',
          ),
        },
        ...(scenario.kind === 'clientFile' && scenario.reachable
          ? {hostPath: localFile}
          : {}),
      });
    },
  };
}

for (const shell of SHELLS) {
  describe(`host channel of the local machine under ${shell}: the lib-host contract`, function () {
    this.timeout(30000);
    after(() => {
      for (const folder of folders) {
        rmSync(folder, {recursive: true, force: true});
      }
    });
    for (const contractCase of channelContractCases(harnessFor(shell))) {
      it(contractCase.name, contractCase.check);
    }
  });
}
