import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import type {CopyOutcome} from 'lib-host';
import type {Invocation, TerminalLogin} from '../../src/index.ts';
import {RecordingTerminals} from '../../src/testing/recording-terminal.ts';
import {terminalCopierOf} from '../../src/terminal/terminal-copy.ts';

const INVOCATION: Invocation = {
  program: '/x/scp',
  arguments: ['-v', '--', 'a', 'h:b'],
  environment: {},
};

const HANDSHAKE = 'debug1: SSH2_MSG_NEWKEYS received\n';

interface Fixture {
  clock: FakeClock;
  terminals: RecordingTerminals;
  questions: string[];
  logins: TerminalLogin[];
  disposed: number;
  /** The timers the copy armed and cancelled, so a take-down that leaves one running can be seen. */
  timers: {armed: number; cancelled: number; fired: number};
  copy(controller?: AbortController): Promise<CopyOutcome>;
}

function fixture(options: {reveal?: boolean} = {}): Fixture {
  const clock = new FakeClock();
  const terminals = new RecordingTerminals();
  const questions: string[] = [];
  const logins: TerminalLogin[] = [];
  const state = {disposed: 0};
  const timers = {armed: 0, cancelled: 0, fired: 0};
  const clockScheduler = clock.scheduler();
  const copier = terminalCopierOf({
    terminals,
    scheduler: {
      setTimer: (milliseconds, callback) => {
        timers.armed += 1;
        const cancel = clockScheduler.setTimer(milliseconds, () => {
          timers.fired += 1;
          callback();
        });
        return () => {
          timers.cancelled += 1;
          cancel();
        };
      },
    },
    invocationFor: () => INVOCATION,
    connectWait: () => ({
      connectTimeoutSeconds: 10,
      fromHost: false,
      unboundedWaitSeconds: 600,
    }),
    attachQuestions: login => {
      logins.push(login);
      return {
        onQuestion: text => {
          questions.push(text);
        },
        dispose: () => {
          state.disposed += 1;
        },
      };
    },
    revealLoginTerminals: () => options.reveal ?? false,
  });
  return {
    clock,
    terminals,
    questions,
    logins,
    get disposed() {
      return state.disposed;
    },
    timers,
    copy: controller =>
      copier({
        localFile: '/local/a',
        remotePath: 'b',
        cancellation: (controller ?? new AbortController()).signal,
      }),
  };
}

/** Starts a copy, lets it open its terminal, and gives the terminal. */
async function started(made: Fixture, controller?: AbortController) {
  const result = made.copy(controller);
  await Promise.resolve();
  const [terminal] = made.terminals.opened;
  if (terminal === undefined) {
    throw new Error('no terminal was opened');
  }
  return {result, terminal};
}

/** Whether the copy has settled: it has when it wins a race against a promise that never settles. */
async function settledWithin(result: Promise<CopyOutcome>): Promise<boolean> {
  const pending = Symbol('pending');
  const winner = await Promise.race([result, Promise.resolve(pending)]);
  return winner !== pending;
}

