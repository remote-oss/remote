import {deepStrictEqual} from 'node:assert';
import type {
  EngineInput,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {
  bootstrapFilesOf,
  bootstrapOverrideStoreOf,
} from '../../src/volumes/bootstrap-files.ts';
import type {EngineStepPorts} from '../../src/volumes/engine-step.ts';
import {exited} from './engine-script.fixture.ts';

/** An engine that answers every call with `outcome`, and records each call's arguments and input. */
function recording(outcome: EngineRunOutcome): EngineStepPorts & {
  seen: Array<{argv: readonly string[]; input: EngineInput}>;
} {
  const seen: Array<{argv: readonly string[]; input: EngineInput}> = [];
  return {
    seen,
    engine: {
      // eslint-disable-next-line id-length -- the port's method is named run
      run: (argv, input) => {
        seen.push({argv, input});
        return Promise.resolve(outcome);
      },
    },
    options: {cancellation: new AbortController().signal},
  };
}

/** What a promise settled with: its value, or the message it rejected with. */
function settled<Value>(promise: Promise<Value>): Promise<Value | string> {
  return promise.catch(
    (error: unknown) => `rejected: ${(error as Error).message}`,
  );
}

describe('the bridge’s files in the bootstrap container (card containers-151)', () => {
  it('the configuration is read with cat in the container, and a read that fails rejects with the engine’s text', async () => {
    const readable = recording(exited(0, '{"name": "r"}'));
    const unreadable = recording(exited(1, '', "cat: can't open"));
    deepStrictEqual(
      [
        await bootstrapFilesOf(readable, 'c1').readText(
          '/workspaces/r/.devcontainer.json',
        ),
        readable.seen[0]?.argv,
        await settled(bootstrapFilesOf(unreadable, 'c1').readText('/x')),
      ],
      [
        '{"name": "r"}',
        ['exec', 'c1', 'cat', '/workspaces/r/.devcontainer.json'],
        "rejected: cat: can't open",
      ],
    );
  });

  it('an override is written by root alone, its text on stdin, under a random name in the container’s temporary folder', async () => {
    const engine = recording(exited(0));
    const file = await bootstrapOverrideStoreOf(engine, 'c1').write('{"a": 1}');
    deepStrictEqual(
      [/^\/tmp\/cli-overrides\/[0-9a-f]{16}\.json$/.test(file), engine.seen],
      [
        true,
        [
          {
            argv: [
              'exec',
              '--interactive',
              'c1',
              '/bin/sh',
              '-c',
              'umask 077 && mkdir -p "${0%/*}" && cat > "$0"',
              file,
            ],
            input: {kind: 'text', text: '{"a": 1}'},
          },
        ],
      ],
    );
  });

  it('a write that the container refuses or the engine can’t run rejects, and a removal is rm -f', async () => {
    const removing = recording(exited(1));
    await bootstrapOverrideStoreOf(removing, 'c1').remove(
      '/tmp/cli-overrides/a.json',
    );
    deepStrictEqual(
      [
        await settled(
          bootstrapOverrideStoreOf(recording(exited(1)), 'c1').write('x'),
        ),
        await settled(
          bootstrapOverrideStoreOf(
            recording({kind: 'failed', detail: 'ENOENT'}),
            'c1',
          ).write('x'),
        ),
        removing.seen[0]?.argv,
      ],
      [
        'rejected: the override file could not be written in c1',
        'rejected: the override file could not be written in c1',
        ['exec', 'c1', 'rm', '-f', '/tmp/cli-overrides/a.json'],
      ],
    );
  });
});
