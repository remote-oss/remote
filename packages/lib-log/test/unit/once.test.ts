import {deepStrictEqual, strictEqual} from 'node:assert';
import {createLogger, logOncePerSession} from '../../src/index.ts';
import {MemorySink} from '../../src/testing/memory-sink.ts';
import {resetOncePerSession} from '../../src/testing/once.ts';

describe('once per session (card log-01 table)', () => {
  beforeEach(() => {
    resetOncePerSession();
  });

  it('logOncePerSession(logger, k, m) twice -> returns true then false', () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {minimumLevel: () => 'trace'});
    const first = logOncePerSession(logger, 'k', 'm');
    const second = logOncePerSession(logger, 'k', 'm');
    deepStrictEqual([first, second], [true, false]);
  });

  it('logOncePerSession(logger, k, m) twice -> sink has one line', () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {minimumLevel: () => 'trace'});
    logOncePerSession(logger, 'k', 'm');
    logOncePerSession(logger, 'k', 'm');
    strictEqual(sink.lines.length, 1);
  });

  it("two keys 'k1', 'k2' -> both written, two lines", () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {minimumLevel: () => 'trace'});
    const first = logOncePerSession(logger, 'k1', 'm');
    const second = logOncePerSession(logger, 'k2', 'm');
    const written = sink.lines.length === 2;
    deepStrictEqual([first, second, written], [true, true, true]);
  });

  it('resetOncePerSession() then logOncePerSession(logger, k, m) -> returns true again', () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {minimumLevel: () => 'trace'});
    logOncePerSession(logger, 'k', 'm');
    resetOncePerSession();
    strictEqual(logOncePerSession(logger, 'k', 'm'), true);
  });

  it('logOncePerSession(logger, k, m, warn) -> the line level is warn; default is info', () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {minimumLevel: () => 'trace'});
    logOncePerSession(logger, 'a', 'm', 'warn');
    logOncePerSession(logger, 'b', 'm');
    deepStrictEqual(
      sink.lines.map(line => line.level),
      ['warn', 'info'],
    );
  });

  it('logOncePerSession with a sink-less logger -> returns true (counted as written), nothing observable', () => {
    const logger = createLogger(undefined, {minimumLevel: () => 'trace'});
    strictEqual(logOncePerSession(logger, 'z', 'm'), true);
  });
});

describe('MemorySink (card log-01 table)', () => {
  it('write of two lines -> lines keeps insertion order and the same objects', () => {
    const sink = new MemorySink();
    const first = {level: 'info', scope: [], message: 'one', time: 1} as const;
    const second = {
      level: 'error',
      scope: ['s'],
      message: 'two',
      time: 2,
    } as const;
    sink.write(first);
    sink.write(second);
    deepStrictEqual(sink.lines, [first, second]);
  });
});
