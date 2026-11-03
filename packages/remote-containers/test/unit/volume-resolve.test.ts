import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {ContainerOutcome} from '../../src/lifecycle/container-lifecycle.ts';
import {
  resolveVolume,
  type VolumeContainerRequest,
  type VolumeResolution,
} from '../../src/volumes/volume-resolve.ts';
import type {DevContainerVolume} from '../../src/volumes/volume-payload.ts';
import {
  type EngineScript,
  exited,
  scriptedEngine,
} from './engine-script.fixture.ts';

const READY: ContainerOutcome = {
  kind: 'ready',
  containerId: 'dev1',
  remoteUser: 'node',
  remoteWorkspaceFolder: '/workspaces/r',
  volumeMounted: true,
  created: true,
};

const TARGET: DevContainerVolume = {
  kind: 'volume',
  repositoryPath: 'https://github.com/o/r',
  volumeName: '__UNIQUE__',
  folder: 'r',
  cloneInfo: {urlToClone: 'https://github.com/o/r'},
  inspectVolume: false,
};

/** The short form of a call: git by its step and whether its protocols were pinned, the other checks by what they do. */
function shortOf(argv: readonly string[]): string {
  if (argv[0] !== 'exec') {
    return argv.slice(0, 2).join(' ');
  }
  const script = argv.at(-2) ?? '';
  const steps: Array<[boolean, string]> = [
    [script.includes('command -v'), `tool ${String(argv.at(-1))}`],
    [script.includes('ls -A'), 'holds'],
    [argv.includes('--tags'), 'deepen'],
    [
      argv.includes('clone'),
      argv.includes('protocol.allow=never') ? 'clone pinned' : 'clone',
    ],
    [argv.includes('mkdir'), 'mkdir'],
    [argv.includes('cat'), 'cat'],
    [
      argv.includes('test'),
      `test ${String(argv.at(-1)).slice('/workspaces/r/'.length)}`,
    ],
  ];
  return steps.find(([matches]) => matches)?.[1] ?? argv.join(' ');
}

/** The answers of a plain pass: a new volume, a running bootstrap, an empty folder, the folder's configuration. */
function plainPass(short: string): ReturnType<EngineScript> {
  const failing = ['volume inspect', 'holds'];
  return failing.includes(short) ? exited(1) : undefined;
}

/** What a scene did. */
interface SceneRecord {
  calls: string[];
  logLines: string[];
  record: string[];
  requests: VolumeContainerRequest[];
  resolution: VolumeResolution;
}

/** Resolves `target` with the engine answering by `script` before the plain pass, and `prepare` giving `outcome`. */
async function sceneOf(
  options: {
    script?: EngineScript;
    typed?: boolean;
    target?: DevContainerVolume;
    outcome?: ContainerOutcome;
    /** What the user does when the clone has no configuration. */
    added?: 'written' | 'left';
  } = {},
): Promise<SceneRecord> {
  const sink = new MemorySink();
  const record: string[] = [];
  const requests: VolumeContainerRequest[] = [];
  const scripted = scriptedEngine(
    shortOf,
    short => options.script?.(short) ?? plainPass(short),
    short => {
      if (short === 'run --detach') {
        return 'boot1\n';
      }
      return short === 'cat' ? '{"image": "alpine"}' : '';
    },
  );
  const resolution = await resolveVolume(
    {
      ...scripted,
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
      settings: () => ({
        image: '',
        pull: false,
        socketPath: '/var/run/docker.sock',
      }),
      buildContext: () =>
        Promise.resolve({folder: '/ctx', dispose: () => Promise.resolve()}),
      typed: payload => {
        record.push(`read ${payload}`);
        return options.typed ?? true;
      },
      clearTyped: payload => {
        record.push(`cleared ${payload}`);
        return Promise.resolve();
      },
      onCloning: () => record.push('cloning'),
      addConfiguration: (bootstrap, folder) => {
        record.push(`add in ${bootstrap} ${folder}`);
        return Promise.resolve(options.added ?? 'written');
      },
      prepare: (bootstrap, request, configText) => {
        record.push(`prepare in ${bootstrap} with ${configText}`);
        requests.push(request);
        return Promise.resolve(options.outcome ?? READY);
      },
    },
    'payload1',
    options.target ?? TARGET,
  );
  return {
    calls: scripted.calls,
    logLines: sink.lines.map(line => line.message),
    record,
    requests,
    resolution,
  };
}

