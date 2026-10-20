/**
 * @fileoverview The connector the resolver host runs for every dev container resolve of the window: it checks the
 * engine, has the container found or made, has the server installed and started inside it, relays a port on the host's
 * loopback into it, and holds the connection until the window ends or connects again.
 */

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
  devContainerTargetOf,
} from '../authority/payload.ts';
import type {CliTarget} from '../cli/cli-arguments.ts';
import type {CliBridge} from '../cli/cli-bridge.ts';
import {
  type ConfigurationResult,
  type CliEvent,
  withoutControlSequences,
} from '../cli/cli-lines.ts';
import type {EngineHost} from '../engine/engine-host.ts';
import {type Executable, executableOf} from '../engine/executable.ts';
import {sourceTypesValid} from '../config/source-types.ts';
import {type PreflightDependencies, secondCheck} from '../engine/preflight.ts';
import {execChannelOf} from '../exec/exec-channel.ts';
import {
  type ContainerLifecycle,
  type ContainerOutcome,
  type ContainerStep,
  type LifecyclePresenter,
} from '../lifecycle/container-lifecycle.ts';
import {
  configurationEntries,
  effectiveExtensions,
  settingEntries,
} from '../extensions/extension-list.ts';
import {portAttributeSettings} from '../ports/port-attributes.ts';
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
import {withContext} from './context-engine.ts';
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
  containerSetupFailed,
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
}

/** The connector, with the identity the window's label reads. */
export interface ContainerConnector extends Connector {
  /** The container the window's last connect found and ended without a connection; nothing once a connect succeeds. */
  failedContainer(): FailedContainer | undefined;
  /** The identity of the connection the window holds; nothing before the first connect. */
  heldIdentity(): WindowIdentity | undefined;
  /** The ports the connection the window holds declared; nothing before the first connect. */
  heldPorts(): DeclaredPorts | undefined;
  /** The connection the window holds; nothing before the first connect, and nothing once it is given back. */
  heldConnection(): HeldConnection | undefined;
  /** Calls the listener when the connection the window holds is made or given back; gives the way to stop listening. */
  onHeldChanged(listener: () => void): () => void;
  /** The local path a URI of this window's container folder stands for; nothing otherwise. */
  canonicalPathOf(authority: string, path: string): Promise<string | undefined>;
}

