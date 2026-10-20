import {deepStrictEqual} from 'node:assert';
import {mock} from 'node:test';
import type {ConnectPhase, Connected, Failed} from 'lib-authority';
import {
  devContainerPayloadOf,
  type DevContainerFolder,
} from '../../src/authority/payload.ts';
import {
  FOLDER,
  inputOf,
  PAYLOAD,
  READY,
  sceneOf,
  SECRET_TOKEN,
  STARTED_SERVER,
  type Scene,
} from './connector.fixture.ts';
import {
  REBUILD_INTENTS_KEY,
  storeRebuildIntent,
} from '../../src/open/rebuild-intent.ts';
import type {CliEvent} from '../../src/cli/cli-lines.ts';
import {storePausedRetry} from '../../src/state/paused-retry.ts';

function tick(): Promise<unknown> {
  return new Promise(resolve => setImmediate(resolve));
}

function failedKind(result: Connected | Failed): string {
  return 'kind' in result ? result.kind : 'connected';
}

function messages(scene: Scene): string[] {
  return scene.sink.lines.map(line => line.message);
}

/** Holds the preparation of the next connect until the returned function releases it. */
function heldPreparation(scene: Scene): () => void {
  let release: (() => void) | undefined;
  scene.outcome = () =>
    new Promise(resolve => {
      release = () => {
        resolve(READY);
      };
    });
  return () => {
    release?.();
  };
}

async function connected(scene: Scene) {
  const result = await scene.connector.connect(inputOf(PAYLOAD));
  if (!('connectionToken' in result)) {
    throw new Error(`the connect failed: ${JSON.stringify(result)}`);
  }
  return result;
}

/** The CLI's answer for a configuration whose layers list these extensions. */
function withMerged(extensions: string[]): Scene['configuration'] {
  return {
    kind: 'configuration',
    configuration: {name: 'Proj'},
    workspaceFolder: '/workspaces/proj',
    workspaceMount: undefined,
    mergedConfiguration: {customizations: {vscode: [{extensions}]}},
  };
}

