import {deepStrictEqual} from 'node:assert';
import {
  createWslRunner,
  type ExecRequest,
  type StartRequest,
} from '../../src/runner.ts';
import {
  type FakeRun,
  fakeWsl,
  utf16Output,
  utf8Output,
} from '../../src/testing/fake-wsl.ts';

const SYSTEM_WSL = 'C:\\Windows\\System32\\wsl.exe';

/** A request to run `program` in a distro, with what a test changes. */
function requestOf(changes: Partial<ExecRequest> = {}): ExecRequest {
  return {
    distro: 'Ubuntu',
    program: 'echo',
    programArguments: ['hi'],
    environment: {},
    input: {kind: 'none'},
    cancellation: new AbortController().signal,
    ...changes,
  };
}

/** A runner over a fake that gives every process `run`. */
function runnerOver(behaviour: FakeRun, session = {}) {
  const fake = fakeWsl(() => behaviour, session);
  return {fake, runner: createWslRunner(fake)};
}

/** The lines `exec` delivered and its outcome. */
async function executed(
  behaviour: FakeRun,
  changes: Partial<ExecRequest> = {},
  session = {},
) {
  const {fake, runner} = runnerOver(behaviour, session);
  const lines: string[] = [];
  const outcome = await runner.exec(requestOf(changes), line => {
    lines.push(line);
  });
  return {fake, lines, outcome};
}

const EXITS_ZERO: FakeRun = {kind: 'exits', status: 0};

/** The kind of a failed outcome, else the outcome's own kind. */
function kindOf(outcome: {kind: string; failure?: {kind: string}}): string {
  return outcome.failure?.kind ?? outcome.kind;
}

/** The `status` verb run by `runner`. */
function manageStatus(runner: ReturnType<typeof runnerOver>['runner']) {
  return runner.manage({
    verb: 'status',
    operands: [],
    cancellation: new AbortController().signal,
  });
}

describe('D1: where wsl.exe is', () => {
  it('cw01 locate: finds wsl.exe in System32 first', async () => {
    const {runner} = runnerOver(EXITS_ZERO);
    deepStrictEqual(await runner.locate(), {kind: 'located', path: SYSTEM_WSL});
  });

  it('cw01 locate: finds wsl.exe on the PATH when System32 has none', async () => {
    const {fake, runner} = runnerOver(EXITS_ZERO, {
      systemRoot: undefined,
      environment: {PATH: 'D:\\tools;E:\\bin'},
    });
    fake.local.set('E:\\bin\\wsl.exe', new Uint8Array(0));
    deepStrictEqual(await runner.locate(), {
      kind: 'located',
      path: 'E:\\bin\\wsl.exe',
    });
  });

  it('cw01 locate: reads the PATH under the name Path too', async () => {
    const {fake, runner} = runnerOver(EXITS_ZERO, {
      systemRoot: undefined,
      environment: {Path: 'F:\\apps'},
    });
    fake.local.set('F:\\apps\\wsl.exe', new Uint8Array(0));
    deepStrictEqual(await runner.locate(), {
      kind: 'located',
      path: 'F:\\apps\\wsl.exe',
    });
  });

  it('cw01 locate: is wslMissing when neither has it', async () => {
    const {runner} = runnerOver(EXITS_ZERO, {
      systemRoot: undefined,
      environment: {},
    });
    const located = await runner.locate();
    deepStrictEqual(
      located.kind === 'failed' ? located.failure.kind : located.kind,
      'wslMissing',
    );
  });
});

