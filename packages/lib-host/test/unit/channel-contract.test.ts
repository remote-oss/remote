import {deepStrictEqual, rejects} from 'node:assert';
import {createHash} from 'node:crypto';
import type {ChannelFailureKind, ScriptInput} from '../../src/host-channel.ts';
import {
  channelContractCases,
  type ChannelHarness,
  type ContractScenario,
  type StagedChannel,
} from '../../src/testing/channel-contract.ts';
import {
  RecordingChannel,
  type FailingEnding,
  type RecordingSetup,
  type ScriptAnswer,
  type ScriptEnding,
} from '../../src/testing/recording-channel.ts';

const ALL_KINDS: readonly ChannelFailureKind[] = [
  'channelClosed',
  'spawnFailed',
  'copyToolMissing',
  'copyFailed',
  'timeout',
  'cancelled',
];

const LOCAL_FILE = '/local/archive.tar.gz';

const HOST_PATH = '/mnt/c/local/archive.tar.gz';

const BASE = {identity: 'fake-host', platformHint: 'linux'} as const;

function failing(failure: ChannelFailureKind): FailingEnding {
  return {kind: 'fail', failure: {kind: failure, detail: `staged ${failure}`}};
}

/** The scenario's answer, then one that would succeed, so that a retry would be seen. */
function answered(
  lines: ScriptAnswer['lines'],
  ending: ScriptEnding,
): ScriptAnswer[] {
  return [
    {interpreter: 'posixShell', matches: () => true, lines, ending},
    {
      interpreter: 'posixShell',
      matches: () => true,
      lines: [],
      ending: {kind: 'exit', status: 0},
    },
  ];
}

function setupFor(scenario: ContractScenario): RecordingSetup {
  switch (scenario.kind) {
    case 'printsLines':
      return {
        ...BASE,
        scripts: answered(scenario.lines, {
          kind: 'exit',
          status: scenario.status,
        }),
      };
    case 'printsUntilCancelled':
      return {
        ...BASE,
        scripts: answered(scenario.lines, {kind: 'holdUntilCancelled'}),
      };
    case 'streamsUntilCancelled':
      return {
        ...BASE,
        scripts: answered(scenario.lines, {kind: 'holdUntilCancelled'}),
        localFiles: new Map([[LOCAL_FILE, new Uint8Array(4096)]]),
      };
    case 'digestsInput':
      return {
        ...BASE,
        scripts: answered(
          input => [createHash('sha256').update(input).digest('hex')],
          {kind: 'exit', status: 0},
        ),
        ...(scenario.input.kind === 'file'
          ? {localFiles: new Map([[LOCAL_FILE, scenario.input.content]])}
          : {}),
      };
    case 'scriptFails':
    case 'failsThenSucceeds':
      return {...BASE, scripts: answered([], failing(scenario.failure))};
    case 'copyFails':
      return {
        ...BASE,
        copies: [{matches: () => true, ending: failing(scenario.failure)}],
      };
    case 'clientFile':
      return scenario.reachable
        ? {...BASE, hostPaths: new Map([[LOCAL_FILE, HOST_PATH]])}
        : BASE;
    default:
      return {
        ...BASE,
        scripts: answered([], {kind: 'exit', status: 0}),
        copies: [{matches: () => true, ending: {kind: 'copied'}}],
      };
  }
}

function inputFor(scenario: ContractScenario): ScriptInput {
  switch (scenario.kind) {
    case 'digestsInput':
      return scenario.input.kind === 'text'
        ? scenario.input
        : {kind: 'file', localFile: LOCAL_FILE};
    case 'missingInputFile':
    case 'streamsUntilCancelled':
      return {kind: 'file', localFile: LOCAL_FILE};
    default:
      return {kind: 'text', text: ''};
  }
}

const FAKE_HARNESS: ChannelHarness = {
  scriptFailures: ALL_KINDS,
  copyFailures: ALL_KINDS,
  reachesClientFiles: true,
  stage: (scenario: ContractScenario): Promise<StagedChannel> =>
    Promise.resolve({
      channel: new RecordingChannel(setupFor(scenario)),
      script: {
        script: 'scenario',
        interpreter: 'posixShell',
        environment: {},
        input: inputFor(scenario),
      },
      copy: {localFile: LOCAL_FILE, remotePath: '/home/user/archive.tar.gz'},
      ...(scenario.kind === 'clientFile' && scenario.reachable
        ? {hostPath: HOST_PATH}
        : {}),
    }),
};

describe('host channel contract on the recording channel', () => {
  for (const contractCase of channelContractCases(FAKE_HARNESS)) {
    it(contractCase.name, contractCase.check);
  }
});

describe('host channel contract cases', () => {
  it('stage only the cases a transport without failures or client paths can play', () => {
    deepStrictEqual(
      channelContractCases({
        ...FAKE_HARNESS,
        scriptFailures: [],
        copyFailures: [],
        reachesClientFiles: false,
      }).map(contractCase => contractCase.name),
      [
        'delivers every output line in order before the outcome',
        'reports a non-zero exit status as a result, not a failure',
        'ends a script cancelled before the call as cancelled, with no output',
        'ends a running script as cancelled when it is cancelled',
        "streams a local file to the script's input byte for byte",
        "gives a text input to the script's input as UTF-8",
        'fails a run whose input file is missing with spawnFailed naming the file, with no output',
        'ends a script reading a streamed file as cancelled when it is cancelled',
        'copies a file',
        'ends a copy cancelled before the call as cancelled',
        'gives no host path for a client file the host cannot read directly',
      ],
    );
  });

  it('reject a channel that ignores cancellation', async () => {
    const ignoring: ChannelHarness = {
      ...FAKE_HARNESS,
      stage: async scenario => {
        const staged = await FAKE_HARNESS.stage(scenario);
        const channel = new RecordingChannel(setupFor(scenario));
        return {
          ...staged,
          channel: {
            identity: () => channel.identity(),
            platformHint: () => channel.platformHint(),
            copyToHost: request => channel.copyToHost(request),
            runScript: (request, onLine) =>
              channel.runScript(
                {...request, cancellation: new AbortController().signal},
                onLine,
              ),
          },
        };
      },
    };
    const cancelledBefore = channelContractCases(ignoring).find(contractCase =>
      contractCase.name.startsWith('ends a script cancelled'),
    );
    await rejects(cancelledBefore?.check() ?? Promise.resolve());
  });
});
