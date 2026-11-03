import {deepStrictEqual} from 'node:assert';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  cloneInNamedVolume,
  type NamedVolumeCommandPorts,
} from '../../src/volumes/clone-named-volume.ts';
import type {NamedVolumeFact} from '../../src/volumes/clone-volume.ts';
import {
  cloneCommandPortsOf,
  DEFAULT_CLONE_ANSWERS,
  type CloneAnswers,
} from './clone-ports.fixture.ts';

/** The named command's answers, over the clone command's. */
interface NamedAnswers extends CloneAnswers {
  volumes: NamedVolumeFact[];
  picked: string | null | undefined;
  volumeName: string | undefined;
  volumeExists: boolean;
  folder: string | undefined;
  current:
    {repositoryPath: string; volumeName: string; folder: string} | undefined;
}

/** The named answers a scene holds when it changes none. */
const NAMED_ANSWERS: NamedAnswers = {
  ...DEFAULT_CLONE_ANSWERS,
  volumes: [],
  picked: null,
  volumeName: 'data',
  volumeExists: false,
  folder: 'r',
  current: undefined,
};

/** Runs the command over ports that answer as `changes` says, and gives what it did, in order. */
async function runWith(
  changes: Partial<NamedAnswers> = {},
): Promise<{calls: string[]; logLines: string[]}> {
  const answers: NamedAnswers = {...NAMED_ANSWERS, ...changes};
  const calls: string[] = [];
  const sink = new MemorySink();
  const ports: NamedVolumeCommandPorts = {
    ...cloneCommandPortsOf(answers, calls, sink),
    namedVolumes: () => {
      calls.push(
        `list ${answers.volumes.map(volume => volume.name).join(',')}`,
      );
      return Promise.resolve(answers.volumes);
    },
    pickVolume: volumes => {
      calls.push(
        `pick ${volumes.map(volume => volume.name).join(',')}:${
          answers.picked === null ? 'create' : (answers.picked ?? 'escape')
        }`,
      );
      return Promise.resolve(answers.picked);
    },
    volumeName: () => {
      calls.push(`name ${answers.volumeName ?? 'escape'}`);
      return Promise.resolve(answers.volumeName);
    },
    volumeExists: name => {
      calls.push(`exists ${name}`);
      return Promise.resolve(answers.volumeExists);
    },
    volumeAlreadyExists: () => {
      calls.push('collision');
      return Promise.resolve();
    },
    folderName: defaultFolder => {
      calls.push(
        `folder ${defaultFolder} -> ${JSON.stringify(answers.folder)}`,
      );
      return Promise.resolve(answers.folder);
    },
    currentClone: () => {
      calls.push('current');
      return answers.current;
    },
  };
  await cloneInNamedVolume(ports, new AbortController().signal);
  return {calls, logLines: sink.lines.map(line => line.message)};
}

/** The target the rows record and reload: a named volume, the engine pinned. */
const TARGET = JSON.stringify({
  kind: 'volume',
  repositoryPath: 'https://github.com/o/r/tree/main',
  volumeName: 'data',
  folder: 'r',
  cloneInfo: {urlToClone: 'https://github.com/o/r', ref: 'main'},
  inspectVolume: false,
  context: 'ctx1',
});

