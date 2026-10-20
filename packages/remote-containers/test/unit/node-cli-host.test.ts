import {deepStrictEqual} from 'node:assert';
import {mock} from 'node:test';
import {PassThrough} from 'node:stream';
import type {
  CliLine,
  CliRun,
  StdinPresentation,
} from '../../src/cli/cli-host.ts';
import {nodeCliHost} from '../../src/cli/node-cli-host.ts';
import type {NodeCliPorts} from '../../src/cli/node-cli-ports.ts';

const PATHS = {
  node: '/usr/bin/node',
  entry: '/ext/dist/devcontainers-cli/devcontainer.js',
  preload: '/ext/dist/cli-preload.js',
  editorModules: '/app/node_modules.asar',
};

/** The preload's marker line, saying whether it loaded `node-pty`. */
function markerLine(loaded: boolean): string {
  return `${JSON.stringify({marker: 'remote-oss-cli-preload', nodePty: {loaded, from: loaded ? 'editor' : 'none'}})}\n`;
}

/** What a test sees of the fake system. */
interface Fake {
  ports: NodeCliPorts;
  spawns: Array<{
    program: string;
    programArguments: readonly string[];
    options: unknown;
  }>;
  signals: Array<[number, string]>;
  /** What a test wrote to the process's stdin. */
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  stdinWrote: string[];
  /** Ends the process with `status`. */
  exit(status: number | null): void;
}

function fakeSystem(
  options: {
    failure?: string;
    gone?: boolean;
  } = {},
): Fake {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdinWrote: string[] = [];
  stdin.on('data', (chunk: Buffer) => stdinWrote.push(chunk.toString()));
  const ends: Array<(status: number | null) => void> = [];
  const exited = new Promise<number | null>(resolve => {
    ends.push(resolve);
  });
  const spawns: Fake['spawns'] = [];
  const signals: Fake['signals'] = [];
  return {
    spawns,
    signals,
    stdin,
    stdout,
    stderr,
    stdinWrote,
    exit: status => {
      stdout.end();
      stderr.end();
      ends[0]?.(status);
    },
    ports: {
      spawn: (program, programArguments, spawnOptions) => {
        spawns.push({program, programArguments, options: spawnOptions});
        return Promise.resolve(
          options.failure === undefined
            ? {
                kind: 'spawned',
                process: {processId: 4242, stdin, stdout, stderr, exited},
              }
            : {kind: 'failed', message: options.failure},
        );
      },
      killGroup: (processId, signal) => {
        signals.push([processId, signal]);
        if (options.gone === true) {
          throw new Error('ESRCH');
        }
      },
    },
  };
}

