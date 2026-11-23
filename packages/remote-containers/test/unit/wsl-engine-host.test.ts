import {deepStrictEqual} from 'node:assert';
import {createWslRunner} from 'lib-wsl';
import {type FakeRun, fakeWsl, utf8Output} from 'lib-wsl/testing/fake-wsl';
import {wslEngineHost} from '../../src/engine/wsl-engine-host.ts';

/** The engine host of the distro `Ubuntu` over a fake `wsl.exe` that gives every process `behaviour`. */
function hostOver(behaviour: FakeRun, session = {}) {
  const fake = fakeWsl(() => behaviour, session);
  return {fake, host: wslEngineHost(createWslRunner(fake), 'Ubuntu')};
}

const NEVER = new AbortController().signal;

describe('the engine host through WSL (card containers-203, F-0207 BR-15)', () => {
  it('F-0207 BR-15: a run starts docker in the distro’s home folder with the argument list, and collects what it printed and its status', async () => {
    const seen = hostOver({
      kind: 'exits',
      stdout: utf8Output('27.1.1\n'),
      stderr: utf8Output('warning\n'),
      status: 0,
    });
    const outcome = await seen.host.run(
      ['version', '--format', '{{.Server.Version}}'],
      {kind: 'none'},
      {cancellation: NEVER},
    );
    deepStrictEqual(
      [outcome, seen.fake.started[0]?.programArguments],
      [
        {kind: 'ran', status: 0, stdout: '27.1.1\n', stderr: 'warning\n'},
        [
          '-d',
          'Ubuntu',
          '--cd',
          '~',
          '--exec',
          'docker',
          'version',
          '--format',
          '{{.Server.Version}}',
        ],
      ],
    );
  });

  it('F-0207 BR-15: the variables of a run cross into the distro through WSLENV, never in the argument list, and a text given as input reaches docker', async () => {
    const seen = hostOver({kind: 'writesInput'});
    await seen.host.run(
      ['load', '/tmp/in'],
      {kind: 'text', text: 'secret-looking input'},
      {environment: {DOCKER_CONTEXT: 'ctx-1'}, cancellation: NEVER},
    );
    const specification = seen.fake.started[0];
    deepStrictEqual(
      [
        specification?.environment.DOCKER_CONTEXT,
        specification?.environment.WSLENV,
        specification?.programArguments.some(each => each.includes('ctx-1')),
        new TextDecoder().decode(seen.fake.written.get('/tmp/in')),
      ],
      ['ctx-1', 'DOCKER_CONTEXT', false, 'secret-looking input'],
    );
  });

  it('F-0207 BR-15: a spawn gives the live process: its output, its exit status, and an input written after the start', async () => {
    const seen = hostOver({kind: 'writesInput'});
    const spawned = await seen.host.spawn(['exec', '-i', 'c1', '/tmp/out'], {
      cancellation: NEVER,
    });
    if (spawned.kind !== 'spawned') {
      throw new Error('not spawned');
    }
    spawned.process.stdin.write(Buffer.from([0, 255, 10]));
    spawned.process.stdin.end(Buffer.from([13]));
    deepStrictEqual(
      [
        await spawned.process.exited,
        [...(seen.fake.written.get('/tmp/out') ?? [])],
      ],
      [0, [0, 255, 10, 13]],
    );
  });

  it('F-0207 BR-15: a wsl.exe that is missing or a distro that does not start is a spawn that failed, with the kind in the detail', async () => {
    const missing = hostOver(
      {kind: 'exits', status: 0},
      {systemRoot: undefined, environment: {}},
    );
    deepStrictEqual(await missing.host.spawn(['info'], {cancellation: NEVER}), {
      kind: 'failed',
      detail: 'wslMissing: wsl.exe is neither in System32 nor on the PATH',
    });
  });

  it('F-0207 BR-15: a run that wsl.exe itself ends has no status, and its stderr names the failure', async () => {
    const seen = hostOver({
      kind: 'exits',
      stdout: utf8Output('There is no distribution with the supplied name.\n'),
      status: -1,
    });
    const outcome = await seen.host.run(
      ['info'],
      {kind: 'none'},
      {
        cancellation: NEVER,
      },
    );
    deepStrictEqual(
      outcome.kind === 'ran'
        ? [outcome.status, outcome.stderr.startsWith('distroUnknown: ')]
        : outcome,
      [undefined, true],
    );
  });

  it('F-0207 BR-15: kill ends the process, and a cancelled request ends it too', async () => {
    const seen = hostOver({kind: 'printsUntilKilled', lines: ['events']});
    const spawned = await seen.host.spawn(['events'], {cancellation: NEVER});
    if (spawned.kind !== 'spawned') {
      throw new Error('not spawned');
    }
    spawned.process.kill();
    const killed = await spawned.process.exited;
    const cancel = new AbortController();
    const again = hostOver({kind: 'printsUntilKilled', lines: ['events']});
    const second = await again.host.spawn(['events'], {
      cancellation: cancel.signal,
    });
    if (second.kind !== 'spawned') {
      throw new Error('not spawned');
    }
    cancel.abort();
    deepStrictEqual(
      [killed, await second.process.exited],
      [undefined, undefined],
    );
  });

  it('F-0207 BR-15: a write to the distro that fails is the input stream’s error, whatever the reason is', async () => {
    const reasons: unknown[] = [new Error('pipe closed'), 'plain text'];
    const messages: string[] = [];
    for (const reason of reasons) {
      const host = wslEngineHost(
        {
          ...createWslRunner(fakeWsl(() => ({kind: 'exits', status: 0}))),
          start: () =>
            Promise.resolve({
              kind: 'started' as const,
              process: {
                onOutput: () => undefined,
                onError: () => undefined,
                write: () => Promise.reject(reason as Error),
                endInput: () => undefined,
                kill: () => undefined,
                exited: new Promise<never>(() => undefined),
              },
            }),
        },
        'Ubuntu',
      );
      const spawned = await host.spawn(['x'], {cancellation: NEVER});
      if (spawned.kind !== 'spawned') {
        throw new Error('not spawned');
      }
      messages.push(
        await new Promise<string>(resolve => {
          spawned.process.stdin.once('error', (error: Error) => {
            resolve(error.message);
          });
          spawned.process.stdin.write('x');
        }),
      );
    }
    deepStrictEqual(messages, ['pipe closed', 'plain text']);
  });
});