/** The reason of a failed resolution, or its kind for any other. */
function reasonOf(resolution: VolumeResolution): Failed['reason'] | string {
  return resolution.kind === 'failed'
    ? resolution.failure.reason
    : resolution.kind;
}

const UNIQUE_NAME = /^r-[0-9a-f]{64}$/;

describe('the resolve of a clone in a volume (card containers-151)', () => {
  it('F-0701 5.0, F-0704: a typed source clones unpinned into a new volume, clears its record, and runs up in the bootstrap', async () => {
    const scene = await sceneOf();
    const request = scene.requests[0];
    const volumeName = request?.workspace.workspaceMount.split(/[=,]/)[3] ?? '';
    deepStrictEqual(
      {
        calls: scene.calls,
        record: scene.record,
        request: {
          ...request,
          idLabels: request?.idLabels.map(label =>
            label.replace(volumeName, 'VOLUME'),
          ),
        },
        named: UNIQUE_NAME.test(volumeName),
        resolution:
          scene.resolution.kind === 'prepared'
            ? {...scene.resolution, request: undefined}
            : scene.resolution,
      },
      {
        calls: [
          'volume inspect',
          'volume create',
          'build --tag',
          'run --detach',
          'tool docker',
          'tool git',
          'tool node',
          'tool ssh',
          'tool git-lfs',
          'holds',
          'mkdir',
          'clone',
          'test .devcontainer/devcontainer.json',
          'deepen',
          'cat',
        ],
        record: [
          'read payload1',
          'cloning',
          'cleared payload1',
          'prepare in boot1 with {"image": "alpine"}',
        ],
        request: {
          folder: '/workspaces/r',
          configFile: '/workspaces/r/.devcontainer/devcontainer.json',
          idLabels: [
            'vsch.local.repository=https://github.com/o/r',
            'vsch.local.repository.volume=VOLUME',
            'vsch.local.repository.folder=r',
            'devcontainer.config_file=/workspaces/r/.devcontainer/devcontainer.json',
          ],
          workspace: {
            workspaceMount: `type=volume,source=${volumeName},target=/workspaces`,
            workspaceFolder: '/workspaces/r',
          },
        },
        named: true,
        resolution: {
          kind: 'prepared',
          outcome: READY,
          bootstrap: 'boot1',
          volumeName,
          request: undefined,
          configText: '{"image": "alpine"}',
          shallow: false,
        },
      },
    );
  });

  it('a source with no typed record is read as one from a link: its clone is pinned, and a local path is refused before any step', async () => {
    const [linked, local] = await Promise.all([
      sceneOf({typed: false}),
      sceneOf({typed: false, target: {...TARGET, repositoryPath: '/home/u/r'}}),
    ]);
    deepStrictEqual(
      [
        linked.calls.includes('clone pinned'),
        local.calls,
        reasonOf(local.resolution),
        local.logLines,
      ],
      [
        true,
        [],
        {id: 'S034'},
        ["the window's source can't be cloned: notAllowed"],
      ],
    );
  });

  it('a folder that is no plain name is refused before any step', async () => {
    const scenes = await Promise.all(
      ['..', 'a/b', 'a\u0007'].map(folder =>
        sceneOf({target: {...TARGET, folder}}),
      ),
    );
    deepStrictEqual(
      scenes.map(scene => [scene.calls.length, reasonOf(scene.resolution)]),
      Array.from({length: 3}, () => [0, {id: 'S034'}]),
    );
  });

  it('F-0704 7.E1, 7.E2, 7.E5: a missing tool is S344 or S345, and a bootstrap that can’t start is S034', async () => {
    const scenes = await Promise.all([
      sceneOf({
        script: short => (short === 'tool git' ? exited(1) : undefined),
      }),
      sceneOf({
        script: short => (short === 'tool docker' ? exited(1) : undefined),
      }),
      sceneOf({
        script: short =>
          short === 'build --tag' ? exited(1, '', 'no space') : undefined,
      }),
    ]);
    deepStrictEqual(
      [
        ...scenes.map(scene => reasonOf(scene.resolution)),
        scenes[2].logLines.at(-1),
      ],
      [
        {id: 'S345'},
        {id: 'S344'},
        {id: 'S034'},
        'the bootstrap container could not start: no space',
      ],
    );
  });

  it('F-0701 7.E2, 7.E3: a failed clone or checkout removes the bootstrap and keeps the record for a retry', async () => {
    const commit = {
      ...TARGET,
      repositoryPath: `https://github.com/o/r/commit/${'a'.repeat(40)}`,
    };
    const [noClone, noCheckout] = await Promise.all([
      sceneOf({
        script: short =>
          short === 'clone' ? exited(128, '', 'fatal: no') : undefined,
      }),
      sceneOf({
        target: commit,
        script: short =>
          short.includes(' fetch ')
            ? exited(128, '', 'not our ref')
            : undefined,
      }),
    ]);
    deepStrictEqual(
      [
        reasonOf(noClone.resolution),
        noClone.calls.at(-1),
        noClone.record.some(entry => entry.startsWith('cleared')),
        reasonOf(noCheckout.resolution),
      ],
      [
        {id: 'S193', values: ['fatal: no']},
        'rm --force',
        false,
        {
          id: 'S193',
          values: [
            {
              id: 'errorPrefixed',
              values: [{id: 'S176', values: ['https://github.com/o/r']}],
            },
          ],
        },
      ],
    );
  });

  it('F-0701 6.1, 7.E4: a clone with no configuration asks for one; leaving ends silently, and a written one goes on to up', async () => {
    let lookups = 0;
    const [left, written, stillNone] = await Promise.all([
      sceneOf({
        added: 'left',
        script: short => (short.startsWith('test') ? exited(1) : undefined),
      }),
      sceneOf({
        script: short => {
          if (!short.startsWith('test')) {
            return undefined;
          }
          lookups += 1;
          return lookups <= 2 ? exited(1) : undefined;
        },
      }),
      sceneOf({
        script: short => (short.startsWith('test') ? exited(1) : undefined),
      }),
    ]);
    deepStrictEqual(
      [
        left.resolution.kind === 'failed' && left.resolution.failure.kind,
        left.resolution.kind === 'failed' && left.resolution.failure.silent,
        left.calls.at(-1),
        left.record.filter(entry => entry.startsWith('add')),
        written.resolution.kind,
        reasonOf(stillNone.resolution),
        stillNone.calls.at(-1),
        stillNone.logLines.includes(
          'the clone holds no dev container configuration',
        ),
      ],
      [
        'volumeLeft',
        true,
        'rm --force',
        ['add in boot1 /workspaces/r'],
        'prepared',
        {id: 'S034'},
        'rm --force',
        true,
      ],
    );
  });

  it('a container that isn’t ready removes the bootstrap and hands the outcome back; a failed removal is logged', async () => {
    const outcome: ContainerOutcome = {
      kind: 'setupFailed',
      message: 'm',
      description: 'd',
      containerId: undefined,
    };
    const scene = await sceneOf({
      outcome,
      script: short =>
        short === 'rm --force' ? exited(1, '', 'busy') : undefined,
    });
    deepStrictEqual(
      [scene.resolution, scene.logLines.at(-1)],
      [
        {kind: 'notReady', outcome},
        'the bootstrap container could not be removed: busy',
      ],
    );
  });

  it('F-0702: a named volume is used by its name and made with no labels; a history that wasn’t fetched marks the pass shallow', async () => {
    const scene = await sceneOf({
      target: {...TARGET, volumeName: 'data'},
      script: short =>
        short === 'deepen' ? exited(128, '', 'early EOF') : undefined,
    });
    deepStrictEqual(
      [
        scene.requests[0]?.workspace.workspaceMount,
        scene.resolution.kind === 'prepared' && scene.resolution.shallow,
      ],
      ['type=volume,source=data,target=/workspaces', true],
    );
  });

  it('a payload that says it explores a volume is refused before any engine call, whether its volume is missing or empty, so it never clones', async () => {
    const explored = {...TARGET, inspectVolume: true};
    const [missing, empty] = await Promise.all([
      sceneOf({target: explored}),
      sceneOf({
        target: explored,
        script: short => (short === 'volume inspect' ? exited(0) : undefined),
      }),
    ]);
    deepStrictEqual(
      [missing, empty].map(scene => [
        scene.calls,
        scene.record,
        reasonOf(scene.resolution),
      ]),
      [
        [[], [], {id: 'S034'}],
        [[], [], {id: 'S034'}],
      ],
    );
  });
});
