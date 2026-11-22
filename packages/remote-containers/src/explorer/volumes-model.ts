/**
 * @fileoverview The Dev Volumes view as pure rows: the engine's volumes and containers and the time go in, and the
 * rows, their kinds, labels, descriptions and tooltips come out. No editor, no engine and no file is touched here.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {githubAddressOf, githubRepositoryOf} from './github-repository.ts';
import type {ListedContainer} from './listed-containers.ts';
import type {ListedVolume} from './listed-volumes.ts';
import {agoPhraseOf} from './relative-time.ts';

/** The labels a volume the extension made carries (BR-2, BR-3). */
const UNIQUE_LABEL = 'vsch.local.repository.unique';
const REPOSITORY_LABEL = 'vsch.local.repository';
const BRANCH_LABEL = 'vsch.local.repository.branch';
const PULL_REQUEST_LABEL = 'vsch.local.repository.pullRequestId';

/** The volume the extension's dev containers share; it is never a row (BR-1). */
const SHARED_VOLUME = 'vscode';

/** The shape of the names Docker gives anonymous volumes, 64 hexadecimal digits in any case; never a row (BR-1). */
const ANONYMOUS_NAME = /^[0-9a-fA-F]{64}$/;

/** A web address a source line may link: the scheme `http` or `https`. */
const WEB_ADDRESS = /^https?:\/\//i;

/** A row's kind: `uniqueDevVolume` for the label exactly `true`, every other volume a `devVolume` (BR-2). */
export type VolumeKind = 'devVolume' | 'uniqueDevVolume';

/** The icon of a tooltip line, by its codicon name without the `$()`. */
export type TooltipIcon =
  | 'github'
  | 'source-control'
  | 'file-symlink-directory'
  | 'git-branch'
  | 'git-pull-request'
  | 'history'
  | 'vm';

/** One line of a tooltip: an icon and a text, the text a link when it has an address. Both are plain text, never markup. */
export interface TooltipLine {
  icon: TooltipIcon;
  text: string;
  /** The address the text links to; none for plain text. Built here, never a label's own text. */
  link?: string;
}

/** One row: a volume of the engine. */
export interface VolumeRow {
  /** The volume's raw Docker name, which is the row's id and what every dialog names. */
  name: string;
  kind: VolumeKind;
  label: string;
  /** "#<n>", else the branch, for a GitHub-recognized unique volume; empty for none. */
  description: string;
  icon: 'file-symlink-directory';
  /** The token the manifest's menus match: the row's kind. */
  viewItem: VolumeKind;
  tooltip: readonly TooltipLine[];
}

/** What the rows are made from. */
export interface VolumesInput {
  volumes: readonly ListedVolume[];
  containers: readonly ListedContainer[];
  /** The time the rows are built, in epoch milliseconds. */
  now: number;
  translate: Translate;
}

/** Whether the volume is a row: not the shared volume and not an anonymous one (BR-1). */
export function isListedVolume(name: string): boolean {
  return name !== SHARED_VOLUME && !ANONYMOUS_NAME.test(name);
}

/** The containers that mount the volume, in any state, newest first; a container that only names it in a label is not one (BR-4, BR-5). */
export function containersMounting(
  volumeName: string,
  containers: readonly ListedContainer[],
): ListedContainer[] {
  return containers
    .filter(container => container.volumes.includes(volumeName))
    .sort((left, right) => right.createdAt - left.createdAt);
}

/** An address for a link: the text as a web address with its spaces and control characters escaped, and no brackets or parentheses that would end a link early; none when the text is not a web address. */
function linkOf(text: string): string | undefined {
  if (!WEB_ADDRESS.test(text)) {
    return undefined;
  }
  try {
    return new URL(text).href.replace(/[()[\]]/g, character =>
      encodeURIComponent(character).replace(
        /[()]/g,
        each => `%${each.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    );
  } catch {
    return undefined;
  }
}

/** The source line of a row (BR-4 line 1). */
function sourceLineOf(
  volume: ListedVolume,
  kind: VolumeKind,
  repository: string | undefined,
): TooltipLine {
  if (kind === 'devVolume' || repository === undefined) {
    return {icon: 'file-symlink-directory', text: volume.name};
  }
  const github = githubRepositoryOf(repository);
  if (github !== undefined) {
    const address = githubAddressOf(github);
    return address === undefined
      ? {
          icon: 'github',
          text: `https://github.com/${github.owner}/${github.repository}`,
        }
      : {icon: 'github', text: address, link: address};
  }
  if (WEB_ADDRESS.test(repository)) {
    const shown = repository.replace(/\.git$/, '');
    const link = linkOf(shown);
    return link === undefined
      ? {icon: 'source-control', text: shown}
      : {icon: 'source-control', text: shown, link};
  }
  return {icon: 'source-control', text: `${repository})`};
}

/** The row of one volume. */
function rowOf(
  volume: ListedVolume,
  input: VolumesInput,
  mounting: readonly ListedContainer[],
): VolumeRow {
  const kind: VolumeKind =
    volume.labels[UNIQUE_LABEL] === 'true' ? 'uniqueDevVolume' : 'devVolume';
  const repository = volume.labels[REPOSITORY_LABEL];
  const github =
    kind === 'uniqueDevVolume' && repository !== undefined
      ? githubRepositoryOf(repository)
      : undefined;
  const branch =
    kind === 'uniqueDevVolume' ? volume.labels[BRANCH_LABEL] : undefined;
  const pullRequest =
    kind === 'uniqueDevVolume' ? volume.labels[PULL_REQUEST_LABEL] : undefined;
  const pullAddress =
    github === undefined || pullRequest === undefined
      ? undefined
      : githubAddressOf(github);
  const lines: TooltipLine[] = [sourceLineOf(volume, kind, repository)];
  if (branch !== undefined && branch !== '') {
    lines.push({icon: 'git-branch', text: branch});
  }
  if (pullRequest !== undefined && pullRequest !== '') {
    lines.push(
      pullAddress !== undefined && /^[0-9]+$/.test(pullRequest)
        ? {
            icon: 'git-pull-request',
            text: `#${pullRequest}`,
            link: `${pullAddress}/pull/${pullRequest}`,
          }
        : {icon: 'git-pull-request', text: `#${pullRequest}`},
    );
  }
  if (volume.createdAt !== undefined) {
    lines.push({
      icon: 'history',
      text: agoPhraseOf(
        input.now - volume.createdAt,
        input.translate,
        'counted',
      ),
    });
  }
  lines.push({
    icon: 'vm',
    text:
      mounting.length === 0
        ? 'None'
        : mounting.map(container => container.name).join(', '),
  });
  const description =
    github === undefined
      ? ''
      : pullRequest !== undefined && pullRequest !== ''
        ? `#${pullRequest}`
        : (branch ?? '');
  return {
    name: volume.name,
    kind,
    label:
      github === undefined
        ? volume.name
        : `${github.owner}/${github.repository}`,
    description,
    icon: 'file-symlink-directory',
    viewItem: kind,
    tooltip: lines,
  };
}

/** The rows of the engine's volumes: the listed ones, newest first, and in one second by raw name (BR-1, BR-6). */
export function volumeRowsOf(input: VolumesInput): VolumeRow[] {
  return input.volumes
    .filter(volume => isListedVolume(volume.name))
    .sort((left, right) => {
      const newer = (right.createdAt ?? 0) - (left.createdAt ?? 0);
      if (newer !== 0) {
        return newer;
      }
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    })
    .map(volume =>
      rowOf(volume, input, containersMounting(volume.name, input.containers)),
    );
}
