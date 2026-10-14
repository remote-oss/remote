/**
 * @fileoverview Splits what a stream prints into lines, for the exec channel and the CLI host.
 */

import {StringDecoder} from 'node:string_decoder';

/** Splits what a stream prints into lines: `\n` ends a line, and a `\r` before it goes. */
export function lineSplitter(onLine: (line: string) => void): {
  push(chunk: Buffer): void;
  flush(): void;
} {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  function told(line: string): void {
    onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  }
  return {
    push: chunk => {
      const text = pending + decoder.write(chunk);
      const lineEnd = text.lastIndexOf('\n');
      pending = text.slice(lineEnd + 1);
      const complete = lineEnd < 0 ? [] : text.slice(0, lineEnd).split('\n');
      for (const part of complete) {
        told(part);
      }
    },
    flush: () => {
      const rest = pending + decoder.end();
      pending = '';
      if (rest !== '') {
        told(rest);
      }
    },
  };
}
