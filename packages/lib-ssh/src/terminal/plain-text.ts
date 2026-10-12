/**
 * @fileoverview The plain text of a terminal's output: the escape sequences a terminal emits are removed from a stream
 * given in pieces, and a sequence a piece ends inside is held for the next piece.
 */

const ESCAPE = '\u001b';
const BELL = '\u0007';

/** Where a sequence that starts with an escape ends in `text` (the index after its last character), or -1. */
function sequenceEnd(text: string): number {
  const kind = text[1];
  if (kind === undefined) {
    return -1;
  }
  if (kind === '[') {
    return csiEnd(text);
  }
  if (kind === ']') {
    return stringEnd(text, true);
  }
  if ('PX^_'.includes(kind)) {
    return stringEnd(text, false);
  }
  if (kind >= ' ' && kind <= '/') {
    return intermediateEnd(text);
  }
  return 2;
}

/** The end of a control sequence: parameter bytes, intermediate bytes and one final byte. */
function csiEnd(text: string): number {
  for (let index = 2; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index + 1;
    }
    if (code < 0x20 || code > 0x3f) {
      return index;
    }
  }
  return -1;
}

/** The end of a string sequence: up to the string terminator, or the bell when `bellEnds`. */
function stringEnd(text: string, bellEnds: boolean): number {
  for (let index = 2; index < text.length; index++) {
    if (bellEnds && text[index] === BELL) {
      return index + 1;
    }
    if (text[index] === ESCAPE && text[index + 1] === '\\') {
      return index + 2;
    }
  }
  return -1;
}

/** The end of an escape with intermediate bytes: the intermediates and one final byte. */
function intermediateEnd(text: string): number {
  for (let index = 2; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0x30 && code <= 0x7e) {
      return index + 1;
    }
    if (code < 0x20 || code > 0x2f) {
      return index;
    }
  }
  return -1;
}

/** Removes terminal escape sequences from a stream given in pieces; a sequence split across pieces is held. */
export class PlainTextFilter {
  private held = '';

  /** The plain text of `piece`, with any escape sequence it completes removed. */
  push(piece: string): string {
    let text = this.held + piece;
    this.held = '';
    let plain = '';
    for (
      let start = text.indexOf(ESCAPE);
      start !== -1;
      start = text.indexOf(ESCAPE)
    ) {
      plain += text.slice(0, start);
      text = text.slice(start);
      const end = sequenceEnd(text);
      if (end === -1) {
        this.held = text;
        return plain;
      }
      text = text.slice(end);
    }
    return plain + text;
  }

  /** What is held at the end of the stream: an unfinished sequence is dropped, so this gives ''. */
  flush(): string {
    this.held = '';
    return '';
  }
}
