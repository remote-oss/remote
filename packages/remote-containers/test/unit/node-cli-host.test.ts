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
};

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
          env: {HOME: '/home/u', ELECTRON_RUN_AS_NODE: '1'},
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

  /** A run over `fake` that captures the stdin writer the host offers; `writer` gives it once it has. */
  function capturingRun(fake: Fake): {
    running: Promise<CliRun>;
    writer: () => ((data: string) => void) | undefined;
  } {
    let writer: ((data: string) => void) | undefined;
    const running = nodeCliHost(PATHS, {}, fake.ports).run(
      [],
      () => undefined,
      new AbortController().signal,
      write => {
        writer = write;
      },
    );
    return {running, writer: () => writer};
  }

  /** Runs `fake` with a stdin and returns whether the host offered a writer, and the presentation it handed. */
  async function presentedStdin(
    fake: Fake,
    presentation?: StdinPresentation,
  ): Promise<[boolean, StdinPresentation | undefined]> {
    let write: ((data: string) => void) | undefined;
    let given: StdinPresentation | undefined;
    const running = nodeCliHost(PATHS, {}, fake.ports).run(
      [],
      () => undefined,
      new AbortController().signal,
      (writer, givenPresentation) => {
        write = writer;
        given = givenPresentation;
      },
      presentation,
    );
    await new Promise(resolve => setImmediate(resolve));
    fake.exit(0);
    await running;
    return [write !== undefined, given];
  }

  it('F-0415 7.E6: onStdin gets a writer that delivers to the stdin of the CLI, an Enter as LF', async () => {
    const fake = fakeSystem();
    const {running, writer} = capturingRun(fake);
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
    const {running, writer} = capturingRun(fake);
    await new Promise(resolve => setImmediate(resolve));
    fake.stdin.destroy();
    fake.exit(0);
    writer()?.('late\r\n');
    deepStrictEqual(await running, {kind: 'ran', result: undefined, status: 0});
  });

  it('F-0415 7.E6: a run hands its stdin writer and its presentation, plain by default or as given', async () => {
    const plain = await presentedStdin(fakeSystem(), undefined);
    const echoed = await presentedStdin(fakeSystem(), 'echoed');
    deepStrictEqual(
      [plain, echoed],
      [
        [true, 'plain'],
        [true, 'echoed'],
      ],
    );
  });
});
