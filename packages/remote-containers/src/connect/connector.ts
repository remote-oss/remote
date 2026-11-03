/**
 * @fileoverview The connector the resolver host runs for every dev container resolve of the window: it checks the
 * engine, has the container found or made, has the server installed and started inside it, relays a port on the host's
 * loopback into it, and holds the connection until the window ends or connects again.
 */

import {join} from 'node:path';
import type {
  ConnectInput,
  ConnectPhase,
  Connected,
  Connector,
  ContainerTarget,
  Failed,
} from 'lib-authority';
import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {OverrideValue} from 'lib-product';
import {
  type DevContainerFolder,
  type DevContainerTarget,
  devContainerTargetOf,
  folderTargetOf,
} from '../authority/payload.ts';
import type {CliTarget} from '../cli/cli-arguments.ts';
import type {VolumeWorkspace} from '../cli/override-pre-pass.ts';
import {
  bootstrapRemoveArguments,
  type BootstrapSettings,
} from '../volumes/bootstrap.ts';
import type {BuildContext} from '../volumes/bootstrap-start.ts';
import {
  type DevContainerVolume,
  volumeTargetOf,
} from '../volumes/volume-payload.ts';
import {
  resolveVolume,
  type VolumeContainerRequest,
} from '../volumes/volume-resolve.ts';
import type {CliBridge} from '../cli/cli-bridge.ts';
import {
  type ConfigurationResult,
  type CliEvent,
  type CliFailure,
  cliDescriptionOf,
  cliFailureText,
  withoutControlSequences,
} from '../cli/cli-lines.ts';
import {featureFailureOf, requestedFeaturesOf} from '../cli/failing-feature.ts';
import type {EngineHost} from '../engine/engine-host.ts';
import {
  environmentOfPinned,
  engineLabelOf,
  type PinnedEngine,
  withEnvironment,
} from '../engine/effective-engine.ts';
import {
  engineBaseOf,
  type Executable,
  executableOf,
} from '../engine/executable.ts';
import {effectiveAction} from '../shutdown/effective-action.ts';
import type {EngineCoordinates} from '../shutdown/protocol.ts';
import {
  metadataArguments,
  recordedMetadataOf,
} from '../shutdown/recorded-metadata.ts';
import type {ShutdownMessenger} from '../shutdown/window-lease.ts';
import {sourceTypesValid} from '../config/source-types.ts';
import {type PreflightDependencies, secondCheck} from '../engine/preflight.ts';
import {execChannelOf} from '../exec/exec-channel.ts';
import {
  type BackgroundStage,
  type ContainerLifecycle,
  type ContainerOutcome,
  type ContainerRequest,
  type ContainerStep,
  type LifecyclePresenter,
} from '../lifecycle/container-lifecycle.ts';
import {
  configurationEntries,
  effectiveExtensions,
  settingEntries,
} from '../extensions/extension-list.ts';
import {portAttributeSettings} from '../ports/port-attributes.ts';
import {devPortOf} from './dev-port.ts';
import {idLabels} from '../lifecycle/labels.ts';
import {takeRebuildIntent} from '../open/rebuild-intent.ts';
import {takePausedRetry} from '../state/paused-retry.ts';
import type {IntentMemento} from '../state/timed-store.ts';
import {
  ensureTrusted,
  TRUST_TEMPLATES,
  type TrustNeeds,
  type TrustPort,
} from '../trust/trust-gate.ts';
import {
  extensionHostEnvironmentOf,
  type ProbeMode,
  probedEnvironmentOf,
  probeModeOf,
  probeScriptOf,
  remoteEnvironmentOf,
} from './remote-environment.ts';
import {
  cancelled,
  configurationInvalid,
  containerGone,
  commandFailed,
  containerSetupFailed,
  disallowedFeature,
  featureResolutionFailed,
  vscodeMountReserved,
  containerUnusable,
  engineCheckFailed,
  type FailedContainer,
  malformedAuthority,
  remoteEngine,
  transportLost,
  trustDeclined,
} from './failures.ts';
import type {OpenRelay, RelayRequest} from './host-relay.ts';
import {
  mountGitWorktreeCommonDirOf,
  workspaceMountConsistencyOf,
} from './mount-settings.ts';
import {featureSettingsOf} from './feature-settings.ts';
import {
  type ContainerState,
  type ReconnectionOutcome,
  reconnectionOutcomeOf,
} from './reconnection.ts';
import type {
  ServerRequest,
  ServerResult,
  StartedContainerServer,
} from './server-steps.ts';
import type {WindowIdentity} from './window-identity.ts';
import {reasonOf} from './extension-cache.ts';
import type {DeclaredPorts} from '../ports/declared-forwards.ts';
import {
  appPortOf,
  engineIsLocal,
  staticForwards,
} from '../ports/static-forwards.ts';

/** The CLI's levels for an info, a warning and an error event. */
const CLI_INFO_LEVEL = 3;
const CLI_WARNING_LEVEL = 4;
const CLI_ERROR_LEVEL = 5;

/** How many characters of a container's identifier the log shows. */
const IDENTIFIER_LENGTH = 12;

/** How long a canonical request waits for the configuration read, in milliseconds (windows contracts §3.2). */
const CANONICAL_READ_MILLISECONDS = 30_000;

/** How long the decline's modal waits for its OK before the folder reopens locally, in milliseconds. */
const DECLINED_MODAL_MILLISECONDS = 5000;

/** The authority prefix of a dev container window. */
const AUTHORITY_PREFIX = 'dev-container+';

/** What the connection the window holds says of itself, for the code that shows the window's own container. */
export interface HeldConnection {
  containerId: string;
  /** The local folder the container shows. */
  hostPath: string;
  /** The folder the container shows it at. */
  remoteWorkspaceFolder: string;
  /** The engine the connection was made with, whatever `dev.containers.dockerPath` says now. */
  engine: EngineHost;
  /** The local path of the configuration file the connection was made for. */
  configFile: string;
  /** Whether this connection created the container: a first build, a rebuild, or a build after it was removed. */
  created: boolean;
}

/** The connector, with the identity the window's label reads. */
export interface ContainerConnector extends Connector {
  /** The container the window's last connect found and ended without a connection; nothing once a connect succeeds. */
  failedContainer(): FailedContainer | undefined;
  /** The identity of the connection the window holds; nothing before the first connect. */
  heldIdentity(): WindowIdentity | undefined;
  /**
   * The identity the latest attempt read from its configuration, once the attempt's container was ready; none while it
   * wasn't, and none once the next attempt begins.
   */
  attemptIdentity(): WindowIdentity | undefined;
  /** The ports the connection the window holds declared; nothing before the first connect. */
  heldPorts(): DeclaredPorts | undefined;
  /** The connection the window holds; nothing before the first connect, and nothing once it is given back. */
  heldConnection(): HeldConnection | undefined;
  /** Calls the listener when the connection the window holds is made or given back; gives the way to stop listening. */
  onHeldChanged(listener: () => void): () => void;
  /**
   * Tells the shutdown helper about the connection this window is about to make, from the authority it was opened on and
   * before the connect starts: nothing for another kind of authority or a folder that is not trusted yet.
   */
  announceShutdown(authority: string | undefined): void;
  /** Tells the shutdown helper that the window leaves the container it holds, before the window reloads elsewhere. */
  leaveShutdown(): Promise<void>;
  /** The local path a URI of this window's container folder stands for; nothing otherwise. */
  canonicalPathOf(authority: string, path: string): Promise<string | undefined>;
}