describe("the window's scp in a hidden login terminal (card ssh-29 table)", () => {
  it('F-2405 BR-8: opens one terminal named for the copy, with the invocation of the request', async () => {
    const made = fixture();
    const {terminal} = await started(made);
    deepStrictEqual(
      [made.terminals.opened.length, terminal.name, terminal.invocation],
      [1, 'Copy VS Code Server', INVOCATION],
    );
  });

  it('F-2405 AC-10: a terminal is not revealed when the setting says hidden', async () => {
    const {terminal} = await started(fixture({reveal: false}));
    deepStrictEqual(terminal.revealedAtOpen, false);
  });

  it('F-2308 BR-3: a terminal is revealed at open when the setting says so', async () => {
    const {terminal} = await started(fixture({reveal: true}));
    deepStrictEqual(terminal.revealedAtOpen, true);
  });

  it('F-2405 5.0 step 7: a terminal that ends with code 0 has copied the file', async () => {
    const {result, terminal} = await started(fixture());
    terminal.write(HANDSHAKE);
    terminal.end(0);
    deepStrictEqual(await result, {kind: 'copied'});
  });

  it('F-2405 7.E7: code 1 is a failed copy with the line scp printed', async () => {
    const {result, terminal} = await started(fixture());
    terminal.write('scp: /x: Permission denied\n');
    terminal.end(1);
    deepStrictEqual(await result, {
      kind: 'failed',
      failure: {
        kind: 'copyFailed',
        detail: 'scp failed: scp: /x: Permission denied',
      },
    });
  });

  it('F-2603: code 255 is a lost connection with the line scp printed', async () => {
    const {result, terminal} = await started(fixture());
    terminal.write('Host key verification failed.\n');
    terminal.end(255);
    deepStrictEqual(await result, {
      kind: 'failed',
      failure: {
        kind: 'channelClosed',
        detail:
          'scp could not keep the connection: Host key verification failed.',
      },
    });
  });

  it('F-2405 AC-9: a terminal that never started, with no reason from the user, is a refused trust', async () => {
    const {result, terminal} = await started(fixture());
    terminal.end(undefined, 'process');
    deepStrictEqual(await result, {
      kind: 'failed',
      failure: {
        kind: 'cancelled',
        detail: 'the terminal did not start: the workspace was not trusted',
      },
    });
  });

  it('F-2405 7.E7: a terminal the user closed is cancelled, not a refused trust', async () => {
    const {result, terminal} = await started(fixture());
    terminal.end(undefined, 'user');
    deepStrictEqual(await result, {
      kind: 'failed',
      failure: {kind: 'cancelled', detail: 'the copy terminal was closed'},
    });
  });

  it('F-2405 7.E7: a terminal with no code that had output was closed, not refused', async () => {
    const {result, terminal} = await started(fixture());
    terminal.write('some output\n');
    terminal.end(undefined, 'shutdown');
    deepStrictEqual(await result, {
      kind: 'failed',
      failure: {kind: 'cancelled', detail: 'the copy terminal was closed'},
    });
  });

  it('#253 Q11: the questions owner is given the copy terminal and its reader', async () => {
    const made = fixture();
    const {terminal} = await started(made);
    const [login] = made.logins;
    login?.terminal.send('x');
    deepStrictEqual([made.logins.length, terminal.sent], [1, ['x']]);
  });

  it('#253 Q11: a password question reaches the questions owner', async () => {
    const made = fixture();
    const {terminal} = await started(made);
    terminal.write("copy@host's password: ");
    made.clock.advance(100);
    deepStrictEqual(made.questions, ["copy@host's password: "]);
  });

  it('F-2105 BR-3: no output for the length of the wait is a timeout', async () => {
    const made = fixture();
    const {result} = await started(made);
    made.clock.advance(12_000);
    deepStrictEqual(await result, {
      kind: 'failed',
      failure: {kind: 'timeout', detail: 'the copy login did not finish'},
    });
  });

  it('F-2105 BR-3: the terminal is disposed when the wait runs out', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    made.clock.advance(12_000);
    await result;
    deepStrictEqual(terminal.disposed, true);
  });

  it('F-2105 BR-3: one millisecond before the wait runs out nothing has settled', async () => {
    const made = fixture();
    const {result} = await started(made);
    made.clock.advance(11_999);
    deepStrictEqual(await settledWithin(result), false);
  });

  it('F-2105 BR-3: the first output stops the wait, so a slow copy that has begun is not timed out', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write('Sending file modes: C0644 100 a\n');
    made.clock.advance(60_000);
    terminal.end(0);
    deepStrictEqual(await result, {kind: 'copied'});
  });

  it('F-2308 BR-5: a question nobody can reach after the handshake is a timeout', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(HANDSHAKE);
    terminal.write('Some unknown question? ');
    made.clock.advance(12_000);
    deepStrictEqual((await result).kind, 'failed');
  });

  it('F-2308 BR-5: one millisecond before that bound nothing has settled', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write(HANDSHAKE);
    terminal.write('Some unknown question? ');
    made.clock.advance(11_999);
    deepStrictEqual(await settledWithin(result), false);
  });

  it('contracts: a cancellation while the copy runs cancels it and disposes the terminal', async () => {
    const made = fixture();
    const controller = new AbortController();
    const {result, terminal} = await started(made, controller);
    controller.abort();
    deepStrictEqual(
      [await result, terminal.disposed],
      [
        {
          kind: 'failed',
          failure: {kind: 'cancelled', detail: 'cancelled by the caller'},
        },
        true,
      ],
    );
  });

  it('contracts: a cancellation that came before the copy opens no terminal', async () => {
    const made = fixture();
    const controller = new AbortController();
    controller.abort();
    deepStrictEqual(
      [await made.copy(controller), made.terminals.opened.length],
      [
        {
          kind: 'failed',
          failure: {
            kind: 'cancelled',
            detail: 'cancelled before the copy',
          },
        },
        0,
      ],
    );
  });

  it('contracts: a copy settles once, however many ends the terminal reports', async () => {
    const {result, terminal} = await started(fixture());
    terminal.end(0);
    terminal.end(1);
    deepStrictEqual(await result, {kind: 'copied'});
  });

  it('contracts: an abort after the copy ended does not change its outcome', async () => {
    const controller = new AbortController();
    const {result, terminal} = await started(fixture(), controller);
    terminal.end(0);
    const outcome = await result;
    controller.abort();
    deepStrictEqual(outcome, {kind: 'copied'});
  });

  it('connect-16: the questions are taken down once, whatever the outcome', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.end(0);
    await result;
    deepStrictEqual(made.disposed, 1);
  });

  it('#402: the cause of a failure survives the debug lines scp -v prints after it', async () => {
    const {result, terminal} = await started(fixture());
    terminal.write('scp: /x/y: No such file or directory\n');
    terminal.write(
      Array.from(
        {length: 40},
        (unusedItem, index) => `debug1: line ${String(index)}\n`,
      ).join(''),
    );
    terminal.end(1);
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.detail : outcome,
      'scp failed: scp: /x/y: No such file or directory',
    );
  });

  it('#402: a long output is cut to its latest lines, and the cause at its end is still told', async () => {
    const {result, terminal} = await started(fixture());
    terminal.write(
      Array.from(
        {length: 300},
        (unusedItem, index) => `scp: error ${String(index)}\n`,
      ).join(''),
    );
    terminal.end(1);
    const outcome = await result;
    const told =
      outcome.kind === 'failed' ? outcome.failure.detail.split('\n') : [];
    deepStrictEqual(
      [told.length, told[0], told.at(-1)],
      [20, 'scp failed: scp: error 280', 'scp: error 299'],
    );
  });

  /** A failed copy whose cause `after` debug lines follow, and the cause it tells. */
  async function causeAfter(after: number): Promise<string> {
    const {result, terminal} = await started(fixture());
    terminal.write('scp: /x: Permission denied\n');
    terminal.write(
      Array.from(
        {length: after},
        (unusedItem, index) => `debug1: ${String(index)}\n`,
      ).join(''),
    );
    terminal.end(1);
    const outcome = await result;
    return outcome.kind === 'failed' ? outcome.failure.detail : outcome.kind;
  }

  it('#402: a cause followed by 199 debug lines is still told', async () => {
    deepStrictEqual(
      await causeAfter(199),
      'scp failed: scp: /x: Permission denied',
    );
  });

  it('themis on #413: a cause followed by 250 debug lines is still told, the cap counts only the kept lines', async () => {
    const {result, terminal} = await started(fixture());
    terminal.write('scp: dest open "/x/f": No such file\n');
    terminal.write(
      Array.from(
        {length: 250},
        (unusedItem, index) => `debug1: ${String(index)}\n`,
      ).join(''),
    );
    terminal.end(1);
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.detail : outcome,
      'scp failed: scp: dest open "/x/f": No such file',
    );
  });
  it('#434: a blank line between two error lines is not told', async () => {
    const {result, terminal} = await started(fixture());
    terminal.write(
      'scp: /x: No such file or directory\n\nscp: /y: Permission denied\n',
    );
    terminal.end(1);
    const outcome = await result;
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.detail : outcome,
      'scp failed: scp: /x: No such file or directory\nscp: /y: Permission denied',
    );
  });

  it("themis on #413: a settled copy's wait and reader are stopped, so advancing the clock fires nothing", async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write("copy@host's password: ");
    terminal.end(0);
    const outcome = await result;
    made.clock.advance(13_000);
    deepStrictEqual([outcome, made.timers.fired], [{kind: 'copied'}, 0]);
  });

  it('contracts: a copy that ends takes down every timer it armed', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.write("copy@host's password: ");
    terminal.end(0);
    await result;
    deepStrictEqual(
      made.timers.armed - made.timers.cancelled - made.timers.fired,
      0,
    );
  });

  it('contracts: a copy that ends before any output takes down the wait it armed', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    terminal.end(undefined, 'process');
    await result;
    deepStrictEqual(
      made.timers.armed - made.timers.cancelled - made.timers.fired,
      0,
    );
  });

  it('contracts: a copy that is cancelled takes down every timer it armed', async () => {
    const made = fixture();
    const controller = new AbortController();
    const {result, terminal} = await started(made, controller);
    terminal.write(HANDSHAKE);
    terminal.write('Some unknown question? ');
    controller.abort();
    await result;
    deepStrictEqual(
      made.timers.armed - made.timers.cancelled - made.timers.fired,
      0,
    );
  });

  it('contracts: a terminal that ended by itself is not disposed again', async () => {
    const {result, terminal} = await started(fixture());
    terminal.end(0);
    await result;
    deepStrictEqual(terminal.disposed, false);
  });

  it('contracts: an end after a timeout does not change the outcome', async () => {
    const made = fixture();
    const {result, terminal} = await started(made);
    made.clock.advance(12_000);
    terminal.end(0);
    deepStrictEqual((await result).kind, 'failed');
  });
});
