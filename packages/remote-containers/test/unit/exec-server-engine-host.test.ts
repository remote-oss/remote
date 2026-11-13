import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {
  ExecReadStream,
  ExecServer,
  ExecSpawnedCommand,
  ExecSpawnOptions,
} from 'lib-server';
import {execServerEngineHost} from '../../src/engine/exec-server-engine-host.ts';

/** The script the host runs `docker` under, so that it reports its process id first. */
const REPORTING_SCRIPT = 'printf "%s\\n" "$$"; exec "$@"';

/** The process id the fake host's shell reports. */
const PROCESS_ID = 4242;

/** The exit status of a process the fake host kills. */
const KILLED_STATUS = 137;

/** A host stream the test feeds, then ends, or ends with a rejection. */
function hostStream(): {
  stream: ExecReadStream;
  send(text: string): void;
  end(): void;
  fail(): void;
} {
  let listener: ((data: Uint8Array) => void) | undefined;
  let ended: (() => void) | undefined;
  let failed: ((reason: Error) => void) | undefined;
  const onEnd = new Promise<void>((resolve, reject) => {
    ended = resolve;
    failed = reject;
  });
  return {
    stream: {
      onDidReceiveMessage: given => {
        listener = given;
        return {
          dispose: () => {
            listener = undefined;
          },
        };
      },
      onEnd,
    },
    send: text => listener?.(new TextEncoder().encode(text)),
    end: () => {
      ended?.();
    },
    fail: () => {
      failed?.(new Error('the stream broke'));
    },
  };
}

/** How the fake host's one command behaves. */
interface Behaviour {
  status?: number;
  complaint?: string;
  refuse?: boolean;
  firstLines?: readonly string[];
  ignoresInput?: boolean;
  killFails?: boolean;
  closesAtOnce?: boolean;
}

/** What the fake host was asked, and what reached its command. */
interface Scene {
  asked: Array<{
    command: string;
    argv: string[];
    options: ExecSpawnOptions | undefined;
  }>;
  input: string[];
  inputEnded: boolean;
  killed: number[];
  server: Pick<ExecServer, 'spawn' | 'kill'>;
}

/**
 * A host whose command first sends `firstLines` (by default its process id's line), then, when its input ends, echoes
 * it on stdout, writes `complaint` on stderr and exits `status`; one that `ignoresInput` runs until it is killed.
 */
function sceneOf(behaviour: Behaviour = {}): Scene {
  const {
    status = 0,
    complaint = '',
    refuse = false,
    firstLines = [`${String(PROCESS_ID)}\n`],
    ignoresInput = false,
    killFails = false,
    closesAtOnce = false,
  } = behaviour;
  let finish: ((exitStatus: number) => void) | undefined;
  const scene: Scene = {
    asked: [],
    input: [],
    inputEnded: false,
    killed: [],
    server: {
      spawn: (command, argv, options) => {
        if (refuse) {
          return Promise.reject(new Error('the control connection is closed'));
        }
        scene.asked.push({command, argv, options});
        const stdout = hostStream();
        const stderr = hostStream();
        let exited: ((exit: {status: number}) => void) | undefined;
        const onExit = new Promise<{status: number}>(resolve => {
          exited = resolve;
        });
        finish = exitStatus => {
          stdout.send(scene.input.join(''));
          stderr.send(complaint);
          stdout.end();
          stderr.end();
          exited?.({status: exitStatus});
        };
        const spawned: ExecSpawnedCommand = {
          stdin: {
            write: data => {
              scene.input.push(new TextDecoder().decode(data));
            },
            end: () => {
              scene.inputEnded = true;
              if (!ignoresInput) {
                finish?.(status);
              }
            },
          },
          stdout: stdout.stream,
          stderr: stderr.stream,
          onExit,
        };
        setImmediate(() => {
          for (const line of firstLines) {
            stdout.send(line);
          }
          if (closesAtOnce) {
            finish?.(status);
          }
        });
        return Promise.resolve(spawned);
      },
      kill: processId => {
        scene.killed.push(processId);
        if (killFails) {
          return Promise.reject(new Error('no such process'));
        }
        finish?.(KILLED_STATUS);
        return Promise.resolve();
      },
    },
  };
  return scene;
}

