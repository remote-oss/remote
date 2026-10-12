import {deepStrictEqual} from 'node:assert';
import {RecordingTerminals} from '../../src/testing/recording-terminal.ts';
import type {Invocation, TerminalEnd} from '../../src/index.ts';

const INVOCATION: Invocation = {
  program: 'ssh',
  arguments: ['host'],
  environment: {},
};

function opened(reveal = false) {
  const terminals = new RecordingTerminals();
  const session = terminals.open(INVOCATION, 'install', reveal);
  const [terminal] = terminals.opened;
  if (terminal === undefined) {
    throw new Error('no terminal was opened');
  }
  return {session, terminal};
}

describe('RecordingTerminals (card ssh-18 table)', () => {
  it('F-2308 3.2: records what the terminal was opened with', () => {
    const {terminal} = opened();
    deepStrictEqual(
      [terminal.invocation, terminal.name, terminal.revealedAtOpen],
      [INVOCATION, 'install', false],
    );
  });

  it('#299: delivers the output as plain text', () => {
    const {session, terminal} = opened();
    const output: string[] = [];
    session.onOutput(text => output.push(text));
    terminal.write('\x1b[0mhi\n');
    deepStrictEqual(output, ['hi\n']);
  });

  it('F-2308 BR-6: records each text sent', () => {
    const {session, terminal} = opened();
    session.send('pw\r');
    session.send('pw\r');
    deepStrictEqual(terminal.sent, ['pw\r', 'pw\r']);
  });

  it('F-2308 BR-2: counts reveals after the open', () => {
    const {session, terminal} = opened();
    session.reveal();
    deepStrictEqual(terminal.revealCount, 1);
  });

  it('F-2308 7.E7: an end with no output had none', () => {
    const {session, terminal} = opened();
    const ends: TerminalEnd[] = [];
    session.onEnd(end => ends.push(end));
    terminal.end(undefined);
    deepStrictEqual(ends, [
      {code: undefined, reason: 'process', hadOutput: false},
    ]);
  });

  it('F-2308: an end after output says so', () => {
    const {session, terminal} = opened();
    const ends: TerminalEnd[] = [];
    session.onEnd(end => ends.push(end));
    terminal.write('x');
    terminal.end(0);
    deepStrictEqual(ends, [{code: 0, reason: 'process', hadOutput: true}]);
  });

  it('F-2308: output after the end is not delivered', () => {
    const {session, terminal} = opened();
    const output: string[] = [];
    session.onOutput(text => output.push(text));
    terminal.end(0);
    terminal.write('late');
    deepStrictEqual(output, []);
  });

  it('F-2308: a listener registered after the end is called at once', () => {
    const {session, terminal} = opened();
    terminal.end(3, 'user');
    const ends: TerminalEnd[] = [];
    session.onEnd(end => ends.push(end));
    deepStrictEqual(ends, [{code: 3, reason: 'user', hadOutput: false}]);
  });

  it('F-2308: ending twice tells once', () => {
    const {session, terminal} = opened();
    const ends: TerminalEnd[] = [];
    session.onEnd(end => ends.push(end));
    terminal.end(0);
    terminal.end(1);
    deepStrictEqual(ends.length, 1);
  });

  it('F-2308: disposing an open terminal ends it as the extension', () => {
    const {session, terminal} = opened();
    const ends: TerminalEnd[] = [];
    session.onEnd(end => ends.push(end));
    session.dispose();
    deepStrictEqual(
      [terminal.disposed, ends],
      [true, [{code: undefined, reason: 'extension', hadOutput: false}]],
    );
  });

  it('F-2308: disposing twice tells once', () => {
    const {session} = opened();
    const ends: TerminalEnd[] = [];
    session.onEnd(end => ends.push(end));
    session.dispose();
    session.dispose();
    deepStrictEqual(ends.length, 1);
  });

  it('F-2308 BR-2: a terminal opened revealed says so', () => {
    deepStrictEqual(opened(true).terminal.revealedAtOpen, true);
  });
});
