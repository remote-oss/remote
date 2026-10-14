import {deepStrictEqual} from 'node:assert';
import {lineSplitter} from '../../src/line-splitter.ts';

/** The lines the splitter tells for `chunks`, then flushed. */
function linesOf(chunks: Buffer[]): string[] {
  const lines: string[] = [];
  const splitter = lineSplitter(line => lines.push(line));
  for (const chunk of chunks) {
    splitter.push(chunk);
  }
  splitter.flush();
  return lines;
}

describe('the line splitter (card containers-02)', () => {
  it('contracts: a line ends at a line feed and loses a carriage return before it', () => {
    deepStrictEqual(linesOf([Buffer.from('a\r\nb\n')]), ['a', 'b']);
  });

  it('contracts: a line cut between chunks is told whole, and the last partial line on flush', () => {
    deepStrictEqual(
      linesOf([Buffer.from('on'), Buffer.from('e\ntw'), Buffer.from('o')]),
      ['one', 'two'],
    );
  });

  it('contracts: a character cut between chunks is decoded whole', () => {
    const bytes = Buffer.from('é\n');
    deepStrictEqual(linesOf([bytes.subarray(0, 1), bytes.subarray(1)]), ['é']);
  });

  it('contracts: a final partial line that ends with a carriage return is told without it, and nothing flushes nothing', () => {
    deepStrictEqual(
      [linesOf([Buffer.from('end\r')]), linesOf([])],
      [['end'], []],
    );
  });
});
