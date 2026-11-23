import {deepStrictEqual} from 'node:assert';
import {
  encodeFrame,
  type Frame,
  FrameReader,
  MAX_PAYLOAD_BYTES,
} from '../../src/relays/relay-frames.ts';
import {
  HOST_CONNECT_MILLISECONDS,
  type HostEnd,
  MAX_OPEN_STREAMS,
  relaySession,
} from '../../src/relays/relay-session.ts';

const TEXT = new TextEncoder();

/** A host end the test drives: what it was given, and its listeners. */
interface FakeHostEnd extends HostEnd {
  written: string[];
  ended: boolean;
  accepts: boolean;
  emitData(text: string): void;
  emitDrain(): void;
  emitClose(): void;
}

function fakeHostEnd(): FakeHostEnd {
  let data: ((bytes: Uint8Array) => void) | undefined;
  let drain: (() => void) | undefined;
  let close: (() => void) | undefined;
  const end: FakeHostEnd = {
    written: [],
    ended: false,
    accepts: true,
    write: bytes => {
      end.written.push(new TextDecoder().decode(bytes));
      return end.accepts;
    },
    onData: listener => {
      data = listener;
    },
    onDrain: listener => {
      drain = listener;
    },
    onClose: listener => {
      close = listener;
    },
    end: () => {
      end.ended = true;
    },
    emitData: text => {
      data?.(TEXT.encode(text));
    },
    emitDrain: () => {
      drain?.();
    },
    emitClose: () => {
      close?.();
    },
  };
  return end;
}

/** A session over fake ports: what it sent, logged and did to the relay host, and how to answer its connects. */
function sessionScene(kinds: readonly string[] = ['ssh-agent']) {
  const sent: Frame[] = [];
  const reader = new FrameReader();
  const events: string[] = [];
  const connects: Array<{
    kind: string;
    signal: AbortSignal;
    resolve: (end: HostEnd) => void;
    reject: (error: Error) => void;
  }> = [];
  const timers: Array<() => void> = [];
  const session = relaySession({
    connectors: new Map(
      kinds.map(
        kind =>
          [
            kind,
            (signal: AbortSignal) =>
              new Promise<HostEnd>((resolve, reject) => {
                connects.push({kind, signal, resolve, reject});
              }),
          ] as const,
      ),
    ),
    send: bytes => {
      sent.push(...reader.push(bytes).frames);
    },
    pauseInput: () => {
      events.push('pause');
    },
    resumeInput: () => {
      events.push('resume');
    },
    endHost: () => {
      events.push('endHost');
    },
    ready: () => {
      events.push('ready');
    },
    setTimer: (milliseconds, callback) => {
      events.push(`timer ${String(milliseconds)}`);
      timers.push(callback);
      return () => {
        events.push('timer stopped');
      };
    },
    logLine: line => {
      events.push(`log ${line}`);
    },
  });
  /** Hands the session one frame from the container. */
  function frame(type: Frame['type'], stream: number, payload = ''): void {
    session.receive(encodeFrame({type, stream, payload: TEXT.encode(payload)}));
  }
  /** The frames the session sent the container, as text. */
  function shownSent(): string[] {
    return sent.map(each =>
      `${each.type} ${String(each.stream)} ${new TextDecoder().decode(each.payload)}`.trim(),
    );
  }
  return {session, frame, sent: shownSent, events, connects, timers};
}

