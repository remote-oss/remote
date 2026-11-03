import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type CloneOutcome,
  cloneIntoVolume,
} from '../../src/volumes/clone-steps.ts';
import {
  type CloneRequest,
  cloneArguments,
  commitCheckoutArguments,
  commitFetchArguments,
  deepenArguments,
} from '../../src/volumes/git-arguments.ts';
import {
  type EngineScript,
  exited,
  scriptedEngine,
} from './engine-script.fixture.ts';

const COMMIT_SHA = '45f5e33e47f4b113804ea808b7ce4c90a6823867';
const REPOSITORY_URL = 'https://github.com/o/r';

/** The short form of a clone step: the folder checks by what they do, git by its subcommand, a lookup by its file. */
function shortOf(argv: readonly string[]): string {
  const script = argv.at(-2) ?? '';
  if (script.includes('ls -A')) {
    return 'holds';
  }
  if (script.includes('find')) {
    return 'empty';
  }
  if (argv.includes('mkdir')) {
    return 'mkdir';
  }
  if (argv.includes('test')) {
    return `test ${String(argv.at(-1)).slice('/workspaces/r/'.length)}`;
  }
  if (argv.includes('--tags')) {
    return 'deepen';
  }
  return String(
    argv.find(word => ['clone', 'fetch', 'checkout'].includes(word)),
  );
}

/** The two words after `git` in a call: its first `-c` option. */
function pinnedOf(argv: string[]): string[] {
  return argv.slice(5, 7);
}

/** What a scene did: the steps run, the log, and the outcome. */
interface SceneRecord {
  calls: string[];
  logLines: string[];
  outcome: CloneOutcome;
}

/** An answer where the folder is empty and the root configuration is the only one, so a plain clone runs. */
function emptyFolder(short: string): ReturnType<EngineScript> {
  return short === 'holds' || short === 'test .devcontainer/devcontainer.json'
    ? exited(1)
    : undefined;
}

/** Clones `request` with the engine answering by `script`, after the empty-folder answers. */
async function sceneOf(
  script: EngineScript,
  request: CloneRequest = {urlToClone: REPOSITORY_URL},
): Promise<SceneRecord> {
  const sink = new MemorySink();
  const scripted = scriptedEngine(
    shortOf,
    short => script(short) ?? emptyFolder(short),
  );
  const outcome = await cloneIntoVolume(
    {...scripted, logger: createLogger(sink, {minimumLevel: () => 'info'})},
    'c1',
    request,
    'typed',
    'r',
  );
  return {
    calls: scripted.calls,
    logLines: sink.lines.map(line => line.message),
    outcome,
  };
}

