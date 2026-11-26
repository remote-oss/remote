import {deepStrictEqual} from 'node:assert';
import {spawn} from 'node:child_process';
import type {Readable} from 'node:stream';
import type {ExecServer, ExecSpawnedCommand} from '../../src/index.ts';
import {
  GROUP_SCRIPT,
  REPORTING_SCRIPT,
  signalGroupOnHost,
  spawnOnHost,
} from '../../src/index.ts';
import {localExecServer} from '../../src/testing/local-exec-server.ts';
import {
  hostStream,
  KILLED_STATUS,
  PROCESS_ID,
  sceneOf,
  settled,
} from '../../src/testing/fake-exec-host.ts';

const NEVER = new AbortController().signal;

const NO_ID = 'the command on the host did not report its process id';

/** What `stream` carries until it ends. */
async function textOf(stream: Readable): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    text += String(chunk);
  }
  return text;
}

/** The request of a command under the reporting script, with `cancellation`. */
function requestOf(cancellation: AbortSignal = NEVER) {
  return {
    script: REPORTING_SCRIPT,
    command: ['docker', 'version'],
    environment: {DOCKER_HOST: 'tcp://host:2375', UNSET: undefined},
    cancellation,
    endById: () => Promise.resolve(),
  };
}

describe('a process on the exec server’s host', () => {
  it('starts the command under the shell with the variables that have a value in the environment, never in the arguments, and reads its output without the process id', async () => {
    const scene = sceneOf({complaint: 'warning'});
    const spawned = await spawnOnHost(scene.server, requestOf());
    if (spawned.kind !== 'spawned') {
      throw new Error('the spawn failed');
    }
    spawned.process.stdin.write('given');
    spawned.process.stdin.end();
    deepStrictEqual(
      [
        spawned.process.processId,
        await textOf(spawned.process.stdout),
        await textOf(spawned.process.stderr),
        await spawned.process.exited,
        scene.asked,
      ],
      [
        PROCESS_ID,
        'given',
        'warning',
        0,
        [
          {
            command: 'sh',
            argv: ['-c', REPORTING_SCRIPT, 'sh', 'docker', 'version'],
            options: {env: {DOCKER_HOST: 'tcp://host:2375'}},
          },
        ],
      ],
    );
  });

  it('reads a process id that arrives in pieces whole, and what follows it on the same message is output', async () => {
    const scene = sceneOf({firstLines: ['42', '42\nfirst ']});
    const spawned = await spawnOnHost(scene.server, requestOf());
    if (spawned.kind !== 'spawned') {
      throw new Error('the spawn failed');
    }
    spawned.process.stdin.end('second');
    deepStrictEqual(
      [spawned.process.processId, await textOf(spawned.process.stdout)],
      [4242, 'first second'],
    );
  });

  it('fails with the reason of a spawn the host refuses, an error or a bare text', async () => {
    const refused = await spawnOnHost(
      sceneOf({refuse: true}).server,
      requestOf(),
    );
    const textual = await spawnOnHost(
      {
        spawn: () =>
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the exec server may reject with a bare text
          Promise.reject('no exec server'),
      },
      requestOf(),
    );
    deepStrictEqual(
      [refused, textual],
      [
        {kind: 'failed', detail: 'the control connection is closed'},
        {kind: 'failed', detail: 'no exec server'},
      ],
    );
  });

  it('fails a first line that is no process id, one too long to be one, and output that ends before one, ends the input and ends nothing', async () => {
    const scenes = [
      sceneOf({firstLines: ['not a pid\n']}),
      sceneOf({firstLines: ['9'.repeat(40)]}),
      sceneOf({firstLines: [], closesAtOnce: true, status: 127}),
    ];
    const outcomes = await Promise.all(
      scenes.map(scene => spawnOnHost(scene.server, requestOf())),
    );
    deepStrictEqual(
      {
        outcomes,
        inputEnded: scenes.map(scene => scene.inputEnded),
        killed: scenes.map(scene => scene.killed),
      },
      {
        outcomes: [
          {kind: 'failed', detail: NO_ID},
          {kind: 'failed', detail: NO_ID},
          {kind: 'failed', detail: NO_ID},
        ],
        inputEnded: [true, true, true],
        killed: [[], [], []],
      },
    );
  });

  it('a kill, and a spawn aborted before its id came, end the input and end the process by its id, and an ending the host refuses is let go', async () => {
    const ended: number[] = [];
    function endById(processId: number): Promise<void> {
      ended.push(processId);
      return Promise.reject(new Error('no such process'));
    }
    const killed = sceneOf({ignoresInput: true});
    const spawned = await spawnOnHost(killed.server, {
      ...requestOf(),
      endById,
    });
    if (spawned.kind === 'spawned') {
      spawned.process.kill();
    }
    const early = sceneOf({ignoresInput: true});
    const aborted = new AbortController();
    aborted.abort();
    await spawnOnHost(early.server, {
      ...requestOf(aborted.signal),
      endById,
    });
    await settled();
    deepStrictEqual(
      [killed.inputEnded, early.inputEnded, ended],
      [true, true, [PROCESS_ID, PROCESS_ID]],
    );
  });

  it('an abort ends the process by its id through the ending it is given', async () => {
    const scene = sceneOf({ignoresInput: true});
    const controller = new AbortController();
    const spawned = await spawnOnHost(scene.server, {
      ...requestOf(controller.signal),
      endById: processId => scene.server.kill(processId),
    });
    controller.abort();
    if (spawned.kind !== 'spawned') {
      throw new Error('the spawn failed');
    }
    deepStrictEqual(
      [await spawned.process.exited, scene.killed],
      [KILLED_STATUS, [PROCESS_ID]],
    );
  });

  it('a process that has ended is not ended again by a later abort or kill, since its id may name another process by then', async () => {
    const scene = sceneOf();
    const controller = new AbortController();
    const ended: number[] = [];
    const spawned = await spawnOnHost(scene.server, {
      ...requestOf(controller.signal),
      endById: processId => {
        ended.push(processId);
        return Promise.resolve();
      },
    });
    if (spawned.kind !== 'spawned') {
      throw new Error('the spawn failed');
    }
    spawned.process.stdin.end();
    await spawned.process.exited;
    await settled();
    controller.abort();
    spawned.process.kill();
    await settled();
    deepStrictEqual(ended, []);
  });

  it('a process whose exit never comes back, because the connection went, ends with no status, and a stream whose end rejects still ends', async () => {
    const stdout = hostStream();
    const stderr = hostStream();
    const server: Pick<ExecServer, 'spawn'> = {
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
    };
    const spawned = await spawnOnHost(server, requestOf());
    if (spawned.kind !== 'spawned') {
      throw new Error('the spawn failed');
    }
    deepStrictEqual(
      [
        await spawned.process.exited,
        await textOf(spawned.process.stdout),
        await textOf(spawned.process.stderr),
      ],
      [undefined, '', ''],
    );
  });

  it('a write the connection refuses fails the input with its reason, an error or a bare text, so that the run fails with it', async () => {
    const reasons: unknown[] = [];
    for (const refusal of [new Error('connection closed'), 'closed']) {
      const stdout = hostStream();
      const stderr = hostStream();
      const spawned = await spawnOnHost(
        {
          spawn: () => {
            setImmediate(() => {
              stdout.send(`${String(PROCESS_ID)}\n`);
            });
            return Promise.resolve({
              stdin: {
                write: () => {
                  // eslint-disable-next-line @typescript-eslint/only-throw-error -- the exec server may throw a bare text
                  throw refusal;
                },
                end: () => undefined,
              },
              stdout: stdout.stream,
              stderr: stderr.stream,
              onExit: new Promise(() => undefined),
            } satisfies ExecSpawnedCommand);
          },
        },
        requestOf(),
      );
      if (spawned.kind !== 'spawned') {
        throw new Error('the spawn failed');
      }
      reasons.push(
        await new Promise<unknown>(resolve => {
          spawned.process.stdin.once('error', resolve);
          spawned.process.stdin.write('input');
        }),
      );
    }
    deepStrictEqual(
      reasons.map(reason => (reason as Error).message),
      ['connection closed', 'closed'],
    );
  });
});

