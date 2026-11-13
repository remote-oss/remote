import {deepStrictEqual} from 'node:assert';
import {
  colouredLineOf,
  createTerminalSink,
  type LogLine,
} from '../../src/index.ts';
import {FakeEditorPort} from '../../src/testing/fake-editor-port.ts';

/** The terminals a port created, each named and carrying its written text and its reveals. */
function terminalsOf(
  port: FakeEditorPort,
): Array<{name: string; text: string[]; shows: boolean[]}> {
  return port.terminals.map(terminal => ({
    name: terminal.name,
    text: terminal.writtenText,
    shows: terminal.shows,
  }));
}

const FIRST: LogLine = {level: 'info', scope: [], message: 'first', time: 0};
const SECOND: LogLine = {level: 'info', scope: [], message: 'second', time: 0};
const THIRD: LogLine = {level: 'warn', scope: [], message: 'third', time: 0};

/** The text a terminal shows for `line`: its coloured form and the line end. */
function shown(line: LogLine): string {
  return `${colouredLineOf(line)}\r\n`;
}

describe('terminal sink (card wsl-10)', () => {
  it('wsl-10: lines written before any reveal make no terminal', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.write(SECOND);
    deepStrictEqual(port.terminals.length, 0);
  });

  it('wsl-10: the first terminal that opens gets every kept line, once, in order', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.write(SECOND);
    sink.reveal(true);
    port.openLatestTerminal();
    deepStrictEqual(terminalsOf(port), [
      {name: 'WSL', text: [shown(FIRST), shown(SECOND)], shows: [false]},
    ]);
  });

  it('wsl-10: a line after the terminal opened is streamed at once', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.reveal(true);
    port.openLatestTerminal();
    sink.write(THIRD);
    deepStrictEqual(port.terminals.at(0)?.writtenText, [
      shown(FIRST),
      shown(THIRD),
    ]);
  });

  it('wsl-10: a line written while the terminal has not opened yet waits for it', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.reveal(true);
    sink.write(FIRST);
    const before = port.terminals.at(0)?.writtenText.length;
    port.openLatestTerminal();
    deepStrictEqual(
      [before, port.terminals.at(0)?.writtenText],
      [0, [shown(FIRST)]],
    );
  });

  it('wsl-10: a terminal made after the user closed one starts empty, and gets only what is written after', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.reveal(true);
    port.openLatestTerminal();
    port.closeLatestTerminal();
    sink.write(SECOND);
    sink.reveal(true);
    port.openLatestTerminal();
    sink.write(THIRD);
    deepStrictEqual(
      terminalsOf(port).map(terminal => terminal.text),
      [[shown(FIRST)], [shown(THIRD)]],
    );
  });

  it('wsl-10: a line written between the new terminal and its opening is shown when it opens', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.reveal(true);
    port.openLatestTerminal();
    port.closeLatestTerminal();
    sink.reveal(true);
    sink.write(SECOND);
    port.openLatestTerminal();
    deepStrictEqual(port.terminals.at(1)?.writtenText, [shown(SECOND)]);
  });

  it('wsl-10: a terminal the editor never opened does not count as the first: its lines are kept for the next', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.reveal(true);
    port.closeLatestTerminal();
    sink.write(SECOND);
    sink.reveal(true);
    port.openLatestTerminal();
    deepStrictEqual(port.terminals.at(1)?.writtenText, [
      shown(FIRST),
      shown(SECOND),
    ]);
  });

  it('wsl-10: reveal with the focus shows the terminal and keeps no focus aside; without it preserves the focus', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.reveal(true);
    sink.reveal(false);
    deepStrictEqual(port.terminals.at(0)?.shows, [false, true]);
  });

  it('wsl-10: at most one terminal exists: a second reveal shows the same one', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.reveal(true);
    sink.reveal(true);
    deepStrictEqual(port.terminals.length, 1);
  });

  it('wsl-10: a terminal that opens after the sink dropped it gets nothing', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.reveal(true);
    const stale = port.terminals.at(0)?.openListeners ?? [];
    sink.dispose();
    for (const listener of stale) {
      listener();
    }
    deepStrictEqual(port.terminals.at(0)?.writtenText, []);
  });

  it('wsl-10: dispose ends the terminal once and a later line is kept for the first terminal that opens', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.reveal(true);
    sink.dispose();
    sink.write(FIRST);
    sink.reveal(true);
    port.openLatestTerminal();
    deepStrictEqual(
      [port.terminals.at(0)?.disposeCalls, port.terminals.at(1)?.writtenText],
      [1, [shown(FIRST)]],
    );
  });

  it('wsl-10: dispose with no terminal does nothing', () => {
    const port = new FakeEditorPort();
    createTerminalSink(port, 'WSL').dispose();
    deepStrictEqual(port.terminals.length, 0);
  });

  it('wsl-10: the named secrets are redacted from a line the terminal shows', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL', {secrets: () => ['hunter2']});
    sink.write({...FIRST, message: 'password hunter2'});
    sink.reveal(true);
    port.openLatestTerminal();
    deepStrictEqual(port.terminals.at(0)?.writtenText, [
      `${colouredLineOf({...FIRST, message: 'password [redacted]'})}\r\n`,
    ]);
  });
});