/** What a connect to a clone in a volume needs beyond a folder's. */
export interface VolumeConnectDependencies {
  /** The bootstrap settings, read at every start. */
  bootstrapSettings(): BootstrapSettings;
  buildContext(): Promise<BuildContext>;
  /** Whether our record says the source of `payload` was typed. */
  typed(payload: string): boolean;
  clearTyped(payload: string): Promise<void>;
  /**
   * The bridge whose CLI runs in the bootstrap container, through `engine`'s program `dockerPath`, the configuration
   * rewritten for `workspace`.
   */
  bootstrapBridge(
    bootstrap: string,
    workspace: VolumeWorkspace,
    environment: Readonly<Record<string, string | undefined>>,
    engine: {host: EngineHost; dockerPath: string},
  ): CliBridge;
  /** The bridge on the host for the runs after `up`, over the configuration's text rewritten for `workspace`. */
  hostBridge(
    configText: string,
    workspace: VolumeWorkspace,
    environment: Readonly<Record<string, string | undefined>>,
  ): CliBridge;
  /** A fresh, empty folder on the host that the CLI is given as its workspace folder there. */
  standIn(): Promise<{folder: string; dispose(): Promise<void>}>;
  /** Shows that only the latest commits of `repository` were cloned. */
  showShallow(repository: string): void;
}

/** What the connector is made from. */
export interface ContainerConnectorDependencies {
  /** What a clone in a volume needs; without it, a volume payload is no authority the connector reads. */
  volumes?: VolumeConnectDependencies;
  /** Whether a file or a folder exists on this machine. */
  pathExists(place: string): Promise<boolean>;
  /** The program a read before the trust answer is given (see `noEngineProgramOf`). */
  noEngineProgram: string;
  /** The client's platform, as `process.platform` names it. */
  clientPlatform: string;
  /** The configuration files of a folder, in the order of the picker. */
  discoverConfigurations(
    folder: string,
  ): Promise<ReadonlyArray<{file: string}>>;
  /** The engine for the program a connect will spawn. */
  engineFor(file: string): EngineHost;
  /** The CLI bridge for the environment its processes get. */
  cliFor(environment: Readonly<Record<string, string | undefined>>): CliBridge;
  /** The container lifecycle over an engine and a CLI; a clone in a volume gives its background stage. */
  lifecycleFor(
    engine: EngineHost,
    cli: CliBridge,
    presenter: LifecyclePresenter,
    backgroundStage?: BackgroundStage,
  ): ContainerLifecycle;
  /** The settings this connector reads, at every connect. */
  settings(): {
    dockerPath: unknown;
    serverDownloadBaseUrl: OverrideValue | undefined;
    serverDownloadFolder: unknown;
    cacheVolume(): boolean;
    /** The user's value of `dev.containers.workspaceMountConsistency`, `undefined` when unset. */
    workspaceMountConsistency: unknown;
    /** The user's value of the deprecated `remote.containers.workspaceMountConsistency`, `undefined` when unset. */
    legacyWorkspaceMountConsistency: unknown;
    /** The user's value of `dev.containers.experimentalMountGitWorktreeCommonDir`, `undefined` when unset. */
    mountGitWorktreeCommonDir: unknown;
    /** The user's value of `dev.containers.defaultFeatures`, `undefined` when unset. */
    defaultFeatures: unknown;
    /** The user's value of `dev.containers.lockfile`, `undefined` when unset. */
    lockfile: unknown;
    /** The user's value of `dev.containers.defaultExtensions`, `undefined` when unset. */
    defaultExtensions: unknown;
    /** The user's value of the deprecated `remote.containers.defaultExtensions`, `undefined` when unset. */
    deprecatedDefaultExtensions: unknown;
  };
  /** What the second check needs besides the engine and the program. */
  preflight: Omit<PreflightDependencies, 'engineFor' | 'dockerPath'>;
  editorEnvironment: Readonly<Record<string, string | undefined>>;
  /** The server's steps over the channel, which the lib-server composition provides. */
  runServer(
    request: ServerRequest,
    settings: {
      serverDownloadBaseUrl: OverrideValue | undefined;
      serverDownloadFolder: unknown;
    },
  ): Promise<ServerResult>;
  /** The relay into the container, which the host's loopback listener provides. */
  openRelay(
    request: RelayRequest,
  ): Promise<OpenRelay | {kind: 'failed'; failure: Failed}>;
  /** What shows the lifecycle commands' terminal and progress. */
  lifecyclePresenter: LifecyclePresenter;
  /** The extension's own store, where a rebuild command left its intent. */
  intents: IntentMemento;
  /** The editor's workspace trust, which the connect asks before anything runs for the folder. */
  trust: TrustPort;
  trustNeeds: Omit<TrustNeeds, 'commandTitle'>;
  /** Shows the modal that says the folder is not trusted, with `detail` under it and one OK button; settles when it closes. */
  showDeclined(message: string, detail: string): Promise<void>;
  /** Opens `hostPath` as a local folder in this window. */
  reopenLocally(hostPath: string): Promise<void>;
  /** Starts the log of a new connect attempt, as the phase begins. */
  beginAttempt(): void;
  /** What tells the shutdown helper about this window's connection. */
  shutdown: ShutdownMessenger;
  /** A fresh id for each connection of the window to a container. */
  newConnectionId(): string;
  clock: () => number;
  logger: Logger;
  revealLog(): void;
}

/** A set of listeners that each hear what is told, as the arguments the listeners take. */
function subscribers<Arguments extends unknown[]>(): {
  subscribe(listener: (...told: Arguments) => void): () => void;
  tell(...told: Arguments): void;
} {
  const listeners = new Set<(...told: Arguments) => void>();
  return {
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    tell: (...told) => {
      for (const listener of [...listeners]) {
        try {
          listener(...told);
        } catch {
          // A listener's fault is its own; the others and the connect go on.
        }
      }
    },
  };
}

/** The local path of `path` when it is `root` or under it, `root` standing for `hostPath`; nothing otherwise. */
function mappedPath(
  root: string,
  hostPath: string,
  path: string,
): string | undefined {
  if (path === root) {
    return hostPath;
  }
  return path.startsWith(`${root}/`)
    ? hostPath + path.slice(root.length)
    : undefined;
}

/**
 * The program a read before the trust answer is given: a path in a folder of the extension's own that nothing creates,
 * so that no program is ever there to run, and the CLI's preload answers its spawns. A fixed path at a drive's root
 * would let another user plant a program where the preload does not reach.
 */
