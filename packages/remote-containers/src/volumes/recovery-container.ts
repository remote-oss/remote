/**
 * @fileoverview The recovery container of a clone in a volume: the target of its window, the synthetic configuration
 * the dev container CLI starts it from, the labels that find it again, and the choice of the container to start. All of
 * it is pure.
 */

import path from 'node:path';
import {type ContainerFacts, type Decision} from '../lifecycle/labels.ts';
import {decideByLabels} from '../lifecycle/labels.ts';
import {type CloneOrigin, cloneSourceOf} from './clone-source.ts';
import {VOLUME_ROOT} from './clone-steps.ts';
import {mountFieldOf} from './bootstrap.ts';
import {type DevContainerVolume, UNIQUE_VOLUME} from './volume-payload.ts';
import {uniqueVolumeName} from './volume-name.ts';

/** The label that names the volume a recovery container is for. */
const VOLUME_LABEL = 'vsch.local.volume';

/** The label that names the synthetic configuration a recovery container was made from. */
const CONFIG_LABEL = 'devcontainer.config_file';

/**
 * The target of the recovery container of the volume window `volume`: the same volume, named for real, with no clone to
 * make and no dev container to build. None when the window's source is one the clone refuses.
 */
export function recoveryTargetOf(
  volume: DevContainerVolume,
  origin: CloneOrigin,
): DevContainerVolume | undefined {
  const source = cloneSourceOf(volume.repositoryPath, origin);
  if ('refused' in source) {
    return undefined;
  }
  const target: DevContainerVolume = {
    ...volume,
    volumeName:
      volume.volumeName === UNIQUE_VOLUME
        ? uniqueVolumeName(source)
        : volume.volumeName,
    inspectVolume: true,
    recovery: true,
  };
  delete target.cloneInfo;
  return target;
}

/** Where the synthetic configuration of a volume lies: one file per volume, in a folder of its own. */
export function recoveryConfigFileOf(
  temporaryFolder: string,
  user: string,
  extensionVersion: string,
  volumeName: string,
): string {
  return path.join(
    temporaryFolder,
    `vsch-${user}`,
    'recovery-volume',
    extensionVersion,
    volumeName,
    '.devcontainer.json',
  );
}

/** The synthetic configuration's text: the bootstrap image on the volume, as root, with no Feature. */
export function recoveryConfigurationOf(
  image: string,
  volumeName: string,
  folder: string,
): string {
  return `${JSON.stringify(
    {
      image,
      workspaceMount: `type=volume,${mountFieldOf('source', volumeName)},target=${VOLUME_ROOT}`,
      workspaceFolder: `${VOLUME_ROOT}/${folder}`,
      remoteUser: 'root',
      overrideCommand: true,
    },
    null,
    2,
  )}\n`;
}

/** The labels that find the recovery container of a volume, in the order the CLI is given them. */
export function recoveryIdLabels(
  volumeName: string,
  configFile: string,
): string[] {
  return [`${VOLUME_LABEL}=${volumeName}`, `${CONFIG_LABEL}=${configFile}`];
}

/**
 * The recovery container to start: one that carries both labels, started again when it is stopped, never made again.
 * The image is not part of the match, and a container with other labels is left as it is.
 */
export function recoveryDecisionOf(
  volumeName: string,
  configFile: string,
  containers: readonly ContainerFacts[],
): Decision {
  return decideByLabels(recoveryIdLabels(volumeName, configFile), containers);
}
