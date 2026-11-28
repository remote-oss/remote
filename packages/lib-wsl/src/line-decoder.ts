/**
 * @fileoverview Cuts the bytes a distro's program prints into lines of UTF-8 text, each at most as long as the channel
 * contract bounds a pending line.
 */

import {BoundedLines} from 'lib-host';

/** Delivers whole lines, without their line end, as the bytes of a stream arrive; a long line comes in bounded parts. */
export class LineDecoder {
  private readonly decoder = new TextDecoder('utf-8');
  private readonly lines: BoundedLines;

  /** A decoder that calls `onLine` for each complete line. */
  constructor(onLine: (line: string) => void) {
    this.lines = new BoundedLines(onLine);
  }

  /** Takes the next bytes of the stream. */
  push(chunk: Uint8Array): void {
    this.lines.push(
      this.decoder.decode(chunk, {stream: true}).replaceAll('\u0000', ''),
    );
  }

  /** Delivers the last line when the stream ended without a line end. */
  flush(): void {
    this.lines.push(this.decoder.decode().replaceAll('\u0000', ''));
    this.lines.flush();
  }
}
