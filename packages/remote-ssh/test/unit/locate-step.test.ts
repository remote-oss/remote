import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {ConnectionMode} from 'lib-ssh';
import {
  type ConnectState,
  locateClientStep,
} from '../../src/pipeline/locate-step.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';
import {
  type Answer,
  LOOKUP,
  OPENSSH,
  OPTIONS_TEXT,
  type Seen,
  SSH_PROGRAM,
  spawnerOf,
} from './locate.fixture.ts';
import {INPUT} from './pipeline.fixture.ts';

/** A lookup that fails with ssh's own words on standard error. */
function lookupFailing(errorOutput: string): Answer {
  return {kind: 'exit', errorOutput, status: 255};
}

/** The parts of one run of the step that a row may set. */
interface Scenario {
  checks?: Readonly<Record<string, Answer>>;
  lookup?: Answer;
  settingValue?: string;
  configFile?: string;
  connectTimeout?: unknown;
  mode?: ConnectionMode;
  input?: ConnectInput;
}

/** Runs the step once and gives its result, what it kept, what the spawner saw, and the log. */
async function located(scenario: Scenario = {}): Promise<{
  result: Awaited<ReturnType<ReturnType<typeof locateClientStep>>>;
  state: ConnectState;
  seen: Seen;
  logged: string[];
}> {
  const seen: Seen = {started: [], killed: []};
  const state: ConnectState = {};
  const sink = new MemorySink();
  const step = locateClientStep({
    settingValue: () => scenario.settingValue ?? '',
    configFile: () => scenario.configFile ?? '',
    mode: () => scenario.mode ?? 'shared',
    connectTimeout: () => scenario.connectTimeout,
    environment: {searchPath: '/usr/bin', programFilesFolder: ''},
    platform: 'linux',
    homeFolder: '/home/a',
    spawner: spawnerOf(
      scenario.checks ?? {[SSH_PROGRAM]: OPENSSH},
      scenario.lookup ?? LOOKUP,
      seen,
    ),
    processEnvironment: {},
    checkMilliseconds: 20,
    state,
    logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
  });
  const result = await step(scenario.input ?? INPUT);
  return {
    result,
    state,
    seen,
    logged: sink.lines.map(line => line.message),
  };
}

describe('the step that finds the ssh client', () => {
  it('F-2101: the ssh on the search path is accepted, with scp by name', async () => {
    const {state} = await located();
    deepStrictEqual(state.programs, {sshProgram: 'ssh', scpProgram: 'scp'});
  });

  it('F-2101: the setting comes first, and scp is taken beside it', async () => {
    const {state} = await located({
      checks: {'/opt/ssh/bin/ssh': OPENSSH, [SSH_PROGRAM]: OPENSSH},
      settingValue: '/opt/ssh/bin/ssh',
    });
    deepStrictEqual(state.programs, {
      sshProgram: '/opt/ssh/bin/ssh',
      scpProgram: '/opt/ssh/bin/scp',
    });
  });

  it('F-2101: the client is checked with -V, then the accepted one looks the host up', async () => {
    const {seen} = await located();
    deepStrictEqual(seen.started, ['ssh -V', 'ssh -G -- dev']);
  });

  it('F-2101: a banner on standard output is accepted too', async () => {
    const {state} = await located({
      checks: {[SSH_PROGRAM]: {kind: 'exit', output: 'OpenSSH_9.6', status: 0}},
    });
    deepStrictEqual(state.programs?.sshProgram, 'ssh');
  });

  it('F-2101 7.E1: a configured program that is not OpenSSH falls through to the search path', async () => {
    const {state} = await located({
      checks: {
        '/opt/other': {kind: 'exit', errorOutput: 'Dropbear', status: 0},
        [SSH_PROGRAM]: OPENSSH,
      },
      settingValue: '/opt/other',
    });
    deepStrictEqual(state.programs?.sshProgram, 'ssh');
  });

  it('F-2101: a banner with a failing status is not accepted', async () => {
    const {result} = await located({
      checks: {
        [SSH_PROGRAM]: {kind: 'exit', errorOutput: 'OpenSSH_9.6', status: 1},
      },
    });
    deepStrictEqual(result.kind, 'failed');
  });

  it('F-2101: a program that does not answer in time is killed and not accepted', async () => {
    const {result, seen} = await located({
      checks: {[SSH_PROGRAM]: {kind: 'hang'}},
    });
    deepStrictEqual([result.kind, seen.killed], ['failed', ['ssh']]);
  });

  it('F-2101 S009: no accepted client fails with the missing-installation reason, and keeps nothing', async () => {
    const {result, state} = await located({checks: {}});
    deepStrictEqual(
      [result, state],
      [
        {
          kind: 'failed',
          failure: {kind: 'prerequisiteMissing', reason: {id: 'S009'}},
        },
        {},
      ],
    );
  });
});

