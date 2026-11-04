/**
 * @fileoverview What a row of the Containers or Volumes view of another extension hands the row commands: the one
 * place that knows which members of its element hold the container's id and the volume's name. An argument that is no
 * such element, or whose value Docker would not take as a name, is no row: the command then does what its palette twin
 * does.
 */

import {exploredVolumeNameValid} from '../volumes/explore-definition.ts';

/** The member of a container row's element that holds the container's id. */
const CONTAINER_MEMBER = 'containerId';

/** The member of a volume row's element that holds the volume's name. */
const VOLUME_MEMBER = 'volumeName';

/** The text member `member` of `argument` when it is an object holding a name that Docker accepts. */
function dockerNameOf(argument: unknown, member: string): string | undefined {
  const value =
    typeof argument === 'object' && argument !== null
      ? (argument as Record<string, unknown>)[member]
      : undefined;
  return typeof value === 'string' && exploredVolumeNameValid(value)
    ? value
    : undefined;
}

/** The id of the container a row stands for; none for any other argument. */
export function viewletContainerOf(argument: unknown): string | undefined {
  return dockerNameOf(argument, CONTAINER_MEMBER);
}

/** The name of the volume a row stands for; none for any other argument. */
export function viewletVolumeOf(argument: unknown): string | undefined {
  return dockerNameOf(argument, VOLUME_MEMBER);
}
