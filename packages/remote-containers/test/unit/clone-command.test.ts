import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type CloneCommandPorts,
  type CloneTrustAnswer,
  cloneInUniqueVolume,
} from '../../src/volumes/clone-command.ts';
import type {PrecheckOutcome} from '../../src/volumes/precheck.ts';
import {volumeTargetOf} from '../../src/volumes/volume-payload.ts';

/** How a scene's ports answer. */
interface Answers {
  accepted: boolean;
  trust: CloneTrustAnswer;
  engineReady: boolean;
  typed: string | undefined;
  precheck: PrecheckOutcome;
  currentRepository: string | undefined;
}

/** Runs the command over ports that answer as `changes` says, and gives what it did, in order. */
async function runWith(changes: Partial<Answers> = {}): Promise<string[]> {
  const answers: Answers = {
    accepted: true,
    trust: 'gotIt',
    engineReady: true,
    typed: 'https://github.com/o/r/tree/main',
    precheck: 'reachable',
    currentRepository: undefined,
    ...changes,
  };
  const calls: string[] = [];
  const ports: CloneCommandPorts = {
    trust: {
      accepted: () => answers.accepted,
      confirm: () => {
        calls.push('trust');
        return Promise.resolve(answers.trust);
      },
      remember: () => {
        calls.push('remember');
        return Promise.resolve();
      },
      learnMore: () => {
        calls.push('learnMore');
      },
    },
    engineReady: () => {
      calls.push('engine');
      return Promise.resolve(answers.engineReady);
    },
    pickSource: () => {
      calls.push('pick');
      return Promise.resolve(answers.typed);
    },
    precheck: source => {
      calls.push(`precheck ${source.urlToClone}`);
      return Promise.resolve(answers.precheck);
    },
    cannotAccess: repository => {
      calls.push(`cannotAccess ${repository}`);
      return Promise.resolve();
    },
    currentRepository: () => answers.currentRepository,
    engine: () => ({context: 'ctx1'}),
    recordTyped: payload => {
      calls.push(`typed ${JSON.stringify(volumeTargetOf(payload))}`);
      return Promise.resolve();
    },
    reload: uri => {
      const [authority, folder] = uri
        .slice('vscode-remote://dev-container+'.length)
        .split('/workspaces/');
      calls.push(
        `reload ${String(folder)} ${JSON.stringify(volumeTargetOf(authority ?? ''))}`,
      );
      return Promise.resolve();
    },
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
  };
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