describe('D1: the management verbs', () => {
  /** What `manage` ran: the program and arguments of the one process. */
  async function managed(
    verb: Parameters<
      ReturnType<typeof runnerOver>['runner']['manage']
    >[0]['verb'],
    operands: string[] = [],
  ) {
    const {fake, runner} = runnerOver({
      kind: 'exits',
      stdout: utf16Output('NAME  STATE\r\n'),
      status: 0,
    });
    const outcome = await runner.manage({
      verb,
      operands,
      cancellation: new AbortController().signal,
    });
    return {fake, outcome};
  }

  it('cw01 manage: status runs --status', async () => {
    const {fake} = await managed('status');
    deepStrictEqual(fake.started[0]?.programArguments, ['--status']);
  });

  it('cw01 manage: version runs --version', async () => {
    const {fake} = await managed('version');
    deepStrictEqual(fake.started[0]?.programArguments, ['--version']);
  });

  it('cw01 manage: list runs --list --verbose', async () => {
    const {fake} = await managed('list');
    deepStrictEqual(fake.started[0]?.programArguments, ['--list', '--verbose']);
  });

  it('cw01 manage: listOnline runs --list --online', async () => {
    const {fake} = await managed('listOnline');
    deepStrictEqual(fake.started[0]?.programArguments, ['--list', '--online']);
  });

  it('cw01 manage: install names the distro after -d', async () => {
    const {fake} = await managed('install', ['Debian']);
    deepStrictEqual(fake.started[0]?.programArguments, [
      '--install',
      '-d',
      'Debian',
    ]);
  });

  it('cw01 manage: setDefault names the distro', async () => {
    const {fake} = await managed('setDefault', ['Debian']);
    deepStrictEqual(fake.started[0]?.programArguments, [
      '--set-default',
      'Debian',
    ]);
  });

  it('cw01 manage: runs the located wsl.exe', async () => {
    const {fake} = await managed('status');
    deepStrictEqual(fake.started[0]?.program, SYSTEM_WSL);
  });

  it('cw01 manage: decodes UTF-16 output into plain lines', async () => {
    const {outcome} = await managed('list');
    deepStrictEqual(outcome, {kind: 'ran', text: 'NAME  STATE\n', status: 0});
  });

  it('cw01 manage: decodes UTF-8 output that has no byte-order mark', async () => {
    const {runner} = runnerOver({
      kind: 'exits',
      stdout: utf8Output('Default Distribution: Ubuntu\n'),
      status: 0,
    });
    deepStrictEqual(await manageStatus(runner), {
      kind: 'ran',
      text: 'Default Distribution: Ubuntu\n',
      status: 0,
    });
  });

  it('cw01 manage: keeps what a verb prints on standard error', async () => {
    const {runner} = runnerOver({
      kind: 'exits',
      stderr: utf16Output('E\r\n'),
      status: 1,
    });
    deepStrictEqual(await manageStatus(runner), {
      kind: 'ran',
      text: 'E\n',
      status: 1,
    });
  });

  it('cw01 manage: an inbox wsl.exe that lacks the verb is wslNeedsUpdate', async () => {
    const {runner} = runnerOver({
      kind: 'exits',
      stdout: utf16Output(
        "Invalid command line argument: --version\r\nPlease use 'wsl.exe --help' to get a list of supported arguments.\r\n",
      ),
      status: 0xffffffff,
    });
    const outcome = await runner.manage({
      verb: 'version',
      operands: [],
      cancellation: new AbortController().signal,
    });
    deepStrictEqual(kindOf(outcome), 'wslNeedsUpdate');
  });

  it('cw01 manage: a missing wsl.exe is wslMissing', async () => {
    const {runner} = runnerOver(EXITS_ZERO, {
      systemRoot: undefined,
      environment: {},
    });
    const outcome = await manageStatus(runner);
    deepStrictEqual(kindOf(outcome), 'wslMissing');
  });

  it('cw01 manage: a process that cannot start is spawnFailed', async () => {
    const {runner} = runnerOver({
      kind: 'failsToStart',
      error: {code: 'EMFILE', message: 'too many open files'},
    });
    const outcome = await manageStatus(runner);
    deepStrictEqual(kindOf(outcome), 'spawnFailed');
  });

  it('cw01 manage: a start error with the code ENOENT is wslMissing', async () => {
    const {runner} = runnerOver({
      kind: 'failsToStart',
      error: {code: 'ENOENT', message: 'spawn wsl.exe ENOENT'},
    });
    const outcome = await manageStatus(runner);
    deepStrictEqual(kindOf(outcome), 'wslMissing');
  });

  it('cw01 manage: a start error with no code and a thrown text is still spawnFailed', async () => {
    const fake = fakeWsl(() => EXITS_ZERO);
    const runner = createWslRunner({
      ...fake,
      spawner: () => Promise.reject(new Error('no code')),
    });
    const outcome = await manageStatus(runner);
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.detail : outcome.kind,
      'no code',
    );
  });

  it('cw01 manage: a start that rejects with a bare text keeps the text', async () => {
    const fake = fakeWsl(() => EXITS_ZERO);
    const runner = createWslRunner({
      ...fake,
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a spawner may reject with any value
      spawner: () => Promise.reject('plain text'),
    });
    const outcome = await manageStatus(runner);
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.detail : outcome.kind,
      'plain text',
    );
  });

  it('cw01 manage: cancelled before the call is cancelled and starts nothing', async () => {
    const {fake, runner} = runnerOver(EXITS_ZERO);
    const controller = new AbortController();
    controller.abort();
    const outcome = await runner.manage({
      verb: 'status',
      operands: [],
      cancellation: controller.signal,
    });
    deepStrictEqual([kindOf(outcome), fake.started.length], ['cancelled', 0]);
  });

  it('cw01 manage: cancelled while it runs is cancelled', async () => {
    const {runner} = runnerOver({kind: 'printsUntilKilled', lines: []});
    const controller = new AbortController();
    const running = runner.manage({
      verb: 'status',
      operands: [],
      cancellation: controller.signal,
    });
    setImmediate(() => {
      controller.abort();
    });
    const outcome = await running;
    deepStrictEqual(kindOf(outcome), 'cancelled');
  });

  it('cw01 manage: a run ended by a signal is spawnFailed', async () => {
    const {runner} = runnerOver({kind: 'exits', status: undefined});
    const outcome = await manageStatus(runner);
    deepStrictEqual(kindOf(outcome), 'spawnFailed');
  });
});

