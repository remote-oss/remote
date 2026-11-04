import {deepStrictEqual} from 'node:assert';
import type {CliTarget} from '../../src/cli/cli-arguments.ts';
import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';
import {volumePayloadOf} from '../../src/volumes/volume-payload.ts';
import {
  inputOf,
  leaveRebuildIntent,
  type Scene,
  sceneOf,
} from './connector.fixture.ts';

const EXPLORED_PAYLOAD = volumePayloadOf({
  kind: 'volume',
  repositoryPath: '',
  volumeName: 'data',
  folder: 'volume',
  inspectVolume: true,
});

const VOLUME_PAYLOAD = volumePayloadOf({
  kind: 'volume',
  repositoryPath: 'https://github.com/o/r',
  volumeName: '__UNIQUE__',
  folder: 'r',
  cloneInfo: {urlToClone: 'https://github.com/o/r'},
  inspectVolume: false,
});

/** An engine answer that exited with `status`. */
function exited(status: number, stdout = ''): EngineRunOutcome {
  return {kind: 'ran', status, stdout, stderr: ''};
}

/** The bootstrap's answers of a plain pass, with `changes` first: a new volume, the container boot1, an empty folder. */
function plainPass(
  changes: (argv: readonly string[]) => EngineRunOutcome | undefined = () =>
    undefined,
): (argv: readonly string[]) => EngineRunOutcome | undefined {
  return argv => {
    const changed = changes(argv);
    if (changed !== undefined) {
      return changed;
    }
    const line = argv.join(' ');
    if (line.startsWith('volume inspect') || line.includes('ls -A')) {
      return exited(1);
    }
    if (argv[0] === 'run') {
      return exited(0, 'boot1\n');
    }
    return argv.includes('cat') ? exited(0, '{"image": "alpine"}') : undefined;
  };
}

/** A scene with the volume dependencies, its bootstrap answering by `answer`. */
function volumeScene(
  answer = plainPass(),
  overrides: Partial<Pick<Scene, 'dockerPath'>> = {},
): Scene {
  const scene = sceneOf(overrides, {volumes: true});
  scene.bootstrapAnswer = answer;
  return scene;
}

/** The engine calls of a scene, as command lines. */
function linesOf(scene: Scene): string[] {
  return scene.engineCalls.map(call => call.argv.join(' '));
}

