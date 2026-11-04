/**
 * @fileoverview The resolve of a recovery container: the volume of a clone that could not be built, the bootstrap image
 * made ready, the synthetic configuration written afresh, and the container found or made by the dev container CLI
 * on the host. No clone is made and nothing is removed.
 */

import type {Logger} from 'lib-log';
import {containerSetupFailed} from '../connect/failures.ts';
import type {ContainerOutcome} from '../lifecycle/container-lifecycle.ts';
import {type BootstrapSettings, mountFieldOf} from './bootstrap.ts';
import {type BuildContext, readyImage} from './bootstrap-start.ts';
import {volumeInspectArguments} from './clone-volume.ts';
import {VOLUME_ROOT} from './clone-steps.ts';
import {type EngineStepPorts, stepOf} from './engine-step.ts';
import {exploredVolumeNameValid} from './explore-definition.ts';
import {
  recoveryConfigurationOf,
  recoveryIdLabels,
} from './recovery-container.ts';
import {UNIQUE_VOLUME, type DevContainerVolume} from './volume-payload.ts';
import {
  plainFolder,
  type VolumeContainerRequest,
  type VolumeResolution,
} from './volume-resolve.ts';

/** What the recovery resolve needs of the engine, the host and the lifecycle. */
export interface RecoveryResolvePorts extends EngineStepPorts {
  logger: Logger;
  /** The bootstrap settings, read for this start. */
  settings(): BootstrapSettings;
  buildContext(): Promise<BuildContext>;
  /** The file the synthetic configuration of `volumeName` is written to. */
  configFileOf(volumeName: string): string;
  /** Whether the user asked for the recovery of `volumeName`, in a failing clone of it. */
  picked(volumeName: string): boolean;
  /** The neutral folder on the host that the CLI is given as its workspace folder. */
  standInFolder: string;
  /** Writes `text` to `file`, replacing it and making its folder. */
  writeFile(file: string, text: string): Promise<void>;
  /** Finds or creates the dev container with the CLI on the host; `configText` is the synthetic file's. */
  prepare(
    request: VolumeContainerRequest,
    configText: string,
  ): Promise<ContainerOutcome>;
}

/** Resolves the recovery target `target` up to a ready recovery container, or why it can't be. */
export async function resolveRecovery(
  ports: RecoveryResolvePorts,
  target: DevContainerVolume,
): Promise<VolumeResolution> {
  const volumeName = target.volumeName;
  if (
    volumeName === UNIQUE_VOLUME ||
    !exploredVolumeNameValid(volumeName) ||
    !plainFolder(target.folder)
  ) {
    ports.logger.info('the recovery container has no volume or folder');
    return {kind: 'failed', failure: containerSetupFailed()};
  }
  if (!ports.picked(volumeName)) {
    ports.logger.info(
      `the recovery of the volume ${volumeName} was never asked for`,
    );
    return {kind: 'failed', failure: containerSetupFailed()};
  }
  const inspected = await stepOf(ports, volumeInspectArguments(volumeName));
  if (!inspected.succeeded) {
    ports.logger.info(`the volume ${volumeName} is not there`);
    return {kind: 'failed', failure: containerSetupFailed()};
  }
  const image = await readyImage(ports, ports.settings());
  if (!image.succeeded) {
    ports.logger.info(`the recovery image is not ready: ${image.detail}`);
    return {kind: 'failed', failure: containerSetupFailed()};
  }
  const folder = `${VOLUME_ROOT}/${target.folder}`;
  const configFile = ports.configFileOf(volumeName);
  const configText = recoveryConfigurationOf(
    image.image,
    volumeName,
    target.folder,
  );
  await ports.writeFile(configFile, configText);
  const request: VolumeContainerRequest = {
    folder: ports.standInFolder,
    configFile,
    idLabels: recoveryIdLabels(volumeName, configFile),
    workspace: {
      workspaceMount: `type=volume,${mountFieldOf('source', volumeName)},target=${VOLUME_ROOT}`,
      workspaceFolder: folder,
    },
  };
  const outcome = await ports.prepare(request, configText);
  if (outcome.kind !== 'ready') {
    return {kind: 'notReady', outcome};
  }
  return {
    kind: 'prepared',
    outcome,
    bootstrap: undefined,
    volumeName,
    request,
    configText,
    shallow: false,
  };
}
