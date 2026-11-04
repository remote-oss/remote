import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type CloneCommandPorts,
  type CloneTrustAnswer,
  cloneFromLink,
  cloneInUniqueVolume,
} from '../../src/volumes/clone-command.ts';
import type {PrecheckOutcome} from '../../src/volumes/precheck.ts';
import type {PickedRepository} from '../../src/volumes/source-pick.ts';
import {volumeTargetOf} from '../../src/volumes/volume-payload.ts';

/** How a scene's ports answer. */
interface Answers {
  accepted: boolean;
  trust: CloneTrustAnswer;
  engineReady: boolean;
  /** The text typed, the GitHub row with what its picker gives, or a dismissed pick. */
  typed: string | {github: PickedRepository | undefined} | undefined;
  precheck: PrecheckOutcome;
  currentRepository: string | undefined;
}

/** Runs the command over ports that answer as `changes` says, and gives what it did, in order. */
async function runWith(
  changes: Partial<Answers> = {},
  link?: string,
  entry: 'command' | 'linkHandler' = 'command',
): Promise<string[]> {
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
      const {typed} = answers;
      return Promise.resolve(
        typeof typed === 'object'
          ? {kind: 'github' as const}
          : typed === undefined
            ? undefined
            : {kind: 'typed' as const, text: typed},
      );
    },
    pickGithub: () => {
      calls.push('github');
      const {typed} = answers;
      return Promise.resolve(
        typeof typed === 'object' ? typed.github : undefined,
      );
    },
    precheck: (source, origin) => {
      calls.push(`precheck ${source.urlToClone} ${origin}`);
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
  const cancellation = new AbortController().signal;
  if (entry === 'linkHandler') {
    await cloneFromLink(ports, String(link), cancellation);
  } else {
    await cloneInUniqueVolume(ports, cancellation, link);
  }
  return calls;
}

describe('Clone Repository in Container Volume, up to the reload (card containers-151)', () => {
  it('F-0701 5.0, BR-12: a reachable source is recorded as typed, then reloads the window into the unique volume’s payload, the engine pinned', async () => {
    deepStrictEqual(await runWith(), [
      'engine',
      'pick',
      'precheck https://github.com/o/r typed',
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

  it('F-0205 AC-2a: the first confirmation comes first, then the engine check, and a check that stops shows no source pick', async () => {
    deepStrictEqual(await runWith({accepted: false, engineReady: false}), [
      'trust',
      'remember',
      'engine',
    ]);
  });

  it('a dismissed pick ends the attempt', async () => {
    deepStrictEqual(await runWith({typed: undefined}), ['engine', 'pick']);
  });

  it('F-0701 7.E1: an unreachable source shows S052 with the source after shorthand expansion, and no reload', async () => {
    deepStrictEqual(await runWith({typed: ' o/r ', precheck: 'unreachable'}), [
      'engine',
      'pick',
      'precheck https://github.com/o/r typed',
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
      'precheck https://github.com/o/r typed',
    ]);
  });

  it('F-0701 BR-3: the same repository from its own window does nothing', async () => {
    deepStrictEqual(
      await runWith({currentRepository: 'https://github.com/o/r/tree/main'}),
      ['engine', 'pick'],
    );
  });

  it('F-0708 6.4: a link skips the pick and the record of a typed source, is checked as a link, and reloads into the same kind of payload', async () => {
    const calls = await runWith({}, 'https://github.com/o/r.git');
    deepStrictEqual(
      [
        calls.slice(0, 2),
        calls.some(call => call.startsWith('typed ')),
        calls.some(call => call === 'pick'),
        calls.at(-1)?.startsWith('reload r '),
      ],
      [
        ['engine', 'precheck https://github.com/o/r.git link'],
        false,
        false,
        true,
      ],
    );
  });

  it('F-0708 6.4: a link that the clone refuses ends with the repository named and nothing checked', async () => {
    deepStrictEqual(await runWith({}, '/home/u/repo'), [
      'engine',
      'cannotAccess /home/u/repo',
    ]);
  });

  it('F-0701 6.3: the GitHub row picks a repository and a branch, which clones as their branch URL; a GitHub pick left ends the attempt', async () => {
    const [picked, bare, left] = await Promise.all([
      runWith({
        typed: {github: {url: 'https://github.com/o/r.git', branch: 'dev'}},
      }),
      runWith({typed: {github: {url: 'https://github.com/o/r.git'}}}),
      runWith({typed: {github: undefined}}),
    ]);
    deepStrictEqual(
      [picked.slice(0, 4), bare.slice(0, 4), left],
      [
        ['engine', 'pick', 'github', 'precheck https://github.com/o/r typed'],
        [
          'engine',
          'pick',
          'github',
          'precheck https://github.com/o/r.git typed',
        ],
        ['engine', 'pick', 'github'],
      ],
    );
  });
});

describe('an "Open in Dev Containers" link, up to the reload (card containers-154)', () => {
  /** The link handler over a profile that never gave the warning, with `changes`. */
  function linked(
    link: string,
    changes: Partial<Answers> = {},
  ): Promise<string[]> {
    return runWith({accepted: false, ...changes}, link, 'linkHandler');
  }

  it('F-0706 AC-5, BR-10: a reachable link is checked before the warning, then reloads with no pick and no typed record', async () => {
    const calls = await linked('https://github.com/o/r.git');
    deepStrictEqual(
      [calls.slice(0, 4), calls.at(-1)?.startsWith('reload r '), calls.length],
      [
        [
          'engine',
          'precheck https://github.com/o/r.git link',
          'trust',
          'remember',
        ],
        true,
        5,
      ],
    );
  });

  it('F-0706 AC-17: an unreachable link shows S052 with no warning', async () => {
    deepStrictEqual(
      await linked('https://github.com/o/r.git', {precheck: 'unreachable'}),
      [
        'engine',
        'precheck https://github.com/o/r.git link',
        'cannotAccess https://github.com/o/r.git',
      ],
    );
  });

  it('F-0706 AC-4, AC-10: a link the clone refuses shows S052 with the value as given, no check and no warning', async () => {
    deepStrictEqual(await linked(' ftp://h/r '), [
      'engine',
      'cannotAccess ftp://h/r',
    ]);
  });

  it('F-0706 AC-21: an owner/repo link is expanded before the check', async () => {
    deepStrictEqual((await linked('o/r', {accepted: true})).slice(0, 2), [
      'engine',
      'precheck https://github.com/o/r link',
    ]);
  });

  it('F-0706 AC-20: the link of the window’s own repository does nothing', async () => {
    deepStrictEqual(
      await linked('https://github.com/o/r', {
        currentRepository: 'https://github.com/o/r',
      }),
      ['engine'],
    );
  });

  it('an engine that isn’t ready, a cancelled check and a refused warning each end the attempt before the reload', async () => {
    deepStrictEqual(
      [
        await linked('o/r', {engineReady: false}),
        await linked('o/r', {precheck: 'cancelled'}),
        await linked('o/r', {trust: 'cancel'}),
      ],
      [
        ['engine'],
        ['engine', 'precheck https://github.com/o/r link'],
        ['engine', 'precheck https://github.com/o/r link', 'trust'],
      ],
    );
  });
});