describe('the container connector: the connect (card containers-08)', () => {
  it('contracts §2 step 1: a malformed payload, a legacy one and an outer hop fail at once, with no engine call', async () => {
    const scene = sceneOf();
    const legacy = Buffer.from('/work/proj').toString('hex');
    const results = [
      await scene.connector.connect(inputOf('zz')),
      await scene.connector.connect(inputOf(legacy)),
      await scene.connector.connect({
        ...inputOf(PAYLOAD),
        target: {
          payload: PAYLOAD,
          outer: {
            family: 'ssh-remote',
            target: {kind: 'plain', text: 'devbox'},
            rawHostString: 'devbox',
          },
        },
      }),
    ];
    deepStrictEqual(
      [results.map(failedKind), scene.engineCalls, scene.engineFiles],
      [['malformedAuthority', 'malformedAuthority', 'remoteEngine'], [], []],
    );
  });

  it('contracts §2 step 2: a second check that fails with S104 is engineCheckFailed, and nothing is prepared', async () => {
    const scene = sceneOf();
    scene.version = {status: 1, stderr: 'permission denied'};
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [result, scene.prepared],
      [
        {
          kind: 'engineCheckFailed',
          reason: {id: 'S104'},
          retryable: false,
          silent: false,
          userAlreadyNotified: false,
          hints: [],
          diagnostics: [],
        },
        [],
      ],
    );
  });

  it("F-0301 AC-11: an image that is a number ends the connect with S081 and the configuration's path, before any container step", async () => {
    const scene = sceneOf();
    scene.configuration = {
      kind: 'configuration',
      configuration: {image: 42},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration: undefined,
    };
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [result, scene.prepared],
      [
        {
          kind: 'configurationInvalid',
          reason: {
            id: 'S081',
            values: ['/work/proj/.devcontainer/devcontainer.json'],
          },
          retryable: false,
          silent: false,
          userAlreadyNotified: false,
          hints: [],
          diagnostics: [],
        },
        [],
      ],
    );
  });

  it('F-0301 AC-11: after an invalid configuration the next connect reads it again', async () => {
    const scene = sceneOf();
    scene.configuration = {
      kind: 'configuration',
      configuration: {image: 42},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration: undefined,
    };
    const first = await scene.connector.connect(inputOf(PAYLOAD));
    scene.configuration = {
      kind: 'configuration',
      configuration: {image: 'node:22'},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration: undefined,
    };
    const second = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        failedKind(first),
        failedKind(second),
        scene.configurationReads.filter(read => read.containerId === undefined)
          .length,
        scene.prepared.length,
      ],
      ['configurationInvalid', 'connected', 2, 1],
    );
  });

  it("F-0410 AC-13: an image that is a string that doesn't exist still reaches the container step", async () => {
    const scene = sceneOf();
    scene.configuration = {
      kind: 'configuration',
      configuration: {image: 'nope:latest'},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration: undefined,
    };
    await connected(scene);
    deepStrictEqual(scene.prepared.length, 1);
  });

  it("F-0301 7.E3: a configuration read that fails isn't checked, and the connect goes on", async () => {
    const scene = sceneOf();
    scene.configuration = {kind: 'configurationFailed', message: 'x'};
    await connected(scene);
    deepStrictEqual(scene.prepared.length, 1);
  });

  it('contracts §2 step 3: unusable, discovery failed, a build failure and a cancel are rows 4, 5, 5 and 11', async () => {
    const kinds: string[] = [];
    for (const outcome of [
      {kind: 'unusable', containerId: 'c1', status: 'exited'},
      {kind: 'discoveryFailed', detail: 'x'},
      {kind: 'buildFailed', message: 'x'},
      {kind: 'cancelled'},
    ] as const) {
      const scene = sceneOf();
      scene.outcome = outcome;
      kinds.push(failedKind(await scene.connector.connect(inputOf(PAYLOAD))));
    }
    deepStrictEqual(kinds, [
      'containerUnusable',
      'containerSetupFailed',
      'containerSetupFailed',
      'cancelled',
    ]);
  });

  it("F-0410 AC-11, AC-12: a setup failure carries the daemon's refusal as its reason (card containers-11)", async () => {
    const reasons: unknown[] = [];
    for (const refusal of [
      'invalidMount',
      'portAllocated',
      undefined,
    ] as const) {
      const scene = sceneOf();
      scene.outcome = {
        kind: 'setupFailed',
        message: 'x',
        description: 'y',
        containerId: undefined,
        ...(refusal === undefined ? {} : {refusal}),
      };
      const result = await scene.connector.connect(inputOf(PAYLOAD));
      reasons.push('reason' in result ? result.reason : result);
    }
    deepStrictEqual(reasons, [{id: 'S018'}, {id: 'S019'}, {id: 'S034'}]);
  });

  it('contracts §2 steps 4–6: everything succeeding gives the host port and the token, untrusted, with the probed environment and no tunnels, and the phases in order', async () => {
    const scene = sceneOf();
    const phases: ConnectPhase[] = [];
    scene.connector.onPhase(phase => phases.push(phase));
    const result = await connected(scene);
    deepStrictEqual(
      [result, phases.map(phase => phase.name)],
      [
        {
          address: {host: '127.0.0.1', port: 41000},
          connectionToken: SECRET_TOKEN,
          extensionHostEnv: {ALPHA: 'probe', BRAVO: 'probe'},
          environmentTunnels: [],
          trusted: false,
        },
        ['initializing', 'installing', 'startingServer'],
      ],
    );
  });

  /** Leaves a no-cache rebuild intent for the payload, as the reload of a rebuild command does. */
  async function withIntent(scene: Scene): Promise<void> {
    await storeRebuildIntent(
      {
        get: () => scene.intentStore,
        update: (key, value) => {
          scene.intentStore = value;
          return Promise.resolve();
        },
      },
      PAYLOAD,
      {buildNoCache: true},
      0,
    );
  }

  it('contracts §3: the first attempt takes the intent and hands it to C7', async () => {
    const scene = sceneOf();
    await withIntent(scene);
    await connected(scene);
    deepStrictEqual(
      [
        scene.prepared[0]?.rebuild,
        scene.intentStore,
        messages(scene).includes(
          'the window asked for a rebuild (no cache: true)',
        ),
      ],
      [{buildNoCache: true}, {}, true],
    );
  });

  it('F-0502: a reconnection never takes the intent', async () => {
    const scene = sceneOf();
    await withIntent(scene);
    await scene.connector.connect(inputOf(PAYLOAD, {isReconnection: true}));
    deepStrictEqual(
      [
        scene.prepared[0]?.rebuild,
        REBUILD_INTENTS_KEY in {[REBUILD_INTENTS_KEY]: 1},
        Object.keys(scene.intentStore as object).length,
      ],
      [undefined, true, 1],
    );
  });

  it('contracts §3: a later attempt never takes the intent', async () => {
    const scene = sceneOf();
    await withIntent(scene);
    await scene.connector.connect(inputOf(PAYLOAD, {attempt: 2}));
    deepStrictEqual(scene.prepared[0]?.rebuild, undefined);
  });

  it('contracts §3: an unreadable store is an ordinary open, with one warning', async () => {
    const scene = sceneOf();
    scene.intentError = new Error('store gone');
    const result = await connected(scene);
    deepStrictEqual(
      [
        scene.prepared[0]?.rebuild,
        messages(scene).filter(line =>
          line.startsWith('the rebuild intent could not be read'),
        ),
        'connectionToken' in result,
      ],
      [undefined, ['the rebuild intent could not be read: store gone'], true],
    );
  });

  it('contracts §3: a store that throws something that is not an error is read by its text', async () => {
    const scene = sceneOf();
    scene.intentError = 'quota' as unknown as Error;
    await connected(scene);
    deepStrictEqual(
      messages(scene).filter(line =>
        line.startsWith('the rebuild intent could not be read'),
      ),
      ['the rebuild intent could not be read: quota'],
    );
  });

  /** The memento of a scene, as the connector's store. */
  function mementoOf(scene: Scene) {
    return {
      get: () => scene.intentStore,
      update: (key: string, value: unknown) => {
        scene.intentStore = value;
        return Promise.resolve();
      },
    };
  }

  it('F-0409 AC-22, ruling 12: C7 is handed the paused retry, which is taken once and logged', async () => {
    const scene = sceneOf();
    await connected(scene);
    await storePausedRetry(mementoOf(scene), 'a'.repeat(64), 0);
    const retry = scene.prepared[0]?.pausedRetry;
    deepStrictEqual(
      [
        await retry?.('b'.repeat(64)),
        await retry?.('a'.repeat(64)),
        await retry?.('a'.repeat(64)),
        messages(scene).filter(line => line.includes('retry the paused')),
      ],
      [
        false,
        true,
        false,
        ['the window asked to retry the paused container aaaaaaaaaaaa'],
      ],
    );
  });

  it('F-0409 ruling 12: a store that cannot be read gives no retry, with one warning, whatever it throws', async () => {
    const scene = sceneOf();
    await connected(scene);
    const retry = scene.prepared[0]?.pausedRetry;
    scene.intentError = new Error('store gone');
    const broken = await retry?.('a'.repeat(64));
    scene.intentError = 'quota' as unknown as Error;
    const refused = await retry?.('a'.repeat(64));
    deepStrictEqual(
      [
        broken,
        refused,
        messages(scene).filter(line =>
          line.startsWith('the paused retry could not be read'),
        ),
      ],
      [
        false,
        false,
        [
          'the paused retry could not be read: store gone',
          'the paused retry could not be read: quota',
        ],
      ],
    );
  });

  it('F-0409 AC-7, ruling 12: a paused container fails as containerPaused, with the same reason, and the window knows it was paused', async () => {
    const scene = sceneOf();
    scene.outcome = {kind: 'unusable', containerId: 'p1', status: 'paused'};
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        failedKind(result),
        'reason' in result ? result.reason : undefined,
        scene.connector.failedContainer(),
      ],
      ['containerPaused', {id: 'S034'}, {containerId: 'p1', paused: true}],
    );
  });

  it('F-0409 AC-34, ruling 14: an unusable container that is not paused, or a failure of up that kept a container, names it; one that found none names none', async () => {
    const named = [];
    for (const outcome of [
      {kind: 'unusable', containerId: 'r1', status: 'restarting'},
      {kind: 'buildFailed', message: 'x', foundContainerId: 'e1'},
      {kind: 'buildFailed', message: 'x'},
    ] as const) {
      const scene = sceneOf();
      scene.outcome = outcome;
      await scene.connector.connect(inputOf(PAYLOAD));
      named.push(scene.connector.failedContainer());
    }
    deepStrictEqual(named, [
      {containerId: 'r1', paused: false},
      {containerId: 'e1', paused: false},
      undefined,
    ]);
  });

  it('F-0409 AC-34: a failure after the container was ready names it, and a connect that succeeds clears it', async () => {
    const scene = sceneOf();
    scene.relayOutcome = {
      kind: 'relayFailed',
      retryable: false,
      silent: false,
      userAlreadyNotified: false,
      hints: [],
      diagnostics: [],
    };
    await scene.connector.connect(inputOf(PAYLOAD));
    const afterFailure = scene.connector.failedContainer();
    scene.relayOutcome = 'open';
    await connected(scene);
    deepStrictEqual(
      [afterFailure, scene.connector.failedContainer()],
      [{containerId: READY.containerId, paused: false}, undefined],
    );
  });

  it('F-0409 AC-34: a connect that fails before it finds a container clears what the one before found', async () => {
    const scene = sceneOf();
    scene.outcome = {kind: 'unusable', containerId: 'p1', status: 'paused'};
    await scene.connector.connect(inputOf(PAYLOAD));
    scene.outcome = {kind: 'cancelled'};
    await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(scene.connector.failedContainer(), undefined);
  });

  it('F-0409: an ordinary open hands C7 no rebuild', async () => {
    const scene = sceneOf();
    await connected(scene);
    deepStrictEqual(scene.prepared[0]?.rebuild, undefined);
  });

  it('F-0503 AC-1: a reused server has no installing phase', async () => {
    const scene = sceneOf();
    scene.phasesOfServer = ['startingServer'];
    const phases: string[] = [];
    scene.connector.onPhase(phase => phases.push(phase.name));
    await connected(scene);
    deepStrictEqual(phases, ['initializing', 'startingServer']);
  });

  it('containers-55: the percents of the server download reach the listeners as serverDownloadPercent phases', async () => {
    const scene = sceneOf();
    scene.phasesOfServer = ['installing'];
    scene.percentsOfServer = [0, 40, 100];
    const phases: ConnectPhase[] = [];
    scene.connector.onPhase(phase => phases.push(phase));
    await connected(scene);
    deepStrictEqual(phases, [
      {name: 'initializing'},
      {name: 'installing'},
      {name: 'serverDownloadPercent', percent: 0},
      {name: 'serverDownloadPercent', percent: 40},
      {name: 'serverDownloadPercent', percent: 100},
    ]);
  });

  it('F-0502 BR-21: a target with a context gives every engine call DOCKER_CONTEXT, gives the CLI the same, and leaves it out of every argument', async () => {
    const scene = sceneOf();
    const folder: DevContainerFolder = {...FOLDER, context: 'ctx1'};
    await scene.connector.connect(inputOf(devContainerPayloadOf(folder)));
    deepStrictEqual(
      [
        scene.engineCalls.length > 0,
        scene.engineCalls.every(
          call => call.environment?.DOCKER_CONTEXT === 'ctx1',
        ),
        scene.cliEnvironments.map(environment => environment.DOCKER_CONTEXT),
        scene.engineCalls.some(call =>
          call.argv.some(word => word.includes('DOCKER_CONTEXT')),
        ),
      ],
      [true, true, ['ctx1'], false],
    );
  });

  it('F-0502 BR-21: a target with no context sets none, in the engine or in the CLI', async () => {
    const scene = sceneOf();
    await connected(scene);
    deepStrictEqual(
      [
        scene.engineCalls.every(
          call => call.environment?.DOCKER_CONTEXT === undefined,
        ),
        scene.cliEnvironments.map(
          environment => 'DOCKER_CONTEXT' in environment,
        ),
      ],
      [true, [false]],
    );
  });

  it('contracts §6 no shell: a docker path with spaces and quotes reaches the engine as one file', async () => {
    const scene = sceneOf({dockerPath: "/opt/my docker/dk 'q'"});
    await connected(scene);
    deepStrictEqual(scene.engineFiles, ["/opt/my docker/dk 'q'"]);
  });

  it('contracts §2 step 3: an empty or non-text docker path is the program docker', async () => {
    const files: string[][] = [];
    for (const dockerPath of ['', 42]) {
      const scene = sceneOf({dockerPath});
      await connected(scene);
      files.push(scene.engineFiles);
    }
    deepStrictEqual(files, [['docker'], ['docker']]);
  });

  it('F-0201 AC-37, BR-1: a relative docker path is the folder’s file: the engine, the CLI’s read and the container request all get it, with ./ or without', async () => {
    const seen = [];
    for (const dockerPath of ['tools/dk', './tools/dk']) {
      const scene = sceneOf({dockerPath});
      await connected(scene);
      seen.push([
        scene.engineFiles,
        [
          ...new Set(
            scene.configurationReads.map(read => read.target.dockerPath),
          ),
        ],
        scene.prepared.map(request => request.dockerPath),
      ]);
    }
    const resolved = '/work/proj/tools/dk';
    deepStrictEqual(seen, [
      [[resolved], [resolved], [resolved]],
      [[resolved], [resolved], [resolved]],
    ]);
  });

  it("F-0419 AC-12: a folder's value is ignored per BR-7, and an unset setting is true", async () => {
    const scene = sceneOf();
    scene.cacheVolumeInspect = {globalValue: undefined, workspaceValue: false};
    await connected(scene);
    deepStrictEqual(scene.prepared[0]?.cacheVolume, true);
  });

  it('F-0411 BR-7: the consistency reaches the container request, the current key over the deprecated one, and unset is cached', async () => {
    const requests: Array<[unknown, unknown]> = [
      [undefined, undefined],
      [undefined, 'delegated'],
      ['consistent', 'delegated'],
      ['fast', undefined],
    ];
    const consistencies: string[] = [];
    for (const [current, legacy] of requests) {
      const scene = sceneOf();
      scene.workspaceMountConsistency = current;
      scene.legacyWorkspaceMountConsistency = legacy;
      await connected(scene);
      consistencies.push(String(scene.prepared[0]?.workspaceMountConsistency));
    }
    deepStrictEqual(consistencies, [
      'cached',
      'delegated',
      'consistent',
      'fast',
    ]);
  });

  it('F-0411 AC-37: the worktree setting reaches the container request and both reads of the configuration, for the boolean and for the string', async () => {
    const seen: Array<[boolean | undefined, boolean[]]> = [];
    for (const value of [undefined, false, true, 'true']) {
      const scene = sceneOf();
      scene.mountGitWorktreeCommonDir = value;
      await connected(scene);
      seen.push([
        scene.prepared[0]?.mountGitWorktreeCommonDir,
        scene.configurationReads.map(
          read => read.target.mountGitWorktreeCommonDir,
        ),
      ]);
    }
    deepStrictEqual(seen, [
      [false, [false, false]],
      [false, [false, false]],
      [true, [true, true]],
      [true, [true, true]],
    ]);
  });

  it('F-0411 BR-7, BR-11: the settings are read at each connect, so a change between two connects takes effect', async () => {
    const scene = sceneOf();
    scene.workspaceMountConsistency = 'cached';
    scene.mountGitWorktreeCommonDir = false;
    await connected(scene);
    scene.workspaceMountConsistency = 'delegated';
    scene.mountGitWorktreeCommonDir = true;
    await connected(scene);
    deepStrictEqual(
      scene.prepared.map(request => [
        request.workspaceMountConsistency,
        request.mountGitWorktreeCommonDir,
      ]),
      [
        ['cached', false],
        ['delegated', true],
      ],
    );
  });

  it('F-0504 BR-2: the name comes from the configuration, read for the container that was prepared', async () => {
    const scene = sceneOf();
    await connected(scene);
    deepStrictEqual(
      [
        scene.connector.heldIdentity(),
        scene.configurationReads.map(read => [
          read.containerId,
          read.target.workspaceFolder,
          read.target.configFile,
          read.target.dockerPath,
        ]),
      ],
      [
        {name: 'Proj', context: undefined},
        [
          [
            undefined,
            '/work/proj',
            '/work/proj/.devcontainer/devcontainer.json',
            'docker',
          ],
          [
            'c1c1c1c1c1c1c1c1',
            '/work/proj',
            '/work/proj/.devcontainer/devcontainer.json',
            'docker',
          ],
        ],
      ],
    );
  });

  it('F-1101 BR-24: the server start carries the port attributes of the merged configuration as machine settings', async () => {
    const scene = sceneOf();
    scene.configuration = {
      kind: 'configuration',
      configuration: {name: 'Proj'},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration: {portsAttributes: {'3000': {label: 'App'}}},
    };
    await connected(scene);
    deepStrictEqual(
      scene.serverRequests.map(request => request.machineSettings),
      [{'remote.portsAttributes': {'3000': {label: 'App'}}}],
    );
  });

  it("F-0505 5.0 step 5: a new container's start carries the effective list, and the log names it", async () => {
    const scene = sceneOf();
    scene.defaultExtensions = ['c.d'];
    scene.configuration = withMerged(['a.b']);
    await connected(scene);
    deepStrictEqual(
      [
        scene.serverRequests.map(request => request.defaultExtensions),
        messages(scene).filter(line => line.includes('extensions to install')),
      ],
      [
        [['a.b', 'c.d']],
        ['extensions to install in the new container: a.b, c.d'],
      ],
    );
  });

  it('F-0505 AC-14: a reused container installs nothing, and says nothing of it', async () => {
    const scene = sceneOf();
    scene.outcome = {...READY, created: false};
    scene.defaultExtensions = ['c.d'];
    scene.configuration = withMerged(['a.b']);
    await connected(scene);
    deepStrictEqual(
      [
        scene.serverRequests.map(request => request.defaultExtensions),
        messages(scene).some(line => line.includes('extensions to install')),
      ],
      [[[]], false],
    );
  });

  it('F-0505 BR-10: an empty list says so', async () => {
    const scene = sceneOf();
    await connected(scene);
    deepStrictEqual(
      [
        scene.serverRequests.map(request => request.defaultExtensions),
        messages(scene).includes('no extensions to install'),
      ],
      [[[]], true],
    );
  });

  it("F-0504 BR-2 with F-0505: a failed identity read keeps the setting's ids", async () => {
    const scene = sceneOf();
    scene.defaultExtensions = ['c.d'];
    scene.configuration = {kind: 'malformedResult', field: 'configuration'};
    await connected(scene);
    deepStrictEqual(
      scene.serverRequests.map(request => request.defaultExtensions),
      [['c.d']],
    );
  });

  it('F-0505 AC-27: the deprecated setting is used when the new one is unset', async () => {
    const scene = sceneOf();
    scene.deprecatedDefaultExtensions = ['x.y'];
    await connected(scene);
    deepStrictEqual(
      scene.serverRequests.map(request => request.defaultExtensions),
      [['x.y']],
    );
  });

  it('F-0505 6.4 step 8: the settings are read at each connect', async () => {
    const scene = sceneOf();
    scene.defaultExtensions = ['one.a'];
    await connected(scene);
    scene.defaultExtensions = ['two.b'];
    await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      scene.serverRequests.map(request => request.defaultExtensions),
      [['one.a'], ['two.b']],
    );
  });

  it('contracts §2: a configuration file whose URI has no file system path is read by its path', async () => {
    const scene = sceneOf();
    const folder: DevContainerFolder = {
      ...FOLDER,
      configFile: {
        $mid: 1,
        path: '/work/proj/.devcontainer/devcontainer.json',
        scheme: 'vscode-fileHost',
      },
    };
    await scene.connector.connect(inputOf(devContainerPayloadOf(folder)));
    deepStrictEqual(
      scene.prepared.map(request => request.configFile),
      ['/work/proj/.devcontainer/devcontainer.json'],
    );
  });

  it('F-0504 BR-2: a name that is not a text is no name', async () => {
    const scene = sceneOf();
    scene.configuration = {
      kind: 'configuration',
      configuration: {name: 42},
      workspaceFolder: '/w',
      workspaceMount: undefined,
      mergedConfiguration: undefined,
    };
    await connected(scene);
    deepStrictEqual(scene.connector.heldIdentity(), {
      name: undefined,
      context: undefined,
    });
  });

  it('F-0504 AC-31: the context is part of the identity', async () => {
    const scene = sceneOf();
    await scene.connector.connect(
      inputOf(devContainerPayloadOf({...FOLDER, context: 'ctx1'})),
    );
    deepStrictEqual(scene.connector.heldIdentity(), {
      name: 'Proj',
      context: 'ctx1',
    });
  });

  it('F-0504 BR-2: a configuration that cannot be read does not fail the connect: one warning, no name', async () => {
    const scene = sceneOf();
    scene.configuration = {kind: 'configurationFailed', message: 'x'};
    const result = await connected(scene);
    deepStrictEqual(
      [
        result.address.port,
        scene.connector.heldIdentity()?.name,
        scene.sink.lines
          .filter(line => line.level === 'warn')
          .map(line => line.message),
      ],
      [
        41000,
        undefined,
        [
          'the configuration of /work/proj could not be read: configurationFailed',
          "the configuration's name could not be read: configurationFailed",
        ],
      ],
    );
  });

  it('F-0408 BR-6: the log tells the connect in order, with the duration at the end', async () => {
    const scene = sceneOf();
    scene.steps = ['findingContainer', 'startingContainer', 'containerReady'];
    await connected(scene);
    deepStrictEqual(messages(scene), [
      'Resolving Remote',
      'docker: version → 0 (0 ms)',
      'findingContainer',
      'Starting container',
      'containerReady',
      'container c1c1c1c1c1c1 was newly started',
      'no extensions to install',
      'the environment probe (loginInteractiveShell) took 25 ms and gave 2 variables',
      'Resolving Remote: 100 ms',
    ]);
  });

  it('F-0502 BR-11: a container that was found is told as already running', async () => {
    const scene = sceneOf();
    scene.outcome = {...READY, created: false};
    await connected(scene);
    deepStrictEqual(
      messages(scene).some(message => message.endsWith('was already running')),
      true,
    );
  });

  /** A `log` event of the CLI with the level, type and text given. */
  function cliLog(
    level: number,
    type: 'raw' | 'start' | 'stop' | 'text',
    text: string,
  ): CliEvent {
    return {
      kind: 'log',
      level,
      text,
      channel: undefined,
      type,
      timestamp: undefined,
      startTimestamp: undefined,
    };
  }

  /** What the connect writes to the log for `events`, as [level, message] of the lines they gave. */
  async function loggedFor(
    events: CliEvent[],
    only: string[],
  ): Promise<string[][]> {
    const scene = sceneOf();
    scene.cliEvents = events;
    await connected(scene);
    const lines = scene.sink.lines
      .filter(line => only.includes(line.message))
      .map(line => [line.level, line.message]);
    // The connect prepares the container and reads its configuration, and each hands the events to the log.
    return lines.slice(0, lines.length / 2);
  }

  it('contracts §2 step 3: a text of level 5 is logged as an error', async () => {
    deepStrictEqual(
      await loggedFor([cliLog(5, 'text', 'it broke')], ['it broke']),
      [['error', 'it broke']],
    );
  });

  it('contracts §2 step 3: a text of level 4 is logged as a warning', async () => {
    deepStrictEqual(
      await loggedFor([cliLog(4, 'text', 'be careful')], ['be careful']),
      [['warn', 'be careful']],
    );
  });

  it('contracts §2 step 3: a text of level 3 is logged as info', async () => {
    deepStrictEqual(
      await loggedFor([cliLog(3, 'text', 'it ran')], ['it ran']),
      [['info', 'it ran']],
    );
  });

  it('contracts §2 step 3: a text of level 2, and a start of level 3, are logged as debug', async () => {
    deepStrictEqual(
      await loggedFor(
        [cliLog(2, 'text', 'detail'), cliLog(3, 'start', 'Running: x')],
        ['detail', 'Running: x'],
      ),
      [
        ['debug', 'detail'],
        ['debug', 'Running: x'],
      ],
    );
  });

  it('F-0412 AC-11: Docker’s own output is logged as info, one line for each line of its text, without control sequences or empty lines', async () => {
    deepStrictEqual(
      await loggedFor(
        [
          cliLog(
            2,
            'raw',
            '#5 [2/3] RUN false\r\n\n  \r\n\u001b[31mfailed to solve\u001b[0m: exit code 1\n\n',
          ),
        ],
        ['#5 [2/3] RUN false', 'failed to solve: exit code 1', '', '  '],
      ),
      [
        ['info', '#5 [2/3] RUN false'],
        ['info', 'failed to solve: exit code 1'],
      ],
    );
  });

  it('F-0405 AC-10: a failed lifecycle command’s line is logged as an error without its colour codes and line end', async () => {
    deepStrictEqual(
      await loggedFor(
        [
          cliLog(
            5,
            'text',
            '\u001b[1m\u001b[31mpostCreateCommand from devcontainer.json failed with exit code 7. Skipping any further user-provided commands.\u001b[39m\u001b[22m\r',
          ),
        ],
        [
          'postCreateCommand from devcontainer.json failed with exit code 7. Skipping any further user-provided commands.',
        ],
      ),
      [
        [
          'error',
          'postCreateCommand from devcontainer.json failed with exit code 7. Skipping any further user-provided commands.',
        ],
      ],
    );
  });

  it('F-0408 BR-6: a progress event is logged as a debug line', async () => {
    const scene = sceneOf();
    scene.cliEvents = [
      {
        kind: 'progress',
        name: 'Running',
        status: 'succeeded',
        detail: undefined,
      },
    ];
    await connected(scene);
    deepStrictEqual(
      scene.sink.lines
        .filter(line => line.message === 'Running: succeeded')
        .map(line => line.level),
      ['debug', 'debug'],
    );
  });

  it('contracts §2: the server’s steps get the channel, the user and the volume, and a failure of theirs is the connect’s', async () => {
    const scene = sceneOf();
    scene.outcome = {...READY, volumeMounted: true};
    scene.server = {
      kind: 'failed',
      failure: {
        kind: 'serverFailed',
        retryable: false,
        silent: false,
        userAlreadyNotified: false,
        hints: [],
        diagnostics: [],
      },
    };
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        failedKind(result),
        scene.serverRequests.map(request => [
          request.remoteUser,
          request.volumeMounted,
        ]),
        scene.relayRequests,
      ],
      [['serverFailed'][0], [['node', true]], []],
    );
  });

  it('contracts §5.2: the connector passes a root channel of the same container', async () => {
    const scene = sceneOf();
    await scene.connector.connect(inputOf(PAYLOAD));
    const [request] = scene.serverRequests;
    const before = scene.engineCalls.length;
    await request?.rootChannel.runScript(
      {
        script: 'true',
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: new AbortController().signal,
      },
      () => undefined,
    );
    const argv = scene.engineCalls[before]?.argv ?? [];
    deepStrictEqual(
      [argv.slice(0, 4), argv.includes(READY.containerId)],
      [['exec', '-i', '--user', 'root'], true],
    );
  });

  it('F-0502 BR-3: the relay is opened for the server’s port, with its paths, and a failure of it is the connect’s', async () => {
    const scene = sceneOf();
    scene.relayOutcome = {
      kind: 'relayFailed',
      retryable: false,
      silent: false,
      userAlreadyNotified: false,
      hints: [],
      diagnostics: [],
    };
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        failedKind(result),
        scene.relayRequests.map(request => [
          request.containerId,
          request.remoteUser,
          request.nodePath,
          request.relayPath,
          request.containerPort,
        ]),
      ],
      [
        'relayFailed',
        [
          [
            'c1c1c1c1c1c1c1c1',
            'node',
            STARTED_SERVER.kind === 'started' ? STARTED_SERVER.nodePath : '',
            STARTED_SERVER.kind === 'started' ? STARTED_SERVER.relayPath : '',
            41000,
          ],
        ],
      ],
    );
  });

  it('R-26: the token appears in no log line, no engine argument and no diagnostic', async () => {
    const scene = sceneOf();
    const result = await connected(scene);
    deepStrictEqual(
      [
        messages(scene).some(message => message.includes(SECRET_TOKEN)),
        scene.engineCalls.some(call =>
          call.argv.some(word => word.includes(SECRET_TOKEN)),
        ),
        JSON.stringify(scene.prepared).includes(SECRET_TOKEN),
        result.connectionToken,
      ],
      [false, false, false, SECRET_TOKEN],
    );
  });

  it('contracts §2: the details link reveals the log', () => {
    const scene = sceneOf();
    scene.connector.revealDetails();
    deepStrictEqual(scene.revealed, 1);
  });

  it('contracts §2: a new connect gives back the held connection', async () => {
    const scene = sceneOf();
    await connected(scene);
    await connected(scene);
    deepStrictEqual(
      scene.relays.map(relay => relay.closed),
      [1, 0],
    );
  });

  it('contracts §2: a reconnection with nothing held runs the whole connect', async () => {
    const scene = sceneOf();
    const result = await scene.connector.connect(
      inputOf(PAYLOAD, {isReconnection: true}),
    );
    deepStrictEqual(
      [failedKind(result), scene.prepared.length],
      ['connected', 1],
    );
  });

  it('contracts §2: a phase listener that throws does not keep the others from hearing', async () => {
    const scene = sceneOf();
    const heard: string[] = [];
    scene.connector.onPhase(() => {
      throw new Error('a listener’s fault');
    });
    scene.connector.onPhase(phase => heard.push(phase.name));
    await connected(scene);
    deepStrictEqual(heard, ['initializing', 'installing', 'startingServer']);
  });

  it('contracts §2: a phase listener that has stopped hears no more', async () => {
    const scene = sceneOf();
    const heard: string[] = [];
    const stop = scene.connector.onPhase(phase => heard.push(phase.name));
    stop();
    await connected(scene);
    deepStrictEqual(heard, []);
  });
});

