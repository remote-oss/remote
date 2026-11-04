import {deepStrictEqual} from 'node:assert';
import {
  type LogFilePorts,
  logFileSinkOf,
} from '../../src/logging/log-file-sink.ts';

const LINE = {
  level: 'info',
  scope: ['connect'],
  message: 'hello',
  time: Date.UTC(2026, 10, 3, 12, 34, 56, 789),
} as const;

/** The ports over a record of what the sink asked, with the folder and the appends made to fail on request. */
function portsOf(failWith?: string) {
  const events: string[] = [];
  const reasons: string[] = [];
  const ports: LogFilePorts = {
    makeFolder: folder => {
      events.push(`folder ${folder}`);
      return Promise.resolve();
    },
    append: (file, text) => {
      events.push(`append ${file} ${JSON.stringify(text)}`);
      return failWith === undefined
        ? Promise.resolve()
        : Promise.reject(new Error(failWith));
    },
    failed: reason => {
      reasons.push(reason);
    },
  };
  return {ports, events, reasons};
}

describe('the sink of the activation’s log file (card containers-186, F-0104 BR-3)', () => {
  it('F-0104 BR-3: the folder is made first and every line is appended in the order it was written, each ended by a newline', async () => {
    const seen = portsOf();
    const sink = logFileSinkOf(seen.ports, '/logs', '/logs/a.log');
    sink.write(LINE);
    sink.write({...LINE, scope: [], message: 'second'});
    await sink.flushed();
    deepStrictEqual(seen.events, [
      'folder /logs',
      'append /logs/a.log "2026-11-03T12:34:56.789Z [info] connect: hello\\n"',
      'append /logs/a.log "2026-11-03T12:34:56.789Z [info] second\\n"',
    ]);
  });

  it('F-0104 BR-3: a format given decides the line', async () => {
    const seen = portsOf();
    const sink = logFileSinkOf(seen.ports, '/logs', '/logs/a.log', line =>
      line.message.toUpperCase(),
    );
    sink.write(LINE);
    await sink.flushed();
    deepStrictEqual(seen.events.slice(1), ['append /logs/a.log "HELLO\\n"']);
  });

  it('F-0104 BR-3: a failing append is reported once, with its reason, and the later lines are still tried', async () => {
    const seen = portsOf('disk full');
    const sink = logFileSinkOf(seen.ports, '/logs', '/logs/a.log');
    sink.write(LINE);
    sink.write(LINE);
    await sink.flushed();
    deepStrictEqual(
      [seen.reasons, seen.events.length],
      [['Error: disk full'], 3],
    );
  });

  it('F-0104 BR-3: a folder that cannot be made is reported once, and the later append that fails adds no second report', async () => {
    const reasons: string[] = [];
    const sink = logFileSinkOf(
      {
        makeFolder: () => Promise.reject(new Error('no folder')),
        append: () => Promise.reject(new Error('later')),
        failed: reason => {
          reasons.push(reason);
        },
      },
      '/logs',
      '/logs/a.log',
    );
    sink.write(LINE);
    await sink.flushed();
    deepStrictEqual(reasons, ['Error: no folder']);
  });
});
