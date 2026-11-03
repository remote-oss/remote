/**
 * @fileoverview The fakes of the connector's tests: a `docker` that answers by its arguments, a lifecycle, a CLI, a
 * server and a relay that the test steers, and the connector over them.
 */

import type {ConnectInput, Failed} from 'lib-authority';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  devContainerPayloadOf,
  type DevContainerFolder,
} from '../../src/authority/payload.ts';
import type {CliTarget} from '../../src/cli/cli-arguments.ts';
import type {CliBridge} from '../../src/cli/cli-bridge.ts';
import type {BackgroundStage} from '../../src/lifecycle/container-lifecycle.ts';
import type {CliEvent} from '../../src/cli/cli-lines.ts';
import {
  type ContainerConnector,
  type ContainerConnectorDependencies,
  type VolumeConnectDependencies,
  containerConnectorOf,
  noEngineProgramOf,
} from '../../src/connect/connector.ts';
import type {OpenRelay, RelayRequest} from '../../src/connect/host-relay.ts';
import type {
  ServerRequest,
  ServerResult,
} from '../../src/connect/server-steps.ts';
import type {
  EngineHost,
  EngineOptions,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';
import {cacheVolumeOf} from '../../src/lifecycle/cache-volume.ts';
import type {ShutdownRequest} from '../../src/shutdown/protocol.ts';
import {metadataArguments} from '../../src/shutdown/recorded-metadata.ts';
import type {
  ContainerLifecycle,
  ContainerOutcome,
  ContainerRequest,
  ContainerStep,
} from '../../src/lifecycle/container-lifecycle.ts';
import {fakeEngine, type ProcessScript, type SpawnPlan} from './fake-engine.ts';

/** The extension's global storage folder of the fixture: nothing is ever created in it. */
export const FIXTURE_STORAGE = '/storage-of-the-fixture';

/** The connection token of the fixture's server, a secret no log may hold. */
export const SECRET_TOKEN = 'tok-s3cret';

/** The folder a dev container is made for. */
export const FOLDER: DevContainerFolder = {
  kind: 'folder',
  hostPath: '/work/proj',
  localDocker: false,
  configFile: {
    $mid: 1,
    fsPath: '/work/proj/.devcontainer/devcontainer.json',
    external: 'file:///work/proj/.devcontainer/devcontainer.json',
    path: '/work/proj/.devcontainer/devcontainer.json',
    scheme: 'file',
  },
};

/**
 * Makes the reads that name a container answer `failure`, while the read before the container starts keeps the
 * scene's answer: a connect that goes on past a failed read after the start.
 */
export function containerReadsFail(
  scene: Scene,
  failure: Exclude<
    Awaited<ReturnType<CliBridge['readConfiguration']>>,
    {kind: 'configuration'}
  >,
): void {
  const before = scene.configuration;
  scene.configuration = () => {
    if (scene.configurationReads.at(-1)?.containerId !== undefined) {
      return Promise.resolve(failure);
    }
    return typeof before === 'function' ? before() : Promise.resolve(before);
  };
}

/** The input of a resolve of `payload`. */
export function inputOf(
  payload: string,
  changes: Partial<ConnectInput> = {},
): ConnectInput {
  return {
    target: {payload},
    rawHostString: payload,
    attempt: 1,
    isReconnection: false,
    windowId: 'window-1',
    windowWorkspace: undefined,
    ...changes,
  };
}

/** The payload of the authority of that folder. */
export const PAYLOAD = devContainerPayloadOf(FOLDER);

/** The state `docker inspect` gives the container. */
interface InspectState {
  /** The answer: the state, `missing`, or a failure of the engine. */
  answer:
    | {status: string; startedAt: string}
    | 'missing'
    | 'unreachable'
    | 'refused'
    | 'garbled'
    | 'incomplete';
}

/** What `docker` was asked, by one call. */
interface EngineCall {
  argv: readonly string[];
  environment: Readonly<Record<string, string>> | undefined;
}

/** What a test steers and reads: the fakes, their answers and what they recorded. */
export interface Scene {
  /** Whether the folder the payload names exists on the machine. */
  folderExists: boolean;
  /** Whether the configuration file exists on this machine. */
  configurationExists: boolean;
  /** The configuration files discovery finds in a folder, in the picker's order. */
  candidates: Array<{file: string}>;
  connector: ContainerConnector;
  /** How many connect attempts began their log. */
  attemptsBegun: number;
  engineCalls: EngineCall[];
  engineFiles: string[];
  cliEnvironments: Array<Readonly<Record<string, string | undefined>>>;
  inspect: InspectState;
  /** What the version query answers: its status and stderr. */
  version: {status: number; stderr: string};
  prepared: ContainerRequest[];
  /** What the extension's store holds under the rebuild key, and the error its reading throws, if any. */
  intentStore: unknown;
  intentError: Error | undefined;
  configurationReads: Array<{
    target: CliTarget;
    containerId: string | undefined;
  }>;
  serverRequests: ServerRequest[];
  relayRequests: RelayRequest[];
  relays: Array<{
    closed: number;
    failListeners: Array<() => void>;
    hostPort: number;
  }>;
  stopped: number;
  revealed: number;
  /** What the shutdown helper was told, in order, and how many configuration reads had started at each message. */
  shutdownSent: ShutdownRequest[];
  readsAtShutdown: number[];
  /** What `docker inspect` prints of the container's metadata label; `fails` for an engine that does not answer. */
  metadata: string;
  /** What `docker inspect` prints of the container's published ports; `fails` for an engine that does not answer. */
  published: string;
  sink: MemorySink;
  /** The outcome of `prepare`; a function to hold it. */
  outcome: ContainerOutcome | (() => Promise<ContainerOutcome>);
  steps: ContainerStep[];
  cliEvents: CliEvent[];
  /** What the configuration read answers; a function to hold it or to change it from one read to the next. */
  configuration:
    | Awaited<ReturnType<CliBridge['readConfiguration']>>
    | (() => ReturnType<CliBridge['readConfiguration']>);
  /** The delay of each timer set, in order. */
  timerDelays: number[];
  /** The callbacks of the timers still pending. */
  timers: Array<() => void>;
  server: ServerResult | (() => Promise<ServerResult>);
  phasesOfServer: Array<'installing' | 'startingServer'>;
  /** The percents of the server download the server step reports. */
  percentsOfServer: number[];
  relayOutcome: 'open' | Failed;
  dockerPath: unknown;
  /** What the settings' `inspect` answers for the two `cacheVolume` settings; nothing, when the scene leaves it absent. */
  cacheVolumeInspect:
    {globalValue?: unknown; workspaceValue?: unknown} | undefined;
  /** The user's values of the workspace mount's consistency, of its deprecated twin and of the worktree setting. */
  workspaceMountConsistency: unknown;
  legacyWorkspaceMountConsistency: unknown;
  mountGitWorktreeCommonDir: unknown;
  /** The user's values of the setting for the extensions of a new container, and of its deprecated twin. */
  defaultFeatures: unknown;
  lockfile: unknown;
  defaultExtensions: unknown;
  deprecatedDefaultExtensions: unknown;
  /** The exit statuses of the next `kill -0` runs. */
  killStatuses: number[];
  /** What the runs over the channel were given on their input, as text. */
  killScripts: string[];
  /** What the environment probe's process does, and the probe scripts it was given. */
  probe: ProcessScript;
  probeScripts: string[];
  /** Holds the opening of the relay until it settles. */
  relayGate: (() => Promise<void>) | undefined;
  /** Whether the editor says the folder is trusted, and what its trust request answers: true, false or a refusal. */
  trusted: boolean;
  trustAnswer: boolean | Error | (() => Promise<boolean>);
  /** What the connect asked of the trust port, of the modal and of the window, in order. */
  trustCalls: string[];
  /** Whether the decline's modal stays open until the test ends it. */
  declinedHeld: boolean;
  /** Whether the decline's modal fails instead of ending with its OK. */
  declinedFails: boolean;
  /** The `setupAgain` calls the trust check made. */
  setupAgains: number;
  /** How many reads of the configuration had run, and how many engine calls had been made, when trust was read. */
  atTrust: {reads: number; engineCalls: number} | undefined;
  /** An answer of the engine for a call of a clone's bootstrap, before the scene's others; none to fall through. */
  bootstrapAnswer: (argv: readonly string[]) => EngineRunOutcome | undefined;
  /** What the connect asked of the volume dependencies, in order. */
  volumeCalls: string[];
  /** Whether the volume dependencies say the payload's source was typed. */
  typedSource: boolean;
  /** Whether the profile gives the clone's trust confirmation. */
  consentGiven: boolean;
  /** The background stages the lifecycles were made with, in order. */
  backgroundStages: Array<BackgroundStage | undefined>;
}

/** What a probe that worked prints: noise, the markers and two variables. */
const PROBE_OUTPUT =
  'motd\nremote-oss-env-probe-begin\nALPHA=probe\0BRAVO=probe\0\nremote-oss-env-probe-end\n';

/** A container prepared and ready. */
export const READY: Extract<ContainerOutcome, {kind: 'ready'}> = {
  kind: 'ready',
  containerId: 'c1c1c1c1c1c1c1c1',
  remoteUser: 'node',
  remoteWorkspaceFolder: '/workspaces/proj',
  volumeMounted: false,
  created: true,
};

/** A server that started. */
export const STARTED_SERVER: ServerResult = {
  kind: 'started',
  port: 41000,
  connectionToken: SECRET_TOKEN,
  processId: 77,
  reused: false,
  nodePath: '/home/node/.fixture-server/bin/abc123/node',
  relayPath: '/home/node/.fixture-server/relay.js',
};

/** Dialogs that show nothing and answer that nobody chose. */
function silentDialogs() {
  return {
    revealLog: () => undefined,
    openExternal: () => Promise.resolve(undefined),
    showError: () => Promise.resolve(undefined),
  };
}

/** Volume dependencies over the scene's bridge that record what they are asked. */
function volumeDependenciesOf(
  scene: Scene,
  bridge: CliBridge,
): VolumeConnectDependencies {
  return {
    bootstrapSettings: () => ({
      image: '',
      pull: false,
      socketPath: '/var/run/docker.sock',
    }),
    buildContext: () => {
      scene.volumeCalls.push('buildContext');
      return Promise.resolve({
        folder: '/ctx',
        dispose: () => Promise.resolve(),
      });
    },
    typed: payload => {
      scene.volumeCalls.push(`typed ${payload.slice(0, 8)}`);
      return scene.typedSource;
    },
    clearTyped: () => {
      scene.volumeCalls.push('clearTyped');
      return Promise.resolve();
    },
    bootstrapBridge: (bootstrap, workspace, environment, engine) => {
      scene.volumeCalls.push(
        `bootstrapBridge ${bootstrap} ${workspace.workspaceFolder} ${engine.dockerPath}`,
      );
      return bridge;
    },
    hostBridge: (configText, workspace) => {
      scene.volumeCalls.push(
        `hostBridge ${configText} ${workspace.workspaceMount}`,
      );
      return bridge;
    },
    recoveryConfigFile: volumeName =>
      `/tmp/recovery/${volumeName}/.devcontainer.json`,
    writeRecoveryFile: (file, text) => {
      scene.volumeCalls.push(
        `writeRecoveryFile ${file} ${String(text.length)}`,
      );
      return Promise.resolve();
    },
    standIn: () => {
      scene.volumeCalls.push('standIn');
      return Promise.resolve({
        folder: '/tmp/stand-in',
        dispose: () => {
          scene.volumeCalls.push('standIn disposed');
          return Promise.resolve();
        },
      });
    },
    exploreDefinition: () => {
      scene.volumeCalls.push('exploreDefinition');
      return Promise.resolve({
        folder: '/t/inspect-volume/1',
        configFile: '/t/inspect-volume/1/.devcontainer/devcontainer.json',
        text: '{}',
      });
    },
    showShallow: repository => {
      scene.volumeCalls.push(`showShallow ${repository}`);
    },
    consent: () => {
      scene.volumeCalls.push('consent');
      return Promise.resolve(scene.consentGiven);
    },
    addConfiguration: (bootstrap, folder) => {
      scene.volumeCalls.push(`addConfiguration ${bootstrap} ${folder}`);
      return Promise.resolve('written');
    },
  };
}

/** The connector over fakes, and the knobs that steer them. */
export function sceneOf(
  overrides: Partial<Pick<Scene, 'dockerPath'>> = {},
  options: {volumes?: boolean} = {},
): Scene {
  const sink = new MemorySink();
  const scene: Scene = {
    connector: undefined as unknown as ContainerConnector,
    folderExists: true,
    configurationExists: true,
    candidates: [],
    attemptsBegun: 0,
    engineCalls: [],
    engineFiles: [],
    cliEnvironments: [],
    inspect: {answer: {status: 'running', startedAt: '2026-10-14T10:00:00Z'}},
    version: {status: 0, stderr: ''},
    prepared: [],
    intentStore: undefined,
    intentError: undefined,
    configurationReads: [],
    serverRequests: [],
    relayRequests: [],
    relays: [],
    stopped: 0,
    revealed: 0,
    shutdownSent: [],
    readsAtShutdown: [],
    metadata: '',
    published: 'null',
    sink,
    outcome: READY,
    steps: [],
    cliEvents: [],
    configuration: {
      kind: 'configuration',
      configuration: {name: 'Proj'},
      workspaceFolder: '/workspaces/proj',
      workspaceMount: undefined,
      mergedConfiguration: undefined,
    },
    server: STARTED_SERVER,
    phasesOfServer: ['installing', 'startingServer'],
    percentsOfServer: [],
    relayOutcome: 'open',
    dockerPath: 'docker',
    cacheVolumeInspect: undefined,
    workspaceMountConsistency: undefined,
    legacyWorkspaceMountConsistency: undefined,
    mountGitWorktreeCommonDir: undefined,
    defaultFeatures: undefined,
    lockfile: undefined,
    defaultExtensions: undefined,
    deprecatedDefaultExtensions: undefined,
    killStatuses: [],
    killScripts: [],
    probe: process => {
      process.print(PROBE_OUTPUT);
      process.exit(0);
    },
    probeScripts: [],
    relayGate: undefined,
    trusted: true,
    trustAnswer: true,
    trustCalls: [],
    declinedHeld: false,
    declinedFails: false,
    setupAgains: 0,
    atTrust: undefined,
    timerDelays: [],
    timers: [],
    bootstrapAnswer: () => undefined,
    volumeCalls: [],
    typedSource: true,
    consentGiven: true,
    backgroundStages: [],
    ...overrides,
  };
  const kills = fakeEngine(
    ...Array.from({length: 8}, (): SpawnPlan => async process => {
      await process.stdinEnded;
      const script = process.stdin().toString('utf8');
      if (script.includes('remote-oss-env-probe-begin')) {
        scene.probeScripts.push(script);
        await scene.probe(process);
        return;
      }
      scene.killScripts.push(script);
      process.exit(scene.killStatuses.shift() ?? 0);
    }),
  );
  function runAnswer(argv: readonly string[]): EngineRunOutcome {
    const bootstrapAnswer = scene.bootstrapAnswer(argv);
    if (bootstrapAnswer !== undefined) {
      return bootstrapAnswer;
    }
    if (argv[0] === 'version') {
      return {
        kind: 'ran',
        status: scene.version.status,
        stdout: '',
        stderr: scene.version.stderr,
      };
    }
    if (argv[0] === 'inspect' && argv[4] === metadataArguments('')[4]) {
      return scene.metadata === 'fails'
        ? {
            kind: 'ran',
            status: 1,
            stdout: '',
            stderr: 'Error: No such container',
          }
        : {kind: 'ran', status: 0, stdout: `${scene.metadata}\n`, stderr: ''};
    }
    if (
      argv[0] === 'inspect' &&
      argv[4] === '{{json .NetworkSettings.Ports}}'
    ) {
      if (scene.published === 'unreachable') {
        return {kind: 'failed', detail: 'spawn docker ENOENT'};
      }
      return scene.published === 'fails'
        ? {
            kind: 'ran',
            status: 1,
            stdout: '',
            stderr: 'Error: No such container',
          }
        : {kind: 'ran', status: 0, stdout: `${scene.published}\n`, stderr: ''};
    }
    const {answer} = scene.inspect;
    if (answer === 'unreachable') {
      return {kind: 'failed', detail: 'spawn docker ENOENT'};
    }
    if (answer === 'missing') {
      return {
        kind: 'ran',
        status: 1,
        stdout: '',
        stderr: 'Error: No such container: c1',
      };
    }
    if (answer === 'refused') {
      return {
        kind: 'ran',
        status: 1,
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
      };
    }
    if (answer === 'incomplete') {
      return {
        kind: 'ran',
        status: 0,
        stdout: '{"Status":"running"}',
        stderr: '',
      };
    }
    if (answer === 'garbled') {
      return {kind: 'ran', status: 0, stdout: 'not json', stderr: ''};
    }
    return {
      kind: 'ran',
      status: 0,
      stdout: JSON.stringify({
        Status: answer.status,
        StartedAt: answer.startedAt,
      }),
      stderr: '',
    };
  }
  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: (argv, input, options: EngineOptions) => {
      scene.engineCalls.push({argv, environment: options.environment});
      return Promise.resolve(runAnswer(argv));
    },
    spawn: (argv, options) => {
      scene.engineCalls.push({argv, environment: options.environment});
      return kills.spawn(argv, options);
    },
  };
  const bridge: CliBridge = {
    // eslint-disable-next-line id-length -- the bridge's method is named up
    up: () => Promise.reject(new Error('the connector never runs up')),
    runUserCommands: () =>
      Promise.reject(new Error('the connector never runs user commands')),
    readConfiguration: (target, containerId, onEvent) => {
      scene.configurationReads.push({target, containerId});
      for (const event of scene.cliEvents) {
        onEvent(event);
      }
      return typeof scene.configuration === 'function'
        ? scene.configuration()
        : Promise.resolve(scene.configuration);
    },
    applyTemplate: () =>
      Promise.reject(new Error('the connector never applies a template')),
    outdated: () =>
      Promise.reject(new Error('the connector never checks versions')),
    templateMetadata: () =>
      Promise.reject(new Error('the connector never reads template metadata')),
  };
  const lifecycle: ContainerLifecycle = {
    prepare: async (request, onStep, onCliEvent) => {
      scene.prepared.push(request);
      for (const step of scene.steps) {
        onStep(step);
      }
      for (const event of scene.cliEvents) {
        onCliEvent(event);
      }
      return typeof scene.outcome === 'function'
        ? scene.outcome()
        : scene.outcome;
    },
    stopBackground: () => {
      scene.stopped += 1;
    },
  };
  let connections = 0;
  const dependencies: ContainerConnectorDependencies = {
    noEngineProgram: noEngineProgramOf(FIXTURE_STORAGE),
    clientPlatform: 'linux',
    pathExists: place =>
      Promise.resolve(
        place.endsWith('.json')
          ? scene.configurationExists
          : scene.folderExists,
      ),
    discoverConfigurations: () => Promise.resolve(scene.candidates),
    shutdown: {
      send: request => {
        scene.shutdownSent.push(request);
        scene.readsAtShutdown.push(scene.configurationReads.length);
        return Promise.resolve();
      },
    },
    newConnectionId: () => {
      connections += 1;
      return `connection-${String(connections)}`;
    },
    engineFor: file => {
      scene.engineFiles.push(file);
      return engine;
    },
    cliFor: environment => {
      scene.cliEnvironments.push(environment);
      return bridge;
    },
    lifecycleFor: (lifecycleEngine, lifecycleBridge, presenter, stage) => {
      scene.backgroundStages.push(stage);
      return lifecycle;
    },
    ...(options.volumes === true
      ? {volumes: volumeDependenciesOf(scene, bridge)}
      : {}),
    lifecyclePresenter: {
      output: () => undefined,
      backgroundStarted: () => undefined,
      ended: () => undefined,
      attachStdin: () => undefined,
      terminalSize: () => ({rows: 24, columns: 80}),
    },
    settings: () => ({
      dockerPath: scene.dockerPath,
      serverDownloadBaseUrl: undefined,
      serverDownloadFolder: undefined,
      defaultFeatures: scene.defaultFeatures,
      lockfile: scene.lockfile,
      cacheVolume: () =>
        cacheVolumeOf(
          scene.cacheVolumeInspect?.globalValue,
          scene.cacheVolumeInspect?.globalValue,
        ),
      workspaceMountConsistency: scene.workspaceMountConsistency,
      legacyWorkspaceMountConsistency: scene.legacyWorkspaceMountConsistency,
      mountGitWorktreeCommonDir: scene.mountGitWorktreeCommonDir,
      defaultExtensions: scene.defaultExtensions,
      deprecatedDefaultExtensions: scene.deprecatedDefaultExtensions,
    }),
    preflight: {
      logger: createLogger(sink, {minimumLevel: () => 'debug'}),
      searchPath: () => '/usr/bin',
      clock: () => 0,
      setTimer: (milliseconds, callback) => {
        scene.timerDelays.push(milliseconds);
        scene.timers.push(callback);
        return () => {
          scene.timers = scene.timers.filter(each => each !== callback);
        };
      },
      translate: template => template,
      dialogs: silentDialogs(),
    },
    get editorEnvironment() {
      return {
        HOME: '/home/u',
        GITHUB_TOKEN: 's3cr3t-token',
      };
    },
    intents: {
      get: () => {
        if (scene.intentError !== undefined) {
          throw scene.intentError;
        }
        return scene.intentStore;
      },
      update: (key, value) => {
        scene.intentStore = value;
        return Promise.resolve();
      },
    },
    trust: {
      isTrusted: () => {
        scene.trustCalls.push('isTrusted');
        return scene.trusted;
      },
      request: message => {
        scene.atTrust = {
          reads: scene.configurationReads.length,
          engineCalls: scene.engineCalls.length,
        };
        scene.trustCalls.push(`request ${message}`);
        const {trustAnswer} = scene;
        if (typeof trustAnswer === 'function') {
          return trustAnswer();
        }
        return typeof trustAnswer === 'boolean'
          ? Promise.resolve(trustAnswer)
          : Promise.reject(trustAnswer);
      },
    },
    trustNeeds: {
      translate: template => template,
      logger: createLogger(sink, {minimumLevel: () => 'debug'}),
      setupAgain: () => {
        scene.setupAgains += 1;
        return Promise.resolve();
      },
    },
    showDeclined: (message, detail) => {
      scene.trustCalls.push(`showDeclined ${message} | ${detail}`);
      if (scene.declinedHeld) {
        return new Promise<void>(() => undefined);
      }
      return scene.declinedFails
        ? Promise.reject(new Error('the modal failed'))
        : Promise.resolve();
    },
    beginAttempt: () => {
      scene.attemptsBegun += 1;
    },
    reopenLocally: hostPath => {
      scene.trustCalls.push(`reopenLocally ${hostPath}`);
      return Promise.resolve();
    },
    runServer: async request => {
      scene.serverRequests.push(request);
      for (const phase of scene.phasesOfServer) {
        request.onPhase(phase);
      }
      for (const percent of scene.percentsOfServer) {
        request.onDownloadPercent(percent);
      }
      return typeof scene.server === 'function' ? scene.server() : scene.server;
    },
    openRelay: async (request: RelayRequest) => {
      scene.relayRequests.push(request);
      await scene.relayGate?.();
      if (scene.relayOutcome !== 'open') {
        return Promise.resolve({
          kind: 'failed' as const,
          failure: scene.relayOutcome,
        });
      }
      const record = {
        closed: 0,
        failListeners: [] as Array<() => void>,
        hostPort: 41000 + scene.relays.length,
      };
      scene.relays.push(record);
      const relay: OpenRelay = {
        kind: 'open',
        hostPort: record.hostPort,
        close: () => {
          record.closed += 1;
        },
        onClosed: listener => {
          record.failListeners.push(listener);
        },
      };
      return Promise.resolve(relay);
    },
    clock: (() => {
      let now = 0;
      return () => {
        now += 25;
        return now;
      };
    })(),
    logger: createLogger(sink, {minimumLevel: () => 'debug'}),
    revealLog: () => {
      scene.revealed += 1;
    },
  };
  scene.connector = containerConnectorOf(dependencies);
  return scene;
}
