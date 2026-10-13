import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import type {
  BootstrapEvent,
  SessionRun,
  SessionRunEnd,
} from '../../src/index.ts';
import {commandsFor} from '../../src/connection-server/shell-runs.ts';
import {RecordingTerminals} from '../../src/testing/recording-terminal.ts';
import {TerminalSessionRunner} from '../../src/terminal/terminal-runs.ts';

const SCRIPT: SessionRun = {
  script: 'echo hello',
  environment: {},
  inputBase64: null,
  deadlineMilliseconds: 1000,
};

const OTHER: SessionRun = {
  script: 'echo other',
  environment: {},
  inputBase64: null,
  deadlineMilliseconds: 1000,
};

const WAIT = 5000;

const PRELUDE = 'P\n';

const INVOCATION = {program: 'ssh', arguments: ['host'], environment: {}};

function fixture() {
  const clock = new FakeClock();
  const terminals = new RecordingTerminals();
  const session = terminals.open(INVOCATION, 'install', false);
  const [terminal] = terminals.opened;
  if (terminal === undefined) {
    throw new Error('no terminal was opened');
  }
  let markers = 0;
  const bootstrap: BootstrapEvent[] = [];
  const runner = new TerminalSessionRunner({
    terminal: session,
    scheduler: clock.scheduler(),
    prelude: PRELUDE,
    newMarker: () => {
      markers += 1;
      return `m${String(markers)}`;
    },
    onBootstrap: event => bootstrap.push(event),
  });
  function start(request: SessionRun = SCRIPT, wait: number = WAIT) {
    const lines: string[] = [];
    const ended: Promise<SessionRunEnd> = runner.runOnSession(
      request,
      line => lines.push(line),
      wait,
    );
    return {lines, ended};
  }
  return {clock, terminal, runner, start, bootstrap};
}

/** Lets the promises that are ready run. */
async function settled(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await Promise.resolve();
  }
}