/** What the connector is made from. */
export interface ContainerConnectorDependencies {
  /** The engine for the program a connect will spawn. */
  engineFor(file: string): EngineHost;
  /** The CLI bridge for the environment its processes get. */
  cliFor(environment: Readonly<Record<string, string | undefined>>): CliBridge;
  /** The container lifecycle over an engine and a CLI. */
  lifecycleFor(
    engine: EngineHost,
    cli: CliBridge,
    presenter: LifecyclePresenter,
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
  channel: HostChannel;
  server: StartedContainerServer;
  relay: OpenRelay;
  identity: WindowIdentity;
  connected: Connected;
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
  let checking = false;
  /** Each payload's configuration as read without a container, read once per payload for the canonical requests and the connect's check (windows contracts §3.2). */
  const reads = new Map<string, Promise<ConfigurationResult | undefined>>();

  /** Gives back the connection the window holds, and stops hearing its relay. */
  function releaseHeld(): void {
    const current = held;
    held = undefined;
    if (current !== undefined) {
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
    if (outcome.foundContainerId !== undefined) {
      failedContainer = {
        containerId: outcome.foundContainerId,
        paused: false,
      };
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
      engine:
        folder.context === undefined
          ? unwrapped
          : withContext(unwrapped, folder.context),
      bridge: dependencies.cliFor(
        folder.context === undefined
          ? dependencies.editorEnvironment
          : {...dependencies.editorEnvironment, DOCKER_CONTEXT: folder.context},
      ),
    };
  }

  /**
   * The workspace folder of `payload`'s configuration, read without a container by the first that asks, a canonical
   * request or the connect's start. It runs no repository code. A failed read is dropped, so the next request reads
   * again.
   */
  function readOf(
    payload: string,
    folder: DevContainerFolder,
    tools?: Tools,
  ): Promise<ConfigurationResult | undefined> {
    const kept = reads.get(payload);
    if (kept !== undefined) {
      return kept;
    }
    const readTools = tools ?? toolsOf(folder);
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
            `the configuration of ${folder.hostPath} could not be read: ${result.kind}`,
          );
          return undefined;
        }
        return result;
      });
    reads.set(payload, reading);
    return reading;
  }

  /** The read of `payload`, or nothing once the canonical request has waited its longest. */
  function readWithinCap(
    payload: string,
    folder: DevContainerFolder,
    tools?: Tools,
  ): Promise<ConfigurationResult | undefined> {
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

  /** The local path of `path` in the window of `authority`, which core keys the window's trust on. */
  async function canonicalPathOf(
    authority: string,
    path: string,
  ): Promise<string | undefined> {
    if (!authority.startsWith(AUTHORITY_PREFIX)) {
      return undefined;
    }
    const payload = authority.slice(AUTHORITY_PREFIX.length);
    const decoded = devContainerTargetOf(payload);
    if ('malformed' in decoded || decoded.kind === 'legacy') {
      return undefined;
    }
    const connection = held?.payload === payload ? held : undefined;
    const read =
      connection === undefined
        ? await readWithinCap(payload, decoded)
        : undefined;
    const root = connection?.remoteWorkspaceFolder ?? read?.workspaceFolder;
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
  ): Promise<boolean> {
    const {trustNeeds, trust} = dependencies;
    const outcome = await ensureTrusted(trust, {
      ...trustNeeds,
      commandTitle: 'the connect',
    });
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
    const tools = toolsOf(folder);
    const {settings, dockerPath, configFile, engine, bridge} = tools;
    const read = await readWithinCap(payload, folder, tools);
    if (!(await trustedFolder(folder, cancellation))) {
      return trustDeclined();
    }
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
        workspaceMountConsistency: workspaceMountConsistencyOf(
          settings.workspaceMountConsistency,
          settings.legacyWorkspaceMountConsistency,
        ),
        mountGitWorktreeCommonDir: mountGitWorktreeCommonDirOf(
          settings.mountGitWorktreeCommonDir,
        ),
        pausedRetry: takenPausedRetry,
        ...(rebuild === undefined
          ? {}
          : {rebuild: {buildNoCache: rebuild.buildNoCache}}),
      },
      (step: ContainerStep) => {
        logger.info(step === 'startingContainer' ? 'Starting container' : step);
      },
      logCliEvent,
      cancellation,
    );
    if (prepared.kind !== 'ready') {
      return failureOf(prepared);
    }
    failedContainer = {containerId: prepared.containerId, paused: false};
    if (isAborted(cancellation)) {
      return cancelled();
    }
    logger.info(
      `container ${shortId(prepared.containerId)} was ${prepared.created ? 'newly started' : 'already running'}`,
    );
    const configuration = await bridge.readConfiguration(
      cliTargetOf(folder, tools),
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
        `the configuration's name could not be read: ${configuration.kind}`,
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
        machineSettings: portAttributeSettings(merged),
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
          context: folder.context,
          dockerHost: dependencies.editorEnvironment.DOCKER_HOST,
        }),
      ),
      trusted: false,
    };
    held = {
      payload,
      hostPath: folder.hostPath,
      remoteWorkspaceFolder: prepared.remoteWorkspaceFolder,
      containerId: prepared.containerId,
      startedAt:
        started === 'missing' || started === 'unreachable'
          ? ''
          : started.startedAt,
      engine,
      channel,
      server,
      relay,
      identity: {name, context: folder.context},
      connected,
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
    relay.onClosed(() => {
      if (held === connection) {
        lost.tell();
      }
    });
    return connected;
  }

  return {
    async connect(input: ConnectInput): Promise<Connected | Failed> {
      const controller = new AbortController();
      running = controller;
      const began = dependencies.clock();
      logger.info('Resolving Remote');
      try {
        const target = input.target as ContainerTarget;
        if (input.isReconnection && held !== undefined) {
          return await reconnect(held, controller.signal);
        }
        releaseHeld();
        if (target.outer !== undefined) {
          return remoteEngine();
        }
        const decoded = devContainerTargetOf(target.payload);
        if ('malformed' in decoded || decoded.kind === 'legacy') {
          return malformedAuthority();
        }
        const result = await connectFresh(
          target.payload,
          decoded,
          controller,
          input,
        );
        return result;
      } finally {
        logger.info(
          `Resolving Remote: ${String(dependencies.clock() - began)} ms`,
        );
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
    heldPorts: () => held?.ports,
    heldConnection: () =>
      held === undefined
        ? undefined
        : {
            containerId: held.containerId,
            hostPath: held.hostPath,
            remoteWorkspaceFolder: held.remoteWorkspaceFolder,
            engine: held.engine,
          },
    canonicalPathOf,
    onHeldChanged: listener => heldChanges.subscribe(listener),
    onPhase: listener => phases.subscribe(listener),
    onTransportLost: listener => lost.subscribe(listener),
    onTransportClosed: listener => closed.subscribe(listener),
  };
}
