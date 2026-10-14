import {deepStrictEqual} from 'node:assert';
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

function tick(): Promise<unknown> {
  return new Promise(resolve => setImmediate(resolve));
}

function failedKind(result: Connected | Failed): string {
  return 'kind' in result ? result.kind : 'connected';
}

function messages(scene: Scene): string[] {
  return scene.sink.lines.map(line => line.message);
}

async function connected(scene: Scene) {
  const result = await scene.connector.connect(inputOf(PAYLOAD));
  if (!('connectionToken' in result)) {
    throw new Error(`the connect failed: ${JSON.stringify(result)}`);
  }
  return result;
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

  it('contracts §2 steps 4–6: everything succeeding gives the host port and the token, untrusted, with no environment and no tunnels, and the phases in order', async () => {
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
          extensionHostEnv: {},
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

  it('contracts §2 step 3: a relative path cannot be resolved inside the resolve, so the second check fails and nothing runs', async () => {
    const scene = sceneOf({dockerPath: 'bin/docker'});
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        'reason' in result && result.reason,
        scene.engineCalls.length,
        scene.prepared,
      ],
      [{id: 'S339'}, 0, []],
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
            'c1c1c1c1c1c1c1c1',
            '/work/proj',
            '/work/proj/.devcontainer/devcontainer.json',
            'docker',
          ],
        ],
      ],
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
        ["the configuration's name could not be read: configurationFailed"],
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
      'Resolving Remote: 50 ms',
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

  it('F-0408 BR-6: the CLI’s error events are logged as errors and the rest as debug lines', async () => {
    const scene = sceneOf();
    scene.cliEvents = [
      {kind: 'log', level: 5, text: 'it broke', channel: undefined},
      {kind: 'log', level: 3, text: 'it ran', channel: undefined},
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
        .filter(line =>
          ['it broke', 'it ran', 'Running: succeeded'].includes(line.message),
        )
        .map(line => [line.level, line.message]),
      [
        ['error', 'it broke'],
        ['debug', 'it ran'],
        ['debug', 'Running: succeeded'],
        ['error', 'it broke'],
        ['debug', 'it ran'],
        ['debug', 'Running: succeeded'],
      ],
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

describe('the container connector: cancelling (card containers-08)', () => {
  it('contracts §2 cancel: a cancel during the preparation ends the connect as cancelled, stops the background and opens no relay', async () => {
    const scene = sceneOf();
    let release: (() => void) | undefined;
    scene.outcome = () =>
      new Promise(resolve => {
        release = () => {
          resolve(READY);
        };
      });
    const connecting = scene.connector.connect(inputOf(PAYLOAD));
    await tick();
    scene.connector.cancel();
    release?.();
    const result = await connecting;
    deepStrictEqual(
      [
        failedKind(result),
        scene.stopped,
        scene.serverRequests.length,
        scene.configurationReads.length,
        scene.relayRequests.length,
      ],
      ['cancelled', 1, 0, 0, 0],
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
    await tick();
    await tick();
    await tick();
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

  it('F-0502 7.E1: a server that cannot be asked about is not alive', async () => {
    const outcome = await reconnection(
      {status: 'running', startedAt: '2026-10-14T10:00:00Z'},
      [127],
    );
    deepStrictEqual(failedKind(outcome.again), 'transportLost');
  });
});
