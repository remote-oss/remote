import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {ContainerOutcome} from '../../src/lifecycle/container-lifecycle.ts';
import {resolveRecovery} from '../../src/volumes/recovery-resolve.ts';
import type {DevContainerVolume} from '../../src/volumes/volume-payload.ts';
import type {VolumeContainerRequest} from '../../src/volumes/volume-resolve.ts';
import {
  type EngineScript,
  exited,
  scriptedEngine,
} from './engine-script.fixture.ts';

const READY: ContainerOutcome = {
  kind: 'ready',
  containerId: 'rec1',
  remoteUser: 'root',
  remoteWorkspaceFolder: '/workspaces/r',
  volumeMounted: true,
  created: true,
};

const TARGET: DevContainerVolume = {
  kind: 'volume',
  repositoryPath: 'https://github.com/o/r',
  volumeName: 'r-volume',
  folder: 'r',
  inspectVolume: true,
  recovery: true,
};

interface SceneRecord {
  calls: string[];
  files: string[];
  logLines: string[];
  requests: VolumeContainerRequest[];
  resolution: Awaited<ReturnType<typeof resolveRecovery>>;
}

/** Resolves `target` with the engine answering by `script`; `prepare` gives `outcome`. */
async function sceneOf(
  options: {
    script?: EngineScript;
    target?: DevContainerVolume;
    outcome?: ContainerOutcome;
    image?: string;
    pull?: boolean;
    picked?: boolean;
  } = {},
): Promise<SceneRecord> {
  const sink = new MemorySink();
  const files: string[] = [];
  const requests: VolumeContainerRequest[] = [];
  const scripted = scriptedEngine(
    argv => argv.slice(0, 2).join(' '),
    short => options.script?.(short),
  );
  const resolution = await resolveRecovery(
    {
      ...scripted,
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
      settings: () => ({
        image: options.image ?? '',
        pull: options.pull ?? false,
        socketPath: '/var/run/docker.sock',
      }),
      buildContext: () =>
        Promise.resolve({folder: '/ctx', dispose: () => Promise.resolve()}),
      picked: () => options.picked ?? true,
      configFileOf: volumeName =>
        `/tmp/recovery/${volumeName}/.devcontainer.json`,
      standInFolder: '/tmp/stand-in',
      writeFile: (file, text) => {
        files.push(`${file}\n${text}`);
        return Promise.resolve();
      },
      prepare: request => {
        requests.push(request);
        return Promise.resolve(options.outcome ?? READY);
      },
    },
    options.target ?? TARGET,
  );
  return {
    calls: scripted.calls,
    files,
    logLines: sink.lines.map(line => line.message),
    requests,
    resolution,
  };
}

describe('the resolve of a recovery container (card containers-160, #2017)', () => {
  it('F-0303 AC-14: the volume is checked, the image built, the file written and up asked for the recovery labels', async () => {
    const scene = await sceneOf();
    const file = '/tmp/recovery/r-volume/.devcontainer.json';
    deepStrictEqual(
      {
        calls: scene.calls,
        written: scene.files.map(text => text.split('\n')[0]),
        request: scene.requests[0],
        kind: scene.resolution.kind,
        bootstrap:
          scene.resolution.kind === 'prepared'
            ? scene.resolution.bootstrap
            : 'none',
      },
      {
        calls: ['volume inspect', 'build --tag'],
        written: [file],
        request: {
          folder: '/tmp/stand-in',
          configFile: file,
          idLabels: [
            'vsch.local.volume=r-volume',
            `devcontainer.config_file=${file}`,
          ],
          workspace: {
            workspaceMount: 'type=volume,source=r-volume,target=/workspaces',
            workspaceFolder: '/workspaces/r',
          },
        },
        kind: 'prepared',
        bootstrap: undefined,
      },
    );
  });

  it('F-0303 AC-14: a custom image is used as it is, and pulled only when the setting asks', async () => {
    const plain = await sceneOf({image: 'mine:1'});
    const pulled = await sceneOf({image: 'mine:1', pull: true});
    deepStrictEqual(
      [
        plain.calls,
        pulled.calls,
        plain.files[0]?.includes('"image": "mine:1"'),
      ],
      [['volume inspect'], ['volume inspect', 'pull --'], true],
    );
  });

  it('F-0303 AC-14: a volume that is not there, a name that is not a volume (a path or a mount field) and an image that fails are failures with nothing written', async () => {
    const absent = await sceneOf({
      script: short => (short === 'volume inspect' ? exited(1) : undefined),
    });
    const unique = await sceneOf({
      target: {...TARGET, volumeName: '__UNIQUE__'},
    });
    const folder = await sceneOf({target: {...TARGET, folder: '../x'}});
    const traversal = await sceneOf({
      target: {...TARGET, volumeName: '../../etc'},
    });
    const comma = await sceneOf({
      target: {...TARGET, volumeName: 'a,source=/'},
    });
    const image = await sceneOf({
      script: short =>
        short === 'build --tag' ? exited(1, '', 'no') : undefined,
    });
    deepStrictEqual(
      [absent, unique, folder, traversal, comma, image].map(scene => [
        scene.resolution.kind,
        scene.files.length,
        scene.requests.length,
      ]),
      [
        ['failed', 0, 0],
        ['failed', 0, 0],
        ['failed', 0, 0],
        ['failed', 0, 0],
        ['failed', 0, 0],
        ['failed', 0, 0],
      ],
    );
  });

  it('F-0410 AC-14 (ruling-2162-recovery-gate): a volume whose recovery was not asked for is refused before any engine call, file or up', async () => {
    const scene = await sceneOf({picked: false});
    deepStrictEqual(
      [
        scene.resolution.kind,
        scene.calls,
        scene.files,
        scene.requests,
        scene.logLines.some(line => line.includes('was never asked for')),
      ],
      ['failed', [], [], [], true],
    );
  });

  it('F-0303 AC-14: a container that is not ready is the outcome, as it is', async () => {
    const outcome: ContainerOutcome = {
      kind: 'unusable',
      containerId: 'rec1',
      status: 'dead',
    };
    const scene = await sceneOf({outcome});
    deepStrictEqual(scene.resolution, {kind: 'notReady', outcome});
  });
});