describe('the connector of a clone in a volume (card containers-151)', () => {
  it('F-0701 5.0, ADR-0009: a typed source clones in the bootstrap, reads on the host CLI, connects trusted, registers its volume with the shutdown helper, and removes the bootstrap', async () => {
    const scene = volumeScene();
    const connected = await scene.connector.connect(inputOf(VOLUME_PAYLOAD));
    await new Promise(setImmediate);
    const stage = scene.backgroundStages[0];
    const upTarget: CliTarget = {
      workspaceFolder: '/workspaces/r',
      configFile: '/workspaces/r/.devcontainer/devcontainer.json',
      dockerPath: 'docker',
      idLabels: [],
      mountWorkspaceGitRoot: true,
      mountGitWorktreeCommonDir: false,
      features: {defaultFeatures: {}, lockfile: true},
      mounts: [],
      logLevel: 'info',
    };
    stage?.ended();
    deepStrictEqual(
      {
        trusted: 'trusted' in connected && connected.trusted,
        calls: scene.volumeCalls.map(call =>
          call.replace(/source=r-[0-9a-f]+/, 'source=VOLUME'),
        ),
        prepared: scene.prepared.map(request => [
          request.folder,
          request.configFile,
          request.dockerPath,
          request.idLabels?.length,
        ]),
        read: scene.configurationReads.map(read => [
          read.target.workspaceFolder,
          read.target.configFile,
          read.target.dockerPath,
        ]),
        background: stage?.targetOf(upTarget).workspaceFolder,
        removed: linesOf(scene).includes('rm --force -- boot1'),
        shutdown: JSON.stringify(scene.shutdownSent).replace(
          /r-[0-9a-f]{64}/g,
          'VOLUME',
        ),
      },
      {
        trusted: true,
        calls: [
          'consent',
          'standIn',
          'typed 7b227265',
          'buildContext',
          'clearTyped',
          'hostBridge {"image": "alpine"} type=volume,source=VOLUME,target=/workspaces',
          'bootstrapBridge boot1 /workspaces/r docker',
          'hostBridge {"image": "alpine"} type=volume,source=VOLUME,target=/workspaces',
          'standIn disposed',
        ],
        prepared: [
          [
            '/workspaces/r',
            '/workspaces/r/.devcontainer/devcontainer.json',
            'docker',
            4,
          ],
        ],
        read: [
          [
            '/tmp/stand-in',
            '/tmp/stand-in/.devcontainer/devcontainer.json',
            'docker',
          ],
        ],
        background: '/tmp/stand-in',
        removed: true,
        shutdown: JSON.stringify([
          {
            type: 'register',
            connectionId: 'connection-1',
            identity: {volumeName: 'VOLUME', folder: 'r'},
            engine: {dockerPath: 'docker', environment: {}},
          },
          {
            type: 'container',
            connectionId: 'connection-1',
            containerId: 'c1c1c1c1c1c1c1c1',
            action: 'stop',
          },
        ]),
      },
    );
  });

  it('F-0106 BR-13: a clone opens trusted, and a payload that explores a volume isn’t connected by a clone’s resolve at all', async () => {
    const inspected = volumePayloadOf({
      kind: 'volume',
      repositoryPath: 'https://github.com/o/r',
      volumeName: '__UNIQUE__',
      folder: 'r',
      cloneInfo: {urlToClone: 'https://github.com/o/r'},
      inspectVolume: true,
    });
    const results = [
      await volumeScene().connector.connect(inputOf(VOLUME_PAYLOAD)),
      await volumeScene().connector.connect(inputOf(inspected)),
    ];
    deepStrictEqual(
      results.map(result =>
        'connectionToken' in result ? result.trusted : result.kind,
      ),
      [true, 'containerSetupFailed'],
    );
  });

  it('F-0705 5.0, BR-5, BR-7 (card containers-155): an explored volume runs the host CLI over the shared definition with the volume in the variable of the run, asks no consent and makes no bootstrap or stand-in, connects untrusted, and registers its volume and the definition with the shutdown helper', async () => {
    const scene = volumeScene();
    const connected = await scene.connector.connect(
      inputOf(
        volumePayloadOf({
          kind: 'volume',
          repositoryPath: '',
          volumeName: 'data',
          folder: 'volume',
          inspectVolume: true,
        }),
      ),
    );
    const definition = '/t/inspect-volume/1/.devcontainer/devcontainer.json';
    deepStrictEqual(
      {
        trusted: 'trusted' in connected && connected.trusted,
        calls: scene.volumeCalls,
        prepared: scene.prepared.map(request => [
          request.folder,
          request.configFile,
          request.idLabels,
          request.workspaceMount,
        ]),
        variable: scene.cliEnvironments.at(-1)?.REMOTE_OSS_INSPECT_VOLUME,
        shutdown: scene.shutdownSent.map(each =>
          'identity' in each ? each.identity : each.type,
        ),
        label: scene.connector.heldIdentity()?.explored,
        asked: linesOf(scene).filter(line => line.startsWith('volume inspect')),
      },
      {
        trusted: false,
        calls: ['exploreDefinition'],
        prepared: [
          [
            '/t/inspect-volume/1',
            definition,
            [
              'vsch.local.volume=data',
              `devcontainer.config_file=${definition}`,
            ],
            'source=${localEnv:REMOTE_OSS_INSPECT_VOLUME},target=/volume,type=volume',
          ],
        ],
        variable: 'data',
        shutdown: [{volumeName: 'data', configFile: definition}, 'container'],
        label: true,
        asked: ['volume inspect --format {{.Name}} -- data'],
      },
    );
  });

  it('F-0705 5.0 (card containers-155): an explored volume that exists is said to exist, and one that does not is said to be created by the mount', async () => {
    const present = volumeScene(
      plainPass(argv =>
        argv.join(' ').startsWith('volume inspect') ? exited(0) : undefined,
      ),
    );
    const absent = volumeScene();
    for (const scene of [present, absent]) {
      await scene.connector.connect(inputOf(EXPLORED_PAYLOAD));
    }
    deepStrictEqual(
      [present, absent].map(scene =>
        scene.sink.lines
          .map(line => line.message)
          .filter(message => message.startsWith('the volume data')),
      ),
      [
        ['the volume data exists'],
        ['the volume data does not exist yet, so the mount creates it'],
      ],
    );
  });

  it('F-0502 (card containers-155): the rebuild an explored volume’s window asked for goes to its preparation, and the same holds for a clone’s', async () => {
    const explored = volumeScene();
    const cloned = volumeScene();
    await leaveRebuildIntent(explored, EXPLORED_PAYLOAD);
    await leaveRebuildIntent(cloned, VOLUME_PAYLOAD);
    await explored.connector.connect(inputOf(EXPLORED_PAYLOAD));
    await cloned.connector.connect(inputOf(VOLUME_PAYLOAD));
    deepStrictEqual(
      [explored, cloned].map(scene =>
        scene.prepared.map(request => request.rebuild?.buildNoCache),
      ),
      [[true], [true]],
    );
  });

  it('F-0705 5.0 (card containers-155): an explored volume whose container is not ready fails as a folder’s does', async () => {
    const scene = volumeScene();
    scene.outcome = {
      kind: 'setupFailed',
      message: 'm',
      description: 'd',
      containerId: undefined,
    };
    const failed = await scene.connector.connect(inputOf(EXPLORED_PAYLOAD));
    deepStrictEqual('reason' in failed ? failed.reason : undefined, {
      id: 'S034',
    });
  });

  it('F-0705 AC-8b (card containers-155): an explored volume asks for the vscode volume whatever dev.containers.cacheVolume says', async () => {
    const scene = volumeScene();
    scene.cacheVolumeInspect = {globalValue: false};
    await scene.connector.connect(
      inputOf(
        volumePayloadOf({
          kind: 'volume',
          repositoryPath: '',
          volumeName: 'vscode',
          folder: 'volume',
          inspectVolume: true,
        }),
      ),
    );
    deepStrictEqual(
      scene.prepared.map(request => request.cacheVolume),
      [true],
    );
  });

  it('F-0705 BR-2 (card containers-155): an explored volume with a name Docker refuses is refused before the definition is touched', async () => {
    const scene = volumeScene();
    const refused = await scene.connector.connect(
      inputOf(
        volumePayloadOf({
          kind: 'volume',
          repositoryPath: '',
          volumeName: 'a,b',
          folder: 'volume',
          inspectVolume: true,
        }),
      ),
    );
    deepStrictEqual(
      ['kind' in refused && refused.kind, scene.volumeCalls, scene.prepared],
      ['containerSetupFailed', [], []],
    );
  });

  it('F-0106 BR-13 (reading-1973-resolve-consent): a refused confirmation ends the resolve silently before any engine call; a crafted Inspect Volume payload isn’t asked, and never creates a volume, clones or starts anything', async () => {
    const refused = volumeScene();
    refused.consentGiven = false;
    const failed = await refused.connector.connect(inputOf(VOLUME_PAYLOAD));
    const inspected = volumeScene();
    inspected.consentGiven = false;
    await inspected.connector.connect(
      inputOf(
        volumePayloadOf({
          kind: 'volume',
          repositoryPath: 'https://github.com/o/r',
          volumeName: '__UNIQUE__',
          folder: 'r',
          cloneInfo: {urlToClone: 'https://github.com/o/r'},
          inspectVolume: true,
        }),
      ),
    );
    deepStrictEqual(
      [
        'kind' in failed && failed.kind,
        'silent' in failed && failed.silent,
        'userAlreadyNotified' in failed && failed.userAlreadyNotified,
        refused.engineCalls.length,
        refused.volumeCalls,
        inspected.volumeCalls.includes('consent'),
        linesOf(inspected).filter(
          line =>
            line.startsWith('volume create') ||
            line.includes(' clone ') ||
            line.startsWith('run '),
        ),
      ],
      ['cloneConsentRefused', true, true, 0, ['consent'], false, []],
    );
  });

  it('F-0701 6.1: a clone with no configuration asks for one through the bootstrap, then goes on', async () => {
    let lookups = 0;
    const scene = volumeScene(
      plainPass(argv => {
        if (!argv.includes('test')) {
          return undefined;
        }
        lookups += 1;
        return exited(lookups <= 2 ? 1 : 0);
      }),
    );
    const connected = await scene.connector.connect(inputOf(VOLUME_PAYLOAD));
    deepStrictEqual(
      [
        scene.volumeCalls.filter(call => call.startsWith('addConfiguration')),
        'connectionToken' in connected,
      ],
      [['addConfiguration boot1 /workspaces/r'], true],
    );
  });

  it('F-0704 7.E2: a resolve that fails ends with its failure and disposes of the stand-in, with no lifecycle made', async () => {
    const scene = volumeScene(
      plainPass(argv => (argv.at(-1) === 'git' ? exited(1) : undefined)),
    );
    const failed = await scene.connector.connect(inputOf(VOLUME_PAYLOAD));
    deepStrictEqual(
      [
        'reason' in failed ? failed.reason : undefined,
        scene.volumeCalls.at(-1),
        scene.backgroundStages.length,
      ],
      [{id: 'S345'}, 'standIn disposed', 0],
    );
  });

  it('a container that isn’t ready fails as a folder’s does, and the bootstrap is removed', async () => {
    const scene = volumeScene();
    scene.outcome = {
      kind: 'setupFailed',
      message: 'm',
      description: 'd',
      containerId: undefined,
    };
    const failed = await scene.connector.connect(inputOf(VOLUME_PAYLOAD));
    deepStrictEqual(
      [
        'reason' in failed ? failed.reason : undefined,
        linesOf(scene).includes('rm --force -- boot1'),
        scene.volumeCalls.at(-1),
      ],
      [{id: 'S034'}, true, 'standIn disposed'],
    );
  });

  it('a clone whose history wasn’t fetched connects, and says so once; the preparation’s steps are logged', async () => {
    const scene = volumeScene(
      plainPass(argv => (argv.includes('--tags') ? exited(128) : undefined)),
    );
    scene.steps = ['startingContainer', 'containerReady'];
    await scene.connector.connect(inputOf(VOLUME_PAYLOAD));
    const logged = scene.sink.lines.map(line => line.message);
    deepStrictEqual(
      [
        scene.volumeCalls.filter(call => call.startsWith('showShallow')),
        logged.includes('Starting container') &&
          logged.includes('containerReady'),
      ],
      [['showShallow https://github.com/o/r'], true],
    );
  });

  it('F-0201: a Docker program the setting can’t name, or a second check that fails, ends before the bootstrap', async () => {
    const unnamed = volumeScene(plainPass(), {dockerPath: './docker'});
    const unchecked = volumeScene();
    unchecked.version = {status: 1, stderr: 'permission denied'};
    const results = [
      await unnamed.connector.connect(inputOf(VOLUME_PAYLOAD)),
      await unchecked.connector.connect(inputOf(VOLUME_PAYLOAD)),
    ];
    deepStrictEqual(
      [
        results.map(result => ('kind' in result ? result.kind : 'connected')),
        unnamed.volumeCalls,
        unchecked.volumeCalls,
      ],
      [['engineCheckFailed', 'engineCheckFailed'], ['consent'], ['consent']],
    );
  });

  it('without the volume dependencies a volume payload is no authority the connector reads', async () => {
    const scene = sceneOf();
    const failed = await scene.connector.connect(inputOf(VOLUME_PAYLOAD));
    deepStrictEqual('kind' in failed && failed.kind, 'malformedAuthority');
  });
});
