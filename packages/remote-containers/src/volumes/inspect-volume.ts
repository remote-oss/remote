/**
 * @fileoverview Explore a Volume in a Dev Container (F-0705): the volumes the picker lists, in the order and with the
 * dates it shows them, and the command that opens the window of the volume that was picked. Nothing here touches the
 * editor or the engine itself.
 */

import type {PinnedEngine} from '../engine/effective-engine.ts';
import type {ListedVolume} from '../explorer/listed-volumes.ts';
import {type DevContainerVolume, volumePayloadOf} from './volume-payload.ts';

/** The English template of each text of the picker, by its string id. */
export const INSPECT_TEMPLATES = {
  S319: 'Select the volume to inspect with Visual Studio Code',
  S419: 'created at {0}',
} as const;

/** The folder of the explore window: where the container mounts the volume. */
export const INSPECT_FOLDER = 'volume';

/** The authority's prefix of a dev container window. */
const AUTHORITY_PREFIX = 'vscode-remote://dev-container+';

/** One row of the picker. */
export interface InspectRow {
  /** The row's label: a folder icon, then the volume's name. */
  label: string;
  /** "created at …" with the date in English; none for a volume the engine gave no creation time. */
  description?: string;
  /** The volume's name. */
  volumeName: string;
}

/** The pieces of a name that are compared: its digit runs, by value, and the text between them, by character code. */
function piecesOf(name: string): string[] {
  return name.match(/\d+|\D+/gu) ?? [];
}

/** Whether `text` is a run of digits. */
function isNumber(text: string): boolean {
  return /^\d+$/u.test(text);
}

/** Compares two digit runs by value: the longer without leading zeros is the greater. */
function compareNumbers(left: string, right: string): number {
  const first = left.replace(/^0+(?=\d)/u, '');
  const second = right.replace(/^0+(?=\d)/u, '');
  if (first.length !== second.length) {
    return first.length - second.length;
  }
  return first < second ? -1 : first > second ? 1 : 0;
}

/** Orders names with digit runs compared by numeric value and every other character by its code. */
export function compareVolumeNames(left: string, right: string): number {
  const first = piecesOf(left);
  const second = piecesOf(right);
  for (
    let index = 0;
    index < Math.min(first.length, second.length);
    index += 1
  ) {
    const leftPiece = first[index] ?? '';
    const rightPiece = second[index] ?? '';
    const order =
      isNumber(leftPiece) && isNumber(rightPiece)
        ? compareNumbers(leftPiece, rightPiece)
        : leftPiece < rightPiece
          ? -1
          : leftPiece > rightPiece
            ? 1
            : 0;
    if (order !== 0) {
      return order;
    }
  }
  return first.length - second.length;
}

/** The rows of the picker for `volumes`: every one of them, sorted, each with the date it was created. */
export function inspectRowsOf(
  volumes: readonly ListedVolume[],
  createdAt: (date: string) => string,
): InspectRow[] {
  return [...volumes]
    .sort((left, right) => compareVolumeNames(left.name, right.name))
    .map(volume => ({
      label: `$(folder) ${volume.name}`,
      ...(volume.createdAt === undefined
        ? {}
        : {description: createdAt(new Date(volume.createdAt).toDateString())}),
      volumeName: volume.name,
    }));
}

/** The volume target of the explore window of `volumeName`. */
export function inspectTargetOf(
  volumeName: string,
  engine: PinnedEngine,
): DevContainerVolume {
  return {
    kind: 'volume',
    repositoryPath: '',
    volumeName,
    folder: INSPECT_FOLDER,
    inspectVolume: true,
    ...engine,
  };
}

/** The URI of the explore window of `target`: the folder where the container mounts the volume. */
export function inspectWindowUriOf(target: DevContainerVolume): string {
  return `${AUTHORITY_PREFIX}${volumePayloadOf(target)}/${INSPECT_FOLDER}`;
}

/** What the command needs of the editor and the engine. */
export interface InspectVolumePorts {
  /** The engine check, which shows its own dialog when the engine isn't ready. */
  engineReady(): Promise<boolean>;
  /** The volumes of the daemon; a failing engine rejects. */
  volumes(): Promise<ListedVolume[]>;
  /** Shows the picker over `rows` and gives the row picked, or none when it closed without a pick. */
  pick(rows: readonly InspectRow[]): Promise<InspectRow | undefined>;
  /** "created at …" with the date given, in the user's language. */
  createdAt(date: string): string;
  /** The engine the window pins. */
  engine(): PinnedEngine;
  /** Opens `address` in this window. */
  reload(address: string): Promise<void>;
  /** Writes one line to the log. */
  report(line: string): void;
}

/**
 * "Explore a Volume in a Dev Container": the picker over every volume, once the listing is in, and the window of the
 * volume that was picked. A dismissed picker changes nothing; an engine that cannot list is logged and shows nothing
 * of ours.
 */
export async function inspectVolume(ports: InspectVolumePorts): Promise<void> {
  if (!(await ports.engineReady())) {
    return;
  }
  let volumes: ListedVolume[];
  try {
    volumes = await ports.volumes();
  } catch (caught) {
    ports.report(
      `the volumes could not be listed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return;
  }
  const picked = await ports.pick(inspectRowsOf(volumes, ports.createdAt));
  if (picked === undefined) {
    return;
  }
  await ports.reload(
    inspectWindowUriOf(inspectTargetOf(picked.volumeName, ports.engine())),
  );
}
