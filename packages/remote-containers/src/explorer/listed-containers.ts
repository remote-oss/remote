/**
 * @fileoverview The containers the Dev Containers view lists: the engine's two queries and the facts the view reads
 * from `docker inspect`'s JSON. Nothing here runs the engine.
 */

/** One container as `docker inspect` reports it, with what the view reads. */
export interface ListedContainer {
  /** The full id. */
  id: string;
  /** The container's name, without the leading slash. */
  name: string;
  /** `Config.Image`, as the container was created. */
  image: string;
  /** `State.Status`. */
  state: string;
  /** The creation time, in epoch milliseconds. */
  createdAt: number;
  /** `State.StartedAt`; none for the engine's zero time. */
  startedAt: number | undefined;
  /** `State.FinishedAt`; none for the engine's zero time. */
  finishedAt: number | undefined;
  /** `Config.Labels`; empty for none. */
  labels: Readonly<Record<string, string>>;
}

/** `docker ps -a -q --no-trunc`: every container's id. */
export const LIST_ARGUMENTS: readonly string[] = [
  'ps',
  '-a',
  '-q',
  '--no-trunc',
];

const ZERO_TIME = /^0001-01-01T00:00:00(?:\.0+)?Z$/;

/** `docker inspect --type container <ids…>`. */
export function inspectArguments(containerIds: readonly string[]): string[] {
  return ['inspect', '--type', 'container', ...containerIds];
}

/** An object's own property as a record, or none for anything else. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The epoch milliseconds of an engine time stamp; none for the zero time, and for text that isn't a time. */
function timeOf(value: unknown): number | undefined {
  if (typeof value !== 'string' || ZERO_TIME.test(value)) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** The labels whose values are text; none for a container with no labels. */
function labelsOf(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(recordOf(value) ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/** The container one element of the array describes, or none when the element lacks what the view needs. */
function containerOf(element: unknown): ListedContainer | undefined {
  const inspected = recordOf(element);
  const config = recordOf(inspected?.Config);
  const state = recordOf(inspected?.State);
  const createdAt = timeOf(inspected?.Created);
  if (
    typeof inspected?.Id !== 'string' ||
    typeof inspected.Name !== 'string' ||
    typeof config?.Image !== 'string' ||
    typeof state?.Status !== 'string' ||
    createdAt === undefined
  ) {
    return undefined;
  }
  return {
    id: inspected.Id,
    name: inspected.Name.replace(/^\//, ''),
    image: config.Image,
    state: state.Status,
    createdAt,
    startedAt: timeOf(state.StartedAt),
    finishedAt: timeOf(state.FinishedAt),
    labels: labelsOf(config.Labels),
  };
}

/** The containers of `docker inspect`'s JSON array, or none when the output isn't one of containers. */
export function listedContainersOf(
  stdout: string,
): ListedContainer[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const containers = parsed.map(containerOf);
  return containers.every(container => container !== undefined)
    ? containers
    : undefined;
}
