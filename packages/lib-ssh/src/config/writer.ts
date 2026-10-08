/**
 * @fileoverview Places a new Host block into the text of a configuration file: before the first `Host` or `Match`
 * line so that it takes precedence, or after the file's global lines when it has no block yet.
 */

import type {HostBlock} from './add-host.ts';

/** A line that opens a block. */
const BLOCK_START = /^\s*(host|match)(\s|=|$)/i;

/** A line that starts with blanks and holds more than blanks. */
const INDENTED_LINE = /^[ \t]+\S/;

/** The indentation of option lines when the file offers none to copy. */
const DEFAULT_OPTION_INDENT = '  ';

/** The file text with the block added. Duplicates of an existing host are written as they are. */
export function writeHostBlock(fileText: string, block: HostBlock): string {
  const lineEnd = fileText.includes('\r\n') ? '\r\n' : '\n';
  if (fileText.trim() === '') {
    return `${fileText}${renderBlock(block, '', DEFAULT_OPTION_INDENT, lineEnd)}`;
  }
  const lines = fileText.split('\n');
  const firstBlock = lines.findIndex(line => BLOCK_START.test(line));
  if (firstBlock < 0) {
    const separated = fileText.endsWith('\n')
      ? fileText
      : `${fileText}${lineEnd}`;
    const blankBefore = /(^|\n)[ \t\r]*\n$/.test(separated) ? '' : lineEnd;
    return `${separated}${blankBefore}${renderBlock(block, '', DEFAULT_OPTION_INDENT, lineEnd)}`;
  }
  const optionIndent = copiedIndent(lines.slice(firstBlock + 1));
  const hostIndent = hostIndentFor(optionIndent);
  const offset =
    lines.slice(0, firstBlock).join('\n').length + (firstBlock > 0 ? 1 : 0);
  return `${fileText.slice(0, offset)}${renderBlock(block, hostIndent, optionIndent, lineEnd)}${lineEnd}${fileText.slice(offset)}`;
}

/** The block's text, each line ended. */
function renderBlock(
  block: HostBlock,
  hostIndent: string,
  optionIndent: string,
  lineEnd: string,
): string {
  const lines = [
    `${hostIndent}Host ${block.alias}`,
    ...block.lines.map(line => `${optionIndent}${line.keyword} ${line.value}`),
  ];
  return lines.map(line => `${line}${lineEnd}`).join('');
}

/** The indentation of the first indented line after the first block start, or the default. */
function copiedIndent(linesAfterBlockStart: string[]): string {
  for (const line of linesAfterBlockStart) {
    if (INDENTED_LINE.test(line)) {
      return line.slice(0, line.length - line.trimStart().length);
    }
  }
  return DEFAULT_OPTION_INDENT;
}

/** The `Host` line's indentation: two spaces less than the options', none for tab or short indentation. */
function hostIndentFor(optionIndent: string): string {
  return /^ {2,}$/.test(optionIndent) ? optionIndent.slice(2) : '';
}