describe('the container connector: the folder trust (card containers-17)', () => {
  it('F-0106 6.3: the connect asks for trust after the configuration read and before any engine call', async () => {
    const scene = sceneOf();
    scene.trusted = false;
    await connected(scene);
    deepStrictEqual(scene.atTrust, {reads: 1, engineCalls: 0});
  });

  it('F-0106 6.2: a trusted folder connects with no request and no modal', async () => {
    const scene = sceneOf();
    const result = await connected(scene);
    deepStrictEqual(
      [scene.trustCalls, 'connectionToken' in result],
      [['isTrusted'], true],
    );
  });

  it('F-0106 BR-2: trust granted in the resolve goes on to prepare the container', async () => {
    const scene = sceneOf();
    scene.trusted = false;
    await connected(scene);
    deepStrictEqual([scene.trustCalls.length, scene.prepared.length], [2, 1]);
  });

  it('F-0106 6.4a, AC-42: a decline shows S360 with S377, reopens the folder locally, and ends silent with nothing prepared', async () => {
    const scene = sceneOf();
    scene.trusted = false;
    scene.trustAnswer = false;
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        scene.trustCalls.slice(2),
        failedKind(result),
        'silent' in result && result.silent,
        'retryable' in result && result.retryable,
        scene.prepared,
        scene.engineCalls,
        scene.timers.length,
      ],
      [
        [
          'showDeclined The local folder is currently not trusted. | Trust is required to build a dev container from it. The folder will now reopen locally.',
          'reopenLocally /work/proj',
        ],
        'trustDeclined',
        true,
        false,
        [],
        [],
        0,
      ],
    );
  });

  it('F-0301 AC-68: with the decline’s modal left open, the folder reopens locally when its 5 s are up, not before', async () => {
    const scene = sceneOf();
    scene.trusted = false;
    scene.trustAnswer = false;
    scene.declinedHeld = true;
    const connecting = scene.connector.connect(inputOf(PAYLOAD));
    await new Promise(resolve => setImmediate(resolve));
    const waiting = [
      scene.trustCalls.slice(2).map(call => call.split(' ')[0]),
      scene.timerDelays.at(-1),
      scene.timers.length,
    ];
    scene.timers[0]?.();
    const result = await connecting;
    deepStrictEqual(
      [
        waiting,
        failedKind(result),
        'silent' in result && result.silent,
        scene.trustCalls.at(-1),
      ],
      [
        [['showDeclined'], 5000, 1],
        'trustDeclined',
        true,
        'reopenLocally /work/proj',
      ],
    );
  });

  it('F-0301 AC-68: a modal that fails still reopens the folder locally, with no timer left', async () => {
    const scene = sceneOf();
    scene.trusted = false;
    scene.trustAnswer = false;
    scene.declinedFails = true;
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [failedKind(result), scene.trustCalls.at(-1), scene.timers.length],
      ['trustDeclined', 'reopenLocally /work/proj', 0],
    );
  });

  it('brief ruling 9: an unavailable trust request reopens locally without the modal, after the setup notice', async () => {
    const scene = sceneOf();
    scene.trusted = false;
    scene.trustAnswer = new Error('proposal');
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        scene.setupAgains,
        scene.trustCalls.slice(2),
        failedKind(result),
        scene.prepared,
      ],
      [1, ['reopenLocally /work/proj'], 'trustDeclined', []],
    );
  });

  it('F-0106 6.3: a connect cancelled while the trust dialog is open neither shows the modal nor reopens the folder', async () => {
    const scene = sceneOf();
    scene.trusted = false;
    let answer: ((trusted: boolean) => void) | undefined;
    scene.trustAnswer = () =>
      new Promise(resolve => {
        answer = resolve;
      });
    const connecting = scene.connector.connect(inputOf(PAYLOAD));
    await tick();
    scene.connector.cancel();
    answer?.(false);
    const result = await connecting;
    deepStrictEqual(
      [scene.trustCalls.slice(2), failedKind(result)],
      [[], 'trustDeclined'],
    );
  });
});

