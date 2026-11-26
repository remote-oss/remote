import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {localChannel} from '../../src/index.ts';
import {
  channelContractCases,
  stagedInputOf,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from '../../src/testing/channel-contract.ts';

/** The folders the harness made, which the suite removes. */
const folders: string[] = [];

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
    default:
      return 'exit 0';
  }
}

const LOCAL_HARNESS: ChannelHarness = {
  scriptFailures: [],
  copyFailures: ['copyFailed'],
  reachesClientFiles: true,
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
          : new Uint8Array(4096),
      );
    }
    if (scenario.kind === 'clientFile' && scenario.reachable) {
      writeFileSync(localFile, 'content');
    }
    mkdirSync(path.join(folder, 'target'));
    return Promise.resolve({
      channel: localChannel({identity: 'this-machine', platform: 'linux'}),
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

describe('host channel of the local machine: the lib-host contract', function () {
  this.timeout(20000);
  after(() => {
    for (const folder of folders) {
      rmSync(folder, {recursive: true, force: true});
    }
  });
  for (const contractCase of channelContractCases(LOCAL_HARNESS)) {
    it(contractCase.name, contractCase.check);
  }
});