describe("the lookup of the host's configuration", () => {
  it('F-2202: the options ssh -G printed are kept for the connect', async () => {
    const {state} = await located();
    deepStrictEqual(state.effective, {
      hostName: 'dev',
      user: 'alex',
      port: '22',
      localForwards: [],
      clearAllForwardings: false,
    });
  });

  it('connect-14: the lookup names the target as the connection does, with its user and port', async () => {
    const {seen} = await located({
      input: {...INPUT, target: {kind: 'plain', text: 'alice@h1:2222'}},
    });
    deepStrictEqual(seen.started[1], 'ssh -G -l alice -p 2222 -- h1');
  });

  it('F-2202: the configuration file setting is given to the lookup, its ~ expanded', async () => {
    const {seen} = await located({configFile: '~/cfg'});
    deepStrictEqual(seen.started[1], 'ssh -F /home/a/cfg -G -- dev');
  });

  it("F-2105 BR-1: the host's connect timeout decides the probe's and the tunnel's waits", async () => {
    const {result} = await located({
      lookup: {
        kind: 'exit',
        output: `${OPTIONS_TEXT}connecttimeout 9\n`,
        status: 0,
      },
      connectTimeout: 30,
    });
    deepStrictEqual(result, {
      kind: 'done',
      value: {probeMilliseconds: 11000, tunnelMilliseconds: 9000},
    });
  });

  it('F-2105 BR-1: a host that names no connect timeout takes the setting', async () => {
    const {result} = await located({connectTimeout: 30});
    deepStrictEqual(result, {
      kind: 'done',
      value: {probeMilliseconds: 32000, tunnelMilliseconds: 30000},
    });
  });

  it('F-2201: a lookup ssh refuses is read as the connection would be, with its reason and hints', async () => {
    const {result} = await located({
      lookup: lookupFailing(
        'ssh: Could not resolve hostname dev: Name or service not known\n',
      ),
    });
    deepStrictEqual(result, {
      kind: 'failed',
      failure: {
        kind: 'unreachable',
        reason: {id: 'S032'},
        hints: [
          {
            status: 'OfflineError',
            message: 'Error: OfflineError',
            details: {id: 'S032'},
            mitigations: [],
            resources: [],
          },
        ],
      },
    });
  });

  it("F-2201 7.E6: ssh's complaint goes to the log, line by line", async () => {
    const {logged} = await located({
      lookup: lookupFailing('/cfg line 3: Bad configuration option: foo\n\n'),
    });
    deepStrictEqual(logged, ['/cfg line 3: Bad configuration option: foo']);
  });

  it('F-2201 AC-26: a refused configuration file shows no reason, and nothing is kept', async () => {
    const {result, state} = await located({
      lookup: lookupFailing(
        '/cfg line 3: Bad configuration option: foo\n/cfg: terminating, 1 bad configuration options\n',
      ),
    });
    deepStrictEqual(
      [result, state],
      [{kind: 'failed', failure: {kind: 'unknown', hints: []}}, {}],
    );
  });

  it("F-2201 7.E6: ssh's lines ended with \\r\\n reach the log without the \\r", async () => {
    const {logged} = await located({
      lookup: lookupFailing(
        '/cfg line 3: Bad configuration option: foo\r\n/cfg: terminating, 1 bad configuration options\r\n',
      ),
    });
    deepStrictEqual(logged, [
      '/cfg line 3: Bad configuration option: foo',
      '/cfg: terminating, 1 bad configuration options',
    ]);
  });

  it('F-2201 AC-26: a refused configuration file ended with \\r\\n shows no reason either', async () => {
    const {result} = await located({
      lookup: lookupFailing(
        '/cfg line 3: Bad configuration option: foo\r\n/cfg: terminating, 1 bad configuration options\r\n',
      ),
    });
    deepStrictEqual(result, {
      kind: 'failed',
      failure: {kind: 'unknown', hints: []},
    });
  });

  it("F-2201: a reason taken from ssh's words carries no \\r", async () => {
    const {result} = await located({
      lookup: lookupFailing('alex@dev: Permission denied (publickey).\r\n'),
    });
    deepStrictEqual(result.kind === 'failed' && result.failure.reason, {
      text: 'Permission denied (publickey).',
    });
  });

  it('F-2201 AC-35: a configuration file ssh cannot read, its line ended with \\r\\n, is "Permission denied"', async () => {
    const {result} = await located({
      lookup: lookupFailing(
        "Can't open user config file /home/a/cfg: Permission denied\r\n",
      ),
    });
    deepStrictEqual(result, {
      kind: 'failed',
      failure: {
        kind: 'unknown',
        reason: {text: 'Permission denied'},
        hints: [],
      },
    });
  });

  it('F-2201 7.E6: a last line with no line end is logged too', async () => {
    const {logged} = await located({
      lookup: lookupFailing('first\r\nlast'),
    });
    deepStrictEqual(logged, ['first', 'last']);
  });

  it("connect-14: the connect's mode reads the failure: a changed host key in a shared connection", async () => {
    const {result} = await located({
      lookup: lookupFailing(
        'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\n',
      ),
    });
    deepStrictEqual(
      result.kind === 'failed' && result.failure.kind,
      'hostKeyChanged',
    );
  });

  it('connect-14: the same lines in a terminal connection are not a changed host key', async () => {
    const {result} = await located({
      lookup: lookupFailing(
        'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\n',
      ),
      mode: 'terminal',
    });
    deepStrictEqual(result.kind === 'failed' && result.failure.kind, 'unknown');
  });

  it('connect-14: a lookup that ends well but prints no options fails as unknown with no reason', async () => {
    const {result} = await located({
      lookup: {kind: 'exit', output: 'nothing useful\n', status: 0},
    });
    deepStrictEqual(result, {kind: 'failed', failure: {kind: 'unknown'}});
  });

  it('connect-14: the text that could not be read is logged', async () => {
    const {logged} = await located({
      lookup: {kind: 'exit', output: 'nothing useful\n', status: 0},
    });
    deepStrictEqual(logged, [
      'ssh -G: the output names no hostname, user or port',
    ]);
  });

  it('connect-14: a lookup past its bound is killed and fails as a timeout with no reason', async () => {
    const {result, seen} = await located({lookup: {kind: 'hang'}});
    deepStrictEqual(
      [result, seen.killed],
      [{kind: 'failed', failure: {kind: 'timeout'}}, ['ssh']],
    );
  });

  it('connect-14: a lookup a signal ended is read from its lines, not as a timeout', async () => {
    const {result} = await located({
      lookup: {
        kind: 'exit',
        errorOutput:
          'ssh: Could not resolve hostname dev: Name or service not known\n',
        status: undefined,
      },
    });
    deepStrictEqual(
      result.kind === 'failed' && result.failure.kind,
      'unreachable',
    );
  });

  it('connect-14: a lookup that cannot start fails as unknown with no reason', async () => {
    const {result} = await located({lookup: {kind: 'refuse'}});
    deepStrictEqual(result, {
      kind: 'failed',
      failure: {kind: 'unknown', hints: []},
    });
  });
});