describe('a process on a host with a POSIX shell, run for real', () => {
  it('each script starts the command with its input, reports an id, and passes the command’s status back, the group script as the leader of a group of its own', async () => {
    const outcomes = [];
    for (const script of [REPORTING_SCRIPT, GROUP_SCRIPT]) {
      const spawned = await spawnOnHost(localExecServer(), {
        ...requestOf(),
        script,
        command: ['sh', '-c', 'cat; exit 7'],
      });
      if (spawned.kind !== 'spawned') {
        throw new Error('the spawn failed');
      }
      spawned.process.stdin.end('hello');
      outcomes.push([
        await textOf(spawned.process.stdout),
        await spawned.process.exited,
      ]);
    }
    deepStrictEqual(outcomes, [
      ['hello', 7],
      ['hello', 7],
    ]);
  });

  it('a signal to the group ends the command and the children it started, and a group already gone is no failure', async () => {
    const server = localExecServer();
    const spawned = await spawnOnHost(server, {
      ...requestOf(),
      script: GROUP_SCRIPT,
      command: ['sh', '-c', 'sleep 61 & sleep 62 & wait'],
    });
    if (spawned.kind !== 'spawned') {
      throw new Error('the spawn failed');
    }
    const {processId} = spawned.process;
    async function membersOf(): Promise<string[]> {
      const table = await textOf(
        spawn('ps', ['-eo', 'pgid=,args='], {
          stdio: ['ignore', 'pipe', 'ignore'],
        }).stdout,
      );
      return table
        .split('\n')
        .filter(
          line =>
            line.trim().startsWith(`${String(processId)} `) &&
            !line.includes('<defunct>'),
        );
    }
    const before = (await membersOf()).length;
    await signalGroupOnHost(server, processId, 'TERM');
    const status = await spawned.process.exited;
    const after = await membersOf();
    await signalGroupOnHost(server, processId, 'KILL');
    deepStrictEqual([before, status, after], [3, 143, []]);
  });
});
