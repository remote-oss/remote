/**
 * @fileoverview C12's container step of an attached connect: find the container, check that it runs, set it up through
 * the CLI and add `libstdc++` on Alpine. It never starts a container by itself; a container that does not run ends the
 * step with the failure whose dialog offers to start it.
 */

import type {Failed} from 'lib-authority';
import type {Logger} from 'lib-log';
import type {AttachedCliTarget} from '../cli/cli-arguments.ts';
import type {CliBridge} from '../cli/cli-bridge.ts';
import {type CliEvent, cliFailureText} from '../cli/cli-lines.ts';
import {
  attachedNotFound,
  attachedNotRunning,
  attachFailed,
} from '../connect/failures.ts';
import type {EngineHost} from '../engine/engine-host.ts';
import type {PinnedEngine} from '../engine/effective-engine.ts';
import type {ListedContainer} from '../explorer/listed-containers.ts';
import {alpineStep} from './alpine.ts';
import {findAttachedContainer, type IdRecord} from './find.ts';
import {engineSuffixOf} from './label.ts';
import type {AttachedTarget} from './payload.ts';

/** What the step needs from outside. */
export interface AttachedStepPorts {
  engine: EngineHost;
  bridge: CliBridge;
  record: IdRecord;
  /** The attach configuration file that applies to the container; none when there is none. */
  configFileOf(container: ListedContainer): Promise<string | undefined>;
  /** The CLI target without the container and the file, which the step adds. */
  cliTarget: Omit<AttachedCliTarget, 'containerId' | 'configFile'>;
  engineCoordinates: PinnedEngine;
  logger: Logger;
  onCliEvent: (event: CliEvent) => void;
}

/** How the step ended. */
export type AttachedStep =
  | {
      kind: 'ready';
      container: ListedContainer;
      mergedConfiguration: Record<string, unknown>;
      /** Whether the container was found by its recorded id, because its name no longer resolved. */
      viaRecord: boolean;
      /** The attach file that applied, when one did. */
      configFile: string | undefined;
    }
  | {kind: 'failed'; failure: Failed; container: ListedContainer | undefined}
  | {kind: 'cancelled'};

/** Whether `signal` has been aborted; read through a call, so that a check made earlier does not narrow it. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Finds, checks and sets up the container `target` names. */
export async function attachedContainerStep(
  ports: AttachedStepPorts,
  payload: string,
  target: AttachedTarget,
  cancellation: AbortSignal,
): Promise<AttachedStep> {
  const found = await findAttachedContainer(
    ports.engine,
    ports.record,
    payload,
    target.containerName,
    cancellation,
  );
  if (isAborted(cancellation)) {
    return {kind: 'cancelled'};
  }
  if (found.kind === 'missing') {
    ports.logger.info(`no container named ${target.containerName} was found`);
    return {
      kind: 'failed',
      failure: attachedNotFound(target.containerName),
      container: undefined,
    };
  }
  const {container, viaRecord} = found;
  if (container.state !== 'running') {
    ports.logger.info(
      `container ${container.name} is ${container.state}, and an attach starts nothing by itself`,
    );
    return {
      kind: 'failed',
      failure: attachedNotRunning(
        container.image,
        container.name,
        engineSuffixOf(ports.engineCoordinates),
      ),
      container,
    };
  }
  const configFile = await ports.configFileOf(container);
  const setUp = await ports.bridge.setUp(
    {
      ...ports.cliTarget,
      containerId: container.id,
      ...(configFile === undefined ? {} : {configFile}),
    },
    ports.onCliEvent,
    cancellation,
  );
  if (setUp.kind === 'cancelled' || isAborted(cancellation)) {
    return {kind: 'cancelled'};
  }
  if (setUp.kind !== 'setUp') {
    ports.logger.warn(`set-up failed: ${cliFailureText(setUp)}`);
    return {kind: 'failed', failure: attachFailed(), container};
  }
  const alpine = await alpineStep(ports.engine, container.id, cancellation);
  if (alpine === 'failed') {
    ports.logger.warn('the Alpine step failed');
    return {kind: 'failed', failure: attachFailed(), container};
  }
  ports.logger.info(`the Alpine step: ${alpine}`);
  return {
    kind: 'ready',
    container,
    mergedConfiguration: setUp.mergedConfiguration,
    viaRecord,
    configFile,
  };
}
