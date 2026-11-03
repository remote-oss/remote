/**
 * @fileoverview The pure rules of the named-volume steps of Clone Repository in Named Container Volume: the default
 * volume name, the live checks of a name and the texts they give, the folder-name default of a source, and a
 * volume's creation date as its pick's description.
 */

import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import type {CloneSource} from './clone-source.ts';

/** The name prefilled in the "Enter the volume name." box: the same literal, for every repository. */
export const VOLUME_NAME_DEFAULT = 'vsc-remote-containers';

/**
 * The texts of a volume name's validation, by their string ids: the box shows the length wording and the combined
 * character wording, while the narrower and the collision wordings sit in the same table for the flows that name
 * them.
 */
const VOLUME_NAME_TEMPLATES = {
  S017: 'A Docker volume with this name already exists.',
  S214: "Invalid volume name '{0}'. Volume names must start with an alphanumeric character and contain only [a-zA-Z0-9_.-].",
  S248: 'Only [a-zA-Z0-9_.-] are allowed and the first character must be alphanumeric.',
  S249: 'Only alphanumeric characters are allowed as the first character.',
  S250: 'Only alphanumeric characters, periods, underscores and hyphens are allowed.',
  S361: 'The name cannot be empty.',
  S397: 'Volume names should be at least two characters and the first character must be alphanumeric.',
} as const;

/** The name of a text of a volume name's validation. */
type VolumeNameTextName = keyof typeof VOLUME_NAME_TEMPLATES;

/** The text named `name` in the display language, filled with `values`. */
function volumeNameText(
  name: VolumeNameTextName,
  translate: Translate,
  values: readonly string[] = [],
): string {
  return filled(translate, VOLUME_NAME_TEMPLATES[name], values);
}

/** The character a volume name may not hold; the first character is stricter. */
const REFUSED_CHARACTER = /[^A-Za-z0-9_.-]/;
const ALPHANUMERIC = /^[A-Za-z0-9]/;

/** The prefix of a GitHub source, after a shorthand's expansion. */
const GITHUB = 'https://github.com/';

/** The live checks of a name, each on its own: the length check runs before the character checks, which never pre-empt it. */
export function volumeNameChecks(name: string): {
  short: boolean;
  firstCharacter: boolean;
  character: boolean;
} {
  return {
    short: name.length < 2,
    firstCharacter: name.length >= 2 && !ALPHANUMERIC.test(name),
    character: REFUSED_CHARACTER.test(name),
  };
}

/**
 * The live message of the named-volume box for `name`, or none: the length wording first, and every character
 * violation, first character or not, folded into the combined wording.
 */
export function volumeNameMessageOf(
  name: string,
  translate: Translate,
): string | undefined {
  const checks = volumeNameChecks(name);
  if (checks.short) {
    return volumeNameText('S397', translate);
  }
  if (checks.firstCharacter || checks.character) {
    return volumeNameText('S248', translate);
  }
  return undefined;
}

/** Whether `text` is a GitHub source: its URL, or the shorthand resolved to one. */
/**
 * The default of the "Enter the target folder name." box for `source`: the repository's name for a GitHub source
 * (its pull request's base, a branch's bare name), the text after the last slash for any other URL, a final
 * `.git` removed, and empty when the URL ends in `/`.
 */
export function folderDefaultOf(source: CloneSource): string {
  if (source.repositoryPath.startsWith(GITHUB)) {
    return source.repositoryName;
  }
  const tail = source.repositoryPath.slice(
    source.repositoryPath.lastIndexOf('/') + 1,
  );
  return tail.endsWith('.git') ? tail.slice(0, -'.git'.length) : tail;
}

/** The weekday, month, day and year of `created`, in the process's time zone, joined without separators. */
export function createdAtOf(created: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  })
    .formatToParts(created)
    .filter(part => part.type !== 'literal')
    .map(part => part.value)
    .join(' ');
}
