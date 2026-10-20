import {deepStrictEqual} from 'node:assert';
import type {HelperEvent, PlainData, RequestOutcome} from 'lib-helper';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {ShutdownRequest} from '../../src/shutdown/protocol.ts';
import {pendingOf} from './pending.ts';
import {
  createWindowLease,
  type LeaseAcquired,
  type LeaseOnHelper,
  REQUEST_MILLISECONDS,
} from '../../src/shutdown/window-lease.ts';

const IDENTITY = {
  hostPath: '/w/proj',
  configFile: '/w/proj/.devcontainer/devcontainer.json',
};
const ENGINE = {dockerPath: 'docker', environment: {}};
const REGISTER: ShutdownRequest = {
  type: 'register',
  connectionId: 'a',
  identity: IDENTITY,
  engine: ENGINE,
};
const CONTAINER: ShutdownRequest = {
  type: 'container',
  connectionId: 'a',
  containerId: 'c0ffee',
  action: 'stop',
};
const LEAVE: ShutdownRequest = {type: 'leave', connectionId: 'a'};
const ACCEPTED: RequestOutcome = {kind: 'reply', body: {accepted: true}};

/** A lease on a fake helper: it records what it was asked and answers from `answer`. */
function fakeLease(
  answer: (body: PlainData) => RequestOutcome | Promise<RequestOutcome>,
) {
  const asked: Array<{type: unknown; limit: number}> = [];
  const listeners: Array<(event: HelperEvent) => void> = [];
  const lease: LeaseOnHelper = {
    request: (body, limit) => {
      asked.push({type: (body as {type?: unknown}).type, limit});
      return Promise.resolve(answer(body));
    },
    onEvent: listener => {
      listeners.push(listener);
      return () => undefined;
    },
  };
  return {
    lease,
    asked,
    emit: (event: HelperEvent) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

/** The window's lease over acquires that give `outcomes` in turn, with what was logged. */
function sceneOf(...outcomes: Array<LeaseAcquired | Error>) {
  const sink = new MemorySink();
  const acquires = {count: 0};
  const messenger = createWindowLease({
    acquire: () => {
      const outcome = outcomes[
        Math.min(acquires.count, outcomes.length - 1)
      ] ?? {
        kind: 'failed',
        failure: 'none given',
      };
      acquires.count += 1;
      return outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome);
    },
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  });
  return {messenger, acquires, sink};
}

/** The lines the logger kept, as `level: text`. */
function linesOf(sink: MemorySink): string[] {
  return sink.lines.map(line => `${line.level}: ${line.message}`);
}

describe('the window’s lease on the shutdown helper (card containers-69)', () => {
  it('F-0417 BR-9: the first message acquires the lease once, and the three messages reach the helper in order with a limit of two seconds', async () => {
    const helper = fakeLease(() => ACCEPTED);
    const {messenger, acquires, sink} = sceneOf({
      kind: 'acquired',
      lease: helper.lease,
    });
    await Promise.all([
      messenger.send(REGISTER),
      messenger.send(CONTAINER),
      messenger.send(LEAVE),
    ]);
    deepStrictEqual(
      [acquires.count, helper.asked, linesOf(sink)],
      [
        1,
        [
          {type: 'register', limit: REQUEST_MILLISECONDS},
          {type: 'container', limit: REQUEST_MILLISECONDS},
          {type: 'leave', limit: REQUEST_MILLISECONDS},
        ],
        [],
      ],
    );
  });

  it('F-0417 BR-10, BR-11: a helper that cannot be had gives one line and the message is dropped; later messages of the connection are dropped without asking, and a register asks again', async () => {
    const helper = fakeLease(() => ACCEPTED);
    const {messenger, acquires, sink} = sceneOf(
      {kind: 'failed', failure: 'spawnFailed'},
      {kind: 'acquired', lease: helper.lease},
    );
    await messenger.send(REGISTER);
    await messenger.send(CONTAINER);
    const before = acquires.count;
    await messenger.send({...REGISTER, connectionId: 'b'});
    deepStrictEqual(
      [
        before,
        acquires.count,
        helper.asked.map(each => each.type),
        linesOf(sink),
      ],
      [
        1,
        2,
        ['register'],
        [
          "warn: the shutdown helper isn't available (spawnFailed): this window's containers won't be stopped when it closes",
        ],
      ],
    );
  });

  it('F-0417 BR-11: a request that is refused, rejected or timed out is one line each and nothing else', async () => {
    const answers: RequestOutcome[] = [
      {kind: 'reply', body: {accepted: false, problem: 'unknown connection'}},
      {kind: 'rejected', reason: 'the helper failed'},
      {kind: 'timeout'},
    ];
    const helper = fakeLease(() => answers.shift() ?? ACCEPTED);
    const {messenger, sink} = sceneOf({kind: 'acquired', lease: helper.lease});
    for (const request of [REGISTER, CONTAINER, LEAVE]) {
      await messenger.send(request);
    }
    deepStrictEqual(linesOf(sink), [
      'warn: the shutdown helper did not take the register message: refused: unknown connection',
      'warn: the shutdown helper did not take the container message: the helper failed',
      'warn: the shutdown helper did not take the leave message: timeout',
    ]);
  });

  it('F-0417 BR-9: after the helper is gone, whether the lease said so or a request found out, the next register acquires again and the messages between are dropped', async () => {
    const first = fakeLease(() => ACCEPTED);
    const second = fakeLease(() => ({kind: 'helperGone'}));
    const third = fakeLease(() => ACCEPTED);
    const {messenger, acquires} = sceneOf(
      {kind: 'acquired', lease: first.lease},
      {kind: 'acquired', lease: second.lease},
      {kind: 'acquired', lease: third.lease},
    );
    await messenger.send(REGISTER);
    first.emit({kind: 'message', body: 'noise'});
    first.emit({kind: 'helperGone'});
    await messenger.send(CONTAINER);
    await messenger.send({...REGISTER, connectionId: 'b'});
    await messenger.send({...CONTAINER, connectionId: 'b'});
    await messenger.send({...REGISTER, connectionId: 'c'});
    deepStrictEqual(
      [
        acquires.count,
        first.asked.map(each => each.type),
        second.asked.map(each => each.type),
        third.asked.map(each => each.type),
      ],
      [3, ['register'], ['register'], ['register']],
    );
  });

  it('F-0417 BR-9: a message that arrives while an earlier one is still being answered waits for it', async () => {
    const order: string[] = [];
    const held = pendingOf<undefined>();
    const helper = fakeLease(async body => {
      order.push(`start ${String((body as {type?: unknown}).type)}`);
      if ((body as {type?: unknown}).type === 'register') {
        await held.promise;
      }
      order.push(`end ${String((body as {type?: unknown}).type)}`);
      return ACCEPTED;
    });
    const {messenger} = sceneOf({kind: 'acquired', lease: helper.lease});
    const first = messenger.send(REGISTER);
    const second = messenger.send(CONTAINER);
    await new Promise(resolve => setImmediate(resolve));
    held.resolve(undefined);
    await Promise.all([first, second]);
    deepStrictEqual(order, [
      'start register',
      'end register',
      'start container',
      'end container',
    ]);
  });

  it('F-0417 BR-10: an acquire that throws is one line, and the messages after it go on', async () => {
    const helper = fakeLease(() => ACCEPTED);
    const {messenger, sink} = sceneOf(new Error('boom'), {
      kind: 'acquired',
      lease: helper.lease,
    });
    await messenger.send(REGISTER);
    await messenger.send({...REGISTER, connectionId: 'b'});
    deepStrictEqual(
      [linesOf(sink), helper.asked.map(each => each.type)],
      [['warn: the shutdown helper could not be asked: boom'], ['register']],
    );
  });

  it('F-0417 BR-10: a throw that is not an error is told by its text', async () => {
    const sink = new MemorySink();
    const messenger = createWindowLease({
      // The row on a rejection that is not an error needs exactly that.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      acquire: () => Promise.reject('plain text'),
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    });
    await messenger.send(REGISTER);
    deepStrictEqual(linesOf(sink), [
      'warn: the shutdown helper could not be asked: plain text',
    ]);
  });
});
