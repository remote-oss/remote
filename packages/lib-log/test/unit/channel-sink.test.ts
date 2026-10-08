import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  createChannelSink,
  type LogLine,
  defaultFormat,
} from '../../src/index.ts';
import {FakeEditorPort} from '../../src/testing/fake-editor-port.ts';

const LINE: LogLine = {level: 'info', scope: [], message: 'm', time: 0};

describe('channel sink (card log-02 table)', () => {
  it('createChannelSink(port, Remote - SSH) and no write -> createOutputChannel not called', () => {
    const port = new FakeEditorPort();
    createChannelSink(port, 'Remote - SSH');
    strictEqual(port.channels.length, 0);
  });

  it('first write(line) -> createOutputChannel(Remote - SSH) called once; appendLine(defaultFormat(line))', () => {
    const port = new FakeEditorPort();
    const sink = createChannelSink(port, 'Remote - SSH');
    sink.write(LINE);
    strictEqual(port.channels.length, 1);
    deepStrictEqual(port.channels.at(0)?.name, 'Remote - SSH');
    deepStrictEqual(port.channels.at(0)?.appendedLines, [defaultFormat(LINE)]);
  });

  it('three writes -> one channel, three appendLine calls in order', () => {
    const port = new FakeEditorPort();
    const sink = createChannelSink(port, 'Remote - SSH');
    const second: LogLine = {level: 'warn', scope: [], message: 'b', time: 0};
    const third: LogLine = {level: 'error', scope: [], message: 'c', time: 0};
    sink.write(LINE);
    sink.write(second);
    sink.write(third);
    strictEqual(port.channels.length, 1);
    deepStrictEqual(port.channels.at(0)?.appendedLines, [
      defaultFormat(LINE),
      defaultFormat(second),
      defaultFormat(third),
    ]);
  });

  it("custom format returning 'X' -> appendLine('X')", () => {
    const port = new FakeEditorPort();
    const sink = createChannelSink(port, 'Remote - SSH', () => 'X');
    sink.write(LINE);
    deepStrictEqual(port.channels.at(0)?.appendedLines, ['X']);
  });

  it('dispose() after writes -> channel dispose called once; a later write creates a new channel', () => {
    const port = new FakeEditorPort();
    const sink = createChannelSink(port, 'Remote - SSH');
    sink.write(LINE);
    sink.dispose();
    strictEqual(port.channels.at(0)?.disposeCalls, 1);
    sink.write(LINE);
    strictEqual(port.channels.length, 2);
  });

  it('dispose() before any write -> no port call at all', () => {
    const port = new FakeEditorPort();
    const sink = createChannelSink(port, 'Remote - SSH');
    sink.dispose();
    deepStrictEqual([port.channels.length, port.terminals.length], [0, 0]);
  });

  it('defaultFormat({level: info, scope: [], message: m, time: 0}) -> 1970-01-01T00:00:00.000Z [info] m', () => {
    strictEqual(
      defaultFormat({level: 'info', scope: [], message: 'm', time: 0}),
      '1970-01-01T00:00:00.000Z [info] m',
    );
  });

  it('defaultFormat({level: warn, scope: [a, b], message: m, time: 0}) -> 1970-01-01T00:00:00.000Z [warn] a.b: m', () => {
    strictEqual(
      defaultFormat({level: 'warn', scope: ['a', 'b'], message: 'm', time: 0}),
      '1970-01-01T00:00:00.000Z [warn] a.b: m',
    );
  });
});
