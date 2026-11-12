import {deepStrictEqual, strictEqual} from 'node:assert';
import {acceptanceTerminalPortFor} from '../../src/sinks/acceptance-terminal.ts';
import {FakeEditorPort} from '../../src/testing/fake-editor-port.ts';
import {AppendedText} from '../../src/testing/noting-channels.ts';

const LOG_FILE = '/run/terminal.txt';
const VARIABLE = 'REMOTE_OSS_ACCEPTANCE_WSL_TERMINAL';
const SWITCHED_ON = {REMOTE_OSS_ACCEPTANCE: '1', [VARIABLE]: LOG_FILE};

describe('acceptanceTerminalPortFor (card tooling-199, #2361)', () => {
  it('with the switch off it is the real port itself', () => {
    const real = new FakeEditorPort();
    strictEqual(
      acceptanceTerminalPortFor(
        {[VARIABLE]: LOG_FILE},
        VARIABLE,
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it('with the switch at any value but 1 it is the real port itself', () => {
    const real = new FakeEditorPort();
    strictEqual(
      acceptanceTerminalPortFor(
        {REMOTE_OSS_ACCEPTANCE: 'yes', [VARIABLE]: LOG_FILE},
        VARIABLE,
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it('with the switch on and an empty log variable it is the real port itself', () => {
    const real = new FakeEditorPort();
    strictEqual(
      acceptanceTerminalPortFor(
        {REMOTE_OSS_ACCEPTANCE: '1', [VARIABLE]: ''},
        VARIABLE,
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it('with the switch on and no log variable it is the real port itself', () => {
    const real = new FakeEditorPort();
    strictEqual(
      acceptanceTerminalPortFor(
        {REMOTE_OSS_ACCEPTANCE: '1'},
        VARIABLE,
        real,
        new AppendedText().append,
      ),
      real,
    );
  });

  it('the file holds every write, as written, in order, and the real writer gets them too', () => {
    const real = new FakeEditorPort();
    const files = new AppendedText();
    const writer = acceptanceTerminalPortFor(
      SWITCHED_ON,
      VARIABLE,
      real,
      files.append,
    ).createTerminalWriter('WSL');
    writer.write('first\r\n');
    writer.write('\u001b[31mrefused\u001b[0m\r\n');
    deepStrictEqual(
      [files.appended.get(LOG_FILE), real.terminals.at(0)?.writtenText],
      [
        'first\r\n\u001b[31mrefused\u001b[0m\r\n',
        ['first\r\n', '\u001b[31mrefused\u001b[0m\r\n'],
      ],
    );
  });

  it('a second terminal of the same port appends to the same file', () => {
    const files = new AppendedText();
    const port = acceptanceTerminalPortFor(
      SWITCHED_ON,
      VARIABLE,
      new FakeEditorPort(),
      files.append,
    );
    port.createTerminalWriter('first').write('a\r\n');
    port.createTerminalWriter('second').write('b\r\n');
    port.createTerminalWriter('first').write('c\r\n');
    deepStrictEqual([...files.appended], [[LOG_FILE, 'a\r\nb\r\nc\r\n']]);
  });

  it('onDidClose and dispose reach the real writer', () => {
    const real = new FakeEditorPort();
    let closed = 0;
    const writer = acceptanceTerminalPortFor(
      SWITCHED_ON,
      VARIABLE,
      real,
      new AppendedText().append,
    ).createTerminalWriter('WSL');
    writer.onDidClose(() => {
      closed += 1;
    });
    real.closeLatestTerminal();
    writer.dispose();
    deepStrictEqual([closed, real.terminals.at(0)?.disposeCalls], [1, 1]);
  });

  it('the output channels are the real ones, untouched', () => {
    const real = new FakeEditorPort();
    const port = acceptanceTerminalPortFor(
      SWITCHED_ON,
      VARIABLE,
      real,
      new AppendedText().append,
    );
    const channel = port.createOutputChannel('Remote - WSL');
    channel.appendLine('line');
    channel.dispose();
    deepStrictEqual(
      [
        real.channels.at(0)?.name,
        real.channels.at(0)?.appendedLines,
        real.channels.at(0)?.disposeCalls,
      ],
      ['Remote - WSL', ['line'], 1],
    );
  });

  it('the file is the one the named variable gives, and another variable is not read', () => {
    const files = new AppendedText();
    const writer = acceptanceTerminalPortFor(
      {
        REMOTE_OSS_ACCEPTANCE: '1',
        [VARIABLE]: LOG_FILE,
        OTHER_TERMINAL: '/run/other.txt',
      },
      'OTHER_TERMINAL',
      new FakeEditorPort(),
      files.append,
    ).createTerminalWriter('WSL');
    writer.write('line\r\n');
    deepStrictEqual([...files.appended], [['/run/other.txt', 'line\r\n']]);
  });
});
