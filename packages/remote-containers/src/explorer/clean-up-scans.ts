/**
 * @fileoverview What Clean Up offers for removal: the stopped containers and the unused volumes, each as the rows of a
 * picker, sorted by the label shown. Pure functions over what the engine listed.
 */

import {githubRepositoryOf} from './github-repository.ts';
import type {ListedContainer} from './listed-containers.ts';
import type {ListedVolume} from './listed-volumes.ts';

/** One row of a picker: what it shows, and what removing it removes. */
export interface CleanUpRow {
  label: string;
  /** The line beside the label; none for a row with no description. */
  description?: string;
  /** The container's id, or the volume's name. */
  target: string;
}

/** The container labels that make a stopped container a candidate: a folder or a repository, and the volume labels. */
const FOLDER_LABELS = [
  'devcontainer.local_folder',
  'vsch.local.folder',
  'vsch.local.repository',
] as const;
const VOLUME_LABELS = [
  'vsch.local.volume',
  'vsc.devcontainer.volume.name',
] as const;

/** The state the engine gives a container that ran and stopped; a container never started is `created`. */
const STOPPED = 'exited';

/** The volume that holds the server and is shared by every container. */
const SHARED_VOLUME = 'vscode';

/** The labels a volume made by a clone carries. */
const VOLUME_CANDIDATE_LABELS = [
  'vsch.local.repository',
  'dev.container.volume',
] as const;
const UNIQUE_LABEL = 'vsch.local.repository.unique';
const BRANCH_LABEL = 'vsch.local.repository.branch';
const PULL_REQUEST_LABEL = 'vsch.local.repository.pullRequestId';

const collator = new Intl.Collator();

/** The last segment of a path written with slashes or with backslashes, a trailing separator not counting. */
function basenameOf(value: string): string {
  const trimmed = value.replace(/[\\/]+$/u, '');
  return trimmed.slice(
    Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1,
  );
}

/** What a folder or repository label shows: `owner/repo` for a GitHub address, else the last segment. */
function folderLabelShown(value: string): string {
  const repository = githubRepositoryOf(value);
  return repository === undefined
    ? basenameOf(value)
    : `${repository.owner}/${repository.repository}`;
}

/** The rows sorted by the label they show, as the default collation orders text. */
function sorted(rows: CleanUpRow[]): CleanUpRow[] {
  return rows.sort((left, right) => collator.compare(left.label, right.label));
}

/**
 * The rows of the stopped containers: one for each candidate label a container carries, a folder or repository label
 * giving the last segment of its value (the GitHub form for an address) and a volume label the container's image.
 */
export function containerRowsOf(
  containers: readonly ListedContainer[],
): CleanUpRow[] {
  return sorted(
    containers
      .filter(container => container.state === STOPPED)
      .flatMap(container => [
        ...FOLDER_LABELS.flatMap(key => {
          const value = container.labels[key];
          return value === undefined
            ? []
            : [{label: folderLabelShown(value), target: container.id}];
        }),
        ...VOLUME_LABELS.filter(key => container.labels[key] !== undefined).map(
          () => ({label: container.image, target: container.id}),
        ),
      ]),
  );
}

/** The row of one volume: a unique GitHub volume shows its repository, with its pull request or branch beside it. */
function volumeRowOf(volume: ListedVolume): CleanUpRow {
  const repository =
    volume.labels[UNIQUE_LABEL] === 'true'
      ? githubRepositoryOf(volume.labels['vsch.local.repository'] ?? '')
      : undefined;
  if (repository === undefined) {
    return {label: volume.name, target: volume.name};
  }
  const pullRequest = volume.labels[PULL_REQUEST_LABEL];
  const description =
    pullRequest === undefined || pullRequest === ''
      ? volume.labels[BRANCH_LABEL]
      : `#${pullRequest}`;
  return {
    label: `${repository.owner}/${repository.repository}`,
    ...(description === undefined || description === '' ? {} : {description}),
    target: volume.name,
  };
}

/**
 * The rows of the unused volumes: those that carry one of the two labels of a clone's volume, once each, that no
 * container in any state mounts, never the shared `vscode` volume.
 */
export function volumeRowsOf(
  volumes: readonly ListedVolume[],
  containers: readonly ListedContainer[],
): CleanUpRow[] {
  const mounted = new Set(containers.flatMap(container => container.volumes));
  return sorted(
    volumes
      .filter(
        volume =>
          volume.name !== SHARED_VOLUME &&
          !mounted.has(volume.name) &&
          VOLUME_CANDIDATE_LABELS.some(key => volume.labels[key] !== undefined),
      )
      .map(volumeRowOf),
  );
}
