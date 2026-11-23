/**
 * @fileoverview Cuts the bytes a distro's program prints into lines of UTF-8 text.
 */

/** Delivers whole lines, without their line end, as the bytes of a stream arrive. */
export class LineDecoder {
  private readonly onLine: (line: string) => void;
  private readonly decoder = new TextDecoder('utf-8');
  private pending = '';

  /** A decoder that calls `onLine` for each complete line. */
  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  /** Takes the next bytes of the stream. */
  push(chunk: Uint8Array): void {
    const text = (
      this.pending + this.decoder.decode(chunk, {stream: true})
    ).replaceAll('\u0000', '');
    const lastEnd = text.lastIndexOf('\n');
    this.pending = text.slice(lastEnd + 1);
    if (lastEnd >= 0) {
      for (const line of text.slice(0, lastEnd).split('\n')) {
        this.onLine(line.replace(/\r$/, ''));
      }
    }
  }

  /** Delivers the last line when the stream ended without a line end. */
  flush(): void {
    const rest = (this.pending + this.decoder.decode()).replaceAll(
      '\u0000',
      '',
    );
    this.pending = '';
    if (rest !== '') {
      this.onLine(rest.replace(/\r$/, ''));
    }
  }
}
