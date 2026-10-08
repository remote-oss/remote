import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  nodeProcessSpawner,
  type ProcessHandle,
  type ProcessSpawner,
  type ProcessSpecification,
  sessionEnvironment,
  spawnSession,
  type SpawnOutcome,
  type SshSession,
} from '../../src/index.ts';

const INVOCATION = {
  program: '/usr/bin/ssh',
  arguments: ['-v', 'host'],
  environment: {INVOCATION_VARIABLE: 'one'},
};

/** A process handle that records writes and lets a test drive its streams. */
class FakeHandle implements ProcessHandle {
  readonly written: Array<string | Uint8Array> = [];
  inputEnded = false;
  killed = false;
  private readonly outputListeners: Array<(chunk: string) => void> = [];
  private readonly errorListeners: Array<(chunk: string) => void> = [];
  private readonly exitListeners: Array<(status: number | undefined) => void> =
    [];

  onOutput(listener: (chunk: string) => void): void {
    this.outputListeners.push(listener);
  }

  onError(listener: (chunk: string) => void): void {
    this.errorListeners.push(listener);
  }

  onExit(listener: (status: number | undefined) => void): void {
    this.exitListeners.push(listener);
  }

  write(data: string | Uint8Array): void {
    this.written.push(data);
  }

  endInput(): void {
    this.inputEnded = true;
  }

  kill(): void {
    this.killed = true;
  }

  output(chunk: string): void {
    this.outputListeners.forEach(listener => {
      listener(chunk);
    });
  }

  error(chunk: string): void {
    this.errorListeners.forEach(listener => {
      listener(chunk);
    });
  }

  exit(status: number | undefined): void {
    this.exitListeners.forEach(listener => {
      listener(status);
    });
  }
}

/** A start error as the system gives it: an Error, with a code when it has one. */
function failing(message: string, code?: string): Error {
  return Object.assign(new Error(message), code === undefined ? {} : {code});
}

function sessionOf(outcome: SpawnOutcome): SshSession {
  if (outcome.kind !== 'spawned') {
    throw new Error(`no session: ${outcome.failure}`);
  }
  return outcome.session;
}