describe('D1: setDefaultByWslconfig', () => {
  const WSLCONFIG = 'C:\\Windows\\System32\\wslconfig.exe';

  /** A runner over a fake that has wslconfig.exe and gives every process `run`. */
  function withWslconfig(behaviour: FakeRun, session = {}) {
    const made = runnerOver(behaviour, session);
    made.fake.local.set(WSLCONFIG, new Uint8Array(0));
    return made;
  }

  const NEVER = new AbortController().signal;

  it('F-6103 (D1): runs wslconfig.exe from System32 with /setdefault and the name, as one argument list', async () => {
    const {fake, runner} = withWslconfig({kind: 'exits', status: 0});
    const outcome = await runner.setDefaultByWslconfig('Ubuntu 24', NEVER);
    deepStrictEqual(
      [
        outcome.kind,
        fake.started.map(each => [each.program, each.programArguments]),
      ],
      ['ran', [[WSLCONFIG, ['/setdefault', 'Ubuntu 24']]]],
    );
  });

  it('F-6103 (D1): the output is decoded as manage decodes it, and a non-zero status is given as it is', async () => {
    const {runner} = withWslconfig({
      kind: 'exits',
      stdout: utf16Output('no such distro\r\n'),
      status: 1,
    });
    deepStrictEqual(await runner.setDefaultByWslconfig('x', NEVER), {
      kind: 'ran',
      text: 'no such distro\n',
      status: 1,
    });
  });

  it('F-6103 (D1): without a system root there is no PATH fallback, and it is wslMissing', async () => {
    const {fake, runner} = withWslconfig(
      {kind: 'exits', status: 0},
      {systemRoot: undefined, environment: {PATH: 'C:\\Tools'}},
    );
    fake.local.set('C:\\Tools\\wslconfig.exe', new Uint8Array(0));
    const outcome = await runner.setDefaultByWslconfig('x', NEVER);
    deepStrictEqual([kindOf(outcome), fake.started.length], ['wslMissing', 0]);
  });

  it('F-6103 (D1): a System32 without wslconfig.exe is wslMissing', async () => {
    const {fake, runner} = runnerOver({kind: 'exits', status: 0});
    const outcome = await runner.setDefaultByWslconfig('x', NEVER);
    deepStrictEqual([kindOf(outcome), fake.started.length], ['wslMissing', 0]);
  });

  it('F-6103 (D1): cancelled before the call is cancelled and starts nothing', async () => {
    const {fake, runner} = withWslconfig({kind: 'exits', status: 0});
    const outcome = await runner.setDefaultByWslconfig(
      'x',
      AbortSignal.abort(),
    );
    deepStrictEqual([kindOf(outcome), fake.started.length], ['cancelled', 0]);
  });

  it('F-6103 (D1): a run that fails to start is spawnFailed', async () => {
    const {runner} = withWslconfig({
      kind: 'failsToStart',
      error: {code: 'EMFILE', message: 'too many open files'},
    });
    deepStrictEqual(
      kindOf(await runner.setDefaultByWslconfig('x', NEVER)),
      'spawnFailed',
    );
  });
});

