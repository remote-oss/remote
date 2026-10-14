import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {hostPathOf, type ScriptRequest} from 'lib-host';
import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';
import {execChannelOf} from '../../src/exec/exec-channel.ts';
import {ustarHeader, ustarTrailer} from '../../src/exec/tar-stream.ts';
import {fakeEngine, type ProcessScript} from './fake-engine.ts';

const NEVER = new AbortController().signal;

let folder = '';

/** Ends when stdin does, with `status`. */
function endsWith(status: number, error = ''): ProcessScript {
  return async process => {
    await process.stdinEnded;
    if (error !== '') {
      process.printError(error);
    }
    process.exit(status);
  };
}

function request(changes: Partial<ScriptRequest> = {}): ScriptRequest {
  return {
    script: 'echo hi',
    interpreter: 'posixShell',
    environment: {},
    input: {kind: 'text', text: ''},
    cancellation: NEVER,
    ...changes,
  };
}

describe('the exec channel (card containers-02)', () => {
  before(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'exec-channel-'));
  });

  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('R-26: a value goes in the docker process’s environment and its name alone in the arguments', async () => {
    const engine = fakeEngine(endsWith(0));
    await execChannelOf(engine, 'c1', 'node').runScript(
      request({environment: {TOKEN: 's3cret value'}}),
      () => undefined,
    );
    const [spawned] = engine.processes;
    deepStrictEqual(
      [
        spawned?.argv.includes('TOKEN'),
        spawned?.argv.some(argument => argument.includes('s3cret')),
        spawned?.environment,
      ],
      [true, false, {TOKEN: 's3cret value'}],
    );
  });

  it('R-26: the detail of a failed script holds stderr only, never the environment', async () => {
    const engine = fakeEngine(endsWith(125, 'docker exec failed\n'));
    const outcome = await execChannelOf(engine, 'c1', 'node').runScript(
      request({environment: {TOKEN: 's3cret value'}}),
      () => undefined,
    );
    deepStrictEqual(
      outcome.kind === 'failed' && outcome.failure.detail.includes('s3cret'),
      false,
    );
  });

  it('contracts §1: a copy spawns with the directory as one argument and names the file in the tar header', async () => {
    const file = path.join(folder, 'payload.bin');
    writeFileSync(file, 'abc');
    const engine = fakeEngine(endsWith(0));
    await execChannelOf(engine, 'c1', 'node').copyToHost({
      localFile: file,
      remotePath: "/tmp/a b/it's.tar.gz",
      cancellation: NEVER,
    });
    const [spawned] = engine.processes;
    deepStrictEqual(
      [
        spawned?.argv.at(-1),
        spawned?.stdin().subarray(0, 512).equals(ustarHeader("it's.tar.gz", 3)),
      ],
      ['/tmp/a b', true],
    );
  });

  it('contracts §1: the powershell interpreter is refused before anything spawns', async () => {
    const engine = fakeEngine();
    const outcome = await execChannelOf(engine, 'c1', 'node').runScript(
      request({interpreter: 'powershell'}),
      () => undefined,
    );
    deepStrictEqual(
      [outcome, engine.processes.length],
      [
        {
          kind: 'failed',
          failure: {
            kind: 'spawnFailed',
            detail:
              'the powershell interpreter is not available in a container',
          },
        },
        0,
      ],
    );
  });

  it('contracts §1: an environment name that is not a name is refused, naming it, before anything spawns', async () => {
    const engine = fakeEngine();
    const outcome = await execChannelOf(engine, 'c1', 'node').runScript(
      request({environment: {'A-B': 'x'}}),
      () => undefined,
    );
    deepStrictEqual(
      [
        outcome.kind === 'failed' && outcome.failure.kind,
        outcome.kind === 'failed' && outcome.failure.detail.includes('A-B'),
        engine.processes.length,
      ],
      ['spawnFailed', true, 0],
    );
  });

  it('contracts §1: a script of 7 UTF-8 bytes is given exactly, with nothing added, then the input, and its byte count is in the arguments', async () => {
    const engine = fakeEngine(endsWith(0));
    await execChannelOf(engine, 'c1', 'node').runScript(
      request({script: 'echo é', input: {kind: 'text', text: 'x'}}),
      () => undefined,
    );
    const [spawned] = engine.processes;
    deepStrictEqual(
      [spawned?.argv.at(-1), spawned?.stdin().toString()],
      ['eval "$(dd bs=1 count=7 2>/dev/null)"', 'echo éx'],
    );
  });

  for (const [name, chunks, expected] of [
    [
      'output is told line by line, a carriage return before the line end is dropped, and the last partial line is flushed',
      ['one\r\ntw', 'o\nlast'],
      ['one', 'two', 'last'],
    ],
    [
      'a partial line that ends with a carriage return is flushed without it',
      ['end\r'],
      ['end'],
    ],
  ] as const) {
    it(`contracts §1: ${name}`, async () => {
      const engine = fakeEngine(async process => {
        await process.stdinEnded;
        for (const chunk of chunks) {
          process.print(chunk);
        }
        process.exit(0);
      });
      const lines: string[] = [];
      await execChannelOf(engine, 'c1', 'node').runScript(request(), line =>
        lines.push(line),
      );
      deepStrictEqual(lines, expected);
    });
  }

  it('contracts §1: a spawn that fails is spawnFailed with its detail', async () => {
    const engine = fakeEngine({failure: 'spawn docker ENOENT'});
    deepStrictEqual(
      await execChannelOf(engine, 'c1', 'node').runScript(
        request(),
        () => undefined,
      ),
      {
        kind: 'failed',
        failure: {kind: 'spawnFailed', detail: 'spawn docker ENOENT'},
      },
    );
  });

  it('contracts §1: a copy whose spawn fails is spawnFailed with its detail', async () => {
    const file = path.join(folder, 'tiny.bin');
    writeFileSync(file, 'a');
    const engine = fakeEngine({failure: 'spawn docker ENOENT'});
    deepStrictEqual(
      await execChannelOf(engine, 'c1', 'node').copyToHost({
        localFile: file,
        remotePath: '/d/a',
        cancellation: NEVER,
      }),
      {
        kind: 'failed',
        failure: {kind: 'spawnFailed', detail: 'spawn docker ENOENT'},
      },
    );
  });

  it('contracts §1: a copy of a file that does not exist, and a name over 100 bytes, are copyFailed and spawn nothing', async () => {
    const engine = fakeEngine();
    const long = path.join(folder, 'long.bin');
    writeFileSync(long, 'a');
    const channel = execChannelOf(engine, 'c1', 'node');
    const kinds = await Promise.all(
      [
        {localFile: path.join(folder, 'missing'), remotePath: '/d/a'},
        {localFile: long, remotePath: `/d/${'n'.repeat(101)}`},
      ].map(each => channel.copyToHost({...each, cancellation: NEVER})),
    );
    deepStrictEqual(
      [
        kinds.map(outcome => outcome.kind === 'failed' && outcome.failure.kind),
        engine.processes.length,
      ],
      [['copyFailed', 'copyFailed'], 0],
    );
  });

  it('contracts §1: a copy of 200 000 bytes arrives in order, header first and trailer last, each write waiting for the stream', async () => {
    const content = Buffer.alloc(200_000);
    for (let index = 0; index < content.length; index++) {
      content[index] = index % 251;
    }
    const file = path.join(folder, 'big.bin');
    writeFileSync(file, content);
    const engine = fakeEngine(endsWith(0));
    await execChannelOf(engine, 'c1', 'node').copyToHost({
      localFile: file,
      remotePath: '/d/big.bin',
      cancellation: NEVER,
    });
    const [spawned] = engine.processes;
    deepStrictEqual(
      [
        spawned
          ?.stdin()
          .equals(
            Buffer.concat([
              ustarHeader('big.bin', 200_000),
              content,
              ustarTrailer(200_000),
            ]),
          ),
        (spawned?.pressure.fulls ?? 0) > 0,
        spawned?.pressure.drains,
      ],
      [true, true, spawned?.pressure.fulls],
    );
  });

  it('contracts §1: the identity is the container, the platform linux, and there is no client path on the host', async () => {
    const channel = execChannelOf(fakeEngine(), 'c1', 'node');
    deepStrictEqual(
      [
        channel.identity(),
        channel.platformHint(),
        'clientPathOnHost' in channel,
        await hostPathOf(channel, '/x'),
      ],
      ['c1', 'linux', false, undefined],
    );
  });

  /** The outcome of a script given 200 000 bytes of input. */
  function withLongInput(engine: ReturnType<typeof fakeEngine>) {
    return execChannelOf(engine, 'c1', 'node').runScript(
      request({input: {kind: 'text', text: 'x'.repeat(200_000)}}),
      () => undefined,
    );
  }

  it('contracts §1: a process that ends before reading its input does not hang the run', async () => {
    const engine = fakeEngine(process => {
      process.exit(3);
    });
    deepStrictEqual(await withLongInput(engine), {kind: 'exited', status: 3});
  });

  it('contracts §1: a character split across two chunks of stdout and of stderr arrives whole', async () => {
    const bytes = Buffer.from('café\n');
    const engine = fakeEngine(async process => {
      process.print(bytes.subarray(0, 4));
      process.printError(bytes.subarray(0, 4));
      await new Promise(resolve => setImmediate(resolve));
      process.print(bytes.subarray(4));
      process.printError(bytes.subarray(4));
      process.exit(3);
    });
    const lines: string[] = [];
    const outcome = await execChannelOf(engine, 'c1', 'node').runScript(
      request(),
      line => lines.push(line),
    );
    deepStrictEqual([lines, outcome], [['café'], {kind: 'exited', status: 3}]);
  });

  it('contracts §1: a process that ends while its input waits to drain does not hang the run', async () => {
    const engine = fakeEngine(process => {
      process.stall();
      setImmediate(() => {
        process.exit(3);
      });
    });
    deepStrictEqual(await withLongInput(engine), {kind: 'exited', status: 3});
  });

  it('contracts §1: a stdin that breaks while the input waits to drain leaves the outcome to the exit', async () => {
    const engine = fakeEngine(process => {
      process.stall();
      setImmediate(() => {
        process.breakStdin();
        process.exit(3);
      });
    });
    deepStrictEqual(await withLongInput(engine), {kind: 'exited', status: 3});
  });

  it('contracts §1: a script cancelled in the middle of its output delivers no more lines and ends as cancelled', async () => {
    const engine = fakeEngine(process => {
      process.print('first\nsecond\nthird');
    });
    const controller = new AbortController();
    const lines: string[] = [];
    const outcome = await execChannelOf(engine, 'c1', 'node').runScript(
      request({cancellation: controller.signal}),
      line => {
        lines.push(line);
        controller.abort();
      },
    );
    deepStrictEqual(
      [lines, outcome],
      [
        ['first'],
        {
          kind: 'failed',
          failure: {
            kind: 'cancelled',
            detail: 'cancelled while the script ran',
          },
        },
      ],
    );
  });

  /** The outcome of a script that ends with `status` and `error` on stderr, when the inspect answers `answer`. */
  async function afterKill(
    status: number,
    error: string,
    answer: EngineRunOutcome | undefined,
  ) {
    const engine = fakeEngine(endsWith(status, error));
    engine.answer = answer;
    const outcome = await execChannelOf(engine, 'c1', 'node').runScript(
      request(),
      () => undefined,
    );
    return {outcome, inspected: engine.runs};
  }

  const INSPECT = [
    'inspect',
    '--type',
    'container',
    '-f',
    '{{.State.Running}}',
    'c1',
  ];

  it('contracts §1: a kill status with nothing on stderr and a container that is not running is a closed channel', async () => {
    deepStrictEqual(
      await afterKill(137, '', {
        kind: 'ran',
        status: 0,
        stdout: 'false\n',
        stderr: '',
      }),
      {
        outcome: {
          kind: 'failed',
          failure: {
            kind: 'channelClosed',
            detail: 'the container stopped during the operation (exit 137)',
          },
        },
        inspected: [INSPECT],
      },
    );
  });

  it('contracts §1: a kill status and a container that is gone is a closed channel', async () => {
    deepStrictEqual(
      (
        await afterKill(143, '', {
          kind: 'ran',
          status: 1,
          stdout: '',
          stderr: 'Error response from daemon: No such container: c1',
        })
      ).outcome,
      {
        kind: 'failed',
        failure: {
          kind: 'channelClosed',
          detail: 'the container stopped during the operation (exit 143)',
        },
      },
    );
  });

  it('contracts §1: a kill status and a container still running is the script’s own result', async () => {
    deepStrictEqual(
      await afterKill(137, '', {
        kind: 'ran',
        status: 0,
        stdout: 'true\n',
        stderr: '',
      }),
      {outcome: {kind: 'exited', status: 137}, inspected: [INSPECT]},
    );
  });

  it('contracts §1: a kill status when the inspect cannot run is the script’s own result', async () => {
    deepStrictEqual(
      (await afterKill(137, '', {kind: 'failed', detail: 'no docker'})).outcome,
      {kind: 'exited', status: 137},
    );
  });

  it('contracts §1: no other status and no kill status with something on stderr runs the inspect', async () => {
    const results = await Promise.all([
      afterKill(1, '', undefined),
      afterKill(0, '', undefined),
      afterKill(137, 'Killed\n', undefined),
    ]);
    deepStrictEqual(
      results.map(result => result.inspected),
      [[], [], []],
    );
  });

  it('contracts §1: a copy that ends with a kill status in a container that stopped is a closed channel', async () => {
    const file = path.join(folder, 'stopped.bin');
    writeFileSync(file, 'a');
    const engine = fakeEngine(endsWith(137));
    engine.answer = {kind: 'ran', status: 0, stdout: 'false', stderr: ''};
    const outcome = await execChannelOf(engine, 'c1', 'node').copyToHost({
      localFile: file,
      remotePath: '/d/a',
      cancellation: NEVER,
    });
    deepStrictEqual(
      outcome.kind === 'failed' && outcome.failure.kind,
      'channelClosed',
    );
  });

  it('contracts §1: a copy cancelled while it runs ends as cancelled and the process is killed', async () => {
    const file = path.join(folder, 'cancelled.bin');
    writeFileSync(file, 'abc');
    const engine = fakeEngine(() => undefined);
    const controller = new AbortController();
    const copying = execChannelOf(engine, 'c1', 'node').copyToHost({
      localFile: file,
      remotePath: '/d/a',
      cancellation: controller.signal,
    });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    const outcome = await copying;
    deepStrictEqual(
      [
        outcome.kind === 'failed' && outcome.failure.kind,
        engine.processes[0]?.killed,
      ],
      ['cancelled', true],
    );
  });
});