export function noEngineProgramOf(storageFolder: string): string {
  return join(storageFolder, 'no-engine', 'absent');
}

/** The settings, the program, the engine and the CLI of one folder. */
interface Tools {
  settings: ReturnType<ContainerConnectorDependencies['settings']>;
  /** The file that the engine and the CLI run: the setting's value, a relative one resolved against the folder. */
  dockerPath: string;
  configFile: string;
  engine: EngineHost;
  bridge: CliBridge;
}

/** The connection the window holds. */
interface Held {
  /** The authority's payload the connection was made for. */
  payload: string;
  /** The local folder the container shows. */
  hostPath: string;
  /** The folder the container shows it at, from the CLI's result (ADR-0009). */
  remoteWorkspaceFolder: string;
  containerId: string;
  startedAt: string;
  engine: EngineHost;
  /** The local path of the configuration file the connection was made for. */
  configFile: string;
  /** Whether the connect that made the connection created the container. */
  created: boolean;
  channel: HostChannel;
  server: StartedContainerServer;
  relay: OpenRelay;
  identity: WindowIdentity;
  connected: Connected;
  /** Ends when the connection is given back: what runs for the connection, the extensions cache's background step, stops then. */
  lifetime: AbortController;
  /** The ports the merged configuration declared when the connection was made; a reconnect keeps them. */
  ports: DeclaredPorts;
}

/** The state of a container, or why it is not known. */
type Inspected = ContainerState | 'unreachable';

