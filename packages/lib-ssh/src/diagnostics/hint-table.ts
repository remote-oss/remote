/**
 * @fileoverview The table of the session troubleshooting terminal: the error hints of an attempt drawn with
 * box-drawing characters for a terminal of a given width, as pure text. The outer border is double and the inner rules
 * are single; "Status" is centred, the other headers are left-aligned; text wraps at spaces, and a word that is longer
 * than its column breaks after `/`, `.`, `_` or `-`; a list item starts with a bullet and wraps under itself.
 */

/** One row of the table: an error hint as the table shows it. */
export interface HintTableRow {
  status: string;
  message: string;
  mitigations: readonly string[];
  resources: readonly string[];
}

/** The text of the column headers. */
export interface HintTableHeaders {
  status: string;
  message: string;
  mitigations: string;
  resources: string;
}

/** The column headers in English. */
const HEADERS: HintTableHeaders = {
  status: 'Status',
  message: 'Message',
  mitigations: 'Mitigations',
  resources: 'Resources',
};

/** The bullet of a list item and the width it takes. */
const BULLET = '• ';

/** The narrowest a wrapped column may be, whatever the terminal's width. */
const MINIMUM_COLUMN = 8;

/** The message cell of a hint: its message, and its details in brackets when it has any. */
export function messageCellOf(
  message: string,
  details: string | undefined,
): string {
  return details === undefined || details === ''
    ? message
    : `${message} (${details})`;
}

/** The pieces of `word` a line may end after: each ends with `/`, `.`, `_` or `-`, but the last. */
function piecesOf(word: string): string[] {
  return Array.from(
    word.matchAll(/[^/._-]*[/._-]?/gu),
    found => found[0],
  ).filter(piece => piece !== '');
}

/** `word` broken into lines of at most `width` characters, after `/`, `.`, `_` or `-` where it can, anywhere else. */
function brokenWord(word: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const piece of piecesOf(word)) {
    let rest = piece;
    while (line.length + rest.length > width) {
      if (line === '') {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      } else {
        lines.push(line);
        line = '';
      }
    }
    line += rest;
  }
  return [...lines, line];
}

/** `text` wrapped to lines of at most `width` characters: at spaces, and inside a word longer than a line. */
export function wrappedText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter(each => each !== '')) {
    if (line !== '' && line.length + 1 + word.length <= width) {
      line = `${line} ${word}`;
    } else if (word.length <= width) {
      if (line !== '') {
        lines.push(line);
      }
      line = word;
    } else {
      if (line !== '') {
        lines.push(line);
      }
      lines.push(...brokenWord(word, width));
      line = '';
    }
  }
  if (line !== '' || lines.length === 0) {
    lines.push(line);
  }
  return lines;
}

/**
 * The lines of one list item in a column of `width`: after the bullet, wrapping under itself; an item whose first
 * word does not fit after the bullet leaves the bullet alone and starts on the next line.
 */
function itemLines(item: string, width: number): string[] {
  const inner = width - BULLET.length;
  if (item.split(' ').some(word => word.length > inner)) {
    return ['•', ...wrappedText(item, width)];
  }
  const [first = '', ...rest] = wrappedText(item, inner);
  return [
    `${BULLET}${first}`,
    ...rest.map(line => `${' '.repeat(BULLET.length)}${line}`),
  ];
}

/** The lines of a list cell: its items one after the other. */
function listLines(items: readonly string[], width: number): string[] {
  return items.flatMap(item => itemLines(item, width));
}

/** `text` padded on the right to `width`. */
function padded(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - text.length));
}

/** `text` centred in `width`, the extra cell going to the right. */
function centred(text: string, width: number): string {
  const left = Math.floor(Math.max(0, width - text.length) / 2);
  return padded(' '.repeat(left) + text, width);
}

/** One column: its header, its alignment and its width. */
interface Column {
  header: string;
  centre: boolean;
  width: number;
}

/** The lines of one cell, and the column it is in. */
interface Cell {
  column: Column;
  lines: readonly string[];
}

/** The lines of a horizontal rule: its left, fill, join and right characters over the columns' widths. */
function rule(
  columns: readonly Column[],
  left: string,
  fill: string,
  join: string,
  right: string,
): string {
  return `${left}${columns.map(column => fill.repeat(column.width + 2)).join(join)}${right}`;
}

/** The lines of one row of cells, as tall as its tallest cell. */
function rowLines(cells: readonly Cell[], header: boolean): string[] {
  const height = Math.max(1, ...cells.map(cell => cell.lines.length));
  return Array.from({length: height}, (unused, index) => {
    const parts = cells.map(({column, lines}) => {
      const text = lines[index] ?? '';
      return ` ${header && column.centre ? centred(text, column.width) : padded(text, column.width)} `;
    });
    return `║${parts.join('│')}║`;
  });
}

/**
 * The table of `rows` for a terminal `width` cells wide: a Status column as wide as its longest cell and a Message
 * column that takes the rest, with Mitigations and Resources beside them when a row has either, the three sharing the
 * rest equally. One data row for each hint, with a single rule between rows.
 */
export function hintTable(
  rows: readonly HintTableRow[],
  width: number,
  headers: HintTableHeaders = HEADERS,
): string[] {
  const withLists = rows.some(
    entry => entry.mitigations.length > 0 || entry.resources.length > 0,
  );
  const names = withLists
    ? (['status', 'message', 'mitigations', 'resources'] as const)
    : (['status', 'message'] as const);
  const statusWidth = Math.max(
    headers.status.length,
    ...rows.map(entry => entry.status.length),
  );
  const borders = names.length + 1;
  const padding = 2 * names.length;
  const flexible = names.length - 1;
  const rest = Math.max(
    flexible * MINIMUM_COLUMN,
    width - borders - padding - statusWidth,
  );
  const each = Math.floor(rest / flexible);
  type Name = (typeof names)[number];
  const spec: Record<Name, Column> = {
    status: {header: headers.status, centre: true, width: statusWidth},
    message: {header: headers.message, centre: false, width: each},
    mitigations: {header: headers.mitigations, centre: false, width: each},
    resources: {header: headers.resources, centre: false, width: each},
  };
  const all = names.map(name => spec[name]);
  const dataRows = rows.map(entry => {
    const lines: Record<Name, string[]> = {
      status: [entry.status],
      message: wrappedText(entry.message, each),
      mitigations: listLines(entry.mitigations, each),
      resources: listLines(entry.resources, each),
    };
    return names.map(name => ({column: spec[name], lines: lines[name]}));
  });
  const lines = [
    rule(all, '╔', '═', '╤', '╗'),
    ...rowLines(
      all.map(column => ({column, lines: [column.header]})),
      true,
    ),
    rule(all, '╟', '─', '┼', '╢'),
  ];
  dataRows.forEach((cells, index) => {
    if (index > 0) {
      lines.push(rule(all, '╟', '─', '┼', '╢'));
    }
    lines.push(...rowLines(cells, false));
  });
  lines.push(rule(all, '╚', '═', '╧', '╝'));
  return lines;
}
