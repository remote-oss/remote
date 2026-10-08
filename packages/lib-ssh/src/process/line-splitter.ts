/**
 * @fileoverview Cuts a stream of text pieces into lines.
 */

/** Delivers whole lines, without their line end, as the pieces of a stream arrive. */
export class LineSplitter {
  private readonly onLine: (line: string) => void;
  private pending = '';

  /** A splitter that calls `onLine` for each complete line. */
  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  /** Takes the next piece of the stream. */
  push(piece: string): void {
    const text = this.pending + piece;
    const lastEnd = text.lastIndexOf('\n');
    if (lastEnd < 0) {
      this.pending = text;
      return;
    }
    this.pending = text.slice(lastEnd + 1);
    for (const line of text.slice(0, lastEnd).split('\n')) {
      this.onLine(line.replace(/\r$/, ''));
    }
  }

  /** Delivers the last line when the stream ended without a line end. */
  flush(): void {
    if (this.pending !== '') {
      this.onLine(this.pending.replace(/\r$/, ''));
      this.pending = '';
    }
  }
}
