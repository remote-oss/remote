import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  createTerminalSink,
  defaultFormat,
  type LogLine,
} from '../../src/index.ts';
import {FakeEditorPort} from '../../src/testing/fake-editor-port.ts';

/** The terminals a port created, each named and carrying its written text. */
function terminalsOf(
  port: FakeEditorPort,
): Array<{name: string; text: string[]}> {
  return port.terminals.map(terminal => ({
    name: terminal.name,
    text: terminal.writtenText,
  }));
}

const FIRST: LogLine = {level: 'info', scope: [], message: 'first', time: 0};
const SECOND: LogLine = {level: 'info', scope: [], message: 'second', time: 0};
const THIRD: LogLine = {level: 'warn', scope: [], message: 'third', time: 0};

describe('terminal sink (card log-02 table)', () => {
  it('terminal sink: two writes, no show -> createTerminalWriter not called', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.write(SECOND);
    strictEqual(port.terminals.length, 0);
  });

  it('terminal sink: two writes, then show() -> createTerminalWriter(WSL) once; write called with the two formatted lines, each followed by \\r\\n, in order', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.write(SECOND);
    sink.show();
    deepStrictEqual(terminalsOf(port), [
      {
        name: 'WSL',
        text: [`${defaultFormat(FIRST)}\r\n`, `${defaultFormat(SECOND)}\r\n`],
      },
    ]);
  });

  it('terminal sink: a write after show() -> streamed at once: one more write call', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.write(SECOND);
    sink.show();
    sink.write(THIRD);
    deepStrictEqual(port.terminals.at(0)?.writtenText, [
      `${defaultFormat(FIRST)}\r\n`,
      `${defaultFormat(SECOND)}\r\n`,
      `${defaultFormat(THIRD)}\r\n`,
    ]);
  });

  it('terminal sink: the fake port fires onDidClose; then one write; then show() -> a second createTerminalWriter; write called with all three lines', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.write(SECOND);
    sink.show();
    port.closeLatestTerminal();
    sink.write(THIRD);
    sink.show();
    const replay = [
      `${defaultFormat(FIRST)}\r\n`,
      `${defaultFormat(SECOND)}\r\n`,
      `${defaultFormat(THIRD)}\r\n`,
    ];
    deepStrictEqual(terminalsOf(port), [
      {
        name: 'WSL',
        text: [`${defaultFormat(FIRST)}\r\n`, `${defaultFormat(SECOND)}\r\n`],
      },
      {name: 'WSL', text: replay},
    ]);
  });

  it('terminal sink: show() twice while open -> one terminal only', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.show();
    sink.show();
    strictEqual(port.terminals.length, 1);
  });

  it('terminal sink: two writes, show(), dispose() -> terminal dispose called once; buffer kept; show() after dispose creates a terminal and replays', () => {
    const port = new FakeEditorPort();
    const sink = createTerminalSink(port, 'WSL');
    sink.write(FIRST);
    sink.write(SECOND);
    sink.show();
    sink.dispose();
    const buffered = [
      `${defaultFormat(FIRST)}\r\n`,
      `${defaultFormat(SECOND)}\r\n`,
    ];
    sink.show();
    deepStrictEqual(
      port.terminals.map(terminal => ({
        name: terminal.name,
        text: terminal.writtenText,
        disposed: terminal.disposeCalls,
      })),
      [
        {name: 'WSL', text: buffered, disposed: 1},
        {name: 'WSL', text: buffered, disposed: 0},
      ],
    );
  });
});