/** Lets the session's promise callbacks run. */
function settle(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

describe('the extension’s side of a relay host (card containers-179)', () => {
  it('a host end that tells its close after the container closed the stream sends nothing more', async () => {
    const scene = sessionScene();
    scene.frame('open', 1, 'ssh-agent');
    const host = fakeHostEnd();
    scene.connects[0]?.resolve(host);
    await settle();
    scene.frame('close', 1);
    host.emitClose();
    deepStrictEqual(scene.sent(), []);
  });

  it('the first ready frame is told once; a second is ignored', () => {
    const scene = sessionScene();
    scene.frame('ready', 0);
    scene.frame('ready', 0);
    deepStrictEqual(scene.events, ['ready']);
  });

  it('a stream opens its host end lazily; bytes before it connects wait, with the input paused; then both ways and its close', async () => {
    const scene = sessionScene();
    scene.frame('open', 1, 'ssh-agent');
    scene.frame('data', 1, 'early');
    const host = fakeHostEnd();
    scene.connects[0]?.resolve(host);
    await settle();
    scene.frame('data', 1, 'later');
    host.emitData('answer');
    host.emitClose();
    deepStrictEqual(
      [
        scene.connects.map(each => each.kind),
        host.written,
        scene.sent(),
        scene.events,
        host.ended,
      ],
      [
        ['ssh-agent'],
        ['early', 'later'],
        ['data 1 answer', 'close 1'],
        [
          `timer ${String(HOST_CONNECT_MILLISECONDS)}`,
          'pause',
          'timer stopped',
          'resume',
        ],
        true,
      ],
    );
  });

  it('a host end that wants no more pauses the input until it drains; the container’s close ends the host end', async () => {
    const scene = sessionScene();
    scene.frame('open', 1, 'ssh-agent');
    const host = fakeHostEnd();
    host.accepts = false;
    scene.connects[0]?.resolve(host);
    await settle();
    scene.frame('data', 1, 'a');
    host.emitDrain();
    scene.frame('close', 1);
    scene.frame('data', 1, 'after');
    deepStrictEqual(
      [scene.events.slice(-2), host.ended, host.written, scene.sent()],
      [['pause', 'resume'], true, ['a'], []],
    );
  });

  it('a host end that can’t be reached, or not within the bound, closes its stream with a log line naming only its kind', async () => {
    const scene = sessionScene();
    scene.frame('open', 1, 'ssh-agent');
    scene.frame('open', 2, 'ssh-agent');
    scene.connects[0]?.reject(new Error('ENOENT /secret/path'));
    scene.timers[1]?.();
    const late = fakeHostEnd();
    scene.connects[1]?.resolve(late);
    await settle();
    deepStrictEqual(
      [
        scene.sent(),
        scene.events.filter(each => each.startsWith('log')),
        scene.connects[1]?.signal.aborted,
        late.ended,
      ],
      [
        ['close 2', 'close 1'],
        [
          'log the ssh-agent relay could not reach its host end',
          'log the ssh-agent relay could not reach its host end',
        ],
        true,
        true,
      ],
    );
  });

  it('a stream over the cap is closed at once with one log line; the others stay', () => {
    const scene = sessionScene();
    for (let stream = 1; stream <= MAX_OPEN_STREAMS + 1; stream += 1) {
      scene.frame('open', stream, 'ssh-agent');
    }
    deepStrictEqual(
      [
        scene.connects.length,
        scene.sent(),
        scene.events.filter(each => each.startsWith('log')),
      ],
      [
        MAX_OPEN_STREAMS,
        [`close ${String(MAX_OPEN_STREAMS + 1)}`],
        [
          `log a ssh-agent stream was closed: ${String(MAX_OPEN_STREAMS)} streams are open`,
        ],
      ],
    );
  });

  it('a kind this connection has no relay for, a stream number in use and broken framing each end the relay host and every stream', async () => {
    const outcomes = [];
    for (const [given, more] of [
      ['gpg', undefined],
      ['ssh-agent', 'again'],
      ['ssh-agent', 'broken'],
    ] as const) {
      const scene = sessionScene();
      scene.frame('open', 1, 'ssh-agent');
      const host = fakeHostEnd();
      scene.connects[0]?.resolve(host);
      await settle();
      if (more === 'again') {
        scene.frame('open', 1, given);
      } else if (more === 'broken') {
        scene.session.receive(new Uint8Array([9, 0, 0, 0, 1, 0, 0, 0, 0]));
      } else {
        scene.frame('open', 2, given);
      }
      scene.frame('data', 1, 'ignored');
      outcomes.push([
        host.ended,
        host.written,
        scene.events.filter(
          each => each === 'endHost' || each.startsWith('log'),
        ),
      ]);
    }
    deepStrictEqual(outcomes, [
      [
        true,
        [],
        [
          'log the relay host ended: a stream of a kind this connection has no relay for',
          'endHost',
        ],
      ],
      [
        true,
        [],
        ['log the relay host ended: a stream number already in use', 'endHost'],
      ],
      [
        true,
        [],
        [
          'log the relay host ended: its output broke the framing (unknownType)',
          'endHost',
        ],
      ],
    ]);
  });

  it('the relay host’s end closes every host end; data for a stream it never opened is dropped; long data is cut into frames of 64 KiB', async () => {
    const scene = sessionScene();
    scene.frame('data', 7, 'nobody');
    scene.frame('open', 1, 'ssh-agent');
    const host = fakeHostEnd();
    scene.connects[0]?.resolve(host);
    await settle();
    host.emitData('x'.repeat(MAX_PAYLOAD_BYTES + 1));
    scene.session.ended();
    scene.session.ended();
    scene.frame('open', 2, 'ssh-agent');
    deepStrictEqual(
      [
        scene.sent().map(each => each.length),
        host.ended,
        scene.connects.length,
      ],
      [[MAX_PAYLOAD_BYTES + 7, 8], true, 1],
    );
  });
});
