/**
 * @fileoverview The resolve of a clone in a volume, up to its dev container: the source read again from the payload,
 * as one from a link unless our record says it was typed; the volume and a checked bootstrap container; the clone; and
 * `up` with the CLI inside the bootstrap. A failure removes the bootstrap at once; a container that is ready leaves it
 * to the caller, who removes it once connected.
 */

import type {Failed} from 'lib-authority';
import type {Logger} from 'lib-log';
import type {VolumeWorkspace} from '../cli/override-pre-pass.ts';
import {
  bootstrapToolMissing,
  checkoutFailed,
  cloneFailed,
  containerSetupFailed,
} from '../connect/failures.ts';
import type {ContainerOutcome} from '../lifecycle/container-lifecycle.ts';
import {volumeIdLabels} from '../lifecycle/labels.ts';
import {type BootstrapSettings, bootstrapRemoveArguments} from './bootstrap.ts';
import {type BuildContext, startBootstrap} from './bootstrap-start.ts';
import {bootstrapFilesOf} from './bootstrap-files.ts';
import {cloneSourceOf} from './clone-source.ts';
import {cloneIntoVolume, VOLUME_ROOT} from './clone-steps.ts';
import {uniqueVolumeLabelsOf} from './clone-volume.ts';
import {type EngineStepPorts, stepOf} from './engine-step.ts';
import {type DevContainerVolume, UNIQUE_VOLUME} from './volume-payload.ts';
import {uniqueVolumeName} from './volume-name.ts';

/** What `up` in the bootstrap is asked for. */
export interface VolumeContainerRequest {
  /** The folder in the volume, as the bootstrap and the dev container see it. */
  folder: string;
  configFile: string;
  idLabels: readonly string[];
  workspace: VolumeWorkspace;
}

/** What the resolve needs of the engine, the editor and the lifecycle. */
export interface VolumeResolvePorts extends EngineStepPorts {
  logger: Logger;
  /** The bootstrap settings, read for this start. */
  settings(): BootstrapSettings;
  buildContext(): Promise<BuildContext>;
  /** Whether our record says the source of `payload` was typed. */
  typed(payload: string): boolean;
  clearTyped(payload: string): Promise<void>;
  /** Told when the volume and the clone begin. */
  onCloning(): void;
  /** Finds or creates the dev container, with the CLI in the bootstrap container `bootstrap`. */
  prepare(
    bootstrap: string,
    request: VolumeContainerRequest,
  ): Promise<ContainerOutcome>;
}

/** A dev container that is ready, and what the connect needs of the pass that made it. */
export interface PreparedVolume {
  kind: 'prepared';
  outcome: Extract<ContainerOutcome, {kind: 'ready'}>;
  /** The bootstrap container, still running: the caller removes it once connected. */
  bootstrap: string;
  request: VolumeContainerRequest;
  /** The configuration's text, for the CLI runs on the host once the bootstrap is gone. */
  configText: string;
  /** The volume holds only the latest commits: the history could not be fetched. */
  shallow: boolean;
}

/** How the resolve ended. */
export type VolumeResolution =
  | PreparedVolume
  | {kind: 'failed'; failure: Failed}
  | {kind: 'notReady'; outcome: Exclude<ContainerOutcome, {kind: 'ready'}>};

/** What a folder name may not hold: a separator, or a control character. */
// eslint-disable-next-line no-control-regex -- control characters are what this refuses
const FOLDER_REFUSED = /[/\\\u0000-\u001f\u007f]/;

/** Whether `folder` can be a folder under `/workspaces`: one plain name. */
function plainFolder(folder: string): boolean {
  return !['', '.', '..'].includes(folder) && !FOLDER_REFUSED.test(folder);
}

/** Removes the bootstrap container; the outcome is only logged. */
async function removeBootstrap(
  ports: VolumeResolvePorts,
  bootstrap: string,
): Promise<void> {
  const removed = await stepOf(ports, bootstrapRemoveArguments(bootstrap));
  if (!removed.succeeded) {
    ports.logger.info(
      `the bootstrap container could not be removed: ${removed.detail}`,
    );
  }
}

/** Resolves the volume target `target` of `payload` up to a ready dev container, or why it can't be. */
export async function resolveVolume(
  ports: VolumeResolvePorts,
  payload: string,
  target: DevContainerVolume,
): Promise<VolumeResolution> {
  const origin = ports.typed(payload) ? 'typed' : 'link';
  const source = cloneSourceOf(target.repositoryPath, origin);
  if ('refused' in source || !plainFolder(target.folder)) {
    ports.logger.info(
      `the window's source can't be cloned: ${'refused' in source ? source.refused : 'folder'}`,
    );
    return {kind: 'failed', failure: containerSetupFailed()};
  }
  const unique = target.volumeName === UNIQUE_VOLUME;
  const volumeName = unique ? uniqueVolumeName(source) : target.volumeName;
  ports.onCloning();
  const started = await startBootstrap(
    ports,
    {name: volumeName, labels: unique ? uniqueVolumeLabelsOf(source) : []},
    ports.settings(),
  );
  if (started.kind === 'missingTool') {
    return {kind: 'failed', failure: bootstrapToolMissing(started.reason)};
  }
  if (started.kind === 'engineFailed') {
    ports.logger.info(
      `the bootstrap container could not start: ${started.detail}`,
    );
    return {kind: 'failed', failure: containerSetupFailed()};
  }
  const bootstrap = started.container;
  const cloned = await cloneIntoVolume(
    ports,
    bootstrap,
    source,
    origin,
    target.folder,
  );
  if (cloned.kind !== 'ready' || cloned.configuration === undefined) {
    await removeBootstrap(ports, bootstrap);
    if (cloned.kind === 'cloneFailed') {
      return {kind: 'failed', failure: cloneFailed(cloned.detail)};
    }
    if (cloned.kind === 'checkoutFailed') {
      return {kind: 'failed', failure: checkoutFailed(source.urlToClone)};
    }
    ports.logger.info('the clone holds no dev container configuration');
    return {kind: 'failed', failure: containerSetupFailed()};
  }
  await ports.clearTyped(payload);
  const folder = `${VOLUME_ROOT}/${target.folder}`;
  const configFile = `${folder}/${cloned.configuration}`;
  const request: VolumeContainerRequest = {
    folder,
    configFile,
    idLabels: volumeIdLabels({
      repositoryPath: source.repositoryPath,
      volumeName,
      folder: target.folder,
      configFile,
    }),
    workspace: {
      workspaceMount: `type=volume,source=${volumeName},target=${VOLUME_ROOT}`,
      workspaceFolder: folder,
    },
  };
  const configText = await bootstrapFilesOf(ports, bootstrap)
    .readText(configFile)
    .catch(() => '');
  const outcome = await ports.prepare(bootstrap, request);
  if (outcome.kind !== 'ready') {
    await removeBootstrap(ports, bootstrap);
    return {kind: 'notReady', outcome};
  }
  return {
    kind: 'prepared',
    outcome,
    bootstrap,
    request,
    configText,
    shallow: cloned.cloned && !cloned.deepened,
  };
}
