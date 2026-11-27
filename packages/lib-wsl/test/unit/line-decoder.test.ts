import {strictEqual, deepStrictEqual} from 'node:assert/strict';
import {LONGEST_PENDING_LINE} from 'lib-host';
import {LineDecoder} from '../../src/line-decoder.ts';
import {utf8Output} from '../../src/testing/fake-wsl.ts';

/** The lines a decoder delivers for `chunks`, flushed at the end. */
function decoded(chunks: readonly Uint8Array[]): string[] {
  const lines: string[] = [];
  const decoder = new LineDecoder(line => lines.push(line));
  for (const chunk of chunks) {
    decoder.push(chunk);
  }
  decoder.flush();
  return lines;
}

describe('LineDecoder (D1 on the channel contract bounds)', () => {
  it('#3282: delivers a line split across chunks whole', () => {
    deepStrictEqual(decoded([utf8Output('ab'), utf8Output('c\nd\n')]), [
      'abc',
      'd',
    ]);
  });

  it('#3282: delivers the last line when the stream ends without a line end', () => {
    deepStrictEqual(decoded([utf8Output('a\nb')]), ['a', 'b']);
  });

  it('#3282: strips NULs from the text', () => {
    deepStrictEqual(decoded([utf8Output('a\u0000b\n')]), ['ab']);
  });

  it('#3282: keeps a multi-byte character split across chunks', () => {
    const bytes = utf8Output('é\n');
    deepStrictEqual(decoded([bytes.subarray(0, 1), bytes.subarray(1)]), ['é']);
  });

  it('#3282: cuts a line with no end in parts of at most the bound, keeping all of it', () => {
    const lines = decoded([
      utf8Output('x'.repeat(LONGEST_PENDING_LINE * 2 + 5)),
    ]);
    strictEqual(
      lines.every(line => line.length <= LONGEST_PENDING_LINE) &&
        lines.join('').length === LONGEST_PENDING_LINE * 2 + 5,
      true,
    );
  });
});
