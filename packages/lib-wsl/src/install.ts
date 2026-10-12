/**
 * @fileoverview The online catalogue as the install picker lists it, and the line typed into the terminal to install
 * a distro.
 */

import type {OnlineRow} from './online.ts';

/** The line to type, or the sign that the name cannot be put into a command. */
export type InstallLine =
  | {readonly kind: 'line'; readonly text: string}
  | {readonly kind: 'invalidName'};

/** A name starts with a letter or digit, so it can never read as an option, and holds only name characters. */
const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A new array ordered by the lower-case friendly name, compared by UTF-16 code units; equal rows keep their order. */
export function sortOnlineCatalogue(
  rows: readonly OnlineRow[],
): readonly OnlineRow[] {
  return [...rows].sort((left, right) => {
    const leftName = left.friendlyName.toLowerCase();
    const rightName = right.friendlyName.toLowerCase();
    if (leftName < rightName) {
      return -1;
    }
    return leftName > rightName ? 1 : 0;
  });
}

/** The line that installs the distro with the internal `name`. */
export function installCommandLine(name: string): InstallLine {
  return VALID_NAME.test(name)
    ? {kind: 'line', text: `wsl.exe --install -d ${name}`}
    : {kind: 'invalidName'};
}