/** Lets the timers and promises that are due run. */
function settled(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

const NEVER = new AbortController().signal;

describe('the Docker CLI on the exec server’s host (card containers-174)', () => {
  it('a run starts docker under the reporting shell with the engine’s variables in the environment, never in the arguments, and gives back what it printed without the process id', async () => {
    const scene = sceneOf({status: 3, complaint: 'warning'});
    const outcome = await execServerEngineHost(scene.server, 'docker').run(
      ['ps', '-q'],
      {kind: 'text', text: 'given'},
      {
        environment: {DOCKER_HOST: 'unix:///run/docker.sock'},
        cancellation: NEVER,
      },
    );
    deepStrictEqual(
      [outcome, scene.asked],
      [
        {kind: 'ran', status: 3, stdout: 'given', stderr: 'warning'},
        [
          {
            command: 'sh',
            argv: ['-c', REPORTING_SCRIPT, 'sh', 'docker', 'ps', '-q'],
            options: {env: {DOCKER_HOST: 'unix:///run/docker.sock'}},
          },
        ],
      ],
    );
  });

  it('a process id split across messages is read whole, and what follows it on the same message is output', async () => {
    const scene = sceneOf({firstLines: ['42', '42\nfirst ']});
    const outcome = await execServerEngineHost(scene.server, 'docker').run(
      ['version'],
      {kind: 'text', text: 'second'},
      {cancellation: NEVER},
    );
    deepStrictEqual(outcome, {
      kind: 'ran',
      status: 0,
      stdout: 'first second',
      stderr: '',
    });
  });

  it('a local file is streamed as the input, no input ends it at once, and a refused spawn fails with its reason', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'exec-engine-'));
    try {
      const file = path.join(folder, 'context.tar');
      writeFileSync(file, 'bytes of a file');
      const fromFile = await execServerEngineHost(
        sceneOf().server,
        'docker',
      ).run(['load'], {kind: 'file', localFile: file}, {cancellation: NEVER});
      const none = await execServerEngineHost(sceneOf().server, 'docker').run(
        ['version'],
        {kind: 'none'},
        {cancellation: NEVER},
      );
      const refused = await execServerEngineHost(
        sceneOf({refuse: true}).server,
        'docker',
      ).run(['version'], {kind: 'none'}, {cancellation: NEVER});
      deepStrictEqual(
        [fromFile, none, refused],
        [
          {kind: 'ran', status: 0, stdout: 'bytes of a file', stderr: ''},
          {kind: 'ran', status: 0, stdout: '', stderr: ''},
          {kind: 'failed', detail: 'the control connection is closed'},
        ],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('a spawn refused with something that is no error fails with its text', async () => {
    const textual = await execServerEngineHost(
      {
        spawn: () =>
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the exec server may reject with a bare text
          Promise.reject('no exec server'),
        kill: () => Promise.resolve(),
      },
      'docker',
    ).run(['version'], {kind: 'none'}, {cancellation: NEVER});
    deepStrictEqual(textual, {kind: 'failed', detail: 'no exec server'});
  });

  it('a first line that is no process id, one too long to be one, and output that ends before one fail the spawn, end its input and kill nothing', async () => {
    const scenes = [
      sceneOf({firstLines: ['not a pid\n']}),
      sceneOf({firstLines: ['9'.repeat(40)]}),
      sceneOf({firstLines: [], closesAtOnce: true, status: 127}),
    ];
    const outcomes = await Promise.all(
      scenes.map(scene =>
        execServerEngineHost(scene.server, 'docker').run(
          ['version'],
          {kind: 'none'},
          {cancellation: NEVER},
        ),
      ),
    );
    deepStrictEqual(
      {
        outcomes,
        inputEnded: scenes.map(scene => scene.inputEnded),
        killed: scenes.map(scene => scene.killed),
      },
      {
        outcomes: [
          {
            kind: 'failed',
            detail: 'the command on the host did not report its process id',
          },
          {
            kind: 'failed',
            detail: 'the command on the host did not report its process id',
          },
          {
            kind: 'failed',
            detail: 'the command on the host did not report its process id',
          },
        ],
        inputEnded: [true, true, true],
        killed: [[], [], []],
      },
    );
  });

  it('a long-running command that ignores the end of its input, such as docker events, stops when its run is cancelled, killed by its process id', async () => {
    const scene = sceneOf({ignoresInput: true});
    const controller = new AbortController();
    const running = execServerEngineHost(scene.server, 'docker').run(
      ['events'],
      {kind: 'none'},
      {cancellation: controller.signal},
    );
    await settled();
    await settled();
    controller.abort();
    const outcome = await running;
    deepStrictEqual(
      {outcome, killed: scene.killed, inputEnded: scene.inputEnded},
      {
        outcome: {kind: 'ran', status: KILLED_STATUS, stdout: '', stderr: ''},
        killed: [PROCESS_ID],
        inputEnded: true,
      },
    );
  });

  it('a kill and a spawn cancelled before it starts end the input and kill the process by its id, and a kill the host refuses is let go', async () => {
    const killed = sceneOf({ignoresInput: true});
    const spawned = await execServerEngineHost(killed.server, 'docker').spawn(
      ['logs', '-f', 'c1'],
      {cancellation: NEVER},
    );
    if (spawned.kind === 'spawned') {
      spawned.process.kill();
    }
    const early = sceneOf({ignoresInput: true});
    const aborted = new AbortController();
    aborted.abort();
    await execServerEngineHost(early.server, 'docker').spawn(['version'], {
      cancellation: aborted.signal,
    });
    const refusing = sceneOf({ignoresInput: true, killFails: true});
    const refused = await execServerEngineHost(refusing.server, 'docker').spawn(
      ['attach', 'c1'],
      {cancellation: NEVER},
    );
    if (refused.kind === 'spawned') {
      refused.process.kill();
    }
    await settled();
    deepStrictEqual(
      [killed, early, refusing].map(scene => [scene.inputEnded, scene.killed]),
      [
        [true, [PROCESS_ID]],
        [true, [PROCESS_ID]],
        [true, [PROCESS_ID]],
      ],
    );
  });

  it('a process whose exit never comes back, because the connection went, ends with no status, and a stream whose end rejects still ends', async () => {
    const stdout = hostStream();
    const stderr = hostStream();
    const server: Pick<ExecServer, 'spawn' | 'kill'> = {
      spawn: () => {
        setImmediate(() => {
          stdout.send(`${String(PROCESS_ID)}\n`);
          stdout.end();
          stderr.fail();
        });
        return Promise.resolve({
          stdin: {write: () => undefined, end: () => undefined},
          stdout: stdout.stream,
          stderr: stderr.stream,
          onExit: Promise.reject(new Error('closed')),
        });
      },
      kill: () => Promise.resolve(),
    };
    deepStrictEqual(
      await execServerEngineHost(server, 'docker').run(
        ['version'],
        {kind: 'none'},
        {cancellation: NEVER},
      ),
      {kind: 'ran', status: undefined, stdout: '', stderr: ''},
    );
  });
});
