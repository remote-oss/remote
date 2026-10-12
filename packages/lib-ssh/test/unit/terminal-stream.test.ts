import {deepStrictEqual} from 'node:assert';
import {TerminalStream} from '../../src/terminal/terminal-stream.ts';
import {LineSplitter} from '../../src/process/line-splitter.ts';
import type {TerminalEnd} from '../../src/index.ts';

/** The output a stream delivers for the pieces written, and what it was told at the end when `ends` is set. */
function streamed(
  pieces: string[],
  ends = false,
): {output: string[]; end: TerminalEnd | undefined; order: string[]} {
  const stream = new TerminalStream();
  const output: string[] = [];
  const order: string[] = [];
  let end: TerminalEnd | undefined;
  stream.onOutput(text => {
    output.push(text);
    order.push('output');
  });
  stream.onEnd(finished => {
    end = finished;
    order.push('end');
  });
  for (const piece of pieces) {
    stream.write(piece);
  }
  if (ends) {
    stream.end(0, 'process');
  }
  return {output, end, order};
}

describe('the line ends of the terminal stream (card ssh-25 table)', () => {
  it('#299: a line end that a pty doubled is one line feed', () => {
    deepStrictEqual(streamed(['a\r\r\n']).output, ['a\n']);
  });

  it('#299: a carriage return and line feed is one line feed', () => {
    deepStrictEqual(streamed(['a\r\n']).output, ['a\n']);
  });

  it('#299: a lone carriage return stays', () => {
    deepStrictEqual(streamed(['a\rb']).output, ['a\rb']);
  });

  it('#299: a carriage return that ends a piece joins a line feed that starts the next', () => {
    deepStrictEqual(streamed(['a\r', '\nb']).output, ['a', '\nb']);
  });

  it('#299: two carriage returns that end a piece join a line feed that starts the next', () => {
    deepStrictEqual(streamed(['a\r\r', '\nb']).output, ['a', '\nb']);
  });

  it('#299: a carriage return that ends a piece and is followed by text was a lone one', () => {
    deepStrictEqual(streamed(['x\r', 'y']).output, ['x', '\ry']);
  });

  it('#299: a held carriage return is delivered at the end, before the end is told', () => {
    const result = streamed(['a\r'], true);
    deepStrictEqual(
      [result.output, result.order],
      [
        ['a', '\r'],
        ['output', 'output', 'end'],
      ],
    );
  });

  it('#299: a terminal whose only output was a carriage return ends with output', () => {
    const result = streamed(['\r'], true);
    deepStrictEqual([result.output, result.end?.hadOutput], [['\r'], true]);
  });

  it('#299: a carriage return alone, then a line feed, is one line feed', () => {
    const result = streamed(['\r', '\n'], true);
    deepStrictEqual([result.output, result.end?.hadOutput], [['\n'], true]);
  });

  it('#299: a carriage return alone is held while the terminal runs', () => {
    deepStrictEqual(streamed(['\r']).output, []);
  });

  it('#299: an escape sequence and a doubled line end give a line feed', () => {
    deepStrictEqual(streamed(['\x1b[0mok\r\r\n']).output, ['ok\n']);
  });

  it('#353: the lines of a busy port as a pty delivers them are exact', () => {
    const lines = [
      'bind [127.0.0.1]:18111: Address already in use',
      'channel_setup_fwd_listener_tcpip: cannot listen to port: 18111',
      'Could not request local forwarding.',
      'Connected to SSH Host - Please do not close this terminal',
    ];
    const heard: string[] = [];
    const splitter = new LineSplitter(line => heard.push(line));
    const stream = new TerminalStream();
    stream.onOutput(text => {
      splitter.push(text);
    });
    stream.write(lines.map(line => `${line}\r\r\n`).join(''));
    deepStrictEqual(heard, lines);
  });

  it('F-2308: nothing is delivered after the end', () => {
    const stream = new TerminalStream();
    const output: string[] = [];
    stream.onOutput(text => output.push(text));
    stream.end(0, 'process');
    stream.write('late\r\n');
    deepStrictEqual(output, []);
  });

  it('F-2308: ending twice releases a held carriage return once', () => {
    const stream = new TerminalStream();
    const output: string[] = [];
    stream.onOutput(text => output.push(text));
    stream.write('\r');
    stream.end(0, 'process');
    stream.end(1, 'user');
    deepStrictEqual(output, ['\r']);
  });
});