describe('D1: exec', () => {
  it('cw01 exec: names the distro with -d and runs the program with --exec', async () => {
    const {fake} = await executed(EXITS_ZERO);
    deepStrictEqual(fake.started[0]?.programArguments, [
      '-d',
      'Ubuntu',
      '--exec',
      'echo',
      'hi',
    ]);
  });

  it('cw01 exec: adds the working folder after --cd', async () => {
    const {fake} = await executed(EXITS_ZERO, {folder: '~'});
    deepStrictEqual(fake.started[0]?.programArguments.slice(0, 4), [
      '-d',
      'Ubuntu',
      '--cd',
      '~',
    ]);
  });

  it('cw01 exec: asserts -u only when a user is given, and then names it', async () => {
    const {fake} = await executed(EXITS_ZERO, {user: 'root'});
    deepStrictEqual(fake.started[0]?.programArguments.slice(0, 4), [
      '-d',
      'Ubuntu',
      '-u',
      'root',
    ]);
  });

  it('cw01 exec: a run with no user has no -u among its arguments', async () => {
    const {fake} = await executed(EXITS_ZERO);
    deepStrictEqual(fake.started[0]?.programArguments.includes('-u'), false);
  });

  it('cw01 exec: passes the added variables through WSLENV and not on the command line', async () => {
    const {fake} = await executed(EXITS_ZERO, {
      environment: {TOKEN: 's3cret', OTHER: 'x'},
    });
    const [spec] = fake.started;
    deepStrictEqual(
      [
        spec?.environment.TOKEN,
        spec?.environment.WSLENV,
        spec?.programArguments.join(' ').includes('s3cret'),
      ],
      ['s3cret', 'TOKEN:OTHER', false],
    );
  });

  it('cw01 exec: puts the names after an inherited WSLENV', async () => {
    const {fake} = await executed(
      EXITS_ZERO,
      {environment: {TOKEN: 'v'}},
      {environment: {PATH: 'C:\\Windows\\System32', WSLENV: 'HOME/p'}},
    );
    deepStrictEqual(fake.started[0]?.environment.WSLENV, 'HOME/p:TOKEN');
  });

  it('cw01 exec: leaves WSLENV alone when no variable is added', async () => {
    const {fake} = await executed(
      EXITS_ZERO,
      {},
      {environment: {PATH: 'C:\\Windows\\System32', WSLENV: 'HOME/p'}},
    );
    deepStrictEqual(fake.started[0]?.environment.WSLENV, 'HOME/p');
  });

  it('cw01 exec: refuses a name that is not a variable name, naming it, before starting', async () => {
    const {fake, outcome} = await executed(EXITS_ZERO, {
      environment: {'A B': 'x'},
    });
    deepStrictEqual(
      [
        outcome.kind === 'failed' ? outcome.failure.detail : outcome.kind,
        fake.started.length,
      ],
      ["'A B' is not a name an environment variable can have", 0],
    );
  });

  it('cw01 exec: delivers the lines of standard output and standard error', async () => {
    const {lines} = await executed({
      kind: 'exits',
      stdout: utf8Output('one\r\ntwo\n'),
      stderr: utf8Output('three'),
      status: 0,
    });
    deepStrictEqual(lines, ['one', 'two', 'three']);
  });

  it('cw01 exec: gives a non-zero status of the program as a result', async () => {
    const {outcome} = await executed({kind: 'exits', status: 3});
    deepStrictEqual(outcome, {kind: 'exited', status: 3});
  });

  it('cw01 exec: a run ended by a signal is spawnFailed', async () => {
    const {outcome} = await executed({kind: 'exits', status: undefined});
    deepStrictEqual(kindOf(outcome), 'spawnFailed');
  });

  it('cw01 exec: a missing wsl.exe is wslMissing', async () => {
    const {outcome} = await executed(
      EXITS_ZERO,
      {},
      {systemRoot: undefined, environment: {}},
    );
    deepStrictEqual(kindOf(outcome), 'wslMissing');
  });

  it('cw01 exec: an unknown distro reported by wsl.exe is distroUnknown', async () => {
    const {outcome} = await executed({
      kind: 'exits',
      stdout: utf16Output(
        'There is no distribution with the supplied name.\r\n',
      ),
      status: 0xffffffff,
    });
    deepStrictEqual(kindOf(outcome), 'distroUnknown');
  });

  it('cw01 exec: an unregistered distro reported by wsl.exe is distroUnregistered', async () => {
    const {outcome} = await executed({
      kind: 'exits',
      stdout: utf16Output('Error code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\r\n'),
      status: -1,
    });
    deepStrictEqual(kindOf(outcome), 'distroUnregistered');
  });

  it('cw01 exec: a distro that could not be started is startFailed', async () => {
    const {outcome} = await executed({
      kind: 'exits',
      stdout: utf16Output(
        'Error: 0x80070005 Wsl/Service/CreateInstance/E_ACCESSDENIED\r\n',
      ),
      status: 0xffffffff,
    });
    deepStrictEqual(kindOf(outcome), 'startFailed');
  });

  it('cw01 exec: a status of -1 whose text names no failure of wsl.exe stays the program’s', async () => {
    const {outcome} = await executed({
      kind: 'exits',
      stderr: utf8Output('segmentation fault\n'),
      status: -1,
    });
    deepStrictEqual(outcome, {kind: 'exited', status: -1});
  });

  it('cw01 exec: output that looks like a failure of wsl.exe under another status stays the program’s', async () => {
    const {outcome} = await executed({
      kind: 'exits',
      stdout: utf8Output('There is no distribution with the supplied name.\n'),
      status: 1,
    });
    deepStrictEqual(outcome, {kind: 'exited', status: 1});
  });

  it('cw01 exec: keeps only the first output bytes for the classification', async () => {
    const {outcome} = await executed({
      kind: 'exits',
      stdout: utf8Output(
        `${'x'.repeat(9000)}There is no distribution with the supplied name.`,
      ),
      status: -1,
    });
    deepStrictEqual(outcome, {kind: 'exited', status: -1});
  });

  it('cw01 exec: cancelled before the call is cancelled and starts nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    const {fake, outcome} = await executed(EXITS_ZERO, {
      cancellation: controller.signal,
    });
    deepStrictEqual([kindOf(outcome), fake.started.length], ['cancelled', 0]);
  });

  it('cw01 exec: a text input reaches the program', async () => {
    const {fake, runner} = runnerOver({kind: 'writesInput'});
    await runner.exec(
      requestOf({
        programArguments: ['/out'],
        input: {kind: 'text', text: 'héllo'},
      }),
      () => undefined,
    );
    deepStrictEqual(
      Buffer.from(fake.written.get('/out') ?? new Uint8Array()).toString(),
      'héllo',
    );
  });

  it('cw01 exec: a file input follows its prefix', async () => {
    const {fake, runner} = runnerOver({kind: 'writesInput'});
    fake.local.set('C:\\in.bin', Uint8Array.from([1, 2, 3]));
    await runner.exec(
      requestOf({
        programArguments: ['/out'],
        input: {kind: 'file', prefix: 'AB', localFile: 'C:\\in.bin'},
      }),
      () => undefined,
    );
    deepStrictEqual(
      Array.from(fake.written.get('/out') ?? []),
      [65, 66, 1, 2, 3],
    );
  });

  it('cw01 exec: a missing input file is spawnFailed naming the file, before starting', async () => {
    const {fake, outcome} = await executed(EXITS_ZERO, {
      input: {kind: 'file', prefix: '', localFile: 'C:\\missing'},
    });
    deepStrictEqual(
      [
        outcome.kind === 'failed' ? outcome.failure.detail : outcome.kind,
        fake.started.length,
      ],
      ['no such local file: C:\\missing', 0],
    );
  });

  it('cw01 exec: a process that stops reading its input does not fail the run', async () => {
    const fake = fakeWsl(() => ({kind: 'exits', status: 0}));
    const runner = createWslRunner({
      ...fake,
      spawner: async specification => {
        const handle = await fake.spawner(specification);
        return {
          ...handle,
          write: () => Promise.reject(new Error('EPIPE')),
        };
      },
    });
    deepStrictEqual(
      await runner.exec(
        requestOf({input: {kind: 'text', text: 'x'}}),
        () => undefined,
      ),
      {kind: 'exited', status: 0},
    );
  });

  it('cw01 exec: cancelled while it runs is cancelled, and delivers no line after', async () => {
    const {runner} = runnerOver({kind: 'printsUntilKilled', lines: ['up']});
    const controller = new AbortController();
    const lines: string[] = [];
    const outcome = await runner.exec(
      requestOf({cancellation: controller.signal}),
      line => {
        lines.push(line);
        controller.abort();
      },
    );
    deepStrictEqual([kindOf(outcome), lines], ['cancelled', ['up']]);
  });
});

