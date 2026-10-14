import {deepStrictEqual} from 'node:assert';
import {createProtocol, type Timers, writeEnvelope} from 'lib-companion';
import {
  type RecordingFake,
  createRecordingFake,
} from 'lib-companion/testing/recording-fake';
import {companionCallsOf} from '../../src/view/companion-calls.ts';

const ACTIVE = 'remote-internal.getActiveSshRemote';
const HOSTNAMES = 'remote-internal.getConfiguredHostnames';
const OPEN = 'remote-internal.openRemoteSshTarget';
const VERSION = {major: 1, minor: 0};

/** A clock with one timer that a test runs by hand. */
function handClock(): Timers & {fire(): void} {
  let callback: (() => void) | undefined;
  return {
    setTimer: given => {
      callback = given;
      return 1;
    },
    clearTimer: () => {
      callback = undefined;
    },
    fire: () => {
      callback?.();
    },
  };
}

function callsOver(fake: RecordingFake, timers: Timers = handClock()) {
  return companionCallsOf(
    createProtocol({
      // eslint-disable-next-line id-length -- the protocol's option is named bus
      bus: fake,
      timers,
    }),
  );
}

describe('the companion calls of the view (card explorer-04)', () => {
  it('F-5902.5.rules: the two queries go out in the order asked, with the interface version, and their answers are read', async () => {
    const fake = createRecordingFake();
    fake.answerWith(ACTIVE, {
      kind: 'answer',
      result: {interfaceVersion: VERSION, connected: true, hostKey: 'dev'},
    });
    fake.answerWith(HOSTNAMES, {
      kind: 'answer',
      result: {interfaceVersion: VERSION, hostnames: ['dev', 'box']},
    });
    const calls = callsOver(fake);
    const outcomes = [await calls.activeRemote(), await calls.hostnames()];
    deepStrictEqual(
      [
        fake.calls.map(call => [call.commandId, call.interfaceVersion]),
        outcomes.map(outcome => outcome.status),
      ],
      [
        [
          [ACTIVE, VERSION],
          [HOSTNAMES, VERSION],
        ],
        ['answered', 'answered'],
      ],
    );
  });

  it('F-5902.AC-15: a silent companion gives unavailable after the limit', async () => {
    const fake = createRecordingFake();
    fake.answerWith(HOSTNAMES, {kind: 'silent'});
    const clock = handClock();
    const pending = callsOver(fake, clock).hostnames();
    clock.fire();
    deepStrictEqual(await pending, {status: 'unavailable', cause: 'timeout'});
  });

  it('F-5902.5.foreign: a foreign payload and a newer major version are unavailable, each for its cause', async () => {
    const fake = createRecordingFake();
    fake.answerWith(ACTIVE, {kind: 'foreign'});
    const first = await callsOver(fake).activeRemote();
    fake.answerWith(ACTIVE, {kind: 'newerMajor'});
    const second = await callsOver(fake).activeRemote();
    deepStrictEqual(
      [first, second],
      [
        {status: 'unavailable', cause: 'foreignPayload'},
        {status: 'unavailable', cause: 'unknownMajor'},
      ],
    );
  });

  it('F-5902.5.rules: an open request carries the version, the host key and the window, and no path or kind', async () => {
    const fake = createRecordingFake();
    const received: unknown[] = [];
    fake.registerCommand(OPEN, argument => {
      received.push(argument);
      return writeEnvelope();
    });
    const outcome = await callsOver(fake).open('Alias', 'new');
    deepStrictEqual(
      [received, outcome.status],
      [
        [{interfaceVersion: VERSION, hostKey: 'Alias', window: 'new'}],
        'answered',
      ],
    );
  });

  it('F-5902.AC-21: an open that the companion rejects is unavailable and throws nothing', async () => {
    const fake = createRecordingFake();
    fake.answerWith(OPEN, {kind: 'reject', reason: new Error('no')});
    deepStrictEqual(await callsOver(fake).open('Alias', 'current'), {
      status: 'unavailable',
      cause: 'rejected',
    });
  });
});
