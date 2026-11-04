import {deepStrictEqual} from 'node:assert';
import {
  elapsedLineOf,
  logTerminalOf,
  type LogTerminalSource,
} from '../../src/logging/log-terminal.ts';

const START = Date.parse('2026-11-03T12:00:00.000Z');
const FIRST = '2026-11-03T12:00:01.250Z [info] first';
const SECOND = '2026-11-03T12:00:03.000Z [debug] second';

/** A source whose file holds `lines`, and the means to write more and to settle the read. */
function sourceOf(lines: string[], failRead = false) {
  const file = lines.map(line => `${line}\n`).join('');
  const listeners = new Set<(text: string) => void>();
  const waiting: Array<() => void> = [];
  const source: LogTerminalSource = {
    bytes: () => Buffer.byteLength(file, 'utf8'),
    flushed: () =>
      new Promise<void>(resolve => {
        waiting.push(resolve);
      }),
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () =>
      failRead
        ? Promise.reject(new Error('gone'))
        : Promise.resolve(new TextEncoder().encode(`${file}later\n`)),
  };
  return {
    source,
    release: () => {
      waiting.splice(0).forEach(each => {
        each();
      });
    },
    emit: (text: string) => {
      for (const listener of listeners) {
        listener(text);
      }
    },
    listening: () => listeners.size,
  };
}

/** Lets the pending promises run. */
function settle(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('the Dev Containers log terminal (card containers-186, F-0104 BR-1)', () => {
  it('F-0104 BR-1: the file is replayed from its start with the time since the activation in front of each line, then the later lines stream; a line written during the replay comes after it', async () => {
    const scene = sourceOf([FIRST, SECOND]);
    const written: string[] = [];
    const terminal = logTerminalOf(
      scene.source,
      text => written.push(text),
      START,
    );
    terminal.open();
    scene.emit('2026-11-03T12:00:04.000Z [info] meanwhile');
    scene.release();
    await settle();
    scene.emit('2026-11-03T12:00:05.500Z [info] live');
    deepStrictEqual(written, [
      '[+1.250s] [info] first\r\n',
      '[+3.000s] [debug] second\r\n',
      '[+4.000s] [info] meanwhile\r\n',
      '[+5.500s] [info] live\r\n',
    ]);
  });

  it('F-0104 BR-1: the replay stops at the bytes the file held when the terminal opened, so a line appended meanwhile is shown once', async () => {
    const scene = sourceOf([FIRST]);
    const written: string[] = [];
    logTerminalOf(scene.source, text => written.push(text), START).open();
    scene.release();
    await settle();
    deepStrictEqual(written, ['[+1.250s] [info] first\r\n']);
  });

  it('F-0104 BR-1: a file that cannot be read still lets the lines written meanwhile and later stream', async () => {
    const scene = sourceOf([FIRST], true);
    const written: string[] = [];
    logTerminalOf(scene.source, text => written.push(text), START).open();
    scene.emit('2026-11-03T12:00:02.000Z [info] meanwhile');
    scene.release();
    await settle();
    scene.emit('2026-11-03T12:00:06.000Z [info] live');
    deepStrictEqual(written, [
      '[+2.000s] [info] meanwhile\r\n',
      '[+6.000s] [info] live\r\n',
    ]);
  });

  it('F-0104 BR-1: closing stops the stream, and closing before the replay is read writes nothing', async () => {
    const scene = sourceOf([FIRST]);
    const written: string[] = [];
    const terminal = logTerminalOf(
      scene.source,
      text => written.push(text),
      START,
    );
    terminal.open();
    terminal.close();
    scene.release();
    await settle();
    scene.emit('2026-11-03T12:00:06.000Z [info] live');
    terminal.close();
    deepStrictEqual([written, scene.listening()], [[], 0]);
  });

  it('F-0104 BR-1: a line with no time, one with a time that is no date, and one before the start are written as the time says or as they are', () => {
    deepStrictEqual(
      [
        elapsedLineOf('  continued', START),
        elapsedLineOf('2026-13-45T99:99:99.999Z [info] x', START),
        elapsedLineOf('2026-11-03T11:59:59.000Z [info] early', START),
        elapsedLineOf('2026-11-03T12:00:00.000Z multi\nline', START),
      ],
      [
        '  continued',
        '2026-13-45T99:99:99.999Z [info] x',
        '[+0.000s] [info] early',
        '[+0.000s] multi\nline',
      ],
    );
  });
});