describe('script runs over the login terminal (card ssh-21 table)', () => {
  it('#443: the prelude is sent once, before the first run, and the commands follow it', () => {
    const {terminal, start} = fixture();
    start();
    start(OTHER);
    deepStrictEqual(terminal.sent, [PRELUDE, commandsFor('m1', SCRIPT)]);
  });

  it('contracts §S10: sends the commands of the run', () => {
    const {terminal, start} = fixture();
    start();
    deepStrictEqual(terminal.sent.slice(1), [commandsFor('m1', SCRIPT)]);
  });

  it('contracts §S10: delivers the lines of the run and its status', async () => {
    const {terminal, start} = fixture();
    const attempt = start();
    terminal.write('m1:start\nhello\nm1:end 0\n');
    deepStrictEqual(
      [attempt.lines, await attempt.ended],
      [['hello'], {kind: 'ended', status: 0}],
    );
  });

  it('brief T4, #299: the echo of the sent commands is not taken for the markers', async () => {
    const {terminal, start} = fixture();
    const attempt = start();
    const echo = terminal.sent.slice(1).join('').replaceAll('\n', '\r\n');
    terminal.write(`${echo}m1:start\r\nhello\r\nm1:end 3\r\n`);
    deepStrictEqual(
      [attempt.lines, await attempt.ended],
      [['hello'], {kind: 'ended', status: 3}],
    );
  });

  it('brief T4: output in odd pieces gives the same lines', async () => {
    const {terminal, start} = fixture();
    const attempt = start();
    terminal.write('m1:st');
    terminal.write('art\nhel');
    terminal.write('lo\nm1:end 0\n');
    deepStrictEqual(
      [attempt.lines, await attempt.ended],
      [['hello'], {kind: 'ended', status: 0}],
    );
  });

  it('contracts §S10: a second run is sent only after the first ends', async () => {
    const {terminal, start} = fixture();
    start();
    start(OTHER);
    terminal.write('m1:start\nhello\nm1:end 0\n');
    await settled();
    deepStrictEqual(terminal.sent, [
      PRELUDE,
      commandsFor('m1', SCRIPT),
      commandsFor('m2', OTHER),
    ]);
  });

  it('contracts §S10: the end of the terminal fails the run that is on it', async () => {
    const {terminal, start} = fixture();
    const attempt = start();
    terminal.end(0);
    deepStrictEqual(await attempt.ended, {
      kind: 'failed',
      reason: 'channelClosed',
      detail: 'the session ended',
    });
  });

  it('contracts §S10: a run asked after the end answers at once and sends nothing', async () => {
    const {terminal, start} = fixture();
    terminal.end(0);
    const attempt = start();
    deepStrictEqual(
      [await attempt.ended, terminal.sent],
      [
        {
          kind: 'failed',
          reason: 'channelClosed',
          detail: 'the session ended',
        },
        [PRELUDE],
      ],
    );
  });

  it('contracts §S10: the end of the terminal fails a queued run too', async () => {
    const {terminal, start} = fixture();
    start();
    const queued = start(OTHER);
    terminal.end(0);
    deepStrictEqual(await queued.ended, {
      kind: 'failed',
      reason: 'channelClosed',
      detail: 'the session ended',
    });
  });

  it('F-2308 BR-7: a run past its deadline disposes the terminal', async () => {
    const {clock, terminal, start} = fixture();
    const attempt = start();
    clock.advance(1000);
    await attempt.ended;
    deepStrictEqual(terminal.disposed, true);
  });

  it('F-2308 BR-7: a run past its deadline answers a timeout', async () => {
    const {clock, start} = fixture();
    const attempt = start();
    clock.advance(1000);
    deepStrictEqual((await attempt.ended).kind, 'failed');
  });

  it('contracts §S10: a wait that passes while an earlier run holds the session answers a timeout', async () => {
    const {clock, start} = fixture();
    start({...SCRIPT, deadlineMilliseconds: 60_000});
    const waiting = start(OTHER, 2000);
    clock.advance(2000);
    deepStrictEqual(await waiting.ended, {
      kind: 'failed',
      reason: 'timeout',
      detail: 'no end in time',
    });
  });

  it('contracts §S10: the lines that come after a timed-out wait are not delivered', async () => {
    const {clock, terminal, start} = fixture();
    start({...SCRIPT, deadlineMilliseconds: 60_000});
    const waiting = start(OTHER, 2000);
    clock.advance(2000);
    await waiting.ended;
    terminal.write('m1:start\nhello\nm1:end 0\n');
    terminal.write('m2:start\nother\nm2:end 0\n');
    await settled();
    deepStrictEqual(waiting.lines, []);
  });

  it('#299: the lines of ssh itself reach no run', async () => {
    const {terminal, start} = fixture();
    terminal.write('debug1: before\n');
    const attempt = start();
    terminal.write(
      'debug1: between\nm1:start\nhello\ndebug1: inside\nm1:end 0\ndebug1: after\n',
    );
    await attempt.ended;
    deepStrictEqual(attempt.lines, ['hello', 'debug1: inside']);
  });
});

describe('the bootstrap lines over the login terminal (card ssh-38, #443)', () => {
  it('#443: the ready line is reported, once', () => {
    const {terminal, bootstrap} = fixture();
    terminal.write('LAYER1-READY\n');
    terminal.write('LAYER1-READY\n');
    deepStrictEqual(bootstrap, [{kind: 'ready'}]);
  });

  it('F-2704 AC-11: the timeout line is reported with its seconds', () => {
    const {terminal, bootstrap} = fixture();
    terminal.write('LAYER1-TIMEOUT 5\r\n');
    deepStrictEqual(bootstrap, [{kind: 'timeout', seconds: 5}]);
  });

  it('F-2704 AC-13: the exit line is reported with its status', () => {
    const {terminal, bootstrap} = fixture();
    terminal.write('LAYER1-EXITED 1\n');
    deepStrictEqual(bootstrap, [{kind: 'exited', status: 1}]);
  });

  it('#443: a run after the ready line gets its own lines, not the marker', async () => {
    const {terminal, start} = fixture();
    const attempt = start();
    terminal.write('LAYER1-READY\nm1:start\nhello\nm1:end 0\n');
    deepStrictEqual(
      [attempt.lines, await attempt.ended],
      [['hello'], {kind: 'ended', status: 0}],
    );
  });

  it('#443: a run that prints a marker-like line after the ready line gets it as output', () => {
    const {terminal, start} = fixture();
    const attempt = start();
    terminal.write('LAYER1-READY\nm1:start\nLAYER1-EXITED 1\nm1:end 0\n');
    deepStrictEqual(attempt.lines, ['LAYER1-EXITED 1']);
  });

  it('#443: the echo of the prelude is not taken for a marker', () => {
    const {terminal, bootstrap} = fixture();
    terminal.write("printf 'LAYER1-READY\\n'\r\n");
    deepStrictEqual(bootstrap, []);
  });
});