describe('the clone in the bootstrap container (card containers-151)', () => {
  it('F-0701 5.0, BR-13: a shallow clone of every branch tip, no submodules, then the whole history and tags', () => {
    deepStrictEqual(
      [
        cloneArguments(
          'c1',
          {urlToClone: REPOSITORY_URL, ref: 'a/b'},
          'typed',
          '/w/r',
        ),
        deepenArguments('c1', 'typed', '/w/r'),
      ],
      [
        [
          'exec',
          '--env',
          'GIT_TERMINAL_PROMPT=0',
          'c1',
          'git',
          'clone',
          '--depth=1',
          '--no-single-branch',
          '--branch=a/b',
          '--',
          REPOSITORY_URL,
          '/w/r',
        ],
        [
          'exec',
          '--env',
          'GIT_TERMINAL_PROMPT=0',
          'c1',
          'git',
          '-C',
          '/w/r',
          'fetch',
          '--depth=2147483647',
          '--tags',
          'origin',
        ],
      ],
    );
  });

  it('F-0701 6.9: a commit is cloned without a branch, then fetched and checked out detached', () => {
    deepStrictEqual(
      [
        cloneArguments(
          'c1',
          {urlToClone: REPOSITORY_URL, ref: COMMIT_SHA, commit: true},
          'typed',
          '/w/r',
        ).includes(`--branch=${COMMIT_SHA}`),
        commitFetchArguments('c1', COMMIT_SHA, 'typed', '/w/r').slice(5),
        commitCheckoutArguments('c1', COMMIT_SHA, '/w/r').slice(5),
      ],
      [
        false,
        ['-C', '/w/r', 'fetch', '--depth=1', 'origin', COMMIT_SHA],
        ['-C', '/w/r', 'checkout', '--detach', COMMIT_SHA],
      ],
    );
  });

  it('a source from a link pins the protocols of every call that reaches the remote', () => {
    deepStrictEqual(
      [
        pinnedOf(
          cloneArguments('c1', {urlToClone: REPOSITORY_URL}, 'link', '/w/r'),
        ),
        pinnedOf(commitFetchArguments('c1', COMMIT_SHA, 'link', '/w/r')),
        pinnedOf(deepenArguments('c1', 'link', '/w/r')),
      ],
      Array.from({length: 3}, () => ['-c', 'protocol.allow=never']),
    );
  });

  it('F-0701 5.0, BR-17: an empty folder is made, cloned into, and its configuration looked up before the history', async () => {
    deepStrictEqual(await sceneOf(() => undefined), {
      calls: [
        'holds',
        'mkdir',
        'clone',
        'test .devcontainer/devcontainer.json',
        'test .devcontainer.json',
        'deepen',
      ],
      logLines: [],
      outcome: {
        kind: 'ready',
        cloned: true,
        configuration: '.devcontainer.json',
        deepened: true,
      },
    });
  });

  it('BR-17: .devcontainer/devcontainer.json is taken when both exist, and no configuration at all is undefined', async () => {
    const [both, neither] = await Promise.all([
      sceneOf(short => (short.startsWith('test') ? exited(0) : undefined)),
      sceneOf(short => (short.startsWith('test') ? exited(1) : undefined)),
    ]);
    deepStrictEqual(
      [
        both.outcome,
        both.calls.includes('test .devcontainer.json'),
        neither.outcome,
      ],
      [
        {
          kind: 'ready',
          cloned: true,
          configuration: '.devcontainer/devcontainer.json',
          deepened: true,
        },
        false,
        {kind: 'ready', cloned: true, configuration: undefined, deepened: true},
      ],
    );
  });

  it('F-0702 BR-9, F-0701 BR-3: a folder that holds files is opened as it is: no clone, no fetch', async () => {
    deepStrictEqual(
      await sceneOf(short => (short === 'holds' ? exited(0) : undefined)),
      {
        calls: [
          'holds',
          'test .devcontainer/devcontainer.json',
          'test .devcontainer.json',
        ],
        logLines: [
          'the folder /workspaces/r holds files already and is opened as it is',
        ],
        outcome: {
          kind: 'ready',
          cloned: false,
          configuration: '.devcontainer.json',
          deepened: false,
        },
      },
    );
  });

  it('F-0701 7.E2, AC-10: a failed clone gives git’s text, and a folder that can’t be made gives the engine’s', async () => {
    const [noBranch, noFolder] = await Promise.all([
      sceneOf(short =>
        short === 'clone'
          ? exited(
              128,
              '',
              "Cloning into '/workspaces/r'...\nfatal: Remote branch x not found in upstream origin\n",
            )
          : undefined,
      ),
      sceneOf(short =>
        short === 'mkdir' ? exited(1, '', 'read-only') : undefined,
      ),
    ]);
    deepStrictEqual(
      [
        noBranch.outcome,
        noBranch.calls.at(-1),
        noFolder.outcome,
        noFolder.calls.at(-1),
      ],
      [
        {
          kind: 'cloneFailed',
          detail:
            "Cloning into '/workspaces/r'...\nfatal: Remote branch x not found in upstream origin",
        },
        'clone',
        {kind: 'cloneFailed', detail: 'read-only'},
        'mkdir',
      ],
    );
  });

  it('F-0701 6.9 step 4: a commit is fetched and checked out after the clone, before the lookup', async () => {
    const scene = await sceneOf(() => undefined, {
      urlToClone: REPOSITORY_URL,
      ref: COMMIT_SHA,
      commit: true,
    });
    deepStrictEqual(scene.calls.slice(2, 5), ['clone', 'fetch', 'checkout']);
  });

  it('F-0701 7.E3, AC-11: a commit that can’t be fetched or checked out empties the folder, so a retry clones again', async () => {
    const commit: CloneRequest = {
      urlToClone: REPOSITORY_URL,
      ref: COMMIT_SHA,
      commit: true,
    };
    const [notFetched, notCheckedOut] = await Promise.all([
      sceneOf(
        short =>
          short === 'fetch' ? exited(128, '', 'not our ref') : undefined,
        commit,
      ),
      sceneOf(
        short =>
          short === 'checkout' ? exited(1, '', 'bad object') : undefined,
        commit,
      ),
    ]);
    deepStrictEqual(
      [notFetched, notCheckedOut.calls.slice(-2), notCheckedOut.logLines],
      [
        {
          calls: ['holds', 'mkdir', 'clone', 'fetch', 'empty'],
          logLines: ['the commit could not be checked out: not our ref'],
          outcome: {kind: 'checkoutFailed'},
        },
        ['checkout', 'empty'],
        ['the commit could not be checked out: bad object'],
      ],
    );
  });

  it('a history that can’t be fetched is logged, and the clone is still ready', async () => {
    const scene = await sceneOf(short =>
      short === 'deepen' ? exited(128, '', 'early EOF') : undefined,
    );
    deepStrictEqual(
      [scene.outcome, scene.logLines],
      [
        {
          kind: 'ready',
          cloned: true,
          configuration: '.devcontainer.json',
          deepened: false,
        },
        ['the whole history could not be fetched: early EOF'],
      ],
    );
  });
});
