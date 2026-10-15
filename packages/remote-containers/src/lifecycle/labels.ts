/**
 * @fileoverview How a folder's dev container is found: the labels the CLI puts on the container it makes, the engine
 * query that lists the folder's containers, and the choice among them. All of it is pure; the values are never put
 * through a shell.
 */

const FOLDER_LABEL = 'devcontainer.local_folder';
const CONFIG_LABEL = 'devcontainer.config_file';
const LEGACY_FOLDER_LABEL = 'vsch.local.folder';
const LEGACY_QUALITY_LABEL = 'vsch.quality';
const LEGACY_REPOSITORY_LABEL = 'vsch.local.repository';

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
  | {
      kind: 'use';
      containerId: string;
      status: 'running' | 'exited' | 'created';
      idLabels: string[];
    }
  | {kind: 'unusable'; containerId: string; status: string};

/** The local folder a container was made for, from the first of its folder labels that names one: the current, then the legacy. */
export function localFolderOf(
  labels: Readonly<Record<string, string>>,
): string | undefined {
  return labels[FOLDER_LABEL] ?? labels[LEGACY_FOLDER_LABEL];
}

/** The configuration file a container was made from, when it carries the label that names one. */
export function configFileOf(
  labels: Readonly<Record<string, string>>,
): string | undefined {
  return labels[CONFIG_LABEL];
}

/**
 * The folder, or the repository, a container was made for, from the first of its folder labels the container carries: the
 * current one, then the legacy ones. None for a container made for no folder.
 */
export function devContainerFolderOf(
  labels: Readonly<Record<string, string>>,
): string | undefined {
  return localFolderOf(labels) ?? labels[LEGACY_REPOSITORY_LABEL];
}

/** Whether the labels make the container a dev container: it carries one of the folder labels. */
export function isDevContainer(
  labels: Readonly<Record<string, string>>,
): boolean {
  return devContainerFolderOf(labels) !== undefined;
}

/** The two labels that identify the container of a folder and a configuration file, in the order the CLI is given them. */
export function idLabels(folder: string, configFile: string): string[] {
  return [`${FOLDER_LABEL}=${folder}`, `${CONFIG_LABEL}=${configFile}`];
}

/** The labels of a container made before the `devcontainer.*` labels, in the order the CLI is given them. */
export function legacyIdLabels(folder: string): string[] {
  return [`${LEGACY_FOLDER_LABEL}=${folder}`, `${LEGACY_QUALITY_LABEL}=stable`];
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

/** The arguments of the engine query that lists the ids of the legacy containers of a folder. */
export function legacyDiscoveryArguments(folder: string): string[] {
  return [
    'ps',
    '-a',
    '-q',
    '--no-trunc',
    '--filter',
    `label=${LEGACY_FOLDER_LABEL}=${folder}`,
    '--filter',
    `label=${LEGACY_QUALITY_LABEL}=stable`,
  ];
}

/** Whether a container carries the legacy pair for this folder. */
export function isLegacy(folder: string, container: ContainerFacts): boolean {
  return (
    container.labels[LEGACY_FOLDER_LABEL] === folder &&
    container.labels[LEGACY_QUALITY_LABEL] === 'stable'
  );
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
 * Decides from labels alone. Legacy-labelled containers come first, then those labelled with both, then those
 * labelled with the folder only; within a tier the newest wins, whatever its status.
 */
export function decide(
  folder: string,
  configFile: string,
  containers: readonly ContainerFacts[],
): Decision {
  const legacy = containers.filter(
    container => isLegacy(folder, container) && container.status !== 'removing',
  );
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
  const tier =
    legacy.length > 0 ? legacy : exact.length > 0 ? exact : candidates;
  const fromLegacy = tier === legacy;
  const chosen = newestOf(tier);
  if (chosen === undefined) {
    return {kind: 'create'};
  }
  if (
    chosen.status === 'running' ||
    chosen.status === 'exited' ||
    chosen.status === 'created'
  ) {
    return {
      kind: 'use',
      containerId: chosen.id,
      status: chosen.status,
      idLabels: fromLegacy
        ? legacyIdLabels(folder)
        : idLabels(folder, configFile),
    };
  }
  return {kind: 'unusable', containerId: chosen.id, status: chosen.status};
}