describe('the CLI host over a spawned node (card containers-04)', () => {
  it('C3: the program is node with the preload, the entry and the arguments, without a shell, as a group leader', async () => {
    const fake = fakeSystem();
    const running = nodeCliHost(PATHS, {HOME: '/home/u'}, fake.ports).run(
      ['up', '--workspace-folder', '/work/a b/"q"'],
      () => undefined,
      new AbortController().signal,
    );
    fake.exit(0);
    await running;
    deepStrictEqual(fake.spawns, [
      {
        program: '/usr/bin/node',
        programArguments: [
          '--require',
          '/ext/dist/cli-preload.js',
          '/ext/dist/devcontainers-cli/devcontainer.js',
          'up',
          '--workspace-folder',
          '/work/a b/"q"',
        ],
        options: {
          shell: false,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            BUILDKIT_PROGRESS: 'plain',
            HOME: '/home/u',
            ELECTRON_RUN_AS_NODE: '1',
            REMOTE_OSS_EDITOR_MODULES: '/app/node_modules.asar',
          },
        },
      },
    ]);
  });

  it('C3: every line of both streams is told in order, and the first line of stdout is the result', async () => {
    const fake = fakeSystem();
    const lines: CliLine[] = [];
    const running = nodeCliHost(PATHS, {}, fake.ports).run(
      [],
      line => lines.push(line),
      new AbortController().signal,
    );
    await new Promise(resolve => setImmediate(resolve));
    fake.stderr.write('warn\n');
    await new Promise(resolve => setImmediate(resolve));
    fake.stdout.write('{"outcome":"success"}\nsecond\npart');
    await new Promise(resolve => setImmediate(resolve));
    fake.exit(0);
    deepStrictEqual(
      [await running, lines],
      [
        {kind: 'ran', result: '{"outcome":"success"}', status: 0},
        [
          {stream: 'stderr', line: 'warn'},
          {stream: 'stdout', line: '{"outcome":"success"}'},
          {stream: 'stdout', line: 'second'},
          {stream: 'stdout', line: 'part'},
        ],
      ],
    );
  });

  it('ADR-0010: stdout lines after the result that look like a result are not the result', async () => {
    const fake = fakeSystem();
    const running = nodeCliHost(PATHS, {}, fake.ports).run(
      [],
      () => undefined,
      new AbortController().signal,
    );
    await new Promise(resolve => setImmediate(resolve));
    fake.stdout.write(
      '{"outcome":"success"}\nnpm WARN {"outcome":"error"}\n  {"outcome":"error"}\n',
    );
    await new Promise(resolve => setImmediate(resolve));
    fake.exit(0);
    deepStrictEqual(await running, {
      kind: 'ran',
      result: '{"outcome":"success"}',
      status: 0,
    });
  });

  it('C3: a run with no stdout has no result, and the status is the process’s', async () => {
    const fake = fakeSystem();
    const running = bareRun(fake);
    fake.exit(1);
    deepStrictEqual(await running, {kind: 'ran', result: undefined, status: 1});
  });

  /** A run aborted while it runs; the CLI ends before the 5 s, or only after them. */
  async function aborted(endsFirst: boolean) {
    mock.timers.enable({apis: ['setTimeout']});
    try {
      const fake = fakeSystem();
      const controller = new AbortController();
      const running = nodeCliHost(PATHS, {}, fake.ports).run(
        [],
        () => undefined,
        controller.signal,
      );
      await Promise.resolve();
      await Promise.resolve();
      controller.abort();
      const afterAbort = [...fake.signals];
      if (endsFirst) {
        fake.exit(143);
        await running;
        await Promise.resolve();
      }
      mock.timers.tick(5000);
      if (!endsFirst) {
        fake.exit(143);
      }
      return {afterAbort, signals: fake.signals, outcome: await running};
    } finally {
      mock.timers.reset();
    }
  }

  it('C3: an abort sends SIGTERM to the group, then SIGKILL after 5 s, and the run ends with status null', async () => {
    const {afterAbort, signals, outcome} = await aborted(false);
    deepStrictEqual(
      [afterAbort, signals, outcome],
      [
        [[4242, 'SIGTERM']],
        [
          [4242, 'SIGTERM'],
          [4242, 'SIGKILL'],
        ],
        {kind: 'ran', result: undefined, status: null},
      ],
    );
  });

  it('C3: a CLI that ends before the 5 s is not killed', async () => {
    deepStrictEqual((await aborted(true)).signals, [[4242, 'SIGTERM']]);
  });

  it('C3: an abort before the run signals at once, and a group that is gone is ignored', async () => {
    const fake = fakeSystem({gone: true});
    const controller = new AbortController();
    controller.abort();
    const running = nodeCliHost(PATHS, {}, fake.ports).run(
      [],
      () => undefined,
      controller.signal,
    );
    await new Promise(resolve => setImmediate(resolve));
    fake.exit(null);
    deepStrictEqual(
      [await running, fake.signals[0]],
      [{kind: 'ran', result: undefined, status: null}, [4242, 'SIGTERM']],
    );
  });

  it('C3: a program that cannot start is spawnFailed with the system’s message', async () => {
    const fake = fakeSystem({failure: 'spawn ENOENT'});
    deepStrictEqual(
      await nodeCliHost(PATHS, {}, fake.ports).run(
        [],
        () => undefined,
        new AbortController().signal,
      ),
      {kind: 'spawnFailed', message: 'spawn ENOENT'},
    );
  });

  /** A run over `fake` without an onStdin. */
  function bareRun(fake: Fake): Promise<CliRun> {
    return nodeCliHost(PATHS, {}, fake.ports).run(
      [],
      () => undefined,
      new AbortController().signal,
    );
  }

  /**
   * A run over `fake` that captures the stdin writer the host offers and the presentation it hands with it, and the
   * CLI lines it tells; `stderr` is written first, which the preload's marker line usually begins.
   */
  function capturingRun(
    fake: Fake,
    stderr: string,
  ): {
    running: Promise<CliRun>;
    writer: () => ((data: string) => void) | undefined;
    presentations: StdinPresentation[];
    lines: CliLine[];
  } {
    let writer: ((data: string) => void) | undefined;
    const presentations: StdinPresentation[] = [];
    const lines: CliLine[] = [];
    const running = nodeCliHost(PATHS, {}, fake.ports).run(
      [],
      line => lines.push(line),
      new AbortController().signal,
      (write, presentation) => {
        writer = write;
        presentations.push(presentation);
      },
    );
    fake.stderr.write(stderr);
    return {running, writer: () => writer, presentations, lines};
  }

  it('F-0415 7.E6: onStdin gets a writer that delivers to the stdin of the CLI, an Enter as LF', async () => {
    const fake = fakeSystem();
    const {running, writer} = capturingRun(fake, markerLine(false));
    await new Promise(resolve => setImmediate(resolve));
    writer()?.('yes\r\n');
    await new Promise(resolve => setImmediate(resolve));
    fake.exit(0);
    deepStrictEqual(
      [await running, fake.stdinWrote],
      [{kind: 'ran', result: undefined, status: 0}, ['yes\n\n']],
    );
  });

  it('F-0415 7.E6: a run without onStdin never touches the stdin of the CLI', async () => {
    const fake = fakeSystem();
    const running = bareRun(fake);
    fake.exit(0);
    deepStrictEqual(
      [await running, fake.stdinWrote],
      [{kind: 'ran', result: undefined, status: 0}, []],
    );
  });

  it('F-0415 7.E6: a write after the CLI has ended is dropped, without an error', async () => {
    const fake = fakeSystem();
    const {running, writer} = capturingRun(fake, markerLine(false));
    await new Promise(resolve => setImmediate(resolve));
    fake.stdin.destroy();
    fake.exit(0);
    writer()?.('late\r\n');
    deepStrictEqual(await running, {kind: 'ran', result: undefined, status: 0});
  });

  it('ADR-0011: the marker line sets echoed, and is not told as a CLI line', async () => {
    const fake = fakeSystem();
    const {running, presentations, lines} = capturingRun(
      fake,
      markerLine(true),
    );
    fake.stderr.write('{"type":"text","level":2,"text":"hi"}\n');
    await new Promise(resolve => setImmediate(resolve));
    fake.exit(0);
    await running;
    deepStrictEqual(
      [presentations, lines],
      [
        ['echoed'],
        [{stream: 'stderr', line: '{"type":"text","level":2,"text":"hi"}'}],
      ],
    );
  });

  it('ADR-0011: a marker that says not loaded gives plain', async () => {
    const fake = fakeSystem();
    const {running, presentations} = capturingRun(fake, markerLine(false));
    await new Promise(resolve => setImmediate(resolve));
    fake.exit(0);
    await running;
    deepStrictEqual(presentations, ['plain']);
  });

  /** A run over `fake` whose stderr is `text` and no marker; the host offers no writer until the run has ended. */
  async function markerlessRun(
    fake: Fake,
    text: string,
  ): Promise<{presentations: StdinPresentation[]; lines: CliLine[]}> {
    const {running, presentations, lines} = capturingRun(fake, text);
    await new Promise(resolve => setImmediate(resolve));
    const before = [...presentations];
    fake.exit(0);
    await running;
    deepStrictEqual(before, []);
    return {presentations, lines};
  }

  it('ADR-0011: no marker gives plain at the end of the run, once', async () => {
    const {presentations} = await markerlessRun(fakeSystem(), '');
    deepStrictEqual(presentations, ['plain']);
  });

  it('ADR-0011: a line that mentions the marker inside other text is a CLI line, not the marker', async () => {
    const mentions = '{"type":"text","text":"remote-oss-cli-preload"}';
    const prefixed = `prefix ${markerLine(true).trim()}`;
    const {presentations, lines} = await markerlessRun(
      fakeSystem(),
      `${mentions}\n${prefixed}\n`,
    );
    deepStrictEqual(
      [presentations, lines.map(line => line.line)],
      [['plain'], [mentions, prefixed]],
    );
  });

  it('ADR-0011: a JSON line that is not an object, or names another marker, is a CLI line', async () => {
    const other = '{"marker":"another","nodePty":{"loaded":true}}';
    const {presentations, lines} = await markerlessRun(
      fakeSystem(),
      `42\nnull\n${other}\n`,
    );
    deepStrictEqual(
      [presentations, lines.map(line => line.line)],
      [['plain'], ['42', 'null', other]],
    );
  });

  it('ADR-0011: a marker with no nodePty, or nodePty not an object, gives plain', async () => {
    const results = [];
    for (const text of [
      '{"marker":"remote-oss-cli-preload"}',
      '{"marker":"remote-oss-cli-preload","nodePty":null}',
      '{"marker":"remote-oss-cli-preload","nodePty":{}}',
    ]) {
      const fake = fakeSystem();
      const presentations: StdinPresentation[] = [];
      const running = nodeCliHost(PATHS, {}, fake.ports).run(
        [],
        () => undefined,
        new AbortController().signal,
        (write, presentation) => {
          presentations.push(presentation);
        },
      );
      fake.stderr.write(`${text}\n`);
      await new Promise(resolve => setImmediate(resolve));
      results.push([...presentations]);
      fake.exit(0);
      await running;
    }
    deepStrictEqual(results, [['plain'], ['plain'], ['plain']]);
  });

  it("ADR-0011: an echoed run's CR reaches the CLI's stdin as typed", async () => {
    const fake = fakeSystem();
    const {running, writer} = capturingRun(fake, markerLine(true));
    await new Promise(resolve => setImmediate(resolve));
    writer()?.('yes\r');
    await new Promise(resolve => setImmediate(resolve));
    fake.exit(0);
    await running;
    deepStrictEqual(fake.stdinWrote, ['yes\r']);
  });

  it("ADR-0011: the spawn's environment carries REMOTE_OSS_EDITOR_MODULES from the paths", async () => {
    const fake = fakeSystem();
    const running = bareRun(fake);
    fake.exit(0);
    await running;
    deepStrictEqual(
      (fake.spawns[0]?.options as {env: Record<string, string>}).env
        .REMOTE_OSS_EDITOR_MODULES,
      PATHS.editorModules,
    );
  });

  it('F-0412 AC-11: the spawn asks BuildKit for plain progress, so the log holds one line per step', async () => {
    const fake = fakeSystem();
    const running = bareRun(fake);
    fake.exit(0);
    await running;
    deepStrictEqual(
      (fake.spawns[0]?.options as {env: Record<string, string>}).env
        .BUILDKIT_PROGRESS,
      'plain',
    );
  });

  it('F-0412 AC-11: a BUILDKIT_PROGRESS of the editor’s own environment wins over the plain one', async () => {
    const fake = fakeSystem();
    const running = nodeCliHost(
      PATHS,
      {BUILDKIT_PROGRESS: 'tty'},
      fake.ports,
    ).run([], () => undefined, new AbortController().signal);
    fake.exit(0);
    await running;
    deepStrictEqual(
      (fake.spawns[0]?.options as {env: Record<string, string>}).env
        .BUILDKIT_PROGRESS,
      'tty',
    );
  });
});