describe('S3 session spawner', () => {
  let specifications: ProcessSpecification[];
  let handle: FakeHandle;
  let spawner: ProcessSpawner;

  beforeEach(() => {
    specifications = [];
    handle = new FakeHandle();
    spawner = specification => {
      specifications.push(specification);
      return Promise.resolve(handle);
    };
  });

  describe('environment', () => {
    it("passes the editor's environment unchanged (F-2101 BR-7)", () => {
      deepStrictEqual(
        sessionEnvironment(
          {PATH: '/bin', HOME: '/home/user'},
          {...INVOCATION, environment: {}},
          {},
        ),
        {PATH: '/bin', HOME: '/home/user'},
      );
    });

    it('leaves out an editor variable that has no value', () => {
      deepStrictEqual(
        sessionEnvironment(
          {PATH: '/bin', UNSET: undefined},
          {...INVOCATION, environment: {}},
          {},
        ),
        {PATH: '/bin'},
      );
    });

    it("adds the invocation's variables and then the askpass's", () => {
      deepStrictEqual(
        sessionEnvironment({PATH: '/bin'}, INVOCATION, {
          SSH_ASKPASS: '/ext/askpass.sh',
        }),
        {
          PATH: '/bin',
          INVOCATION_VARIABLE: 'one',
          SSH_ASKPASS: '/ext/askpass.sh',
        },
      );
    });

    it('never sets SSH_ASKPASS_REQUIRE from the askpass environment', () => {
      strictEqual(
        'SSH_ASKPASS_REQUIRE' in
          sessionEnvironment({}, INVOCATION, {
            SSH_ASKPASS: '/ext/askpass.sh',
            SSH_ASKPASS_REQUIRE: 'force',
          }),
        false,
      );
    });

    it("keeps the editor's own SSH_ASKPASS_REQUIRE as it is", () => {
      strictEqual(
        sessionEnvironment({SSH_ASKPASS_REQUIRE: 'never'}, INVOCATION, {})
          .SSH_ASKPASS_REQUIRE,
        'never',
      );
    });
  });

  describe('spawn', () => {
    it('starts the invocation as one program with its arguments, never through a shell', async () => {
      await spawnSession(spawner, INVOCATION, {}, {PATH: '/bin'});
      deepStrictEqual(
        [specifications[0]?.program, specifications[0]?.programArguments],
        ['/usr/bin/ssh', ['-v', 'host']],
      );
    });

    it('starts it with the layered environment', async () => {
      await spawnSession(
        spawner,
        INVOCATION,
        {SSH_ASKPASS: '/ext/a.sh'},
        {PATH: '/bin'},
      );
      deepStrictEqual(specifications[0]?.environment, {
        PATH: '/bin',
        INVOCATION_VARIABLE: 'one',
        SSH_ASKPASS: '/ext/a.sh',
      });
    });

    for (const code of ['ENOENT', 'EACCES']) {
      it(`fails as clientVanished when the system says ${code}, with its message`, async () => {
        const outcome = await spawnSession(
          () => Promise.reject(failing(`spawn ssh ${code}`, code)),
          INVOCATION,
          {},
          {},
        );
        deepStrictEqual(outcome, {
          kind: 'failed',
          failure: 'clientVanished',
          detail: `spawn ssh ${code}`,
        });
      });
    }

    it('fails as spawnFailed for any other start error', async () => {
      const outcome = await spawnSession(
        () => Promise.reject(failing('too many open files', 'EMFILE')),
        INVOCATION,
        {},
        {},
      );
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: 'spawnFailed',
        detail: 'too many open files',
      });
    });

    it('fails as spawnFailed when the error carries no code', async () => {
      const outcome = await spawnSession(
        () => Promise.reject(failing('no reason given')),
        INVOCATION,
        {},
        {},
      );
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: 'spawnFailed',
        detail: 'no reason given',
      });
    });
  });

  describe('session', () => {
    it('relays output and error pieces in order', async () => {
      const session = sessionOf(
        await spawnSession(spawner, INVOCATION, {}, {}),
      );
      const seen: string[] = [];
      session.onOutput(chunk => seen.push(`out:${chunk}`));
      session.onError(chunk => seen.push(`err:${chunk}`));
      handle.output('a');
      handle.error('b');
      handle.output('c');
      deepStrictEqual(seen, ['out:a', 'err:b', 'out:c']);
    });

    it('writes to the input and closes it', async () => {
      const session = sessionOf(
        await spawnSession(spawner, INVOCATION, {}, {}),
      );
      session.write('text');
      session.write(Uint8Array.of(1, 2));
      session.endInput();
      deepStrictEqual(
        [handle.written, handle.inputEnded],
        [['text', Uint8Array.of(1, 2)], true],
      );
    });

    it('ends the process on kill', async () => {
      sessionOf(await spawnSession(spawner, INVOCATION, {}, {})).kill();
      strictEqual(handle.killed, true);
    });

    it('resolves the exit status, also when the process ended before anyone asked', async () => {
      const session = sessionOf(
        await spawnSession(spawner, INVOCATION, {}, {}),
      );
      handle.exit(255);
      strictEqual(await session.exit(), 255);
    });

    it('resolves undefined when a signal ended the process', async () => {
      const session = sessionOf(
        await spawnSession(spawner, INVOCATION, {}, {}),
      );
      handle.exit(undefined);
      strictEqual(await session.exit(), undefined);
    });
  });
});

describe('Node.js process spawner', () => {
  it('starts a real process with piped streams and the given environment only', async () => {
    const outcome = await spawnSession(
      nodeProcessSpawner,
      {
        program: process.execPath,
        arguments: [
          '-e',
          'process.stdin.on("data", d => { process.stdout.write("in:" + d); process.stderr.write(process.env.ONLY_THIS ?? "missing"); }); process.stdin.on("end", () => process.exit(3));',
        ],
        environment: {ONLY_THIS: 'yes'},
      },
      {},
      {},
    );
    const session = sessionOf(outcome);
    let output = '';
    let error = '';
    session.onOutput(chunk => {
      output += chunk;
    });
    session.onError(chunk => {
      error += chunk;
    });
    session.write('hello');
    session.endInput();
    deepStrictEqual(
      [await session.exit(), output, error],
      [3, 'in:hello', 'yes'],
    );
  });

  it('reports a signal as no exit status', async () => {
    const session = sessionOf(
      await spawnSession(
        nodeProcessSpawner,
        {
          program: process.execPath,
          arguments: ['-e', 'setTimeout(() => undefined, 30000)'],
          environment: {},
        },
        {},
        {},
      ),
    );
    session.kill();
    strictEqual(await session.exit(), undefined);
  });

  it('fails as clientVanished for a program that is not there', async () => {
    const outcome = await spawnSession(
      nodeProcessSpawner,
      {program: '/nonexistent/ssh', arguments: [], environment: {}},
      {},
      {},
    );
    strictEqual(
      outcome.kind === 'failed' ? outcome.failure : outcome.kind,
      'clientVanished',
    );
  });

  it('ignores a write after the process ended', async () => {
    const session = sessionOf(
      await spawnSession(
        nodeProcessSpawner,
        {program: process.execPath, arguments: ['-e', ''], environment: {}},
        {},
        {},
      ),
    );
    await session.exit();
    session.write('late');
    session.endInput();
  });
});
