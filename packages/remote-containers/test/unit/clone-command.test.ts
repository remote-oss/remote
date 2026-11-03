import {deepStrictEqual} from 'node:assert';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {cloneInUniqueVolume} from '../../src/volumes/clone-command.ts';
import {
  cloneCommandPortsOf,
  DEFAULT_CLONE_ANSWERS,
  type CloneAnswers,
} from './clone-ports.fixture.ts';

/** Runs the command over ports that answer as `changes` says, and gives what it did, in order. */
async function runWith(changes: Partial<CloneAnswers> = {}): Promise<string[]> {
  const calls: string[] = [];
  const ports = cloneCommandPortsOf(
    {...DEFAULT_CLONE_ANSWERS, ...changes},
    calls,
    new MemorySink(),
  );
  await cloneInUniqueVolume(ports, new AbortController().signal);
  return calls;
}

describe('Clone Repository in Container Volume, up to the reload (card containers-151)', () => {
  it('F-0701 5.0, BR-12: a reachable source is recorded as typed, then reloads the window into the unique volume’s payload, the engine pinned', async () => {
    deepStrictEqual(await runWith(), [
      'engine',
      'pick',
      'precheck https://github.com/o/r',
      `typed ${JSON.stringify({
        kind: 'volume',
        repositoryPath: 'https://github.com/o/r/tree/main',
        volumeName: '__UNIQUE__',
        folder: 'r',
        cloneInfo: {urlToClone: 'https://github.com/o/r', ref: 'main'},
        inspectVolume: false,
        context: 'ctx1',
      })}`,
      `reload r ${JSON.stringify({
        kind: 'volume',
        repositoryPath: 'https://github.com/o/r/tree/main',
        volumeName: '__UNIQUE__',
        folder: 'r',
        cloneInfo: {urlToClone: 'https://github.com/o/r', ref: 'main'},
        inspectVolume: false,
        context: 'ctx1',
      })}`,
    ]);
  });

  it('F-0701 BR-4: the confirmation is asked the first time; Got It is remembered and goes on', async () => {
    deepStrictEqual((await runWith({accepted: false})).slice(0, 3), [
      'trust',
      'remember',
      'engine',
    ]);
  });

  it('F-0106: Cancel ends the attempt, and Learn More opens our page and ends it, with nothing remembered', async () => {
    deepStrictEqual(
      [
        await runWith({accepted: false, trust: 'cancel'}),
        await runWith({accepted: false, trust: 'learnMore'}),
      ],
      [['trust'], ['trust', 'learnMore']],
    );
  });

  it('an engine that isn’t ready ends the attempt before the pick', async () => {
    deepStrictEqual(await runWith({engineReady: false}), ['engine']);
  });

  it('a dismissed pick ends the attempt', async () => {
    deepStrictEqual(await runWith({typed: undefined}), ['engine', 'pick']);
  });

  it('F-0701 7.E1: an unreachable source shows S052 with the source after shorthand expansion, and no reload', async () => {
    deepStrictEqual(await runWith({typed: ' o/r ', precheck: 'unreachable'}), [
      'engine',
      'pick',
      'precheck https://github.com/o/r',
      'cannotAccess https://github.com/o/r',
    ]);
  });

  it('a refused source shows S052 with the text as typed, and starts no git', async () => {
    deepStrictEqual(await runWith({typed: ' --upload-pack=x '}), [
      'engine',
      'pick',
      'cannotAccess --upload-pack=x',
    ]);
  });

  it('a cancelled check ends the attempt silently', async () => {
    deepStrictEqual(await runWith({precheck: 'cancelled'}), [
      'engine',
      'pick',
      'precheck https://github.com/o/r',
    ]);
  });

  it('F-0701 BR-3: the same repository from its own window does nothing', async () => {
    deepStrictEqual(
      await runWith({currentRepository: 'https://github.com/o/r/tree/main'}),
      ['engine', 'pick'],
    );
  });
});