describe('the container connector: cancelling (card containers-08)', () => {
  it('contracts §2 cancel: a cancel during the preparation ends the connect as cancelled, stops the background and opens no relay', async () => {
    const scene = sceneOf();
    const release = heldPreparation(scene);
    const connecting = scene.connector.connect(inputOf(PAYLOAD));
    await tick();
    scene.connector.cancel();
    release();
    const result = await connecting;
    deepStrictEqual(
      [
        failedKind(result),
        scene.stopped,
        scene.serverRequests.length,
        scene.configurationReads.length,
        scene.relayRequests.length,
      ],
      ['cancelled', 1, 0, 1, 0],
    );
  });

  it('contracts §2 cancel: a cancel while the server starts ends the connect as cancelled and opens no relay', async () => {
    const scene = sceneOf();
    let release: (() => void) | undefined;
    scene.server = () =>
      new Promise(resolve => {
        release = () => {
          resolve(STARTED_SERVER);
        };
      });
    const connecting = scene.connector.connect(inputOf(PAYLOAD));
    await tick();
    await tick();
    scene.connector.cancel();
    release?.();
    const result = await connecting;
    deepStrictEqual(
      [failedKind(result), scene.relayRequests.length],
      ['cancelled', 0],
    );
  });

  it('contracts §2 cancel: a cancel while the relay opens gives back the relay that opened, and the connect is cancelled', async () => {
    const scene = sceneOf();
    let release: (() => void) | undefined;
    scene.relayGate = () =>
      new Promise(resolve => {
        release = resolve;
      });
    const connecting = scene.connector.connect(inputOf(PAYLOAD));
    for (let ticks = 0; ticks < 8; ticks += 1) {
      await tick();
    }
    scene.connector.cancel();
    release?.();
    const result = await connecting;
    deepStrictEqual(
      [failedKind(result), scene.relays.map(relay => relay.closed)],
      ['cancelled', [1]],
    );
  });

  it('contracts §2 cancel: a cancel gives back the connection the window holds', async () => {
    const scene = sceneOf();
    await connected(scene);
    scene.connector.cancel();
    deepStrictEqual(
      [scene.relays.map(relay => relay.closed), scene.connector.heldIdentity()],
      [[1], undefined],
    );
  });

  it('F-0903 AC-8, card containers-33: listeners hear when the connection is made and when it is given back, and not after they stop listening', async () => {
    const scene = sceneOf();
    const heard: string[] = [];
    const stop = scene.connector.onHeldChanged(() => {
      heard.push(
        scene.connector.heldConnection() === undefined ? 'none' : 'held',
      );
    });
    await connected(scene);
    scene.connector.cancel();
    stop();
    await connected(scene);
    deepStrictEqual(heard, ['held', 'none']);
  });

  it('F-0901 6.21 step 4, card containers-30: the held connection names the container, its folders and the engine the connect used, and it is nothing before the connect and after a cancel', async () => {
    const scene = sceneOf();
    const before = scene.connector.heldConnection();
    await connected(scene);
    const held = scene.connector.heldConnection();
    await held?.engine.run(
      ['ps'],
      {kind: 'none'},
      {cancellation: new AbortController().signal},
    );
    const during = [
      held?.containerId,
      held?.hostPath,
      held?.remoteWorkspaceFolder,
      scene.engineCalls.at(-1)?.argv,
    ];
    scene.connector.cancel();
    deepStrictEqual(
      [before, during, scene.connector.heldConnection()],
      [
        undefined,
        ['c1c1c1c1c1c1c1c1', '/work/proj', '/workspaces/proj', ['ps']],
        undefined,
      ],
    );
  });

  it('contracts §2 cancel: a cancel with nothing running and nothing held changes nothing', () => {
    const scene = sceneOf();
    scene.connector.cancel();
    deepStrictEqual(scene.stopped, 0);
  });
});

