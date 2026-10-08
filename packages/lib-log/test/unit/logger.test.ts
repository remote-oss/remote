import {deepStrictEqual, ok, strictEqual} from 'node:assert';
import {createLogger, type Level} from '../../src/index.ts';
import {MemorySink} from '../../src/testing/memory-sink.ts';

describe('logger (card log-01 table)', () => {
  it('createLogger(undefined, {minimumLevel: () => trace}) calling all five methods -> no throw; nothing observable', () => {
    const logger = createLogger(undefined, {minimumLevel: () => 'trace'});
    logger.trace('a');
    logger.debug('b');
    logger.info('c');
    logger.warn('d');
    logger.error('e');
    ok(true);
  });

  it('MemorySink; minimum info; logger.debug(a), logger.info(b) -> lines has one entry, message b, level info', () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {minimumLevel: () => 'info'});
    logger.debug('a');
    logger.info('b');
    deepStrictEqual(sink.lines, [
      {level: 'info', scope: [], message: 'b', time: 0},
    ]);
  });

  it('minimum getter returns error then trace between two info calls -> first call not written, second written', () => {
    const sink = new MemorySink();
    let minimum: Level = 'error';
    const logger = createLogger(sink, {minimumLevel: () => minimum});
    logger.info('first');
    minimum = 'trace';
    logger.info('second');
    deepStrictEqual(sink.lines, [
      {level: 'info', scope: [], message: 'second', time: 0},
    ]);
  });

  it('logger.child(ssh).child(session).info(x) -> line scope [ssh, session], parent scope unchanged []', () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {minimumLevel: () => 'trace'});
    logger.child('ssh').child('session').info('x');
    deepStrictEqual(sink.lines[0]?.scope, ['ssh', 'session']);
  });

  it('logger.child(ssh).child(session).info(x) -> parent scope unchanged []', () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {minimumLevel: () => 'trace'});
    logger.child('ssh').child('session').info('x');
    deepStrictEqual(logger.scope, []);
  });

  it('createLogger(sink, {..., clock: () => 42}); info(t) -> line time === 42', () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {
      minimumLevel: () => 'info',
      clock: () => 42,
    });
    logger.info('t');
    strictEqual(sink.lines[0]?.time, 42);
  });

  it('logger with secrets: () => [hunter2]; info(pw hunter2) -> written message pw [redacted]', () => {
    const sink = new MemorySink();
    const logger = createLogger(sink, {
      minimumLevel: () => 'trace',
      secrets: () => ['hunter2'],
    });
    logger.info('pw hunter2');
    strictEqual(sink.lines[0]?.message, 'pw [redacted]');
  });
});
