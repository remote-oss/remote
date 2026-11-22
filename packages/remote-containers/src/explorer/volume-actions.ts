/**
 * @fileoverview Removing a volume of the Dev Volumes view, and the volume that Remove Container may offer to remove with
 * its container. The in-use check comes before any dialog; a volume that is already gone is no error.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import type {ListedContainer} from './listed-containers.ts';
import {recordOf} from './listed-containers.ts';
import type {ListedVolume} from './listed-volumes.ts';
import type {Confirmation} from './row-actions.ts';
import {containersMounting, type VolumeKind} from './volumes-model.ts';

/** The English template of each text of the volume actions, by its string id. */
export const VOLUME_TEMPLATES = {
  S041: "Are you sure you want to remove volume '{0}'?",
  S169: 'Error removing volume: {0}',
  S394: "Volume '{0}' is in use and cannot be removed.",
  /** The Remove button; it has no string id of its own. */
  remove: 'Remove',
  /** The one button of the in-use dialog; it has no string id of its own. */
  ok: 'OK',
} as const;

/** The label that names the volume a container's repository was cloned into. */
const VOLUME_LABEL = 'vsch.local.repository.volume';

/** The label whose value `true` makes a volume the extension's unique one. */
const UNIQUE_LABEL = 'vsch.local.repository.unique';

/** What the removal needs of its surroundings. */
export interface VolumeActionPorts {
  /** The engine the view lists with now; none when no Docker program is named. */
  engine(): EngineHost | undefined;
  /** The program `dev.containers.dockerPath` names, as the user wrote it. */
  program(): string;
  /** Every container of the engine, in any state. */
  containers(): Promise<ListedContainer[]>;
  /** Shows the dialog and says whether the button that confirms was chosen. */
  confirm(confirmation: Confirmation): Promise<boolean>;
  /** Shows a modal dialog that has only the detail and the one button `OK`. */
  inform(detail: string): PromiseLike<unknown>;
  /** Shows an error notification with no buttons. */
  showError(text: string): void;
  /** Reads the engine again and rebuilds the view. */
  refresh(): Promise<void>;
  translate: Translate;
  cancellation: AbortSignal;
}

/** The name of the volume a row of the view stands for; none for anything that is not such a row. */
export function volumeNameOf(argument: unknown): string | undefined {
  const row = recordOf(argument);
  const kinds: readonly VolumeKind[] = ['devVolume', 'uniqueDevVolume'];
  return typeof row?.name === 'string' &&
    typeof row.viewItem === 'string' &&
    (kinds as readonly string[]).includes(row.viewItem)
    ? row.name
    : undefined;
}

/**
 * The volume that removing container `containerId` offers to remove with it: the one its repository-volume label names,
 * when that is a listed unique volume and no other container mounts it, in any state. The label decides, not the mounts.
 */
export function chainedVolumeOf(
  containerId: string,
  containers: readonly ListedContainer[],
  volumes: readonly ListedVolume[],
): string | undefined {
  const named = containers.find(each => each.id === containerId)?.labels[
    VOLUME_LABEL
  ];
  if (
    named === undefined ||
    volumes.find(each => each.name === named)?.labels[UNIQUE_LABEL] !== 'true'
  ) {
    return undefined;
  }
  return containersMounting(named, containers).some(
    each => each.id !== containerId,
  )
    ? undefined
    : named;
}

/** The text a failed Docker command is reported as. */
export function failureTextOf(
  program: string,
  argv: readonly string[],
): string {
  return `Command failed: ${[program, ...argv].join(' ')}`;
}

/** The command of Remove on a row of the view. */
export function removeVolumeOf(
  ports: VolumeActionPorts,
): (argument: unknown) => Promise<void> {
  const {translate} = ports;
  const options = {cancellation: ports.cancellation};

  async function succeeds(argv: readonly string[]): Promise<boolean> {
    const outcome = await ports.engine()?.run(argv, {kind: 'none'}, options);
    return outcome?.kind === 'ran' && outcome.status === 0;
  }

  return async argument => {
    const name = volumeNameOf(argument);
    if (name === undefined) {
      return;
    }
    if (containersMounting(name, await ports.containers()).length > 0) {
      await ports.inform(filled(translate, VOLUME_TEMPLATES.S394, [name]));
      return;
    }
    const confirmed = await ports.confirm({
      message: '',
      detail: filled(translate, VOLUME_TEMPLATES.S041, [name]),
      accept: translate(VOLUME_TEMPLATES.remove),
    });
    if (!confirmed) {
      return;
    }
    const removing = ['volume', 'rm', name];
    if (
      !(await succeeds(removing)) &&
      (await succeeds(['volume', 'inspect', '--', name]))
    ) {
      ports.showError(
        filled(translate, VOLUME_TEMPLATES.S169, [
          failureTextOf(ports.program(), removing),
        ]),
      );
    }
    await ports.refresh();
  };
}
