import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level, type LogLine} from 'lib-log';
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
  searchPath?: string;
  platform?: 'linux' | 'windows' | 'macOS';
  configFile?: string;
  connectTimeout?: unknown;
  mode?: ConnectionMode;
  input?: ConnectInput;
  processEnvironment?: Readonly<Record<string, string>>;
}

/** Runs the step once and gives its result, what it kept, what the spawner saw, and the log. */
async function located(scenario: Scenario = {}): Promise<{
  result: Awaited<ReturnType<ReturnType<typeof locateClientStep>>>;
  state: ConnectState;
  seen: Seen;
  lines: LogLine[];
  /** The lines at warn and error level: what went wrong. */
  logged: string[];
  /** The lines at info level: the client search. */
  searched: string[];
}> {
  const seen: Seen = {started: [], killed: [], environments: []};
  const state: ConnectState = {};
  const sink = new MemorySink();
  const step = locateClientStep({
    settingValue: () => scenario.settingValue ?? '',
    configFile: () => scenario.configFile ?? '',
    mode: () => scenario.mode ?? 'shared',
    connectTimeout: () => scenario.connectTimeout,
    environment: {
      searchPath: scenario.searchPath ?? '/usr/bin',
      programFilesFolder: '',
    },
    platform: scenario.platform ?? 'linux',
    homeFolder: '/home/a',
    spawner: spawnerOf(
      scenario.checks ?? {[SSH_PROGRAM]: OPENSSH},
      scenario.lookup ?? LOOKUP,
      seen,
    ),
    processEnvironment: scenario.processEnvironment ?? {},
    checkMilliseconds: 20,
    state,
    logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
  });
  const result = await step(scenario.input ?? INPUT);
  return {
    result,
    state,
    seen,
    lines: sink.lines,
    logged: sink.lines
      .filter(line => line.level !== 'info')
      .map(line => line.message),
    searched: sink.lines
      .filter(line => line.level === 'info')
      .map(line => line.message),
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

  it('F-2101 AC-27: the lookup runs only the check and ssh -G, and has no port that writes a setting, a state key or a file', async () => {
    const {seen} = await located();
    deepStrictEqual(seen.started, ['ssh -V', 'ssh -G -- dev']);
  });

  it('F-2101 AC-2, AC-17: each candidate is started once, with -V alone and exactly the editor environment', async () => {
    const editor = {
      HOME: '/home/a',
      PATH: '/usr/bin',
      SSH_AUTH_SOCK: '/run/agent.sock',
    };
    const {seen} = await located({
      checks: {
        '/opt/other': {kind: 'exit', errorOutput: 'Dropbear', status: 0},
        [SSH_PROGRAM]: OPENSSH,
      },
      settingValue: '/opt/other',
      processEnvironment: editor,
    });
    deepStrictEqual(
      [seen.started, seen.environments],
      [
        ['/opt/other -V', 'ssh -V', 'ssh -G -- dev'],
        [editor, editor, editor],
      ],
    );
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

  it('F-2201 7.E8: a configured file that is not absolute fails as unknown with no reason', async () => {
    const {result} = await located({configFile: 'relcfg/x'});
    deepStrictEqual(result, {kind: 'failed', failure: {kind: 'unknown'}});
  });

  it('F-2201 7.E8: the same starts no process', async () => {
    const {seen} = await located({configFile: 'relcfg/x'});
    deepStrictEqual([seen.started, seen.killed], [[], []]);
  });

  it('F-2201 7.E8: the same is told to the log once as an error', async () => {
    const {lines} = await located({configFile: 'relcfg/x'});
    deepStrictEqual(
      lines.map(line => `${line.level} ${line.message}`),
      ['error remote.SSH.configFile is not an absolute path: "relcfg/x"'],
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
        '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n',
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
        '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n',
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

describe('the lines of the client search (card connect-28, F-2101 §9)', () => {
  const BANNER = 'OpenSSH_9.6p1, OpenSSL 3.0.13';

  it('F-2101 §9: a configured client that works is logged as set, checked, its banner and used', async () => {
    const {searched} = await located({
      settingValue: '/opt/ssh/bin/ssh',
      checks: {'/opt/ssh/bin/ssh': OPENSSH},
    });
    deepStrictEqual(searched, [
      'remote.SSH.path = "/opt/ssh/bin/ssh"',
      'Checking ssh client: /opt/ssh/bin/ssh',
      `ssh client: ${BANNER}`,
      'Using ssh client: /opt/ssh/bin/ssh',
    ]);
  });

  it('F-2101 AC-6: a missing configured file is logged as not a valid SSH binary, then the search path is used', async () => {
    const {searched} = await located({
      settingValue: '/nowhere/ssh',
      checks: {[SSH_PROGRAM]: OPENSSH},
    });
    deepStrictEqual(searched, [
      'remote.SSH.path = "/nowhere/ssh"',
      'Checking ssh client: /nowhere/ssh',
      'ssh client: (no banner)',
      'ssh client /nowhere/ssh was rejected: it could not be started: not found',
      'remote.SSH.path "/nowhere/ssh" is not a valid SSH binary',
      'Searched for ssh in: /usr/bin',
      'Checking ssh client: ssh',
      `ssh client: ${BANNER}`,
      'Using ssh client: ssh',
    ]);
  });

  it('F-2101 §9: an unset setting goes straight to the search path', async () => {
    const {searched} = await located();
    deepStrictEqual(searched, [
      'remote.SSH.path = ""',
      'Searched for ssh in: /usr/bin',
      'Checking ssh client: ssh',
      `ssh client: ${BANNER}`,
      'Using ssh client: ssh',
    ]);
  });

  it('F-2101 §9: an unset setting is logged as ""', async () => {
    const {searched} = await located();
    deepStrictEqual(searched[0], 'remote.SSH.path = ""');
  });

  it('F-2101 §9: every folder of the search path is a line, in order', async () => {
    const {searched} = await located({searchPath: '/usr/local/bin:/usr/bin'});
    deepStrictEqual(searched.slice(1, 3), [
      'Searched for ssh in: /usr/local/bin',
      'Searched for ssh in: /usr/bin',
    ]);
  });

  it('F-2101 §9: the search path of a Windows client is split at semicolons', async () => {
    const {searched} = await located({
      platform: 'windows',
      searchPath: 'C:\\Windows;C:\\Tools',
    });
    deepStrictEqual(searched.slice(1, 3), [
      'Searched for ssh in: C:\\Windows',
      'Searched for ssh in: C:\\Tools',
    ]);
  });

  it('F-2201 §9: a non-empty setting logs the configuration file in use, expanded', async () => {
    const {searched} = await located({configFile: '~/cfg'});
    deepStrictEqual(searched[0], 'SSH configuration file in use: /home/a/cfg');
  });

  it('F-2201 §9: an absolute setting is logged as typed', async () => {
    const {searched} = await located({configFile: '/etc/ssh/custom'});
    deepStrictEqual(
      searched[0],
      'SSH configuration file in use: /etc/ssh/custom',
    );
  });

  it('F-2201 §9: the configuration file line comes before the client search', async () => {
    const {searched} = await located({configFile: '~/cfg'});
    deepStrictEqual(searched.slice(0, 2), [
      'SSH configuration file in use: /home/a/cfg',
      'remote.SSH.path = ""',
    ]);
  });

  it('F-2201 §9: an empty setting logs no configuration file line', async () => {
    const {searched} = await located();
    deepStrictEqual(
      searched.filter(line => line.startsWith('SSH configuration file')),
      [],
    );
  });

  it('F-2201 §9: an invalid setting logs no configuration file line', async () => {
    const {searched} = await located({configFile: 'relative/cfg'});
    deepStrictEqual(searched, []);
  });

  it('F-2101 §9: a rejected banner says why', async () => {
    const {searched} = await located({
      checks: {
        [SSH_PROGRAM]: {
          kind: 'exit',
          errorOutput: 'PuTTY Release 0.81',
          status: 0,
        },
      },
    });
    deepStrictEqual(
      searched.filter(line => line.includes('was rejected')),
      ['ssh client ssh was rejected: its banner does not name OpenSSH'],
    );
  });

  it('F-2101 §9: a failed check gives its exit status', async () => {
    const {searched} = await located({
      checks: {
        [SSH_PROGRAM]: {kind: 'exit', errorOutput: BANNER, status: 1},
      },
    });
    deepStrictEqual(
      searched.filter(line => line.includes('was rejected')),
      ['ssh client ssh was rejected: exit status 1'],
    );
  });

  it('F-2101 §9: a check that outlasts its bound says it timed out', async () => {
    const {searched} = await located({checks: {[SSH_PROGRAM]: {kind: 'hang'}}});
    deepStrictEqual(
      searched.filter(line => line.includes('was rejected')),
      ['ssh client ssh was rejected: it timed out'],
    );
  });

  it('F-2101 §9: a check that a signal ended says so', async () => {
    const {searched} = await located({
      checks: {
        [SSH_PROGRAM]: {kind: 'exit', errorOutput: BANNER, status: undefined},
      },
    });
    deepStrictEqual(
      searched.filter(line => line.includes('was rejected')),
      ['ssh client ssh was rejected: it was ended by a signal'],
    );
  });

  it('F-2101 §9: the banner is read from standard error only', async () => {
    const {searched} = await located({
      checks: {[SSH_PROGRAM]: {kind: 'exit', output: BANNER, status: 0}},
    });
    deepStrictEqual(
      searched.filter(line => line.startsWith('ssh client:')),
      ['ssh client: (no banner)'],
    );
  });

  it('F-2101 §9: the candidate whose banner is on standard output only is still used', async () => {
    const {searched} = await located({
      checks: {[SSH_PROGRAM]: {kind: 'exit', output: BANNER, status: 0}},
    });
    deepStrictEqual(searched.at(-1), 'Using ssh client: ssh');
  });

  it('F-2101 §9: the first non-empty line of standard error is the banner', async () => {
    const {searched} = await located({
      checks: {
        [SSH_PROGRAM]: {
          kind: 'exit',
          errorOutput: `\n\n${BANNER}\nmore\n`,
          status: 0,
        },
      },
    });
    deepStrictEqual(
      searched.filter(line => line.startsWith('ssh client:')),
      [`ssh client: ${BANNER}`],
    );
  });

  it('F-2101 §9: a rejected candidate that did not come from the setting has no "not a valid" line', async () => {
    const {searched} = await located({checks: {}});
    deepStrictEqual(
      searched.filter(line => line.includes('not a valid SSH binary')),
      [],
    );
  });

  it('F-2101 §9: no candidate accepted writes no "Using" line', async () => {
    const {searched} = await located({checks: {}});
    deepStrictEqual(
      searched.filter(line => line.startsWith('Using ssh client')),
      [],
    );
  });
});