describe('Clone Repository in Named Container Volume, up to the reload (card containers-152)', () => {
  it('F-0702 5.0, BR-14: a new volume, named at step 6, is recorded as typed and reloads the window into its payload, the volume uncreated before the reload', async () => {
    deepStrictEqual(await runWith(), {
      calls: [
        'engine',
        'pick',
        'precheck https://github.com/o/r',
        'list ',
        'pick :create',
        'name data',
        'exists data',
        'folder r -> "r"',
        'current',
        `typed ${TARGET}`,
        `reload r ${TARGET}`,
      ],
      logLines: [],
    });
  });

  it('F-0702 AC-9, 6.1: an existing volume skips the name box and its existence check, and the folder box opens on its own', async () => {
    deepStrictEqual(
      (await runWith({picked: 'data', volumes: [{name: 'data'}]})).calls,
      [
        'engine',
        'pick',
        'precheck https://github.com/o/r',
        'list data',
        'pick data:data',
        'folder r -> "r"',
        'current',
        `typed ${TARGET}`,
        `reload r ${TARGET}`,
      ],
    );
  });

  it('F-0702 AC-8, 7.E1: a new name that already exists ends the attempt with the collision, before any folder step', async () => {
    deepStrictEqual(await runWith({volumeExists: true}), {
      calls: [
        'engine',
        'pick',
        'precheck https://github.com/o/r',
        'list ',
        'pick :create',
        'name data',
        'exists data',
        'collision',
      ],
      logLines: [],
    });
  });

  it('F-0702 AC-13, 6.3: Escape at the volume pick, the name box or the folder box aborts the attempt', async () => {
    deepStrictEqual(
      [
        (await runWith({picked: undefined})).calls,
        (await runWith({volumeName: undefined})).calls,
        (await runWith({folder: undefined})).calls,
      ],
      [
        [
          'engine',
          'pick',
          'precheck https://github.com/o/r',
          'list ',
          'pick :escape',
        ],
        [
          'engine',
          'pick',
          'precheck https://github.com/o/r',
          'list ',
          'pick :create',
          'name escape',
        ],
        [
          'engine',
          'pick',
          'precheck https://github.com/o/r',
          'list ',
          'pick :create',
          'name data',
          'exists data',
          'folder r -> undefined',
        ],
      ],
    );
  });

  it('F-0702 AC-12, 6.4: an empty folder name accepted closes the box like Escape, with no record and no reload', async () => {
    deepStrictEqual((await runWith({folder: ''})).calls, [
      'engine',
      'pick',
      'precheck https://github.com/o/r',
      'list ',
      'pick :create',
      'name data',
      'exists data',
      'folder r -> ""',
    ]);
  });

  it('F-0702 AC-37, 6.8, BR-18: the same clone from its own window does nothing after the folder name is accepted', async () => {
    deepStrictEqual(
      await runWith({
        picked: 'data',
        volumes: [{name: 'data'}],
        current: {
          repositoryPath: 'https://github.com/o/r/tree/main',
          volumeName: 'data',
          folder: 'r',
        },
      }),
      {
        calls: [
          'engine',
          'pick',
          'precheck https://github.com/o/r',
          'list data',
          'pick data:data',
          'folder r -> "r"',
          'current',
        ],
        logLines: ['the window is connected to this clone already'],
      },
    );
  });

  it('F-0702 AC-23, 7.E2: a source that fails the pre-check ends the attempt with S052, before the volume pick', async () => {
    deepStrictEqual((await runWith({precheck: 'unreachable'})).calls, [
      'engine',
      'pick',
      'precheck https://github.com/o/r',
      'cannotAccess https://github.com/o/r/tree/main',
    ]);
  });

  it('F-0702 7.E2: a refused source ends the attempt with S052 and no git, as the unique flow does, and a cancelled check ends it silently', async () => {
    deepStrictEqual(
      [
        (await runWith({typed: ' --upload-pack=x '})).calls,
        (await runWith({precheck: 'cancelled'})).calls,
      ],
      [
        ['engine', 'pick', 'cannotAccess --upload-pack=x'],
        ['engine', 'pick', 'precheck https://github.com/o/r'],
      ],
    );
  });

  it('the trust and the engine end the attempt as the unique flow’s do', async () => {
    deepStrictEqual(
      [
        (await runWith({accepted: false, trust: 'cancel'})).calls,
        (await runWith({accepted: false, trust: 'learnMore'})).calls,
        (await runWith({accepted: false, trust: 'gotIt'})).calls.slice(0, 3),
        (await runWith({engineReady: false})).calls,
        (await runWith({typed: undefined})).calls,
      ],
      [
        ['trust'],
        ['trust', 'learnMore'],
        ['trust', 'remember', 'engine'],
        ['engine'],
        ['engine', 'pick'],
      ],
    );
  });
});