/** The connector after a connect, with listeners counting what it tells about the transport. */
async function held() {
  const scene = sceneOf();
  const told = {lost: 0, closed: 0};
  scene.connector.onTransportLost(() => {
    told.lost += 1;
  });
  scene.connector.onTransportClosed(() => {
    told.closed += 1;
  });
  const result = await connected(scene);
  return {scene, told, result};
}

function inspectsOf(scene: Scene): number {
  return scene.engineCalls.filter(call => call.argv[0] === 'inspect').length;
}

/** A relayed connection ends, and the check that follows runs. */
async function connectionEnds(scene: Scene): Promise<void> {
  scene.relayRequests.at(-1)?.onConnectionClosed();
  await tick();
  await tick();
}

describe('the container connector: the transport (card containers-08)', () => {
  it('F-0502 BR-8: a relayed connection that ends while the container has exited tells that the transport closed, once', async () => {
    const {scene, told} = await held();
    scene.inspect.answer = {
      status: 'exited',
      startedAt: '2026-10-14T10:00:00Z',
    };
    await connectionEnds(scene);
    deepStrictEqual(told, {lost: 0, closed: 1});
  });

  it('F-0502 7.E15: the same with a paused container tells that the transport was lost, once', async () => {
    const {scene, told} = await held();
    scene.inspect.answer = {
      status: 'paused',
      startedAt: '2026-10-14T10:00:00Z',
    };
    await connectionEnds(scene);
    deepStrictEqual(told, {lost: 1, closed: 0});
  });

  it('F-0502 BR-7: the same with a running container of the same start tells nothing', async () => {
    const {scene, told} = await held();
    await connectionEnds(scene);
    deepStrictEqual(told, {lost: 0, closed: 0});
  });

  it('F-0502 7.E16: a container that runs again from a new start tells that the transport closed', async () => {
    const {scene, told} = await held();
    scene.inspect.answer = {
      status: 'running',
      startedAt: '2026-10-14T11:00:00Z',
    };
    await connectionEnds(scene);
    deepStrictEqual(told, {lost: 0, closed: 1});
  });

  it('F-0502 BR-8: a container that is gone tells that the transport closed', async () => {
    const {scene, told} = await held();
    scene.inspect.answer = 'missing';
    await connectionEnds(scene);
    deepStrictEqual(told, {lost: 0, closed: 1});
  });

  it('F-0502 BR-7: a container whose state cannot be read tells nothing', async () => {
    const {scene, told} = await held();
    for (const answer of [
      'unreachable',
      'refused',
      'garbled',
      'incomplete',
    ] as const) {
      scene.inspect.answer = answer;
      await connectionEnds(scene);
    }
    deepStrictEqual(told, {lost: 0, closed: 0});
  });

  it('F-0502 BR-8: connections that end while a check runs are one check', async () => {
    const {scene} = await held();
    const before = inspectsOf(scene);
    scene.relayRequests.at(-1)?.onConnectionClosed();
    scene.relayRequests.at(-1)?.onConnectionClosed();
    await tick();
    await tick();
    deepStrictEqual(inspectsOf(scene) - before, 1);
  });

  it('F-0502 BR-8: a connection of a relay the window no longer holds tells nothing', async () => {
    const scene = sceneOf();
    const told = {closed: 0};
    scene.connector.onTransportClosed(() => {
      told.closed += 1;
    });
    await connected(scene);
    const first = scene.relayRequests[0];
    await connected(scene);
    scene.inspect.answer = 'missing';
    first?.onConnectionClosed();
    await tick();
    await tick();
    deepStrictEqual(told, {closed: 0});
  });

  it('F-0502 7.E15: a listener that fails by itself tells that the transport was lost', async () => {
    const {scene, told} = await held();
    scene.relays[0]?.failListeners.forEach(listener => {
      listener();
    });
    deepStrictEqual(told, {lost: 1, closed: 0});
  });

  it('F-0502 7.E15: the failure of a relay the window no longer holds tells nothing', async () => {
    const scene = sceneOf();
    const told = {lost: 0};
    scene.connector.onTransportLost(() => {
      told.lost += 1;
    });
    await connected(scene);
    await connected(scene);
    scene.relays[0]?.failListeners.forEach(listener => {
      listener();
    });
    deepStrictEqual(told, {lost: 0});
  });

  it('F-0502 BR-8: a container whose start could not be read at the connect is a different start later', async () => {
    const scene = sceneOf();
    scene.inspect.answer = 'unreachable';
    await connected(scene);
    scene.inspect.answer = {
      status: 'running',
      startedAt: '2026-10-14T10:00:00Z',
    };
    const result = await scene.connector.connect(
      inputOf(PAYLOAD, {isReconnection: true}),
    );
    deepStrictEqual(failedKind(result), 'containerGone');
  });
});

