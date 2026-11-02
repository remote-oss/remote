import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {FailureHint} from 'lib-ssh';
import {refusalWatchOf} from '../../src/diagnostics/forwarding-refusal.ts';

const REFUSED =
  '[ssh] channel 2: open failed: administratively prohibited: open failed';

const SETTING_TEXT =
  'ERROR: TCP port forwarding appears to be disabled on the remote host. Ensure that the sshd_config has `AllowTcpForwarding yes`. Contact your system administrator if needed.';

/** A watch over a memory log, with the calls its port received. */
function watching(): {
  watch: ReturnType<typeof refusalWatchOf>;
  sink: MemorySink;
  calls: string[];
  hints: FailureHint[];
} {
  const sink = new MemorySink();
  const calls: string[] = [];
  const hints: FailureHint[] = [];
  return {
    sink,
    calls,
    hints,
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
      template => template,
    ),
  };
}

describe('the refusal of a forward in ssh lines (card connect-119)', () => {
  it('F-2604 AC-1: the setting text is logged directly after the first refused-channel line', () => {
    const {watch, sink} = watching();
    watch.logger.info(REFUSED);
    deepStrictEqual(
      sink.lines.map(line => line.message),
      [REFUSED, SETTING_TEXT],
    );
  });

  it('F-2604 AC-2: several refused channels log the setting text once', () => {
    const {watch, sink} = watching();
    watch.logger.info(REFUSED);
    watch.logger.info(REFUSED.replace('channel 2', 'channel 3'));
    watch.logger.info(REFUSED.replace('channel 2', 'channel 4'));
    deepStrictEqual(
      sink.lines.filter(line => line.message === SETTING_TEXT).length,
      1,
    );
  });

  it('F-2604 AC-2: the next connect logs it again', () => {
    const {watch, sink} = watching();
    watch.logger.info(REFUSED);
    watch.begin();
    watch.logger.info(REFUSED);
    deepStrictEqual(
      sink.lines.filter(line => line.message === SETTING_TEXT).length,
      2,
    );
  });

  it('F-2604 AC-3: the refusal is recorded once, as the classifier gives it', () => {
    const {watch, hints} = watching();
    watch.logger.info(REFUSED);
    watch.logger.info(REFUSED);
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
    watch.logger.info('[ssh] Connection established');
    deepStrictEqual(
      [sink.lines.map(line => line.message), hints],
      [['[ssh] Connection established'], []],
    );
  });

  it('F-2604 BR-2: a message of the extension that is no ssh line is not read', () => {
    const {watch, sink, hints} = watching();
    watch.logger.info('channel 2: open failed: administratively prohibited');
    deepStrictEqual([sink.lines.length, hints], [1, []]);
  });

  it('F-2604 BR-2: the other levels, the scope and a child pass through unread', () => {
    const {watch, sink, hints} = watching();
    watch.logger.trace(REFUSED);
    watch.logger.debug(REFUSED);
    watch.logger.warn(REFUSED);
    watch.logger.error(REFUSED);
    watch.logger.child('part').info(REFUSED);
    deepStrictEqual(
      [sink.lines.map(line => line.level), hints, watch.logger.scope],
      [['trace', 'debug', 'warn', 'error', 'info'], [], []],
    );
  });
});
