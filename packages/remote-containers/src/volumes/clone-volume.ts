/**
 * @fileoverview The Docker volume a clone goes into: its labels, which name the repository it holds, and the engine
 * calls that create and look it up. The labels are fixed when the volume is created.
 */

import type {CloneSource} from './clone-source.ts';

/** The label keys of a clone's volume, the names the volume flows have always written. */
const LABEL = {
  repository: 'vsch.local.repository',
  unique: 'vsch.local.repository.unique',
  branch: 'vsch.local.repository.branch',
  pullRequest: 'vsch.local.repository.pullRequestId',
} as const;

/** The labels of a unique volume for `source`, as `key=value`: its repository, the unique mark, and its ref if any. */
export function uniqueVolumeLabelsOf(source: CloneSource): string[] {
  return [
    `${LABEL.repository}=${source.repositoryPath}`,
    `${LABEL.unique}=true`,
    ...(source.ref === undefined ? [] : [`${LABEL.branch}=${source.ref}`]),
  ];
}

/**
 * The labels of a named volume, set once when the clone that creates it runs: its repository, the named mark, and its
 * branch or pull request when the repository's URL named one.
 */
export function namedVolumeLabelsOf(source: CloneSource): string[] {
  return [
    `${LABEL.repository}=${source.repositoryPath}`,
    `${LABEL.unique}=false`,
    ...(source.ref === undefined ? [] : [`${LABEL.branch}=${source.ref}`]),
    ...(source.pullRequest === undefined
      ? []
      : [`${LABEL.pullRequest}=${String(source.pullRequest)}`]),
  ];
}

/**
 * The engine's arguments that list the named volumes' names: the ones that carry the repository label and the named
 * mark. `volume ls` names no creation date, so the dates come from `namedVolumeInspectArguments`.
 */
export function namedVolumeListArguments(): string[] {
  return [
    'volume',
    'ls',
    '-q',
    '--filter',
    `label=${LABEL.repository}`,
    '--filter',
    `label=${LABEL.unique}=false`,
  ];
}

/** The engine's arguments that give the creation dates of `names`, name and date pipe-joined, one line each. */
export function namedVolumeInspectArguments(
  names: readonly string[],
): string[] {
  return [
    'volume',
    'inspect',
    '--format',
    '{{.Name}}|{{.CreatedAt}}',
    ...names,
  ];
}

/** One named volume the list's lines name: its Docker name, and its creation date's text. */
export interface NamedVolumeFact {
  name: string;
  created?: string;
}

/** The named volumes of `namedVolumeInspectArguments`' output: each line, name and creation date, pipe-joined. */
export function namedVolumesOf(stdout: string): NamedVolumeFact[] {
  return stdout.split('\n').flatMap(line => {
    const pipeAt = line.indexOf('|');
    if (line === '' || pipeAt <= 0) {
      return [];
    }
    const created = line.slice(pipeAt + 1);
    return [
      {name: line.slice(0, pipeAt), ...(created === '' ? {} : {created})},
    ];
  });
}

/** The engine's arguments that create the volume `name` with `labels`. */
export function volumeCreateArguments(
  name: string,
  labels: readonly string[],
): string[] {
  return [
    'volume',
    'create',
    ...labels.flatMap(label => ['--label', label]),
    '--',
    name,
  ];
}

/** The engine's arguments that tell whether the volume `name` exists: the exit status alone answers. */
export function volumeInspectArguments(name: string): string[] {
  return ['volume', 'inspect', '--format', '{{.Name}}', '--', name];
}
