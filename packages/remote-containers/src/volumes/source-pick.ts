/**
 * @fileoverview The rows of the source pick of Clone Repository in Container Volume, as the typed text changes: the
 * row that clones the typed text, once there is text, above the GitHub row when the GitHub source is offered; and the
 * source text a repository picked on GitHub gives.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {cloneText} from './clone-strings.ts';

/** A row of the source pick: what choosing it does, its label, and its description; or a separator. */
export type SourceRow =
  | {kind: 'url'; label: string; description: string}
  | {kind: 'github'; label: string; description: string}
  | {kind: 'separator'; label: string};

/** How the GitHub row is offered: with the full label from a local window, the short one from a remote one, or not. */
export type GithubOffer = 'local' | 'remote' | 'none';

/** The GitHub row for `offer`, or none. */
function githubRows(offer: GithubOffer, translate: Translate): SourceRow[] {
  if (offer === 'none') {
    return [];
  }
  const label =
    offer === 'local'
      ? cloneText('S071', translate, [cloneText('github', translate)])
      : cloneText('github', translate);
  return [{kind: 'github', label, description: ''}];
}

/**
 * The rows for `value` as typed: with text, the clone row with the text, its surrounding whitespace removed, then the
 * GitHub row; without, the GitHub row under the remote sources separator, or nothing when it isn't offered.
 */
export function sourceRowsOf(
  value: string,
  translate: Translate,
  offer: GithubOffer,
): SourceRow[] {
  const text = value.trim();
  const github = githubRows(offer, translate);
  if (text !== '') {
    return [
      {kind: 'url', label: cloneText('S072', translate), description: text},
      ...github,
    ];
  }
  return github.length === 0
    ? []
    : [
        {kind: 'separator', label: cloneText('remoteSources', translate)},
        ...github,
      ];
}

/** A repository picked on GitHub: its address, and the branch picked, if one was. */
export interface PickedRepository {
  url: string;
  branch?: string;
}

/** The source text a picked repository gives: its address, with the branch as a GitHub branch URL when one was picked. */
export function pickedSourceOf(picked: PickedRepository): string {
  if (picked.branch === undefined) {
    return picked.url;
  }
  const repository = picked.url.replace(/\.git$/, '').replace(/\/+$/, '');
  return `${repository}/tree/${picked.branch}`;
}
