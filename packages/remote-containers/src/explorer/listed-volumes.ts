/**
 * @fileoverview The volumes the engine lists: its two queries and the facts read from `docker volume inspect`'s JSON.
 * Nothing here runs the engine.
 */

import {labelsOf, recordOf} from './listed-containers.ts';

/** One volume as `docker volume inspect` reports it. */
export interface ListedVolume {
  /** The volume's name. */
  name: string;
  /** The volume's labels; empty for none. */
  labels: Readonly<Record<string, string>>;
  /** When the volume was created, in epoch milliseconds; none when the engine gives no time. */
  createdAt?: number;
}

/** `docker volume ls -q`: every volume's name. */
export const VOLUME_LIST_ARGUMENTS: readonly string[] = ['volume', 'ls', '-q'];

/** `docker volume inspect <names…>`, the names after `--` so that none is read as an option. */
export function volumeInspectArguments(names: readonly string[]): string[] {
  return ['volume', 'inspect', '--', ...names];
}

/** The volumes of `docker volume inspect`'s JSON array, or none when the output isn't one of volumes. */
export function listedVolumesOf(stdout: string): ListedVolume[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const volumes = (parsed as unknown[]).map(element => {
    const volume = recordOf(element);
    if (typeof volume?.Name !== 'string') {
      return undefined;
    }
    const created =
      typeof volume.CreatedAt === 'string' ? Date.parse(volume.CreatedAt) : NaN;
    return {
      name: volume.Name,
      labels: labelsOf(volume.Labels),
      ...(Number.isNaN(created) ? {} : {createdAt: created}),
    };
  });
  return volumes.every(volume => volume !== undefined) ? volumes : undefined;
}
