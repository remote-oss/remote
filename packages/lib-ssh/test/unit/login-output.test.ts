import {deepStrictEqual} from 'node:assert';
import {RecordingTerminals} from '../../src/testing/recording-terminal.ts';
import {followLoginOutput} from '../../src/terminal/login-output.ts';

const INVOCATION = {program: 'ssh', arguments: ['host'], environment: {}};

function fixture(finished = () => false) {
  const terminals = new RecordingTerminals();
  const session = terminals.open(INVOCATION, 'install', false);
  const [terminal] = terminals.opened;
  if (terminal === undefined) {
    throw new Error('no terminal was opened');
  }
  const heard = {first: 0, reader: [] as string[], lines: [] as string[]};
  followLoginOutput(session, {
    isFinished: finished,
    onFirstOutput: () => {
      heard.first += 1;
    },
    reader: {
      push: text => {
        heard.reader.push(text);
      },
    },
    lines: {
      push: text => {
        heard.lines.push(text);
      },
    },
  });
  return {terminal, heard};
}

describe('the output of a login terminal (card ssh-29)', () => {
  it('F-2105 BR-3: the first output is told once, however much follows', () => {
    const {terminal, heard} = fixture();
    terminal.write('a');
    terminal.write('b');
    deepStrictEqual(heard.first, 1);
  });

  it('F-2308 BR-5: every piece reaches the reader and the line sink in order', () => {
    const {terminal, heard} = fixture();
    terminal.write('a\n');
    terminal.write('b');
    deepStrictEqual(
      [heard.reader, heard.lines],
      [
        ['a\n', 'b'],
        ['a\n', 'b'],
      ],
    );
  });

  it('contracts: output after the login is finished reaches nothing', () => {
    let finished = false;
    const {terminal, heard} = fixture(() => finished);
    terminal.write('a');
    finished = true;
    terminal.write('b');
    deepStrictEqual(
      [heard.first, heard.reader, heard.lines],
      [1, ['a'], ['a']],
    );
  });

  it('contracts: output that arrives when the login is already finished does not count as the first', () => {
    const {terminal, heard} = fixture(() => true);
    terminal.write('a');
    deepStrictEqual(heard.first, 0);
  });
});
