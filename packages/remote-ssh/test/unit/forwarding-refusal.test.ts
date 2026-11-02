import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {FailureHint} from 'lib-ssh';
import {refusalWatchOf} from '../../src/diagnostics/forwarding-refusal.ts';
import {logSshLines} from '../../src/pipeline/ssh-log.ts';

const REFUSED =
  'channel 2: open failed: administratively prohibited: open failed';

const SETTING_TEXT =
  'ERROR: TCP port forwarding appears to be disabled on the remote host. Ensure that the sshd_config has `AllowTcpForwarding yes`. Contact your system administrator if needed.';

/** A watch over a memory log, with the calls its port received. */
function watching(): {
  watch: ReturnType<typeof refusalWatchOf>;
  sink: MemorySink;
  calls: string[];
  hints: FailureHint[];
  remembered: string[];
} {
  const sink = new MemorySink();
  const calls: string[] = [];
  const hints: FailureHint[] = [];
  const remembered: string[] = [];
  return {
    sink,
    calls,
    hints,
    remembered,
    watch: refusalWatchOf(
      createLogger(sink, {minimumLevel: (): Level => 'trace'}),
      {
        begin: () => {
          calls.push('begin');
        },
        record: hint => {
          hints.push(hint);
        },
      },
      {
        contains: connection => remembered.includes(connection),
        remember: connection => {
          remembered.push(connection);
        },
      },
      template => template,
    ),
  };
}

describe('the refusal of a forward in ssh lines (card connect-119)', () => {
  it('F-2604 AC-1: the setting text is logged directly after the first refused-channel line', () => {
    const {watch, sink} = watching();
    logSshLines(watch.logger, [REFUSED], undefined);
    deepStrictEqual(
      sink.lines.map(line => line.message),
      [`[ssh] ${REFUSED}`, SETTING_TEXT],
    );
  });

  it('F-2604 AC-2: several refused channels log the setting text once', () => {
    const {watch, sink} = watching();
    logSshLines(
      watch.logger,
      [
        REFUSED,
        REFUSED.replace('channel 2', 'channel 3'),
        REFUSED.replace('channel 2', 'channel 4'),
      ],
      undefined,
    );
    deepStrictEqual(
      sink.lines.filter(line => line.message === SETTING_TEXT).length,
      1,
    );
  });

  it('F-2604 AC-2: the next connect logs it again', () => {
    const {watch, sink} = watching();
    logSshLines(watch.logger, [REFUSED], undefined);
    watch.begin();
    logSshLines(watch.logger, [REFUSED], undefined);
    deepStrictEqual(
      sink.lines.filter(line => line.message === SETTING_TEXT).length,
      2,
    );
  });

  it('F-2604 AC-3: the refusal is recorded once, as the classifier gives it', () => {
    const {watch, hints} = watching();
    logSshLines(watch.logger, [REFUSED, REFUSED], undefined);
    deepStrictEqual(
      hints.map(hint => hint.status),
      ['AllowTcpForwardingDisabled'],
    );
  });

  it("F-2604 AC-3: a connect starts the port's record", () => {
    const {watch, calls} = watching();
    watch.begin();
    deepStrictEqual(calls, ['begin']);
  });

  it('F-2604 BR-2: a line of ssh that is no refusal logs and records nothing more', () => {
    const {watch, sink, hints} = watching();
    logSshLines(watch.logger, ['Connection established'], undefined);
    deepStrictEqual(
      [sink.lines.map(line => line.message), hints],
      [['[ssh] Connection established'], []],
    );
  });

  it('F-2604 BR-2: a line that ends in a carriage return is read without it', () => {
    const {watch, hints} = watching();
    logSshLines(watch.logger, [`${REFUSED}\r`], undefined);
    deepStrictEqual(hints.length, 1);
  });

  it('F-2604 BR-2: the logger does not read the messages it is given, whatever their text', () => {
    const {watch, sink, hints} = watching();
    watch.logger.info(`[ssh] ${REFUSED}`);
    deepStrictEqual([sink.lines.length, hints], [1, []]);
  });

  it('F-2604 BR-2: the other levels, the scope and a child pass through', () => {
    const {watch, sink} = watching();
    watch.logger.trace('a');
    watch.logger.debug('b');
    watch.logger.warn('c');
    watch.logger.error('d');
    watch.logger.child('part').info('e');
    deepStrictEqual(
      [sink.lines.map(line => line.level), watch.logger.scope],
      [['trace', 'debug', 'warn', 'error', 'info'], []],
    );
  });

  it('F-2604 AC-15: two connects on one shared connection log the setting text once, and record the hint twice', () => {
    const {watch, sink, hints} = watching();
    watch.begin();
    watch.attach('devbox:1080');
    logSshLines(watch.logger, [REFUSED], undefined);
    watch.begin();
    watch.attach('devbox:1080');
    logSshLines(watch.logger, [REFUSED], undefined);
    deepStrictEqual(
      [
        sink.lines.filter(line => line.message === SETTING_TEXT).length,
        hints.length,
      ],
      [1, 2],
    );
  });

  it('F-2604 AC-15: a new shared connection logs the setting text again', () => {
    const {watch, sink} = watching();
    watch.begin();
    watch.attach('devbox:1080');
    logSshLines(watch.logger, [REFUSED], undefined);
    watch.begin();
    watch.attach('devbox:1081');
    logSshLines(watch.logger, [REFUSED], undefined);
    deepStrictEqual(
      sink.lines.filter(line => line.message === SETTING_TEXT).length,
      2,
    );
  });

  it('F-2604 AC-15: a session of one window logs the setting text at every connect', () => {
    const {watch, sink, remembered} = watching();
    watch.begin();
    watch.attach(undefined);
    logSshLines(watch.logger, [REFUSED], undefined);
    watch.begin();
    watch.attach(undefined);
    logSshLines(watch.logger, [REFUSED], undefined);
    deepStrictEqual(
      [
        sink.lines.filter(line => line.message === SETTING_TEXT).length,
        remembered,
      ],
      [2, []],
    );
  });
});
