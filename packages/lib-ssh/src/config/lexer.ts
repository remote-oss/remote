/**
 * @fileoverview Splits the text of an SSH configuration file into keyword lines. The reader is lenient: it skips
 * text that is not a keyword line, ignores keywords it does not know, and fails only on an unterminated quote.
 */

/** One keyword line: the keyword as written and its value split into words, quotes removed. */
export interface Directive {
  keyword: string;
  words: string[];
}

/** The outcome of reading a file: its keyword lines, or why it could not be read. */
export type LexResult = {directives: Directive[]} | {parseError: string};

/** The keyword whose missing value never reaches into the next line. */
const HOST_KEYWORD = 'host';

/** Characters that separate words on a line. */
const BLANKS = new Set([' ', '\t', '\r']);

/** Reads every keyword line of a file's text. A leading byte order mark is ignored. */
export function lexConfiguration(text: string): LexResult {
  const scanner = new Scanner(text.startsWith('﻿') ? text.slice(1) : text);
  const directives: Directive[] = [];
  for (;;) {
    scanner.skipSpace(/* acrossLines= */ true);
    if (scanner.atEnd()) {
      return {directives};
    }
    if (scanner.peek() === '#') {
      scanner.skipLine();
      continue;
    }
    const keyword = scanner.readKeyword();
    const acrossLines = keyword.toLowerCase() !== HOST_KEYWORD;
    scanner.skipSpace(acrossLines);
    if (scanner.peek() === '=') {
      scanner.advance();
      scanner.skipSpace(/* acrossLines= */ false);
    }
    const words = scanner.readWords();
    if (words === undefined) {
      return {parseError: `unterminated quote after ${keyword}`};
    }
    directives.push({keyword, words});
  }
}

/** A cursor over the text of one file. */
class Scanner {
  private position = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  /** Whether the whole text has been read. */
  atEnd(): boolean {
    return this.position >= this.text.length;
  }

  /** The character under the cursor, or the empty string at the end. */
  peek(): string {
    return this.text.charAt(this.position);
  }

  /** Moves past one character. */
  advance(): void {
    this.position++;
  }

  /** Moves past blanks, and past line breaks too when `acrossLines` is set. */
  skipSpace(acrossLines: boolean): void {
    while (BLANKS.has(this.peek()) || (acrossLines && this.peek() === '\n')) {
      this.position++;
    }
  }

  /** Moves to the start of the next line. */
  skipLine(): void {
    while (!this.atEnd() && this.peek() !== '\n') {
      this.position++;
    }
  }

  /** The keyword: everything up to a blank, a line break or `=`. */
  readKeyword(): string {
    const start = this.position;
    while (
      !this.atEnd() &&
      !BLANKS.has(this.peek()) &&
      this.peek() !== '\n' &&
      this.peek() !== '='
    ) {
      this.position++;
    }
    return this.text.slice(start, this.position);
  }

  /**
   * The words of the rest of the line. A double-quoted word keeps its blanks; an unquoted `#` ends the line.
   * Undefined when a quote is still open at the end of the line or of the text.
   */
  readWords(): string[] | undefined {
    const words: string[] = [];
    let word: string | undefined;
    while (!this.atEnd() && this.peek() !== '\n') {
      const character = this.peek();
      if (character === '#') {
        this.skipLine();
        break;
      }
      this.position++;
      if (BLANKS.has(character)) {
        if (word !== undefined) {
          words.push(word);
        }
        word = undefined;
      } else if (character === '"') {
        const quoted = this.readQuoted();
        if (quoted === undefined) {
          return undefined;
        }
        word = (word ?? '') + quoted;
      } else {
        word = (word ?? '') + character;
      }
    }
    if (word !== undefined) {
      words.push(word);
    }
    return words;
  }

  /** The text up to the closing quote, which is consumed; undefined when the line or the text ends first. */
  private readQuoted(): string | undefined {
    const start = this.position;
    while (!this.atEnd() && this.peek() !== '"' && this.peek() !== '\n') {
      this.position++;
    }
    if (this.peek() !== '"') {
      return undefined;
    }
    const quoted = this.text.slice(start, this.position);
    this.position++;
    return quoted;
  }
}