/** A request to start `program` in a distro, with what a test changes. */
function startRequestOf(changes: Partial<StartRequest> = {}): StartRequest {
  return {
    distro: 'Ubuntu',
    program: 'echo',
    programArguments: ['hi'],
    environment: {},
    cancellation: new AbortController().signal,
    ...changes,
  };
}

/** A runner whose processes are counted when they are killed. */
function countingRunner(behaviour: FakeRun, session = {}) {
  const fake = fakeWsl(() => behaviour, session);
  const counted = {kills: 0};
  const runner = createWslRunner({
    ...fake,
    spawner: async specification => {
      const handle = await fake.spawner(specification);
      return {
        ...handle,
        kill: () => {
          counted.kills += 1;
          handle.kill();
        },
      };
    },
  });
  return {fake, runner, counted};
}

/** The text of a failure's kind, or `exited` with its status. */
function endedAs(outcome: {
  kind: string;
  status?: number;
  failure?: {kind: string};
}): string {
  return outcome.kind === 'failed'
    ? `failed ${outcome.failure?.kind ?? ''}`
    : `exited ${String(outcome.status)}`;
}

describe('start, the live process of a program in a distro (card containers-203, ruling-2156-d1-start)', () => {
  it('cw02 start: the argument list and the environment are exec’s', async () => {
    const viaExec = runnerOver(EXITS_ZERO);
    await viaExec.runner.exec(
      requestOf({
        user: 'root',
        folder: '~',
        environment: {ALPHA: '1'},
        programArguments: ['a b', '"q"'],
      }),
      () => undefined,
    );
    const viaStart = runnerOver(EXITS_ZERO);
    const started = await viaStart.runner.start(
      startRequestOf({
        user: 'root',
        folder: '~',
        environment: {ALPHA: '1'},
        programArguments: ['a b', '"q"'],
      }),
    );
    if (started.kind === 'started') {
      await started.process.exited;
    }
    deepStrictEqual(viaStart.fake.started, viaExec.fake.started);
  });

  it('cw02 start: a request cancelled already, a bad variable name, a missing wsl.exe and a program that cannot start are typed failures before any process runs', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const missing = runnerOver(EXITS_ZERO, {
      systemRoot: undefined,
      environment: {},
    });
    const broken = runnerOver({
      kind: 'failsToStart',
      error: {message: 'denied'},
    });
    deepStrictEqual(
      [
        endedAs(
          await runnerOver(EXITS_ZERO).runner.start(
            startRequestOf({cancellation: aborted.signal}),
          ),
        ),
        endedAs(
          await runnerOver(EXITS_ZERO).runner.start(
            startRequestOf({environment: {'BAD-NAME': 'x'}}),
          ),
        ),
        endedAs(await missing.runner.start(startRequestOf())),
        endedAs(await broken.runner.start(startRequestOf())),
      ],
      [
        'failed cancelled',
        'failed spawnFailed',
        'failed wslMissing',
        'failed spawnFailed',
      ],
    );
  });

  it('cw02 start: standard output passes byte for byte, also what is no UTF-8, and a chunk that came before the listener is kept for it', async () => {
    const bytes = Uint8Array.from([0xff, 0x00, 0xfe, 0x0d, 0x0a, 0xc3, 0x28]);
    const {runner} = runnerOver({kind: 'exits', stdout: bytes, status: 0});
    const started = await runner.start(startRequestOf());
    if (started.kind !== 'started') {
      throw new Error('not started');
    }
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const heard: number[][] = [];
    started.process.onOutput(chunk => {
      heard.push([...chunk]);
    });
    deepStrictEqual(
      [heard, endedAs(await started.process.exited)],
      [[[...bytes]], 'exited 0'],
    );
  });

  it('cw02 start: standard input written after the start reaches the program unchanged', async () => {
    const {fake, runner} = runnerOver({kind: 'writesInput'});
    const started = await runner.start(
      startRequestOf({programArguments: ['/tmp/out']}),
    );
    if (started.kind !== 'started') {
      throw new Error('not started');
    }
    await started.process.write(Uint8Array.from([0, 255, 10, 13]));
    await started.process.write(Uint8Array.from([7]));
    started.process.endInput();
    deepStrictEqual(
      [
        [...(fake.written.get('/tmp/out') ?? [])],
        endedAs(await started.process.exited),
      ],
      [[0, 255, 10, 13, 7], 'exited 0'],
    );
  });

  it('cw02 start: standard error is passed on as it comes', async () => {
    const {runner} = runnerOver({
      kind: 'exits',
      stderr: utf8Output('warning\n'),
      status: 3,
    });
    const started = await runner.start(startRequestOf());
    if (started.kind !== 'started') {
      throw new Error('not started');
    }
    const heard: string[] = [];
    started.process.onError(chunk => {
      heard.push(new TextDecoder().decode(chunk));
    });
    deepStrictEqual(
      [heard, endedAs(await started.process.exited)],
      [['warning\n'], 'exited 3'],
    );
  });

  it('cw02 start: a wsl.exe failure after the start settles exited with its kind, and the output before it still passed in full', async () => {
    const bulk = new Uint8Array(20_000).fill(65);
    const text = utf8Output(
      'There is no distribution with the supplied name.\n',
    );
    const {runner} = runnerOver({
      kind: 'exits',
      stdout: Uint8Array.from([...text, ...bulk]),
      status: -1,
    });
    const started = await runner.start(startRequestOf());
    if (started.kind !== 'started') {
      throw new Error('not started');
    }
    let total = 0;
    started.process.onOutput(chunk => {
      total += chunk.length;
    });
    deepStrictEqual(
      [endedAs(await started.process.exited), total],
      ['failed distroUnknown', text.length + bulk.length],
    );
  });

  it('cw02 start: kill ends the process and exited says so, a second kill does nothing, and a kill after exited does nothing', async () => {
    const live = countingRunner({kind: 'printsUntilKilled', lines: ['x']});
    const started = await live.runner.start(startRequestOf());
    if (started.kind !== 'started') {
      throw new Error('not started');
    }
    started.process.kill();
    started.process.kill();
    const afterKill = endedAs(await started.process.exited);
    started.process.kill();
    const done = countingRunner(EXITS_ZERO);
    const finished = await done.runner.start(startRequestOf());
    if (finished.kind !== 'started') {
      throw new Error('not started');
    }
    await finished.process.exited;
    finished.process.kill();
    deepStrictEqual(
      [afterKill, live.counted.kills, done.counted.kills],
      ['failed cancelled', 1, 0],
    );
  });

  it('cw02 start: cancelling the request ends the process once and exited says cancelled', async () => {
    const cancel = new AbortController();
    const live = countingRunner({kind: 'printsUntilKilled', lines: ['x']});
    const started = await live.runner.start(
      startRequestOf({cancellation: cancel.signal}),
    );
    if (started.kind !== 'started') {
      throw new Error('not started');
    }
    cancel.abort();
    started.process.kill();
    deepStrictEqual(
      [endedAs(await started.process.exited), live.counted.kills],
      ['failed cancelled', 1],
    );
  });
});
