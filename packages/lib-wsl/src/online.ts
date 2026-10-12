/**
 * @fileoverview The catalogue of distributions that can be installed, as `wsl.exe --list --online` prints it once
 * decoded: an explanation, a blank line, and a table whose columns come from the layout of its header line.
 */

/** One distribution that can be installed. */
export interface OnlineRow {
  readonly name: string;
  readonly friendlyName: string;
}

/** The rows of the table, or why the text is not a table. */
export type OnlineResult =
  | {readonly kind: 'rows'; readonly rows: readonly OnlineRow[]}
  | {readonly kind: 'unparseable'; readonly reason: string};

/** The blocks of consecutive non-blank lines, in order. */
function blocksOf(text: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of text.split('\n').map(item => item.replace(/\r$/, ''))) {
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    blocks.push(current);
  }
  return blocks;
}

/** Where the second column starts: the first non-space after the first run of two or more spaces. */
function secondColumnOf(header: string): number | undefined {
  const found = / {2,}\S/.exec(header);
  return found === null ? undefined : found.index + found[0].length - 1;
}

/** Reads the last block of the text as the table of distributions. */
export function parseOnline(text: string): OnlineResult {
  const table = blocksOf(text).at(-1);
  if (table === undefined) {
    return {kind: 'rows', rows: []};
  }
  const [header = '', ...lines] = table;
  const column = secondColumnOf(header);
  if (column === undefined) {
    return {kind: 'unparseable', reason: 'header'};
  }
  const rows: OnlineRow[] = [];
  for (const [index, line] of lines.entries()) {
    const name = line.slice(0, column).trim();
    const friendlyName = line.slice(column).trim();
    if (name === '' || friendlyName === '') {
      return {kind: 'unparseable', reason: `line:${String(index + 1)}`};
    }
    rows.push({name, friendlyName});
  }
  return {kind: 'rows', rows};
}