describe('the container connector: a reconnection (card containers-08)', () => {
  /** The answer of a reconnection resolve after the connect, with the inspect answer and the server’s check set. */
  async function reconnection(
    answer: Scene['inspect']['answer'],
    killStatuses: number[] = [],
  ) {
    const {scene, result} = await held();
    scene.inspect.answer = answer;
    scene.killStatuses = killStatuses;
    const prepared = scene.prepared.length;
    const servers = scene.serverRequests.length;
    const again = await scene.connector.connect(
      inputOf(PAYLOAD, {isReconnection: true, attempt: 2}),
    );
    return {
      again,
      first: result,
      reran:
        scene.prepared.length !== prepared ||
        scene.serverRequests.length !== servers,
      logged: messages(scene).filter(message =>
        message.startsWith('reconnection:'),
      ),
    };
  }

  it('F-0502 7.E15: a running container of the same start with its server alive answers the held connection again', async () => {
    const outcome = await reconnection(
      {status: 'running', startedAt: '2026-10-14T10:00:00Z'},
      [0],
    );
    deepStrictEqual([outcome.again, outcome.reran], [outcome.first, false]);
  });

  it('F-0502 7.E1: the held server’s process is asked about by its own id', async () => {
    const {scene} = await held();
    scene.inspect.answer = {
      status: 'running',
      startedAt: '2026-10-14T10:00:00Z',
    };
    await scene.connector.connect(inputOf(PAYLOAD, {isReconnection: true}));
    deepStrictEqual(
      scene.killScripts.map(text => text.includes('kill -0 77')),
      [true],
    );
  });

  it('F-0502 7.E1: a running container whose server is gone is transportLost, and nothing is prepared or started again', async () => {
    const outcome = await reconnection(
      {status: 'running', startedAt: '2026-10-14T10:00:00Z'},
      [1],
    );
    deepStrictEqual(
      [
        failedKind(outcome.again),
        'retryable' in outcome.again && outcome.again.retryable,
        outcome.reran,
      ],
      ['transportLost', true, false],
    );
  });

  it('F-0502 7.E15: a paused container is transportLost, with the server not asked', async () => {
    const outcome = await reconnection({
      status: 'paused',
      startedAt: '2026-10-14T10:00:00Z',
    });
    deepStrictEqual(failedKind(outcome.again), 'transportLost');
  });

  it('F-0502 7.E2: a stopped container is containerGone, silent', async () => {
    const outcome = await reconnection({
      status: 'exited',
      startedAt: '2026-10-14T10:00:00Z',
    });
    deepStrictEqual(
      [
        failedKind(outcome.again),
        'silent' in outcome.again && outcome.again.silent,
      ],
      ['containerGone', true],
    );
  });

  it('F-0502 7.E16: a container that runs again from a new start is containerGone', async () => {
    const outcome = await reconnection({
      status: 'running',
      startedAt: '2026-10-14T11:00:00Z',
    });
    deepStrictEqual(failedKind(outcome.again), 'containerGone');
  });

  it('F-0502 BR-8: a container that is no more is containerGone', async () => {
    const outcome = await reconnection('missing');
    deepStrictEqual(failedKind(outcome.again), 'containerGone');
  });

  it('F-0502 7.E1: a container whose state cannot be read is transportLost', async () => {
    const outcome = await reconnection('unreachable');
    deepStrictEqual(failedKind(outcome.again), 'transportLost');
  });

  it('containers-61: each answer to a reconnecting window is logged with what was found of the container and the server', async () => {
    const SAME = '2026-10-14T10:00:00Z';
    const cases: Array<[Scene['inspect']['answer'], number[], string]> = [
      [
        {status: 'running', startedAt: SAME},
        [0],
        'is running, same start, server alive: held',
      ],
      [
        {status: 'running', startedAt: SAME},
        [1],
        'is running, same start, server down: transportLost',
      ],
      [
        {status: 'paused', startedAt: SAME},
        [],
        'is paused, same start, server not checked: transportLost',
      ],
      [
        {status: 'exited', startedAt: SAME},
        [],
        'is exited, same start, server not checked: containerGone',
      ],
      [
        {status: 'running', startedAt: '2026-10-14T11:00:00Z'},
        [],
        'is running, another start, server not checked: containerGone',
      ],
      [
        'missing',
        [],
        'is missing, no start, server not checked: containerGone',
      ],
      [
        'unreachable',
        [],
        'is unreachable, no start, server not checked: transportLost',
      ],
    ];
    const logged = [];
    for (const [answer, statuses] of cases) {
      logged.push((await reconnection(answer, statuses)).logged);
    }
    deepStrictEqual(
      logged,
      cases.map(([, , text]) => [
        `reconnection: container c1c1c1c1c1c1 ${text}`,
      ]),
    );
  });

  it('F-0502 7.E1: a server that cannot be asked about is not alive', async () => {
    const outcome = await reconnection(
      {status: 'running', startedAt: '2026-10-14T10:00:00Z'},
      [127],
    );
    deepStrictEqual(failedKind(outcome.again), 'transportLost');
  });
});

