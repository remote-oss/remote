/**
 * @fileoverview The table of the session troubleshooting terminal: the error hints of an attempt drawn with
 * box-drawing characters for a terminal of a given width, as pure text. The outer border is double and the inner rules
 * are single; "Status" is centred, the other headers are left-aligned; text wraps at spaces, and a word that is longer
 * than its column breaks after `/`, `.`, `_` or `-`; a list item starts with a bullet and wraps under itself. A stretch
 * of a cell that a row marks as a link is drawn bold and underlined, whatever lines it wraps over.
 */

/** A stretch of a text: where it starts and how many characters it has. */
export interface LinkRange {
  start: number;
  length: number;
}

/** One row of the table: an error hint as the table shows it. */
export interface HintTableRow {
  status: string;
  message: string;
  mitigations: readonly string[];
  resources: readonly string[];
  /** The stretches of the message and of each mitigation drawn as links; a row without them draws all plain. */
  links?: {
    message?: readonly LinkRange[];
    mitigations?: readonly (readonly LinkRange[])[];
  };
}

/** The marks that start and end a link in a text on its way to the lines; they take no width and are replaced when a line is drawn. */
const LINK_START = '\uE000';
const LINK_END = '\uE001';

/** What starts and ends bold, underlined text in the terminal. */
const LINK_ON = '\u001b[1;4m';
const LINK_OFF = '\u001b[0m';

/** Whether `character` is one of the two link marks. */
function isMark(character: string | undefined): boolean {
  return character === LINK_START || character === LINK_END;
}

/** The characters of `text` that take room: the link marks do not. */
function widthOf(text: string): number {
  return text.replaceAll(LINK_START, '').replaceAll(LINK_END, '').length;
}

/** `text` split after its first `count` characters that take room, the marks that follow them going with the first part. */
function splitAfter(text: string, count: number): [string, string] {
  let seen = 0;
  let index = 0;
  while (index < text.length && (seen < count || isMark(text[index]))) {
    seen += isMark(text[index]) ? 0 : 1;
    index += 1;
  }
  return [text.slice(0, index), text.slice(index)];
}

/** `text` with a link mark at each start and end of `ranges`, which do not overlap. */
function withLinkMarks(
  text: string,
  ranges: readonly LinkRange[] | undefined,
): string {
  let marked = text;
  for (const range of [...(ranges ?? [])].sort(
    (left, right) => right.start - left.start,
  )) {
    marked = `${marked.slice(0, range.start)}${LINK_START}${marked.slice(range.start, range.start + range.length)}${LINK_END}${marked.slice(range.start + range.length)}`;
  }
  return marked;
}

/** `lines` with every link closed at the end of its line and opened again on the next, so that each line stands alone. */
function balanced(lines: readonly string[]): string[] {
  let open = false;
  return lines.map(line => {
    const start = open ? LINK_START : '';
    for (const character of line) {
      if (character === LINK_START) {
        open = true;
      } else if (character === LINK_END) {
        open = false;
      }
    }
    return `${start}${line}${open ? LINK_END : ''}`;
  });
}

/** The text of the column headers. */
export interface HintTableHeaders {
  status: string;
  message: string;
  mitigations: string;
  resources: string;
}

/** The header of the Status column in English; a constant of its own, so a scan for hint statuses does not take it for one. */
const STATUS_HEADER = 'Status';

/** The column headers in English. */
const HEADERS: HintTableHeaders = {
  status: STATUS_HEADER,
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
    while (widthOf(line) + widthOf(rest) > width) {
      if (line === '') {
        const [head, tail] = splitAfter(rest, width);
        lines.push(head);
        rest = tail;
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
    if (line !== '' && widthOf(line) + 1 + widthOf(word) <= width) {
      line = `${line} ${word}`;
    } else if (widthOf(word) <= width) {
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
  if (item.split(' ').some(word => widthOf(word) > inner)) {
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
  return text + ' '.repeat(Math.max(0, width - widthOf(text)));
}

/** `text` centred in `width`, the extra cell going to the right. */
function centred(text: string, width: number): string {
  const left = Math.floor(Math.max(0, width - widthOf(text)) / 2);
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
    return `║${parts.join('│')}║`
      .replaceAll(LINK_START, LINK_ON)
      .replaceAll(LINK_END, LINK_OFF);
  });
}

/**
 * The table of `rows` for a terminal `width` cells wide: a Status column as wide as its longest cell and a Message
 * column that takes the rest, with a Mitigations column when a row has a mitigation and a Resources column when a row
 * has a resource, each of them and the Message column sharing the rest equally. One data row for each hint, with a
 * single rule between rows.
 */
export function hintTable(
  rows: readonly HintTableRow[],
  width: number,
  headers: HintTableHeaders = HEADERS,
): string[] {
  const names = [
    'status' as const,
    'message' as const,
    ...(rows.some(entry => entry.mitigations.length > 0)
      ? ['mitigations' as const]
      : []),
    ...(rows.some(entry => entry.resources.length > 0)
      ? ['resources' as const]
      : []),
  ];
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
  type Name = 'status' | 'message' | 'mitigations' | 'resources';
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
      message: balanced(
        wrappedText(withLinkMarks(entry.message, entry.links?.message), each),
      ),
      mitigations: balanced(
        listLines(
          entry.mitigations.map((item, index) =>
            withLinkMarks(item, entry.links?.mitigations?.[index]),
          ),
          each,
        ),
      ),
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
