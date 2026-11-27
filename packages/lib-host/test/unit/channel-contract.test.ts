import {deepStrictEqual, rejects} from 'node:assert';
import {createHash} from 'node:crypto';
import type {ChannelFailureKind} from '../../src/index.ts';
import {LONGEST_PENDING_LINE} from '../../src/channel-rules.ts';
import {
  channelContractCases,
  LONG_LINE_LENGTH,
  ruleScriptOf,
  type BoundedCopy,
  type ChannelHarness,
  type HostProcesses,
  type ContractScenario,
  type StagedChannel,
  stagedInputOf,
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
    case 'backgroundsThenWaits':
      return {
        ...BASE,
        scripts: answered([String(TREE_CHILD)], {kind: 'holdUntilCancelled'}),
      };
    case 'detachesThenWaits':
      return {
        ...BASE,
        scripts: answered([String(DETACHED_CHILD)], {
          kind: 'holdUntilCancelled',
        }),
      };
    case 'printsBothStreams':
      return {
        ...BASE,
        scripts: answered(['out one', 'err one', 'out two'], {
          kind: 'exit',
          status: 0,
        }),
      };
    case 'printsLongLine':
      return {
        ...BASE,
        scripts: answered(
          Array.from({length: LONG_LINE_LENGTH / LONGEST_PENDING_LINE}, () =>
            'x'.repeat(LONGEST_PENDING_LINE),
          ),
          {kind: 'exit', status: 0},
        ),
      };
    default:
      return {
        ...BASE,
        scripts: answered([], {kind: 'exit', status: 0}),
        copies: [{matches: () => true, ending: {kind: 'copied'}}],
      };
  }
}

/** The pid the fake's backgrounding script prints, a process its cancel ends. */
const TREE_CHILD = 111;

/** The pid the fake's detaching script prints, a process outside the script's tree. */
const DETACHED_CHILD = 222;

/** The fake host's running processes: only the detached child, until a case ends it. */
const running = new Set<number>();

const PLAIN_HARNESS: ChannelHarness = {
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
        input: stagedInputOf(scenario, LOCAL_FILE),
      },
      copy: {localFile: LOCAL_FILE, remotePath: '/home/user/archive.tar.gz'},
      ...(scenario.kind === 'clientFile' && scenario.reachable
        ? {hostPath: HOST_PATH}
        : {}),
    }),
};

/** The fake host's processes, as the rules' cases read them. */
const FAKE_PROCESSES: HostProcesses = {
  alive: processId => Promise.resolve(running.has(processId)),
  end: processId => {
    running.delete(processId);
    return Promise.resolve();
  },
};

/** The fake copy's writes: none, so every one is bounded. */
const FAKE_COPY: BoundedCopy = {kind: 'measured', largestWrite: () => 0};

const FAKE_HARNESS: ChannelHarness = {
  ...PLAIN_HARNESS,
  processes: FAKE_PROCESSES,
  boundedCopy: FAKE_COPY,
};

describe('host channel contract on the recording channel', () => {
  beforeEach(() => {
    running.clear();
    running.add(DETACHED_CHILD);
  });

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
        "ends a cancelled script's whole tree: a backgrounded child is gone",
        'leaves a process the script detached from its tree running after a cancel',
        'delivers standard error with standard output, in the order the script wrote them',
        'delivers a line with no line end in parts of at most 65536 characters, all of it',
        'writes a large copy in pieces of at most 65536 bytes',
      ],
    );
  });

  it("register the rules' cases as pending, naming the card, for a channel that hasn't met them yet", async () => {
    const pending = channelContractCases({
      ...FAKE_HARNESS,
      pendingOn: '#9999',
    }).filter(contractCase => contractCase.pending === true);
    await Promise.all(pending.map(contractCase => contractCase.check()));
    deepStrictEqual(
      [
        pending.length,
        pending.every(contractCase =>
          contractCase.name.endsWith('(pending #9999)'),
        ),
      ],
      [5, true],
    );
  });

  it('register the bounded-copy case as pending with its reason for a transport with no drain', async () => {
    const [notApplicable] = channelContractCases({
      ...FAKE_HARNESS,
      boundedCopy: {kind: 'notApplicable', reason: 'no drain signal'},
    }).filter(contractCase => contractCase.pending === true);
    await notApplicable?.check();
    deepStrictEqual(
      notApplicable?.name,
      'writes a large copy in bounded pieces: not applicable, no drain signal',
    );
  });

  it("reject a channel whose cancel leaves the script's background child running, a harness that sees no processes, and a copy written whole", async () => {
    /** How the case named by `start` among `cases` ends: passed, or rejected. */
    async function outcomeOf(
      cases: ReturnType<typeof channelContractCases>,
      start: string,
    ): Promise<string> {
      const found = cases.find(contractCase =>
        contractCase.name.startsWith(start),
      );
      return (found?.check() ?? Promise.reject(new Error('no such case'))).then(
        () => 'passed',
        (error: unknown) => `rejected: ${String(error).split('\n')[0] ?? ''}`,
      );
    }
    running.clear();
    running.add(TREE_CHILD);
    const tree = await outcomeOf(
      channelContractCases(FAKE_HARNESS),
      "ends a cancelled script's whole tree",
    );
    const unseen = await outcomeOf(
      channelContractCases({...PLAIN_HARNESS, boundedCopy: FAKE_COPY}),
      "ends a cancelled script's whole tree",
    );
    const whole = await outcomeOf(
      channelContractCases({...PLAIN_HARNESS, processes: FAKE_PROCESSES}),
      'writes a large copy in pieces',
    );
    deepStrictEqual(
      [tree.startsWith('rejected'), unseen, whole.startsWith('rejected')],
      [true, 'rejected: Error: this harness sees no host processes', true],
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

describe('ruleScriptOf (card #3312)', () => {
  it('gives a script for each scenario a real shell plays out, and none for the others', () => {
    const scripts = [
      {kind: 'backgroundsThenWaits'},
      {kind: 'detachesThenWaits'},
      {kind: 'printsBothStreams'},
      {kind: 'printsLongLine'},
      {kind: 'copiesLarge'},
    ].map(scenario => ruleScriptOf(scenario as ContractScenario));
    deepStrictEqual(
      scripts.map(script => script?.slice(0, 5)),
      ['sleep', '(sets', 'print', 'head ', undefined],
    );
  });
});