describe('the container connector: the canonical path (card containers-22)', () => {
  const AUTHORITY = `dev-container+${PAYLOAD}`;

  /** The canonical paths of `paths` in the window of `authority`, in order. */
  async function pathsOf(
    scene: Scene,
    paths: readonly string[],
    authority = AUTHORITY,
  ): Promise<Array<string | undefined>> {
    const answers: Array<string | undefined> = [];
    for (const path of paths) {
      answers.push(await scene.connector.canonicalPathOf(authority, path));
    }
    return answers;
  }

  it('F-0106 6.11: the workspace folder and a file under it map to the local folder; a sibling and a path outside don’t', async () => {
    const scene = sceneOf();
    await connected(scene);
    deepStrictEqual(
      await pathsOf(scene, [
        '/workspaces/proj',
        '/workspaces/proj/src/a.ts',
        '/workspaces/proj-other',
        '/etc/hosts',
      ]),
      ['/work/proj', '/work/proj/src/a.ts', undefined, undefined],
    );
  });

  it("contracts §3.2: another family's authority and a payload that isn't a folder map nothing", async () => {
    const scene = sceneOf();
    await connected(scene);
    deepStrictEqual(
      [
        await scene.connector.canonicalPathOf('ssh-remote+h', '/x'),
        await scene.connector.canonicalPathOf('dev-container+zz', '/x'),
        scene.configurationReads.length,
      ],
      [undefined, undefined, 2],
    );
  });

  it('contracts §3.2 (T0): with no connection held, the answer comes from the read alone', async () => {
    const scene = sceneOf();
    deepStrictEqual(
      [
        await pathsOf(scene, ['/workspaces/proj/a']),
        scene.configurationReads.length,
        scene.prepared.length,
        messages(scene).filter(message => message.startsWith('the canonical')),
      ],
      [
        ['/work/proj/a'],
        1,
        0,
        [
          'the canonical path of /workspaces/proj/a is /work/proj/a (from the configuration read)',
        ],
      ],
    );
  });

  it('contracts §3.2: the canonical request and the connect’s start share one read without a container, and the name keeps its own read with the container (ADR-0009 deviation 4)', async () => {
    const scene = sceneOf();
    await pathsOf(scene, ['/workspaces/proj']);
    await connected(scene);
    deepStrictEqual(
      [
        scene.configurationReads.map(read => read.containerId),
        scene.connector.heldIdentity()?.name,
      ],
      [[undefined, 'c1c1c1c1c1c1c1c1'], 'Proj'],
    );
  });

  it('contracts §3.2: the connect first, then the canonical request, answered before prepare settles', async () => {
    const scene = sceneOf();
    const release = heldPreparation(scene);
    const connecting = scene.connector.connect(inputOf(PAYLOAD));
    await tick();
    const answer = await scene.connector.canonicalPathOf(
      AUTHORITY,
      '/workspaces/proj',
    );
    const preparedBefore = scene.prepared.length;
    release();
    await connecting;
    deepStrictEqual(
      [answer, preparedBefore, scene.configurationReads.length],
      ['/work/proj', 1, 2],
    );
  });

  it('contracts §3.2: a failed read answers nothing and warns, and the next request reads again', async () => {
    const scene = sceneOf();
    const answers = [
      {kind: 'configurationFailed' as const, message: 'x'},
      {
        kind: 'configuration' as const,
        configuration: {},
        workspaceFolder: '/workspaces/proj',
        workspaceMount: undefined,
        mergedConfiguration: undefined,
      },
    ];
    scene.configuration = () =>
      Promise.resolve(answers.shift() ?? {kind: 'cancelled'});
    deepStrictEqual(
      [
        await pathsOf(scene, ['/workspaces/proj', '/workspaces/proj']),
        scene.configurationReads.length,
        scene.sink.lines
          .filter(line => line.level === 'warn')
          .map(line => line.message),
      ],
      [
        [undefined, '/work/proj'],
        2,
        [
          'the configuration of /work/proj could not be read: configurationFailed',
        ],
      ],
    );
  });

  it('contracts §3.2: the canonical request gives up after 30 s', async () => {
    const scene = sceneOf();
    scene.configuration = () => new Promise(() => undefined);
    const asking = scene.connector.canonicalPathOf(
      AUTHORITY,
      '/workspaces/proj',
    );
    for (const fire of scene.timers) {
      fire();
    }
    deepStrictEqual([await asking, scene.timerDelays], [undefined, [30_000]]);
  });

  it('contracts §3.2: a read that settles first stops the timer', async () => {
    const scene = sceneOf();
    await pathsOf(scene, ['/workspaces/proj']);
    deepStrictEqual([scene.timerDelays, scene.timers], [[30_000], []]);
  });

  it('contracts §3.2: a held connection wins over the read', async () => {
    const scene = sceneOf();
    scene.outcome = {...READY, remoteWorkspaceFolder: '/srv/app'};
    await connected(scene);
    deepStrictEqual(
      [
        await pathsOf(scene, ['/srv/app/x', '/workspaces/proj/x']),
        messages(scene).filter(message => message.startsWith('the canonical')),
      ],
      [
        ['/work/proj/x', undefined],
        [
          'the canonical path of /srv/app/x is /work/proj/x (from the connection)',
        ],
      ],
    );
  });
});

