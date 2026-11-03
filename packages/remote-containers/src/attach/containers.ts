/**
 * @fileoverview The containers the attach picker lists: the running ones of the engine, each as one item, in the order
 * of the Dev Containers view's rows.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import {
  inspectArguments,
  type ListedContainer,
  listedContainersOf,
} from '../explorer/listed-containers.ts';
import {LABEL_COLLATOR} from '../explorer/targets-model.ts';

/** `docker ps -q --no-trunc` for the containers whose status is exactly `running`. */
const RUNNING_ARGUMENTS: readonly string[] = [
  'ps',
  '-q',
  '--no-trunc',
  '--filter',
  'status=running',
];

/** One item of the picker: the container's name as Docker keeps it, with its image and its full id. */
export interface AttachItem {
  label: string;
  description: string;
  containerId: string;
  /** The container's image and its name without the slash. */
  image: string;
  name: string;
}

/** Why the running containers could not be listed. */
export interface ListingFailed {
  failed: string;
}

/** The item of a container. */
function itemOf(container: ListedContainer): AttachItem {
  return {
    label: `/${container.name}`,
    description: `${container.image} ${container.id}`,
    containerId: container.id,
    image: container.image,
    name: container.name,
  };
}

/**
 * The items for the running containers of `engine`, in order. A container that `docker inspect` no longer finds is left
 * out, and so is one that is not running by then.
 */
export async function runningItemsOf(
  engine: EngineHost,
  cancellation: AbortSignal,
): Promise<AttachItem[] | ListingFailed> {
  const listed = await engine.run(
    RUNNING_ARGUMENTS,
    {kind: 'none'},
    {cancellation},
  );
  if (listed.kind !== 'ran' || listed.status !== 0) {
    return {
      failed:
        listed.kind === 'ran'
          ? firstLineOf(
              listed.stderr,
              `docker ended with status ${String(listed.status)}`,
            )
          : listed.detail,
    };
  }
  const containerIds = listed.stdout.split('\n').filter(line => line !== '');
  if (containerIds.length === 0) {
    return [];
  }
  const inspected = await engine.run(
    inspectArguments(containerIds),
    {kind: 'none'},
    {cancellation},
  );
  if (inspected.kind !== 'ran') {
    return {failed: inspected.detail};
  }
  const containers = listedContainersOf(inspected.stdout);
  if (containers === undefined) {
    return {
      failed: firstLineOf(
        inspected.stderr,
        'docker inspect gave no containers',
      ),
    };
  }
  return containers
    .filter(container => container.state === 'running')
    .map(itemOf)
    .sort((left, right) => LABEL_COLLATOR.compare(left.label, right.label));
}

/** The first line of `text`, or `fallback` when there is none. */
function firstLineOf(text: string, fallback: string): string {
  const line = text.split('\n', 1).join('').trim();
  return line === '' ? fallback : line;
}
