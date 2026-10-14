import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FakeClientProcess} from './fake-client-process.ts';
import {
  nodeProcessSpawner,
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
  let handle: FakeClientProcess;
  let spawner: ProcessSpawner;

  beforeEach(() => {
    specifications = [];
    handle = new FakeClientProcess({
      program: 'ssh',
      programArguments: [],
      environment: {},
    });
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

    it("F-2101 AC-17, AC-18: the connection keeps the editor's HOME, PATH and SSH_AUTH_SOCK, an empty SSH_AUTH_SOCK as it is, under our askpass", () => {
      const environment = sessionEnvironment(
        {HOME: '/home/user', PATH: '/bin', SSH_AUTH_SOCK: ''},
        {...INVOCATION, environment: {}},
        {SSH_ASKPASS: '/ext/askpass.sh', SSH_ASKPASS_REQUIRE: 'force'},
      );
      deepStrictEqual(
        [environment.HOME, environment.PATH, environment.SSH_AUTH_SOCK],
        ['/home/user', '/bin', ''],
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

    it("takes SSH_ASKPASS_REQUIRE from the askpass's environment", () => {
      strictEqual(
        sessionEnvironment({}, INVOCATION, {
          SSH_ASKPASS: '/ext/askpass.sh',
          SSH_ASKPASS_REQUIRE: 'force',
        }).SSH_ASKPASS_REQUIRE,
        'force',
      );
    });

    it("passes the window's DISPLAY and WAYLAND_DISPLAY on as they are", () => {
      const environment = sessionEnvironment(
        {DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-0'},
        INVOCATION,
        {SSH_ASKPASS: '/run/askpass.sh', SSH_ASKPASS_REQUIRE: 'force'},
      );
      deepStrictEqual(
        [environment.DISPLAY, environment.WAYLAND_DISPLAY],
        [':1', 'wayland-0'],
      );
    });

    it('adds no DISPLAY of its own', () => {
      strictEqual(
        'DISPLAY' in
          sessionEnvironment({}, INVOCATION, {
            SSH_ASKPASS: '/run/askpass.sh',
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
      await session.write('text');
      await session.write(Uint8Array.of(1, 2));
      session.endInput();
      deepStrictEqual(
        [handle.input.map(piece => [...piece]), handle.inputEnded],
        [
          [
            [116, 101, 120, 116],
            [1, 2],
          ],
          true,
        ],
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
    await session.write('hello');
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

  /**
   * The holder of a child's standard streams, as a ControlMaster holds its mux client's. It writes to its notes file, once
   * each, `stdin` when its input ends and `stdout` or `stderr` when a write to that stream fails: what it sees when the
   * spawner has destroyed its own end of each stream. It writes a dot to both outputs every 50 ms from 300 ms on.
   */
  const HOLDER = [
    'const fs = require("node:fs");',
    'const notes = process.argv[1];',
    'const seen = new Set();',
    'const note = name => { if (!seen.has(name)) { seen.add(name); fs.appendFileSync(notes, name + "\\n"); } };',
    'process.stdin.on("end", () => note("stdin"));',
    'process.stdin.on("error", () => note("stdin"));',
    'process.stdin.resume();',
    'process.stdout.on("error", () => note("stdout"));',
    'process.stderr.on("error", () => note("stderr"));',
    'setTimeout(() => setInterval(() => { process.stdout.write("."); process.stderr.write("."); }, 50), 300);',
    'setTimeout(() => undefined, 30000);',
  ].join(' ');

  /** A child that starts a holder of its streams, prints the holder's pid and then runs `ending`. */
  function heldStreamsScript(notes: string, ending: string): string {
    return [
      'const {spawn} = require("node:child_process");',
      `const holder = spawn(process.execPath, ["-e", ${JSON.stringify(HOLDER)}, ${JSON.stringify(notes)}], {stdio: "inherit", detached: true});`,
      'holder.unref();',
      'process.stdout.write(holder.pid + "\\n");',
      ending,
    ].join(' ');
  }

  const holders: number[] = [];
  const notesFolders: string[] = [];

  afterEach(() => {
    for (const holder of holders.splice(0)) {
      try {
        process.kill(holder);
      } catch {
        // The holder has already ended.
      }
    }
    for (const folder of notesFolders.splice(0)) {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  /** Starts a held-streams child on the spawner itself, and gives its handle once the holder's pid is printed. */
  async function heldStreams(ending: string) {
    const folder = mkdtempSync(path.join(tmpdir(), 'held-'));
    notesFolders.push(folder);
    const notes = path.join(folder, 'notes');
    const handle = await nodeProcessSpawner({
      program: process.execPath,
      programArguments: ['-e', heldStreamsScript(notes, ending)],
      environment: {},
    });
    const exits: Array<number | undefined> = [];
    const exited = new Promise<number | undefined>(resolve => {
      handle.onExit(status => {
        exits.push(status);
        resolve(status);
      });
    });
    const holder = await new Promise<number>(resolve => {
      handle.onOutput(chunk => {
        resolve(Number(chunk.trim()));
      });
    });
    holders.push(holder);
    return {handle, exits, exited, notes, printedAt: Date.now()};
  }

  /** The streams the holder has seen released so far, in order of name. */
  function notedStreams(notes: string): string[] {
    return existsSync(notes)
      ? readFileSync(notes, 'utf8').split('\n').filter(Boolean).sort()
      : [];
  }

  /** The streams the holder saw released, in order of name, waiting up to 1 500 ms for all three. */
  async function releasedStreams(notes: string): Promise<string[]> {
    for (
      let waited = 0;
      waited < 1500 && notedStreams(notes).length < 3;
      waited += 50
    ) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return notedStreams(notes);
  }

  it('connect-51: kill() ends a session whose stdio another process holds, well before the drain, and releases its three streams', async () => {
    const {handle, exited, notes} = await heldStreams(
      'setTimeout(() => undefined, 30000);',
    );
    const killedAt = Date.now();
    handle.kill();
    const status = await exited;
    const elapsed = Date.now() - killedAt;
    deepStrictEqual(
      [status, elapsed < 250, await releasedStreams(notes)],
      [undefined, true, ['stderr', 'stdin', 'stdout']],
    );
  });

  it('connect-51: a process that exits while another holds its stdio is seen to exit after the drain, which releases its three streams', async () => {
    const {exited, notes, printedAt} = await heldStreams('process.exit(4);');
    const status = await exited;
    const elapsed = Date.now() - printedAt;
    deepStrictEqual(
      [status, elapsed >= 500, elapsed < 2000, await releasedStreams(notes)],
      [4, true, true, ['stderr', 'stdin', 'stdout']],
    );
  });

  it('connect-51: the exit is reported once, though the streams close after the drain', async () => {
    const {exits, exited} = await heldStreams('process.exit(4);');
    await exited;
    await new Promise(resolve => setTimeout(resolve, 600));
    deepStrictEqual(exits, [4]);
  });

  it("connect-51: a plain process's exit is reported when its streams close, well before the drain", async () => {
    const handle = await nodeProcessSpawner({
      program: process.execPath,
      programArguments: ['-e', 'process.exit(3);'],
      environment: {},
    });
    const startedAt = Date.now();
    const status = await new Promise<number | undefined>(resolve => {
      handle.onExit(resolve);
    });
    deepStrictEqual([status, Date.now() - startedAt < 400], [3, true]);
  });

  it("connect-51: once a plain process's exit is reported, nothing of the spawner keeps the caller running", async () => {
    const spawner = pathToFileURL(
      path.join(
        import.meta.dirname,
        '..',
        '..',
        'src',
        'process',
        'node-spawner.ts',
      ),
    ).href;
    const caller = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          `import {nodeProcessSpawner} from ${JSON.stringify(spawner)};`,
          'const handle = await nodeProcessSpawner({program: process.execPath, programArguments: ["-e", ""], environment: {}});',
          'handle.onExit(() => process.stdout.write("reported\\n"));',
        ].join(' '),
      ],
      {stdio: ['ignore', 'pipe', 'inherit']},
    );
    const reportedAt = await new Promise<number>(resolve => {
      caller.stdout.once('data', () => {
        resolve(Date.now());
      });
    });
    await new Promise(resolve => caller.once('exit', resolve));
    strictEqual(Date.now() - reportedAt < 250, true);
  });

  it("connect-51: a process's last output still arrives before its exit is reported", async () => {
    const session = sessionOf(
      await spawnSession(
        nodeProcessSpawner,
        {
          program: process.execPath,
          arguments: ['-e', 'process.stdout.write("last"); process.exit(0);'],
          environment: {},
        },
        {},
        {},
      ),
    );
    const events: string[] = [];
    session.onOutput(chunk => {
      events.push(`output ${chunk}`);
    });
    await session.exit();
    events.push('exit');
    deepStrictEqual(events, ['output last', 'exit']);
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
    await session.write('late');
    session.endInput();
  });
});
