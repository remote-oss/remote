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
} as const;

/** The labels of a unique volume for `source`, as `key=value`: its repository, the unique mark, and its ref if any. */
export function uniqueVolumeLabelsOf(source: CloneSource): string[] {
  return [
    `${LABEL.repository}=${source.repositoryPath}`,
    `${LABEL.unique}=true`,
    ...(source.ref === undefined ? [] : [`${LABEL.branch}=${source.ref}`]),
  ];
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
