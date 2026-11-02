import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {FailureHint} from 'lib-ssh';
import {
  openingAttached,
  refusalWatchOf,
} from '../../src/diagnostics/forwarding-refusal.ts';
import type {ConnectInput, ConnectionTerms} from '../../src/pipeline/steps.ts';
import {channelAnswering, leaseOn} from './server-steps.fixture.ts';
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

  it('F-2604 AC-15: a connect that started the login logs the setting text, and one that joined it does not, though both record the hint', () => {
    const {watch, sink, hints} = watching();
    watch.begin();
    watch.attach(true);
    logSshLines(watch.logger, [REFUSED], undefined);
    watch.begin();
    watch.attach(false);
    logSshLines(watch.logger, [REFUSED], undefined);
    deepStrictEqual(
      [
        sink.lines.filter(line => line.message === SETTING_TEXT).length,
        sink.lines.filter(line => line.message === `[ssh] ${REFUSED}`).length,
        hints.length,
      ],
      [1, 2, 2],
    );
  });

  it('F-2604 AC-15 (ruling-1773-joiner-lines): a joiner that logs the refused-channel lines still gets them in its log', () => {
    const {watch, sink} = watching();
    watch.begin();
    watch.attach(false);
    logSshLines(watch.logger, [REFUSED], undefined);
    deepStrictEqual(
      sink.lines.map(line => line.message),
      [`[ssh] ${REFUSED}`],
    );
  });

  it('F-2604 AC-15: a new helper after the old one was killed is started by the connect again, and logs the setting text again, as the next connect of any started login does', () => {
    const {watch, sink} = watching();
    watch.begin();
    watch.attach(true);
    logSshLines(watch.logger, [REFUSED], undefined);
    watch.begin();
    watch.attach(true);
    logSshLines(watch.logger, [REFUSED], undefined);
    deepStrictEqual(
      sink.lines.filter(line => line.message === SETTING_TEXT).length,
      2,
    );
  });

  it('F-2604 AC-15: a refusal line that arrives before the connection is open logs no setting text, whoever started the login', () => {
    const {watch, sink} = watching();
    watch.begin();
    logSshLines(watch.logger, [REFUSED], undefined);
    deepStrictEqual(
      sink.lines.filter(line => line.message === SETTING_TEXT).length,
      0,
    );
  });

  it('F-2604 AC-15: the step that opens the connection tells the watch whether the connect started the login, and a failed one tells nothing', async () => {
    const told: boolean[] = [];
    const watch = {
      attach: (startedLogin: boolean) => {
        told.push(startedLogin);
      },
    };
    const lease = leaseOn(channelAnswering([]));
    const input: ConnectInput = {
      target: {kind: 'plain', text: 'devbox'},
      rawHostString: 'devbox',
      attempt: 1,
      isReconnection: false,
      windowId: 'window-1',
      windowWorkspace: undefined,
    };
    const terms: ConnectionTerms = {
      platform: 'linux',
      remoteCommandInEffect: false,
    };
    const signal = new AbortController().signal;
    await openingAttached(
      () => Promise.resolve({kind: 'done', value: lease}),
      watch,
    )(input, terms, signal);
    await openingAttached(
      () => Promise.resolve({kind: 'failed', failure: {kind: 'cancelled'}}),
      watch,
    )(input, terms, signal);
    deepStrictEqual(told, [true]);
  });
});
