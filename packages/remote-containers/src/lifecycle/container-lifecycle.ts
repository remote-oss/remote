/**
 * @fileoverview The container of a connection: found by its labels when the folder has one, otherwise created by the
 * dev container CLI, then read back for the `vscode` volume. The lifecycle commands of the configuration go on in the
 * background once the container is ready.
 */

import type {Logger} from 'lib-log';
import type {CliBridge} from '../cli/cli-bridge.ts';
import type {CliTarget} from '../cli/cli-arguments.ts';
import type {CliEvent, CliFailure} from '../cli/cli-lines.ts';
import type {EngineHost} from '../engine/engine-host.ts';
import {hasVscodeVolume, inspectedFacts} from './inspect-lines.ts';
import {
  decide,
  discoveryArguments,
  idLabels,
  isLegacy,
  legacyDiscoveryArguments,
  type ContainerFacts,
} from './labels.ts';

const VOLUME_MOUNT = 'type=volume,source=vscode,target=/vscode';
const IDENTIFIER_LENGTH = 12;

/** The stages of a connection that the container takes part in. */
export type ContainerStep =
  'findingContainer' | 'startingContainer' | 'containerReady';

/** What a connection asks for. */
export interface ContainerRequest {
  folder: string;
  configFile: string;
  dockerPath: string;
  logLevel: 'info' | 'debug' | 'trace';
  /** Set when the window asked for a rebuild: the existing container is replaced, whatever its state. */
  rebuild?: {buildNoCache: boolean};
  /** Whether a container this run creates mounts the `vscode` volume (`dev.containers.cacheVolume`). */
  cacheVolume: boolean;
}

/** How the preparation ended. */
export type ContainerOutcome =
  | {
      kind: 'ready';
      containerId: string;
      remoteUser: string;
      remoteWorkspaceFolder: string;
      volumeMounted: boolean;
      created: boolean;
    }
  | {kind: 'unusable'; containerId: string; status: string}
  | {kind: 'discoveryFailed'; detail: string}
  | CliFailure;

/** Finds or creates the container of a folder. */
export interface ContainerLifecycle {
  prepare(
    request: ContainerRequest,
    onStep: (step: ContainerStep) => void,
    onCliEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
  ): Promise<ContainerOutcome>;
  /** Ends the background lifecycle commands this lifecycle started. */
  stopBackground(): void;
}

type EngineAnswer =
  | {kind: 'ok'; stdout: string}
  | {kind: 'failed'; detail: string; stderr: string};

type Discovery =
  | {kind: 'found'; containers: ContainerFacts[]}
  | {kind: 'vanished'}
  | {kind: 'discoveryFailed'; detail: string}
  | {kind: 'cancelled'};

/** Whether a signal has aborted; read again after each wait, since it can change while one waits. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** One `docker` run, reduced to its output or to the line that says why it failed. */
async function askEngine(
  engine: EngineHost,
  argv: readonly string[],
  cancellation: AbortSignal,
): Promise<EngineAnswer> {
  const outcome = await engine.run(argv, {kind: 'none'}, {cancellation});
  if (outcome.kind === 'failed') {
    return {kind: 'failed', detail: outcome.detail, stderr: outcome.detail};
  }
  if (outcome.status === 0) {
    return {kind: 'ok', stdout: outcome.stdout};
  }
  const firstLine = outcome.stderr.split('\n', 1).join('');
  return {
    kind: 'failed',
    detail:
      firstLine === ''
        ? `docker ended with status ${String(outcome.status)}`
        : firstLine,
    stderr: outcome.stderr,
  };
}

/** The two lines with which the engine's client says a container is gone, at the start of a line. */
const VANISHED_LINES = [
  'Error response from daemon: No such container: ',
  'Error: No such container: ',
];

/** Whether `stderr` has a line in which the engine says a container is gone; a line only mentioning it does not count. */
function vanishedIn(stderr: string): boolean {
  return stderr
    .split('\n')
    .map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .some(line => VANISHED_LINES.some(form => line.startsWith(form)));
}

/** Lists the containers made for a folder and reads their facts. */
async function discover(
  engine: EngineHost,
  folder: string,
  cancellation: AbortSignal,
): Promise<Discovery> {
  const identifiers: string[] = [];
  for (const query of [
    discoveryArguments(folder),
    legacyDiscoveryArguments(folder),
  ]) {
    const listed = await askEngine(engine, query, cancellation);
    if (isAborted(cancellation)) {
      return {kind: 'cancelled'};
    }
    if (listed.kind === 'failed') {
      return {kind: 'discoveryFailed', detail: listed.detail};
    }
    for (const identifier of listed.stdout.split('\n').filter(line => line !== '')) {
      if (!identifiers.includes(identifier)) {
        identifiers.push(identifier);
      }
    }
  }
  if (identifiers.length === 0) {
    return {kind: 'found', containers: []};
  }
  const inspected = await askEngine(
    engine,
    ['inspect', '--type', 'container', ...identifiers],
    cancellation,
  );
  if (isAborted(cancellation)) {
    return {kind: 'cancelled'};
  }
  if (inspected.kind === 'failed') {
    return vanishedIn(inspected.stderr)
      ? {kind: 'vanished'}
      : {kind: 'discoveryFailed', detail: inspected.detail};
  }
  const facts = inspectedFacts(inspected.stdout);
  return facts.kind === 'facts'
    ? {kind: 'found', containers: facts.containers}
    : facts;
}

