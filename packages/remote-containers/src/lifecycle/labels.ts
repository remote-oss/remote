/**
 * @fileoverview How a folder's dev container is found: the labels the CLI puts on the container it makes, the engine
 * query that lists the folder's containers, and the choice among them. All of it is pure; the values are never put
 * through a shell.
 */

const FOLDER_LABEL = 'devcontainer.local_folder';
const CONFIG_LABEL = 'devcontainer.config_file';

/** What discovery knows of one container. */
export interface ContainerFacts {
  id: string;
  /** The creation time as the engine writes it: RFC 3339 with up to nine fraction digits. */
  created: string;
  status: string;
  labels: Readonly<Record<string, string>>;
}

/** What to do with the folder's container. */
export type Decision =
  | {kind: 'create'}
  | {kind: 'use'; containerId: string; status: 'running' | 'exited' | 'created'}
  | {kind: 'unusable'; containerId: string; status: string};

/** The two labels that identify the container of a folder and a configuration file, in the order the CLI is given them. */
export function idLabels(folder: string, configFile: string): string[] {
  return [`${FOLDER_LABEL}=${folder}`, `${CONFIG_LABEL}=${configFile}`];
}

/** The arguments of the engine query that lists the ids of every container made for a folder. */
export function discoveryArguments(folder: string): string[] {
  return [
    'ps',
    '-a',
    '-q',
    '--no-trunc',
    '--filter',
    `label=${FOLDER_LABEL}=${folder}`,
  ];
}

const CREATED_PATTERN = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/;

/**
 * A creation time that sorts as time: the engine trims trailing zeros of the fraction, so the fraction is padded to
 * nine digits.
 */
export function createdKey(created: string): string {
  const match = CREATED_PATTERN.exec(created);
  return match === null
    ? created
    : `${String(match[1])}.${(match[2] ?? '').padEnd(9, '0')}`;
}

/** Whether `candidate` was made after `other`: by creation time, and the greater id when the times are equal. */
function isNewer(candidate: ContainerFacts, other: ContainerFacts): boolean {
  const left = createdKey(candidate.created);
  const right = createdKey(other.created);
  return left === right ? candidate.id > other.id : left > right;
}

/** The newest container of a list, or none. */
function newestOf(
  containers: readonly ContainerFacts[],
): ContainerFacts | undefined {
  return containers.reduce<ContainerFacts | undefined>(
    (newest, container) =>
      newest === undefined || isNewer(container, newest) ? container : newest,
    undefined,
  );
}

/**
 * Decides from labels alone. A container is a candidate when it is labelled with exactly this folder, with this
 * configuration file or none, and is not being removed. Those labelled with both come before those labelled with the
 * folder only; within a tier the newest wins, whatever its status.
 */
export function decide(
  folder: string,
  configFile: string,
  containers: readonly ContainerFacts[],
): Decision {
  const candidates = containers.filter(
    container =>
      container.labels[FOLDER_LABEL] === folder &&
      (container.labels[CONFIG_LABEL] === configFile ||
        container.labels[CONFIG_LABEL] === undefined) &&
      container.status !== 'removing',
  );
  const exact = candidates.filter(
    container => container.labels[CONFIG_LABEL] === configFile,
  );
  const chosen = newestOf(exact.length > 0 ? exact : candidates);
  if (chosen === undefined) {
    return {kind: 'create'};
  }
  if (
    chosen.status === 'running' ||
    chosen.status === 'exited' ||
    chosen.status === 'created'
  ) {
    return {kind: 'use', containerId: chosen.id, status: chosen.status};
  }
  return {kind: 'unusable', containerId: chosen.id, status: chosen.status};
}
