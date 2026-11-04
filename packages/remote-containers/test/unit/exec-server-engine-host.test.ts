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

/** A host stream the test feeds, then ends. */
function hostStream(): {
  stream: ExecReadStream;
  send(text: string): void;
  end(): void;
} {
  let listener: ((data: Uint8Array) => void) | undefined;
  let ended: (() => void) | undefined;
  const onEnd = new Promise<void>(resolve => {
    ended = resolve;
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
  };
}

/** What the fake host was asked, and how its one command answers once its input ends. */
interface Scene {
  asked: Array<{
    command: string;
    argv: string[];
    options: ExecSpawnOptions | undefined;
  }>;
  input: string[];
  inputEnded: boolean;
  server: Pick<ExecServer, 'spawn'>;
}

/** A host whose command echoes its input on stdout, writes `complaint` on stderr, and exits `status` when its input ends. */
function sceneOf(status: number, complaint = '', refuse = false): Scene {
  const scene: Scene = {
    asked: [],
    input: [],
    inputEnded: false,
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
        const spawned: ExecSpawnedCommand = {
          stdin: {
            write: data => {
              scene.input.push(new TextDecoder().decode(data));
            },
            end: () => {
              scene.inputEnded = true;
              stdout.send(scene.input.join(''));
              stderr.send(complaint);
              stdout.end();
              stderr.end();
              exited?.({status});
            },
          },
          stdout: stdout.stream,
          stderr: stderr.stream,
          onExit,
        };
        return Promise.resolve(spawned);
      },
    },
  };
  return scene;
}

const NEVER = new AbortController().signal;

describe('the Docker CLI on the exec server’s host (card containers-174)', () => {
  it('a run passes the engine’s variables in the spawn’s environment, never in the arguments, and gives back what it printed', async () => {
    const scene = sceneOf(3, 'warning');
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
            command: 'docker',
            argv: ['ps', '-q'],
            options: {env: {DOCKER_HOST: 'unix:///run/docker.sock'}},
          },
        ],
      ],
    );
  });

  it('a local file is streamed as the input, no input ends it at once, and a refused spawn fails with its reason', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'exec-engine-'));
    try {
      const file = path.join(folder, 'context.tar');
      writeFileSync(file, 'bytes of a file');
      const fromFile = await execServerEngineHost(
        sceneOf(0).server,
        'docker',
      ).run(['load'], {kind: 'file', localFile: file}, {cancellation: NEVER});
      const none = await execServerEngineHost(sceneOf(0).server, 'docker').run(
        ['version'],
        {kind: 'none'},
        {cancellation: NEVER},
      );
      const refused = await execServerEngineHost(
        sceneOf(0, '', true).server,
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
    const refused = await execServerEngineHost(
      {spawn: () => Promise.reject(new Error('unused'))},
      'docker',
    ).run(['version'], {kind: 'none'}, {cancellation: NEVER});
    const textual = await execServerEngineHost(
      {
        spawn: () =>
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the exec server may reject with a bare text
          Promise.reject('no exec server'),
      },
      'docker',
    ).run(['version'], {kind: 'none'}, {cancellation: NEVER});
    deepStrictEqual(
      [refused, textual],
      [
        {kind: 'failed', detail: 'unused'},
        {kind: 'failed', detail: 'no exec server'},
      ],
    );
  });

  it('a cancelled spawn and a kill end the process’s input, the only stop the exec server offers', async () => {
    const cancelled = sceneOf(0);
    const controller = new AbortController();
    const spawned = await execServerEngineHost(
      cancelled.server,
      'docker',
    ).spawn(['exec', '-i', 'c1', 'sh'], {cancellation: controller.signal});
    controller.abort();
    await new Promise(resolve => setImmediate(resolve));
    const killed = sceneOf(0);
    const second = await execServerEngineHost(killed.server, 'docker').spawn(
      ['logs', '-f', 'c1'],
      {cancellation: NEVER},
    );
    if (second.kind === 'spawned') {
      second.process.kill();
    }
    await new Promise(resolve => setImmediate(resolve));
    const early = sceneOf(0);
    const aborted = new AbortController();
    aborted.abort();
    await execServerEngineHost(early.server, 'docker').spawn(['version'], {
      cancellation: aborted.signal,
    });
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(
      [spawned.kind, cancelled.inputEnded, killed.inputEnded, early.inputEnded],
      ['spawned', true, true, true],
    );
  });

  it('a process whose exit never comes back, because the connection went, ends with no status', async () => {
    const stream = hostStream();
    stream.end();
    const server: Pick<ExecServer, 'spawn'> = {
      spawn: () =>
        Promise.resolve({
          stdin: {write: () => undefined, end: () => undefined},
          stdout: stream.stream,
          stderr: stream.stream,
          onExit: Promise.reject(new Error('closed')),
        }),
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