/** Discovery, run a second time when a container vanished between the list and its inspection. */
async function discoverWithRetry(
  engine: EngineHost,
  folder: string,
  cancellation: AbortSignal,
): Promise<Exclude<Discovery, {kind: 'vanished'}>> {
  const first = await discover(engine, folder, cancellation);
  if (first.kind !== 'vanished') {
    return first;
  }
  const second = await discover(engine, folder, cancellation);
  return second.kind === 'vanished'
    ? {
        kind: 'discoveryFailed',
        detail: 'a container disappeared during discovery',
      }
    : second;
}

/** The lifecycle over an engine and the CLI. */
export function containerLifecycleOf(dependencies: {
  engine: EngineHost;
  cli: CliBridge;
  logger: Logger;
}): ContainerLifecycle {
  const {engine, cli: bridge, logger} = dependencies;
  let background: AbortController | undefined;

  async function volumeMounted(
    containerId: string,
    cancellation: AbortSignal,
  ): Promise<boolean> {
    const answer = await askEngine(
      engine,
      ['inspect', '--type', 'container', containerId],
      cancellation,
    );
    if (answer.kind === 'failed') {
      logger.warn(
        `could not read the mounts of the container: ${answer.detail}`,
      );
      return false;
    }
    return hasVscodeVolume(answer.stdout);
  }

  function startBackground(
    target: CliTarget,
    containerId: string,
    onCliEvent: (event: CliEvent) => void,
  ): void {
    background?.abort();
    const own = new AbortController();
    background = own;
    void bridge
      .runUserCommands(target, containerId, onCliEvent, own.signal)
      .then(result => {
        if (result.kind === 'done') {
          logger.info('the lifecycle commands finished');
        } else {
          const hook =
            result.kind === 'lifecycleFailed' ? ` (${result.hook})` : '';
          logger.warn(`the lifecycle commands failed: ${result.kind}${hook}`);
        }
      });
  }

  async function prepare(
    request: ContainerRequest,
    onStep: (step: ContainerStep) => void,
    onCliEvent: (event: CliEvent) => void,
    cancellation: AbortSignal,
  ): Promise<ContainerOutcome> {
    const {folder, configFile} = request;
    onStep('findingContainer');
    const discovery = await discoverWithRetry(engine, folder, cancellation);
    if (discovery.kind === 'cancelled') {
      return {kind: 'cancelled'};
    }
    if (discovery.kind !== 'found') {
      return discovery;
    }
    const decision = decide(folder, configFile, discovery.containers);
    if (decision.kind === 'unusable' && request.rebuild === undefined) {
      return decision;
    }
    onStep('startingContainer');
    const rebuilding = request.rebuild !== undefined;
    // a rebuild replaces the container with the current labels; a use keeps the labels its tier chose
    const targetIdLabels = rebuilding
      ? idLabels(folder, configFile)
      : decision.kind === 'use'
        ? decision.idLabels
        : idLabels(folder, configFile);
    // a rebuild removes a legacy container the CLI's remove would miss: the CLI only finds the labels it's given
    for (const container of discovery.containers) {
      if (rebuilding && isLegacy(folder, container)) {
        const removed = await askEngine(
          engine,
          ['rm', '--force', container.id],
          cancellation,
        );
        if (isAborted(cancellation)) {
          return {kind: 'cancelled'};
        }
        if (removed.kind === 'failed') {
          return {
            kind: 'discoveryFailed',
            detail: `the legacy container ${container.id.slice(0, IDENTIFIER_LENGTH)} couldn't be removed: ${removed.detail}`,
          };
        }
        logger.info(
          `rebuilding: removed the legacy container ${container.id.slice(0, IDENTIFIER_LENGTH)}`,
        );
      }
    }
    const target: CliTarget = {
      workspaceFolder: folder,
      configFile,
      dockerPath: request.dockerPath,
      idLabels: targetIdLabels,
      mountWorkspaceGitRoot: true,
      mounts: request.cacheVolume ? [VOLUME_MOUNT] : [],
      logLevel: request.logLevel,
    };
    if (rebuilding) {
      logger.info(
        `rebuilding: the dev container CLI removes ${discovery.containers.map(container => container.id.slice(0, IDENTIFIER_LENGTH)).join(', ') || 'no container'} first`,
      );
    }
    const upResult = await bridge.up(
      target,
      {
        removeExistingContainer: rebuilding,
        buildNoCache: request.rebuild?.buildNoCache ?? false,
      },
      onCliEvent,
      cancellation,
    );
    if (upResult.kind !== 'up') {
      return upResult;
    }
    if (
      !rebuilding &&
      decision.kind === 'use' &&
      decision.containerId !== upResult.containerId
    ) {
      logger.warn(
        `the dev container CLI used ${upResult.containerId.slice(0, IDENTIFIER_LENGTH)} where ${decision.containerId.slice(0, IDENTIFIER_LENGTH)} was chosen`,
      );
    }
    const mounted = await volumeMounted(upResult.containerId, cancellation);
    startBackground(target, upResult.containerId, onCliEvent);
    onStep('containerReady');
    return {
      kind: 'ready',
      containerId: upResult.containerId,
      remoteUser: upResult.remoteUser,
      remoteWorkspaceFolder: upResult.remoteWorkspaceFolder,
      volumeMounted: mounted,
      created: !discovery.containers.some(
        container => container.id === upResult.containerId,
      ),
    };
  }

  return {
    prepare,
    stopBackground: () => {
      background?.abort();
    },
  };
}
