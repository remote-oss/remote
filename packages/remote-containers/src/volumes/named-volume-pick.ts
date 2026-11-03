/**
 * @fileoverview The rows of the volume pick of Clone Repository in Named Container Volume: "Create a new volume..."
 * first and focused, then the eligible volumes in the order their names compare, each with its creation date.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {cloneText} from './clone-strings.ts';
import {createdAtOf} from './volume-name-rules.ts';

/** One named volume the pick may choose: its Docker name, and the creation date it was given. */
export interface NamedVolume {
  name: string;
  created: Date | undefined;
}

/** A row of the volume pick: its label, its description, and the volume it names, or none for the create row. */
export interface NamedVolumeRow {
  label: string;
  description: string;
  volume: string | undefined;
}

/** The rows for `volumes`: the create row first, then the volumes sorted by name in character-code order. */
export function namedVolumeRowsOf(
  volumes: readonly NamedVolume[],
  translate: Translate,
): NamedVolumeRow[] {
  const rows: NamedVolumeRow[] = [
    {
      label: cloneText('S007', translate),
      description: cloneText('S391', translate),
      volume: undefined,
    },
  ];
  for (const volume of [...volumes].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    rows.push({
      label: `$(folder) ${volume.name}`,
      description:
        volume.created === undefined
          ? ''
          : cloneText('S419', translate, [createdAtOf(volume.created)]),
      volume: volume.name,
    });
  }
  return rows;
}