/** The state of the container from `docker inspect`. */
async function inspectedState(
  engine: EngineHost,
  containerId: string,
  cancellation: AbortSignal,
): Promise<Inspected> {
  const outcome = await engine.run(
    [
      'inspect',
      '--type',
      'container',
      '--format',
      '{{json .State}}',
      containerId,
    ],
    {kind: 'none'},
    {cancellation},
  );
  if (outcome.kind !== 'ran') {
    return 'unreachable';
  }
  if (outcome.status !== 0) {
    return outcome.stderr.includes('No such') ? 'missing' : 'unreachable';
  }
  try {
    const state = JSON.parse(outcome.stdout) as {
      Status?: unknown;
      StartedAt?: unknown;
    };
    return typeof state.Status === 'string' &&
      typeof state.StartedAt === 'string'
      ? {status: state.Status, startedAt: state.StartedAt}
      : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/** The text of a container identifier the log shows. */
function shortId(containerId: string): string {
  return containerId.slice(0, IDENTIFIER_LENGTH);
}

/** Whether a signal has aborted; read again after each wait, since it can change while one waits. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** How long the environment probe may run. */
const PROBE_TIMEOUT_MS = 10_000;

/** Logs why the probe was dropped. */
function logDroppedProbe(logger: Logger, reason: string): void {
  logger.info(`the environment probe was dropped: ${reason}`);
}

/** The environment the remote user's shell exports, or undefined after a log line saying why the probe was dropped. */
async function probedEnvironment(
  channel: HostChannel,
  mode: Exclude<ProbeMode, 'none'>,
  cancellation: AbortSignal,
  logger: Logger,
  clock: () => number,
): Promise<Readonly<Record<string, string>> | undefined> {
  const started = clock();
  const lines: string[] = [];
  const outcome = await channel.runScript(
    {
      script: probeScriptOf(mode),
      interpreter: 'posixShell',
      environment: {},
      input: {kind: 'text', text: ''},
      cancellation: AbortSignal.any([
        cancellation,
        AbortSignal.timeout(PROBE_TIMEOUT_MS),
      ]),
    },
    line => {
      lines.push(line);
    },
  );
  if (outcome.kind === 'failed') {
    logDroppedProbe(logger, outcome.failure.kind);
    return undefined;
  }
  if (outcome.status !== 0) {
    logDroppedProbe(logger, `exit status ${String(outcome.status)}`);
    return undefined;
  }
  const environment = probedEnvironmentOf(lines.join('\n'));
  if (environment === undefined) {
    logDroppedProbe(logger, 'no end marker');
    return undefined;
  }
  logger.info(
    `the environment probe (${mode}) took ${String(clock() - started)} ms and gave ${String(Object.keys(environment).length)} variables`,
  );
  return environment;
}

/** The log line for one answer to a reconnecting window: what was found of the container and the server, and the outcome. */
function reconnectionLine(
  connection: Pick<Held, 'containerId' | 'startedAt'>,
  state: ContainerState,
  alive: boolean | undefined,
  outcome: ReconnectionOutcome,
): string {
  const status = state === 'missing' ? 'missing' : state.status;
  const start =
    state === 'missing'
      ? 'no start'
      : state.startedAt === connection.startedAt
        ? 'same start'
        : 'another start';
  const server = alive === undefined ? 'not checked' : alive ? 'alive' : 'down';
  return `reconnection: container ${shortId(connection.containerId)} is ${status}, ${start}, server ${server}: ${outcome}`;
}

/** The connector of Dev Containers. */
export function containerConnectorOf(
  dependencies: ContainerConnectorDependencies,
): ContainerConnector {
  const {logger} = dependencies;
  const phases = subscribers<[ConnectPhase]>();
  const lost = subscribers<[]>();
  const closed = subscribers<[]>();
  const heldChanges = subscribers<[]>();
  let running: AbortController | undefined;
  let lifecycle: ContainerLifecycle | undefined;
  let held: Held | undefined;
  let failedContainer: FailedContainer | undefined;
  /**
   * The identity the latest attempt read from its configuration, kept once the attempt's container was ready; nothing
   * while the container isn't, and nothing once the next attempt begins.
   */
  let attemptIdentity: WindowIdentity | undefined;
  /** The id the shutdown helper knows this window's connection by; nothing before the connect passed the trust gate. */
  let shutdownConnection: string | undefined;
  let checking = false;
  /** The reconnection attempts of core that this connector, one per window session, has answered (S286). */
  let reconnectionAttempts = 0;
  /** Each payload's configuration as read without a container, read once per payload for the canonical requests and the connect's check (windows contracts §3.2). */
  const reads = new Map<string, Promise<ConfigurationResult | CliFailure>>();

  /** Gives back the connection the window holds, and stops hearing its relay. */
  function releaseHeld(): void {
    const current = held;
    held = undefined;
    if (current !== undefined) {
      current.lifetime.abort();
      current.relay.close();
      heldChanges.tell();
    }
  }

  /** Tells whether the transport of `connection` is still good, after one of its relayed connections ended. */
  async function checkAfterClose(connection: Held): Promise<void> {
    if (checking) {
      return;
    }
    checking = true;
    try {
      const state = await inspectedState(
        connection.engine,
        connection.containerId,
        new AbortController().signal,
      );
      if (held !== connection || state === 'unreachable') {
        return;
      }
      const outcome = reconnectionOutcomeOf(connection, state, true);
      if (outcome === 'transportLost') {
        lost.tell();
      } else if (outcome === 'containerGone') {
        closed.tell();
      }
    } finally {
      checking = false;
    }
  }

  /** What a resolve answers when the window holds a connection and core reconnects. */
  async function reconnect(
    connection: Held,
    cancellation: AbortSignal,
  ): Promise<Connected | Failed> {
    const state = await inspectedState(
      connection.engine,
      connection.containerId,
      cancellation,
    );
    if (state === 'unreachable') {
      logger.info(
        `reconnection: container ${shortId(connection.containerId)} is unreachable, no start, server not checked: transportLost`,
      );
      return transportLost();
    }
    const alive =
      state !== 'missing' &&
      state.status === 'running' &&
      state.startedAt === connection.startedAt
        ? await serverAlive(connection, cancellation)
        : undefined;
    const outcome = reconnectionOutcomeOf(connection, state, alive);
    logger.info(reconnectionLine(connection, state, alive, outcome));
    if (outcome === 'held') {
      return connection.connected;
    }
    return outcome === 'containerGone' ? containerGone() : transportLost();
  }

  /** Whether the held server's process runs, asked over the held channel. */
  async function serverAlive(
    connection: Held,
    cancellation: AbortSignal,
  ): Promise<boolean> {
    const outcome = await connection.channel.runScript(
      {
        script: `kill -0 ${String(connection.server.processId)}`,
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation,
      },
      () => undefined,
    );
    return outcome.kind === 'exited' && outcome.status === 0;
  }

  /**
   * Writes a CLI event to the log: Docker's and BuildKit's own output (`raw`) as info lines, one per line of its text
   * and without control sequences or empty lines; a text by its level (info, warning, error, else debug), also without control sequences; progress as debug.
   */
  function logCliEvent(event: CliEvent): void {
    if (event.kind === 'progress') {
      logger.debug(`${event.name}: ${event.status}`);
      return;
    }
    const text = withoutControlSequences(event.text).trimEnd();
    if (event.type === 'raw') {
      for (const line of text.split(/\r?\n|\r/u)) {
        if (line.trim() !== '') {
          logger.info(line);
        }
      }
    } else if (event.level >= CLI_ERROR_LEVEL) {
      logger.error(text);
    } else if (event.level >= CLI_WARNING_LEVEL) {
      logger.warn(text);
    } else if (event.level >= CLI_INFO_LEVEL && event.type === 'text') {
      logger.info(text);
    } else {
      logger.debug(text);
    }
  }

  /** The failure a container outcome that is not ready ends the connect with. */
  function failureOf(
    outcome: Exclude<ContainerOutcome, {kind: 'ready'}>,
    requestedFeatures: readonly string[],
  ): Failed {
    if (outcome.kind === 'cancelled') {
      return cancelled();
    }
    if (outcome.kind === 'unusable') {
      failedContainer = {
        containerId: outcome.containerId,
        paused: outcome.status === 'paused',
      };
      return containerUnusable(outcome.status);
    }
    if (outcome.kind === 'reservedMount') {
      return vscodeMountReserved(outcome.property, outcome.target);
    }
    if (outcome.foundContainerId !== undefined) {
      failedContainer = {
        containerId: outcome.foundContainerId,
        paused: false,
      };
    }
    if (outcome.kind === 'disallowedFeature') {
      return disallowedFeature(
        outcome.featureId,
        outcome.stoppedContainer,
        outcome.learnMoreUrl,
      );
    }
    const unresolved =
      outcome.kind === 'setupFailed'
        ? featureFailureOf(requestedFeatures, outcome.message)
        : undefined;
    if (unresolved !== undefined) {
      return featureResolutionFailed(unresolved);
    }
    return containerSetupFailed(
      outcome.kind === 'setupFailed' ? outcome.refusal : undefined,
    );
  }

  /** What the CLI is told to read the configuration of the container's folder. */
  function cliTargetOf(
    folder: DevContainerFolder,
    tools: Pick<Tools, 'configFile' | 'dockerPath' | 'settings'>,
  ): CliTarget {
    return {
      workspaceFolder: folder.hostPath,
      configFile: tools.configFile,
      dockerPath: tools.dockerPath,
      idLabels: idLabels(folder.hostPath, tools.configFile),
      mountWorkspaceGitRoot: true,
      mountGitWorktreeCommonDir: mountGitWorktreeCommonDirOf(
        tools.settings.mountGitWorktreeCommonDir,
      ),
      features: featureSettingsOf(
        tools.settings.defaultFeatures,
        tools.settings.lockfile,
      ),
      mounts: [],
      logLevel: 'info',
    };
  }

  /** The extensions a new container's server installs, logged; the ones of the configuration, then the setting's. */
  function newContainerExtensions(
    mergedConfiguration: Record<string, unknown> | undefined,
    settings: ReturnType<ContainerConnectorDependencies['settings']>,
  ): string[] {
    const list = effectiveExtensions([
      ...configurationEntries(mergedConfiguration),
      ...settingEntries(
        settings.defaultExtensions,
        settings.deprecatedDefaultExtensions,
      ),
    ]);
    logger.info(
      list.length === 0
        ? 'no extensions to install'
        : `extensions to install in the new container: ${list.join(', ')}`,
    );
    return list;
  }

  /** The rebuild the window asked for before its reload, taken once on the first attempt of a connect. */
  async function takenRebuild(
    input: ConnectInput,
  ): Promise<{buildNoCache: boolean} | undefined> {
    if (input.attempt !== 1 || input.isReconnection) {
      return undefined;
    }
    try {
      const intent = await takeRebuildIntent(
        dependencies.intents,
        input.rawHostString,
        dependencies.clock(),
      );
      if (intent !== undefined) {
        logger.info(
          `the window asked for a rebuild (no cache: ${String(intent.buildNoCache)})`,
        );
      }
      return intent;
    } catch (error) {
      logger.warn(
        `the rebuild intent could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /** Takes the retry the failure dialog left for the paused container `containerId`; a store that fails is no retry. */
  async function takenPausedRetry(containerId: string): Promise<boolean> {
    try {
      const retried = await takePausedRetry(
        dependencies.intents,
        containerId,
        dependencies.clock(),
      );
      if (retried) {
        logger.info(
          `the window asked to retry the paused container ${shortId(containerId)}`,
        );
      }
      return retried;
    } catch (error) {
      logger.warn(
        `the paused retry could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** Tells the shutdown helper that this window's connection ends, if it has one registered, and forgets it. */
  async function leaveShutdown(): Promise<void> {
    const connectionId = shutdownConnection;
    shutdownConnection = undefined;
    if (connectionId !== undefined) {
      await dependencies.shutdown.send({type: 'leave', connectionId});
    }
  }

  /** The engine of `tools`, as the shutdown helper must reach it: the program and the variables that pick the engine. */
  function engineCoordinatesOf(
    folder: DevContainerFolder,
    tools: Pick<Tools, 'dockerPath'>,
  ): EngineCoordinates {
    return {
      dockerPath: tools.dockerPath,
      environment: environmentOfPinned(folder),
    };
  }

  /**
   * Tells the shutdown helper about this window's connection, once: a reconnection or a retry is the same connection.
   * It runs after the trust gate, so the helper never runs a folder's program for a folder that was not trusted. It
   * does not wait for the helper.
   */
  function registerWithShutdown(
    folder: DevContainerFolder,
    tools: Pick<Tools, 'configFile' | 'dockerPath'>,
  ): string {
    if (shutdownConnection !== undefined) {
      return shutdownConnection;
    }
    const connectionId = dependencies.newConnectionId();
    shutdownConnection = connectionId;
    void dependencies.shutdown.send({
      type: 'register',
      connectionId,
      identity: {hostPath: folder.hostPath, configFile: tools.configFile},
      engine: engineCoordinatesOf(folder, tools),
    });
    return connectionId;
  }

  /**
   * Tells the shutdown helper which container the connection holds and what its end owes it: the value recorded on the
   * container, or the file's when it has no metadata label. It does not wait for the helper.
   */
  async function tellShutdownContainer(
    connectionId: string,
    containerId: string,
    fileValue: unknown,
    engine: EngineHost,
    cancellation: AbortSignal,
  ): Promise<void> {
    const outcome = await engine.run(
      metadataArguments(containerId),
      {kind: 'none'},
      {cancellation},
    );
    const recorded =
      outcome.kind === 'ran' && outcome.status === 0
        ? recordedMetadataOf(outcome.stdout)
        : undefined;
    void dependencies.shutdown.send({
      type: 'container',
      connectionId,
      containerId,
      action: effectiveAction(recorded, fileValue),
    });
  }

  /** The settings, the program, the engine and the CLI a connect or a read of `folder` uses, made the same way for both. */
  function toolsOf(folder: DevContainerFolder): Tools {
    const settings = dependencies.settings();
    // With the folder as base, the setting always names a program: a relative value is the folder's file.
    const executable = executableOf(
      settings.dockerPath,
      folder.hostPath,
    ) as Extract<Executable, {kind: 'spawn'}>;
    const unwrapped = dependencies.engineFor(executable.file);
    return {
      settings,
      dockerPath: executable.file,
      configFile: folder.configFile.fsPath ?? folder.configFile.path,
      engine: withEnvironment(unwrapped, () => environmentOfPinned(folder)),
      bridge: dependencies.cliFor({
        ...dependencies.editorEnvironment,
        ...environmentOfPinned(folder),
      }),
    };
  }

  /**
   * The tools a read of the configuration uses. The CLI runs the Docker program it is given even for a read, and a
   * relative value of `dev.containers.dockerPath` is a file of the folder, which does not run before the window is
   * trusted: until then the read is given a program that does not exist and the CLI's preload answers its spawns with
   * nothing, so that the read consults no engine. Without a container id the CLI asks the engine only for the
   * container of the folder, so it reads the configuration as for a folder that has none.
   */
  function readToolsOf(tools: Tools, folder: DevContainerFolder): Tools {
    const relative =
      executableOf(tools.settings.dockerPath, undefined).kind === 'notFound';
    return relative &&
      executableOf(
        tools.settings.dockerPath,
        engineBaseOf({
          folder: folder.hostPath,
          trusted: dependencies.trust.isTrusted(),
        }),
      ).kind === 'notFound'
      ? {
          ...tools,
          dockerPath: dependencies.noEngineProgram,
          bridge: dependencies.cliFor({
            ...dependencies.editorEnvironment,
            ...environmentOfPinned(folder),
            REMOTE_OSS_NO_ENGINE: dependencies.noEngineProgram,
          }),
        }
      : tools;
  }

  /**
   * The workspace folder of `payload`'s configuration, read without a container by the first that asks, a canonical
   * request or the connect's start. It runs no repository code. A failed read gives its failure and is dropped, so
   * the next request reads again.
   */
  function readOf(
    payload: string,
    folder: DevContainerFolder,
    tools?: Tools,
  ): Promise<ConfigurationResult | CliFailure> {
    const kept = reads.get(payload);
    if (kept !== undefined) {
      return kept;
    }
    const readTools = readToolsOf(tools ?? toolsOf(folder), folder);
    const reading = readTools.bridge
      .readConfiguration(
        cliTargetOf(folder, readTools),
        undefined,
        () => undefined,
        new AbortController().signal,
      )
      .then(result => {
        if (result.kind !== 'configuration') {
          reads.delete(payload);
          logger.warn(
            `the configuration of ${folder.hostPath} could not be read: ${cliFailureText(result)}`,
          );
        }
        return result;
      });
    reads.set(payload, reading);
    return reading;
  }

  /** The read of `payload` or its failure, or nothing once the canonical request has waited its longest. */
  function readWithinCap(
    payload: string,
    folder: DevContainerFolder,
    tools?: Tools,
  ): Promise<ConfigurationResult | CliFailure | undefined> {
    return new Promise(resolve => {
      const stop = dependencies.preflight.setTimer(
        CANONICAL_READ_MILLISECONDS,
        () => {
          resolve(undefined);
        },
      );
      void readOf(payload, folder, tools).then(read => {
        stop();
        resolve(read);
      });
    });
  }

  /**
   * The folder a decoded payload names: itself for a folder target, and for the legacy host path the target that a
   * fresh Reopen of the folder would carry (the first configuration, since a resolve shows no picker). Nothing when the
   * folder doesn't exist or has no configuration.
   */
  async function folderOf(
    target: DevContainerTarget,
  ): Promise<DevContainerFolder | undefined> {
    if (target.kind === 'folder') {
      return target;
    }
    if (!(await dependencies.pathExists(target.hostPath))) {
      logger.info(`the folder ${target.hostPath} doesn't exist`);
      return undefined;
    }
    const candidates = await dependencies.discoverConfigurations(
      target.hostPath,
    );
    const folder = folderTargetOf(target, candidates);
    if (folder === undefined) {
      logger.info(
        `the folder ${target.hostPath} has no dev container configuration`,
      );
    } else if (candidates.length > 1) {
      logger.info(
        `the stored folder's entry names no configuration; using ${folder.configFile.path}`,
      );
    }
    return folder;
  }

  /** The local path of `path` in the window of `authority`, which core keys the window's trust on. */
  async function canonicalPathOf(
    authority: string,
    path: string,
  ): Promise<string | undefined> {
    if (!authority.startsWith(AUTHORITY_PREFIX)) {
      return undefined;
    }
    const payload = authority.slice(AUTHORITY_PREFIX.length);
    const target = devContainerTargetOf(payload);
    if ('malformed' in target) {
      return undefined;
    }
    // A folder target is read at once: the timer of its read starts in this tick.
    const decoded = target.kind === 'folder' ? target : await folderOf(target);
    if (decoded === undefined) {
      return undefined;
    }
    const connection = held?.payload === payload ? held : undefined;
    const read =
      connection === undefined
        ? await readWithinCap(payload, decoded)
        : undefined;
    const root =
      connection?.remoteWorkspaceFolder ??
      (read?.kind === 'configuration' ? read.workspaceFolder : undefined);
    const local =
      root === undefined ? undefined : mappedPath(root, decoded.hostPath, path);
    if (local !== undefined) {
      logger.debug(
        `the canonical path of ${path} is ${local} (from ${connection === undefined ? 'the configuration read' : 'the connection'})`,
      );
    }
    return local;
  }

  /** Shows the decline's modal and waits for its end, or for `DECLINED_MODAL_MILLISECONDS`, whichever comes first. */
  function declinedModalWait(): Promise<void> {
    const {trustNeeds} = dependencies;
    return new Promise(resolve => {
      const stop = dependencies.preflight.setTimer(
        DECLINED_MODAL_MILLISECONDS,
        () => {
          resolve();
        },
      );
      function ended(): void {
        stop();
        resolve();
      }
      void dependencies
        .showDeclined(
          trustNeeds.translate(TRUST_TEMPLATES.S360),
          trustNeeds.translate(TRUST_TEMPLATES.S377),
        )
        .then(ended, ended);
    });
  }

  /**
   * Whether the folder is trusted, asking the editor when it isn't yet. A folder that stays untrusted is opened as a
   * local folder in this window, with the modal that says why when the user declined, for as long as its OK or five
   * seconds take.
   */
  async function trustedFolder(
    folder: DevContainerFolder,
    cancellation: AbortSignal,
    trustedAtStart: boolean,
  ): Promise<boolean> {
    const {trustNeeds, trust} = dependencies;
    const outcome = await ensureTrusted(
      {request: trust.request.bind(trust), isTrusted: () => trustedAtStart},
      {
        ...trustNeeds,
        commandTitle: 'the connect',
      },
    );
    if (outcome === 'trusted') {
      return true;
    }
    if (!isAborted(cancellation)) {
      if (outcome === 'declined') {
        await declinedModalWait();
      }
      await dependencies.reopenLocally(folder.hostPath);
    }
    return false;
  }

  async function connectFresh(
    payload: string,
    folder: DevContainerFolder,
    controller: AbortController,
    input: ConnectInput,
  ): Promise<Connected | Failed> {
    const cancellation = controller.signal;
    failedContainer = undefined;
    attemptIdentity = undefined;
    if (!(await dependencies.pathExists(folder.hostPath))) {
      logger.info(`the folder ${folder.hostPath} doesn't exist`);
      return containerSetupFailed();
    }
    const tools = toolsOf(folder);
    const {settings, dockerPath, configFile, engine, bridge} = tools;
    // A folder that is trusted already counts as connecting from the start; one that is not waits for its answer.
    const trustedAtStart = dependencies.trust.isTrusted();
    if (trustedAtStart) {
      registerWithShutdown(folder, tools);
    }
    const reading = await readWithinCap(payload, folder, tools);
    const read = reading?.kind === 'configuration' ? reading : undefined;
    if (!(await trustedFolder(folder, cancellation, trustedAtStart))) {
      return trustDeclined();
    }
    const connectionId = registerWithShutdown(folder, tools);
    phases.tell({name: 'initializing'});
    const checked = await secondCheck(
      {
        ...dependencies.preflight,
        engineFor: () => engine,
        dockerPath: () => settings.dockerPath,
      },
      folder.hostPath,
      cancellation,
    );
    if (checked.kind === 'failed') {
      return engineCheckFailed(checked.detail);
    }
    // A read that failed with the engine answering is the CLI's own failure, unless its configuration is gone; one
    // that ran out of time is not.
    if (
      reading !== undefined &&
      reading.kind !== 'configuration' &&
      reading.kind !== 'cancelled'
    ) {
      return (await dependencies.pathExists(configFile))
        ? commandFailed(cliDescriptionOf(reading))
        : containerSetupFailed();
    }
    if (read !== undefined && !sourceTypesValid(read.configuration)) {
      // The next attempt reads the file again, so a fix the user saves is seen by Retry.
      reads.delete(payload);
      logger.error(
        `the configuration ${configFile} is not valid: its image or Dockerfile entry is not a string`,
      );
      return configurationInvalid(configFile);
    }
    lifecycle = dependencies.lifecycleFor(
      engine,
      bridge,
      dependencies.lifecyclePresenter,
    );
    const rebuild = await takenRebuild(input);
    const prepared = await lifecycle.prepare(
      {
        folder: folder.hostPath,
        configFile,
        dockerPath,
        logLevel: 'info',
        cacheVolume: settings.cacheVolume(),
        windowsClient: dependencies.clientPlatform === 'win32',
        workspaceMountConsistency: workspaceMountConsistencyOf(
          settings.workspaceMountConsistency,
          settings.legacyWorkspaceMountConsistency,
        ),
        mountGitWorktreeCommonDir: mountGitWorktreeCommonDirOf(
          settings.mountGitWorktreeCommonDir,
        ),
        features: featureSettingsOf(
          settings.defaultFeatures,
          settings.lockfile,
          read?.configuration.features,
        ),
        mounts: Array.isArray(read?.configuration.mounts)
          ? read.configuration.mounts
          : [],
        runArgs: Array.isArray(read?.configuration.runArgs)
          ? read.configuration.runArgs
          : [],
        workspaceMount: read?.configuration.workspaceMount,
        pausedRetry: takenPausedRetry,
        ...(rebuild === undefined
          ? {}
          : {rebuild: {buildNoCache: rebuild.buildNoCache}}),
      },
      logStep,
      logCliEvent,
      cancellation,
    );
    if (prepared.kind !== 'ready') {
      return failureOf(
        prepared,
        requestedFeaturesOf(
          read?.configuration.features,
          settings.defaultFeatures,
        ),
      );
    }
    failedContainer = {containerId: prepared.containerId, paused: false};
    if (read !== undefined) {
      const readName = read.configuration.name;
      attemptIdentity = {
        name: typeof readName === 'string' ? readName : undefined,
        context: folder.context,
      };
    }
    return connectPrepared(
      {
        payload,
        prepared,
        engine,
        bridge,
        cliTarget: cliTargetOf(folder, tools),
        settings,
        pinned: folder,
        shutdownAction: read?.configuration.shutdownAction,
        connectionId,
        hostPath: folder.hostPath,
        configFile: folder.configFile.fsPath ?? folder.configFile.path,
        trusted: false,
      },
      cancellation,
    );
  }

  /** What the last part of a connect needs of the target it connects, once its container is ready. */
  interface PreparedContext {
    payload: string;
    prepared: Extract<ContainerOutcome, {kind: 'ready'}>;
    engine: EngineHost;
    /** The CLI and its target for the reads after `up`. */
    bridge: CliBridge;
    cliTarget: CliTarget;
    settings: Tools['settings'];
    /** The engine the window is pinned to. */
    pinned: PinnedEngine;
    /** The configuration file's `shutdownAction`, for a container that records none. */
    shutdownAction: unknown;
    /** The connection the shutdown helper knows; none when it knows none. */
    connectionId: string | undefined;
    hostPath: string;
    configFile: string;
    /** Whether the window is trusted by the connection itself. */
    trusted: boolean;
  }

  /** Reads the merged configuration, installs and starts the server, relays its port, and holds the connection. */
  async function connectPrepared(
    context: PreparedContext,
    cancellation: AbortSignal,
  ): Promise<Connected | Failed> {
    const {payload, prepared, engine, bridge, settings, connectionId} = context;
    if (isAborted(cancellation)) {
      return cancelled();
    }
    logger.info(
      `container ${shortId(prepared.containerId)} was ${prepared.created ? 'newly started' : 'already running'}`,
    );
    if (connectionId !== undefined) {
      await tellShutdownContainer(
        connectionId,
        prepared.containerId,
        context.shutdownAction,
        engine,
        cancellation,
      );
    }
    const configuration = await bridge.readConfiguration(
      context.cliTarget,
      prepared.containerId,
      logCliEvent,
      cancellation,
    );
    const merged =
      configuration.kind === 'configuration'
        ? configuration.mergedConfiguration
        : undefined;
    const defaultExtensions = prepared.created
      ? newContainerExtensions(merged, settings)
      : [];
    let name: string | undefined;
    if (configuration.kind === 'configuration') {
      const written = configuration.configuration.name;
      name = typeof written === 'string' ? written : undefined;
    } else {
      logger.warn(
        `the configuration's name could not be read: ${cliFailureText(configuration)}`,
      );
    }
    const channel = execChannelOf(
      engine,
      prepared.containerId,
      prepared.remoteUser,
    );
    const server = await dependencies.runServer(
      {
        channel,
        rootChannel: execChannelOf(engine, prepared.containerId, 'root'),
        remoteUser: prepared.remoteUser,
        volumeMounted: prepared.volumeMounted,
        defaultExtensions,
        devPort: devPortOf(merged),
        machineSettings: portAttributeSettings(merged),
        created: prepared.created,
        onPhase: phase => {
          phases.tell({name: phase});
        },
        onDownloadPercent: percent => {
          phases.tell({name: 'serverDownloadPercent', percent});
        },
        cancellation,
      },
      settings,
    );
    if (server.kind === 'failed') {
      return server.failure;
    }
    if (isAborted(cancellation)) {
      return cancelled();
    }
    const mode = probeModeOf(merged);
    const remoteEnvironment = remoteEnvironmentOf(merged);
    for (const name of remoteEnvironment.dropped) {
      logger.warn(`remoteEnv ${name} is neither a string nor null`);
    }
    const probed =
      mode === 'none'
        ? undefined
        : await probedEnvironment(
            channel,
            mode,
            cancellation,
            logger,
            dependencies.clock,
          );
    if (isAborted(cancellation)) {
      return cancelled();
    }
    const owner: {connection?: Held} = {};
    const relay = await dependencies.openRelay({
      engine,
      containerId: prepared.containerId,
      remoteUser: prepared.remoteUser,
      nodePath: server.nodePath,
      relayPath: server.relayPath,
      containerPort: server.port,
      onConnectionClosed: () => {
        const {connection} = owner;
        if (connection !== undefined && held === connection) {
          void checkAfterClose(connection);
        }
      },
    });
    if (relay.kind === 'failed') {
      return relay.failure;
    }
    const started = await inspectedState(
      engine,
      prepared.containerId,
      cancellation,
    );
    if (isAborted(cancellation)) {
      // The window was torn down while the connect finished: give the relay back.
      relay.close();
      return cancelled();
    }
    const connected: Connected = {
      address: {host: '127.0.0.1', port: relay.hostPort},
      connectionToken: server.connectionToken,
      extensionHostEnv: extensionHostEnvironmentOf(
        probed,
        remoteEnvironment.entries,
      ),
      environmentTunnels: staticForwards(
        configuration.kind === 'configuration'
          ? appPortOf(configuration.configuration)
          : undefined,
        engineIsLocal({
          context: context.pinned.context,
          dockerHost: context.pinned.host,
        }),
      ),
      trusted: context.trusted,
    };
    held = {
      payload,
      hostPath: context.hostPath,
      remoteWorkspaceFolder: prepared.remoteWorkspaceFolder,
      containerId: prepared.containerId,
      startedAt:
        started === 'missing' || started === 'unreachable'
          ? ''
          : started.startedAt,
      engine,
      configFile: context.configFile,
      created: prepared.created,
      channel,
      server,
      relay,
      identity: {name, context: engineLabelOf(context.pinned)},
      connected,
      lifetime: new AbortController(),
      ports: {
        forwardPorts: merged?.forwardPorts,
        portsAttributes: merged?.portsAttributes,
        otherPortsAttributes: merged?.otherPortsAttributes,
      },
    };
    const connection = held;
    owner.connection = connection;
    failedContainer = undefined;
    heldChanges.tell();
    server.afterReady?.(connection.lifetime.signal).catch((caught: unknown) => {
      logger.info(`the extensions cache stopped: ${reasonOf(caught)}`);
    });
    relay.onClosed(() => {
      if (held === connection) {
        lost.tell();
      }
    });
    return connected;
  }

  /** Logs a step of the container's preparation. */
  function logStep(step: ContainerStep): void {
    logger.info(step === 'startingContainer' ? 'Starting container' : step);
  }

  /** The options of `up` a clone in a volume gives the lifecycle, beyond its folder, file and labels. */
  function volumeRequestOf(
    request: VolumeContainerRequest,
    settings: Tools['settings'],
    rebuild: {buildNoCache: boolean} | undefined,
  ): ContainerRequest {
    return {
      folder: request.folder,
      configFile: request.configFile,
      idLabels: request.idLabels,
      dockerPath: 'docker',
      logLevel: 'info',
      cacheVolume: settings.cacheVolume(),
      workspaceMountConsistency: workspaceMountConsistencyOf(
        settings.workspaceMountConsistency,
        settings.legacyWorkspaceMountConsistency,
      ),
      mountGitWorktreeCommonDir: false,
      features: featureSettingsOf(
        settings.defaultFeatures,
        settings.lockfile,
        undefined,
      ),
      mounts: [],
      runArgs: [],
      windowsClient: dependencies.clientPlatform === 'win32',
      workspaceMount: undefined,
      pausedRetry: takenPausedRetry,
      ...(rebuild === undefined ? {} : {rebuild}),
    };
  }

  /**
   * Connects a clone in a volume: the bootstrap container clones and runs `up`, and the CLI on the host, given a stand-in
   * folder, does the reads and the background commands after it, so that the bootstrap can go once connected.
   */
  async function connectVolume(
    volumes: VolumeConnectDependencies,
    payload: string,
    target: DevContainerVolume,
    controller: AbortController,
    input: ConnectInput,
  ): Promise<Connected | Failed> {
    const cancellation = controller.signal;
    failedContainer = undefined;
    attemptIdentity = undefined;
    const settings = dependencies.settings();
    const executable = executableOf(settings.dockerPath, undefined);
    if (executable.kind !== 'spawn') {
      logger.info('dev.containers.dockerPath names no program');
      return engineCheckFailed('S339');
    }
    const environment = environmentOfPinned(target);
    const engine = withEnvironment(
      dependencies.engineFor(executable.file),
      () => environment,
    );
    phases.tell({name: 'initializing'});
    const checked = await secondCheck(
      {
        ...dependencies.preflight,
        engineFor: () => engine,
        dockerPath: () => settings.dockerPath,
      },
      undefined,
      cancellation,
    );
    if (checked.kind === 'failed') {
      return engineCheckFailed(checked.detail);
    }
    const cliEnvironment = {...dependencies.editorEnvironment, ...environment};
    const dockerFile = executable.file;
    const rebuild = await takenRebuild(input);
    const standIn = await volumes.standIn();
    /** The CLI on the host and its target, for the runs after `up`: the stand-in folder, the host's Docker program. */
    function hostPassOf(
      request: VolumeContainerRequest,
      configText: string,
    ): {bridge: CliBridge; target: CliTarget} {
      return {
        bridge: volumes.hostBridge(
          configText,
          request.workspace,
          cliEnvironment,
        ),
        target: {
          workspaceFolder: standIn.folder,
          configFile: join(
            standIn.folder,
            request.configFile.slice(request.folder.length + 1),
          ),
          dockerPath: dockerFile,
          idLabels: request.idLabels,
          mountWorkspaceGitRoot: true,
          mountGitWorktreeCommonDir: false,
          features: featureSettingsOf(
            settings.defaultFeatures,
            settings.lockfile,
          ),
          mounts: [],
          logLevel: 'info',
        },
      };
    }
    const resolution = await resolveVolume(
      {
        engine,
        options: {cancellation},
        logger,
        settings: () => volumes.bootstrapSettings(),
        buildContext: () => volumes.buildContext(),
        typed: typedPayload => volumes.typed(typedPayload),
        clearTyped: typedPayload => volumes.clearTyped(typedPayload),
        onCloning: () => {
          logger.info('Cloning Repository');
          phases.tell({name: 'cloningRepository'});
        },
        prepare: (bootstrap, request, configText) => {
          const pass = hostPassOf(request, configText);
          lifecycle = dependencies.lifecycleFor(
            engine,
            volumes.bootstrapBridge(
              bootstrap,
              request.workspace,
              cliEnvironment,
              {
                host: engine,
                dockerPath: dockerFile,
              },
            ),
            dependencies.lifecyclePresenter,
            {
              // eslint-disable-next-line id-length -- the stage's bridge is named cli, as the lifecycle's own
              cli: pass.bridge,
              targetOf: upTarget => ({...upTarget, ...pass.target}),
              ended: () => {
                void standIn.dispose();
              },
            },
          );
          return lifecycle.prepare(
            volumeRequestOf(request, settings, rebuild),
            logStep,
            logCliEvent,
            cancellation,
          );
        },
      },
      payload,
      target,
    );
    if (resolution.kind !== 'prepared') {
      await standIn.dispose();
      return resolution.kind === 'failed'
        ? resolution.failure
        : failureOf(resolution.outcome, []);
    }
    const pass = hostPassOf(resolution.request, resolution.configText);
    const connected = await connectPrepared(
      {
        payload,
        prepared: resolution.outcome,
        engine,
        bridge: pass.bridge,
        cliTarget: pass.target,
        settings,
        pinned: target,
        shutdownAction: undefined,
        connectionId: undefined,
        hostPath: '',
        configFile: resolution.request.configFile,
        trusted: true,
      },
      cancellation,
    );
    void engine.run(
      bootstrapRemoveArguments(resolution.bootstrap),
      {kind: 'none'},
      {cancellation: new AbortController().signal},
    );
    if ('connectionToken' in connected && resolution.shallow) {
      volumes.showShallow(target.repositoryPath);
    }
    return connected;
  }

  return {
    async connect(input: ConnectInput): Promise<Connected | Failed> {
      const controller = new AbortController();
      running = controller;
      const began = dependencies.clock();
      if (input.isReconnection) {
        reconnectionAttempts += 1;
      }
      const phase = input.isReconnection
        ? `Reconnection attempt ${String(reconnectionAttempts)}`
        : 'Resolving Remote';
      dependencies.beginAttempt();
      logger.info(phase);
      try {
        const target = input.target as ContainerTarget;
        if (input.isReconnection && held !== undefined) {
          return await reconnect(held, controller.signal);
        }
        releaseHeld();
        if (target.outer !== undefined) {
          return remoteEngine();
        }
        const stored = devContainerTargetOf(target.payload);
        const volume = volumeTargetOf(target.payload);
        if (volume !== undefined && dependencies.volumes !== undefined) {
          const result = await connectVolume(
            dependencies.volumes,
            target.payload,
            volume,
            controller,
            input,
          );
          if (!('connectionToken' in result)) {
            await leaveShutdown();
          }
          return result;
        }
        if ('malformed' in stored) {
          return malformedAuthority();
        }
        const decoded = await folderOf(stored);
        if (decoded === undefined) {
          return containerSetupFailed();
        }
        const result = await connectFresh(
          target.payload,
          decoded,
          controller,
          input,
        );
        if (!('connectionToken' in result)) {
          // A window that shows a failure does not hold its container: its connection ends here, and a retry is a new one.
          await leaveShutdown();
        }
        return result;
      } finally {
        logger.info(`${phase}: ${String(dependencies.clock() - began)} ms`);
        if (running === controller) {
          running = undefined;
        }
      }
    },
    cancel() {
      running?.abort();
      running = undefined;
      lifecycle?.stopBackground();
      releaseHeld();
    },
    revealDetails() {
      dependencies.revealLog();
    },
    failedContainer: () => failedContainer,
    heldIdentity: () => held?.identity,
    attemptIdentity: () => attemptIdentity,
    heldPorts: () => held?.ports,
    heldConnection: () =>
      held === undefined
        ? undefined
        : {
            containerId: held.containerId,
            hostPath: held.hostPath,
            remoteWorkspaceFolder: held.remoteWorkspaceFolder,
            engine: held.engine,
            configFile: held.configFile,
            created: held.created,
          },
    announceShutdown: authority => {
      const decoded =
        authority?.startsWith(AUTHORITY_PREFIX) === true
          ? devContainerTargetOf(authority.slice(AUTHORITY_PREFIX.length))
          : undefined;
      if (
        decoded !== undefined &&
        !('malformed' in decoded) &&
        decoded.kind !== 'legacy' &&
        dependencies.trust.isTrusted()
      ) {
        registerWithShutdown(decoded, toolsOf(decoded));
      }
    },
    leaveShutdown,
    canonicalPathOf,
    onHeldChanged: listener => heldChanges.subscribe(listener),
    onPhase: listener => phases.subscribe(listener),
    onTransportLost: listener => lost.subscribe(listener),
    onTransportClosed: listener => closed.subscribe(listener),
  };
}