describe('the container connector: the remote environment (card containers-45)', () => {
  const MERGED = {remoteEnv: {ALPHA: 'remote', CHARLIE: null, DELTA: 7}};

  function withMergedConfiguration(
    mergedConfiguration: Record<string, unknown>,
  ): Scene['configuration'] {
    return {
      kind: 'configuration',
      configuration: {name: 'Proj'},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration,
    };
  }

  function dropLines(scene: Scene): string[] {
    return messages(scene).filter(message =>
      message.startsWith('the environment probe was dropped'),
    );
  }

  it('F-0416 BR-11a: the probe and remoteEnv merge, remoteEnv winning, null kept, and a bad value named in the log without its value', async () => {
    const scene = sceneOf();
    scene.configuration = withMergedConfiguration(MERGED);
    const result = await connected(scene);
    deepStrictEqual(
      [
        result.extensionHostEnv,
        scene.sink.lines
          .filter(line => line.level === 'warn')
          .map(line => line.message),
      ],
      [
        {ALPHA: 'remote', BRAVO: 'probe', CHARLIE: null},
        ['remoteEnv DELTA is neither a string nor null'],
      ],
    );
  });

  it('F-0416 BR-11b: a probe that fails, exits 1, prints no end marker or never answers is dropped, once each, and the connect goes on', async () => {
    const results: unknown[] = [];
    const probes: Array<Scene['probe']> = [
      process => {
        process.exit(undefined);
      },
      process => {
        process.print('motd\n');
        process.exit(1);
      },
      process => {
        process.print('remote-oss-env-probe-begin\nA=probe\0');
        process.exit(0);
      },
      () => undefined,
    ];
    for (const probe of probes) {
      const scene = sceneOf();
      scene.configuration = withMergedConfiguration(MERGED);
      scene.probe = probe;
      const timeout = mock.method(AbortSignal, 'timeout', () =>
        AbortSignal.abort(),
      );
      const result = await connected(scene);
      timeout.mock.restore();
      results.push([result.extensionHostEnv, dropLines(scene).length]);
    }
    deepStrictEqual(results, [
      [{ALPHA: 'remote', CHARLIE: null}, 1],
      [{ALPHA: 'remote', CHARLIE: null}, 1],
      [{ALPHA: 'remote', CHARLIE: null}, 1],
      [{ALPHA: 'remote', CHARLIE: null}, 1],
    ]);
  });

  it('F-0416 BR-11b: the probe is given ten seconds', async () => {
    const scene = sceneOf();
    const timeout = mock.method(AbortSignal, 'timeout');
    await connected(scene);
    timeout.mock.restore();
    deepStrictEqual(
      timeout.mock.calls.map(call => call.arguments),
      [[10_000]],
    );
  });

  it('F-0416 6.10: two connects of one reused server each build their own environment', async () => {
    const scene = sceneOf();
    scene.configuration = withMergedConfiguration({remoteEnv: {ALPHA: 'one'}});
    const first = await connected(scene);
    scene.configuration = withMergedConfiguration({remoteEnv: {ALPHA: 'two'}});
    const second = await connected(scene);
    deepStrictEqual(
      [first.extensionHostEnv, second.extensionHostEnv],
      [
        {ALPHA: 'one', BRAVO: 'probe'},
        {ALPHA: 'two', BRAVO: 'probe'},
      ],
    );
  });

  it('F-0416 BR-11: userEnvProbe none runs no probe, and the environment is remoteEnv', async () => {
    const scene = sceneOf();
    scene.configuration = withMergedConfiguration({
      userEnvProbe: 'none',
      remoteEnv: {ALPHA: 'remote'},
    });
    const result = await connected(scene);
    deepStrictEqual(
      [result.extensionHostEnv, scene.probeScripts.length],
      [{ALPHA: 'remote'}, 0],
    );
  });

  it('F-0416 BR-11: a configuration that could not be read gives the default mode and an empty remoteEnv', async () => {
    const scene = sceneOf();
    scene.configuration = {kind: 'configurationFailed', message: 'x'};
    const result = await connected(scene);
    deepStrictEqual(
      [result.extensionHostEnv, scene.probeScripts.length],
      [{ALPHA: 'probe', BRAVO: 'probe'}, 1],
    );
  });

  it('F-0416 BR-11: the mode reaches the script', async () => {
    const scene = sceneOf();
    scene.configuration = withMergedConfiguration({
      userEnvProbe: 'interactiveShell',
    });
    await connected(scene);
    deepStrictEqual(
      scene.probeScripts.map(script => script.includes(' -i -c ')),
      [true],
    );
  });
});

describe('the container connector: the declared ports (card containers-72)', () => {
  function configurationWith(
    mergedConfiguration: Record<string, unknown> | undefined,
  ): Scene['configuration'] {
    return {
      kind: 'configuration',
      configuration: {name: 'Proj'},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration,
    };
  }

  it('F-1101 BR-1: the connection holds the forwardPorts, portsAttributes and otherPortsAttributes of the merged configuration', async () => {
    const scene = sceneOf();
    scene.configuration = configurationWith({
      forwardPorts: [3000, 'side:4000'],
      portsAttributes: {'3000': {label: 'web'}},
      otherPortsAttributes: {onAutoForward: 'silent'},
    });
    await connected(scene);
    deepStrictEqual(scene.connector.heldPorts(), {
      forwardPorts: [3000, 'side:4000'],
      portsAttributes: {'3000': {label: 'web'}},
      otherPortsAttributes: {onAutoForward: 'silent'},
    });
  });

  it('F-1101 AC-11, AC-30: a reconnect keeps the ports read when the connection was made', async () => {
    const scene = sceneOf();
    scene.configuration = configurationWith({forwardPorts: [3000]});
    await connected(scene);
    scene.configuration = configurationWith({forwardPorts: [4000]});
    await scene.connector.connect({...inputOf(PAYLOAD), isReconnection: true});
    deepStrictEqual(scene.connector.heldPorts()?.forwardPorts, [3000]);
  });

  it('F-1101 AC-1: a configuration that cannot be read declares no ports, and a connector that never connected holds none', async () => {
    const scene = sceneOf();
    const before = scene.connector.heldPorts();
    scene.configuration = {kind: 'configurationFailed', message: 'x'};
    await connected(scene);
    deepStrictEqual(
      [before, scene.connector.heldPorts()],
      [
        undefined,
        {
          forwardPorts: undefined,
          portsAttributes: undefined,
          otherPortsAttributes: undefined,
        },
      ],
    );
  });
});

describe('the container connector: the appPort rows (card containers-74)', () => {
  function configurationWith(
    configuration: Record<string, unknown>,
  ): Scene['configuration'] {
    return {
      kind: 'configuration',
      configuration: {name: 'Proj', ...configuration},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration: undefined,
    };
  }

  const STATIC_ROW = {
    remoteAddress: {host: '0.0.0.0', port: 8080},
    localAddress: '127.0.0.1:8080',
  };

  it('F-1101 BR-15: the connection hands core the rows of the configuration’s appPort', async () => {
    const scene = sceneOf();
    scene.configuration = configurationWith({appPort: [8080]});
    deepStrictEqual((await connected(scene)).environmentTunnels, [STATIC_ROW]);
  });

  it('F-1101 BR-14: a Compose configuration hands core none', async () => {
    const scene = sceneOf();
    scene.configuration = configurationWith({
      appPort: [8080],
      dockerComposeFile: 'compose.yml',
    });
    deepStrictEqual((await connected(scene)).environmentTunnels, []);
  });

  it('F-1101 BR-22, AC-23: an engine that is not local hands core none', async () => {
    const scene = sceneOf();
    scene.dockerHost = 'tcp://10.0.0.5:2375';
    scene.configuration = configurationWith({appPort: [8080]});
    deepStrictEqual((await connected(scene)).environmentTunnels, []);
  });

  it('F-1101 BR-14: a configuration that cannot be read hands core none', async () => {
    const scene = sceneOf();
    scene.configuration = {kind: 'configurationFailed', message: 'x'};
    deepStrictEqual((await connected(scene)).environmentTunnels, []);
  });
});
