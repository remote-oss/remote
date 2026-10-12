/**
 * @fileoverview The rows of the WSL distribution list: for each installed distribution, the name, the default
 * marker, the state word and the version, from the management text the tools print in the display language.
 */

/**
 * The state of a distribution list row: the four words the management text prints name the states, every other
 * word of the state column is `other`.
 */
export type DistroState =
  'running' | 'stopped' | 'installing' | 'converting' | 'other';

/**
 * The version of a distribution list row, from the version column: the printed 1 and 2 are the versions, any
 * other number and the missing column are `unknown`.
 */
export type DistroVersion = 1 | 2 | 'unknown';

/** One row of the WSL distribution list: the name, the default marker, the state and the version. */
export interface DistroRow {
  readonly name: string;
  readonly isDefault: boolean;
  readonly state: DistroState;
  readonly version: DistroVersion;
}

/**
 * The result of the list parse: the rows, or the number, among the lines after the header, of the first line
 * that does not fit the row layout.
 */
export type ListResult =
  | {readonly kind: 'rows'; readonly rows: readonly DistroRow[]}
  | {readonly kind: 'unparseable'; readonly reason: string};

/**
 * The layout of a row after the header: a name, the state word, and the version column when the print carries
 * one. The header words are display-language, so the columns are found from this layout, never from them.
 */
const ROW_PATTERN = /^(.+?)\s+(\S+)(?:\s+(\d+))?$/;

/** The state a state word names: the four printed words are their states; every other word is `other`. */
function stateOf(word: string): DistroState {
  const lowered = word.toLowerCase();
  if (
    lowered === 'running' ||
    lowered === 'stopped' ||
    lowered === 'installing' ||
    lowered === 'converting'
  ) {
    return lowered;
  }
  return 'other';
}

/** The version of the version column: `1` and `2` are the versions; any other number, or no column, is `unknown`. */
function versionOf(versionText: string | undefined): DistroVersion {
  if (versionText === '1') {
    return 1;
  }
  if (versionText === '2') {
    return 2;
  }
  return 'unknown';
}

/**
 * One line after the header: a first non-space character `*` marks the default, then the name, the state word and
 * the version column. A line that does not fit the layout is undefined.
 */
function rowOf(line: string): DistroRow | undefined {
  const withoutLeadingSpaces = line.trimStart();
  const isDefault = withoutLeadingSpaces.startsWith('*');
  const body = isDefault ? withoutLeadingSpaces.slice(1) : line;
  const match = ROW_PATTERN.exec(body.trim());
  if (match === null) {
    return undefined;
  }
  return {
    name: String(match[1]),
    isDefault,
    state: stateOf(String(match[2])),
    version: versionOf(match[3]),
  };
}

/**
 * The rows of the list text: the first remaining line is the header and is skipped, the empty lines are not rows,
 * and the first line that does not fit the layout ends the parse with its number among the lines after the header.
 */
export function parseList(text: string): ListResult {
  const lines = text
    .split('\n')
    .map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter(line => line.trim() !== '');
  const rows: DistroRow[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const rowData = rowOf(line);
    if (rowData === undefined) {
      return {kind: 'unparseable', reason: `line:${String(index + 1)}`};
    }
    rows.push(rowData);
  }
  return {kind: 'rows', rows};
}
