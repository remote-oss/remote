import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {channelAnswering} from './answering-channel.ts';
import {
  ECHO_VARIABLE,
  harnessRelayKindsOf,
} from '../../src/relays/echo-relay.ts';
import {
  encodeFrame,
  FrameReader,
  type Frame,
} from '../../src/relays/relay-frames.ts';
import {
  type RelayHostStart,
  type RelayKind,
  startRelayHost,
} from '../../src/relays/relay-host.ts';
import {relayHostScriptPath} from '../../src/relays/relay-host-script.ts';
import {fakeEngine, type FakeProcess, type SpawnPlan} from './fake-engine.ts';

const TEXT = new TextEncoder();

/** The harness's environment that turns the echo relay on. */
const ECHO_ON = {
  REMOTE_OSS_ACCEPTANCE: '1',
  REMOTE_OSS_ACCEPTANCE_RELAY_ECHO: '1',
};

/** The bytes of one frame from the container. */
function frameOf(
  type: Frame['type'],
  stream: number,
  payload = '',
): Uint8Array {
  return encodeFrame({type, stream, payload: TEXT.encode(payload)});
}

/** Lets the start's promise callbacks run. */
function settle(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

/** A start over a fake engine: what it gave, what it logged, its process, and its timers. */
async function started(
  options: {
    kinds?: readonly RelayKind[];
    channel?: ReturnType<typeof channelAnswering>;
    plan?: SpawnPlan;
    cancellation?: AbortSignal;
  } = {},
): Promise<{
  start: RelayHostStart;
  lines: string[];
  process: FakeProcess | undefined;
  engine: ReturnType<typeof fakeEngine>;
  timers: number[];
}> {
  const sink = new MemorySink();
  const timers: number[] = [];
  const engine = fakeEngine(
    options.plan ??
      (process => {
        process.print(frameOf('ready', 0));
      }),
  );
  const start = await startRelayHost(
    {
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
      randomName: () => 'r4nd0m',
      setTimer: milliseconds => {
        timers.push(milliseconds);
        return () => undefined;
      },
    },
    {
      engine,
      channel: options.channel ?? channelAnswering(0),
      containerId: 'c1',
      remoteUser: 'node',
      nodePath: '/srv/node',
      dataFolder: '/d',
      kinds: options.kinds ?? harnessRelayKindsOf(ECHO_ON),
      cancellation: options.cancellation ?? new AbortController().signal,
    },
  );
  await settle();
  return {
    start,
    lines: sink.lines.map(line => line.message),
    process: engine.processes[0],
    engine,
    timers,
  };
}

/** The frames written to the relay host's standard input. */
function framesSent(process: FakeProcess | undefined): string[] {
  return new FrameReader()
    .push(new Uint8Array(process?.stdin() ?? []))
    .frames.map(frame =>
      `${frame.type} ${String(frame.stream)} ${new TextDecoder().decode(frame.payload)}`.trim(),
    );
}

describe('a connection’s relay host (card containers-179, part 2)', () => {
  it('with no kind set up nothing is written or run, and there are no variables', async () => {
    const channel = channelAnswering(0);
    const scene = await started({kinds: [], channel});
    if (scene.start.kind === 'started') {
      scene.start.host.dispose();
    }
    deepStrictEqual(
      [
        scene.start.kind === 'started' && scene.start.host.variables,
        channel.calls.length,
        scene.engine.processes.length,
      ],
      [{}, 0, 0],
    );
  });

  it('a script that can’t be written fails the start with its detail, and nothing runs', async () => {
    const scene = await started({channel: channelAnswering(1)});
    deepStrictEqual(
      [scene.start.kind, scene.engine.processes.length],
      ['failed', 0],
    );
  });

  it('a docker exec that can’t be spawned fails the start with the system’s message', async () => {
    const scene = await started({plan: {failure: 'no docker'}});
    deepStrictEqual(scene.start, {kind: 'failed', detail: 'no docker'});
  });

  it('it runs as the remote user on the server’s node, with a fresh socket per kind, and once it is ready its variables name them', async () => {
    const scene = await started();
    const socket = '/tmp/remote-oss-echo-r4nd0m.sock';
    deepStrictEqual(
      [
        scene.process?.argv,
        scene.start.kind === 'started' && scene.start.host.variables,
        scene.lines,
        scene.timers,
      ],
      [
        [
          'exec',
          '-i',
          '--user',
          'node',
          'c1',
          '/srv/node',
          relayHostScriptPath('/d'),
          `echo=${socket}`,
        ],
        {[ECHO_VARIABLE]: socket},
        [`the relay host listens for echo at ${socket}`],
        [10_000],
      ],
    );
  });

  it('its lease ends with the connection: the end of its input, and the process killed', async () => {
    const scene = await started();
    if (scene.start.kind === 'started') {
      scene.start.host.dispose();
    }
    await scene.process?.stdinEnded;
    deepStrictEqual(scene.process?.killed, true);
  });

  it('a stream of the echo kind comes back through the frames, the input paused until its host end connected', async () => {
    let handle: FakeProcess | undefined;
    const scene = await started({
      plan: process => {
        handle = process;
        process.print(frameOf('ready', 0));
      },
    });
    const both = new Uint8Array([
      ...frameOf('open', 1, 'echo'),
      ...frameOf('data', 1, 'ping'),
    ]);
    handle?.print(both);
    await settle();
    await settle();
    deepStrictEqual(
      [scene.start.kind, framesSent(scene.process)],
      ['started', ['data 1 ping']],
    );
  });

  it('broken framing after it is ready ends its process', async () => {
    let handle: FakeProcess | undefined;
    await started({
      plan: process => {
        handle = process;
        process.print(frameOf('ready', 0));
      },
    });
    handle?.print(new Uint8Array([9, 0, 0, 0, 1, 0, 0, 0, 0]));
    await settle();
    deepStrictEqual(handle?.killed, true);
  });

  it('a relay host that ends before it is ready fails the start, and its end is logged with its status or signal', async () => {
    const exited = await started({
      plan: process => {
        process.exit(1);
      },
    });
    const signalled = await started({
      plan: process => {
        process.exit(undefined);
      },
    });
    deepStrictEqual(
      [exited.start.kind, exited.lines, signalled.lines],
      [
        'failed',
        ["the relay host's process ended (1)"],
        ["the relay host's process ended (signal)"],
      ],
    );
  });

  it('no ready within the bound fails the start and ends the process', async () => {
    const sink = new MemorySink();
    const engine = fakeEngine(() => undefined);
    const callbacks: Array<() => void> = [];
    const starting = startRelayHost(
      {
        logger: createLogger(sink, {minimumLevel: () => 'info'}),
        randomName: () => 'r4nd0m',
        setTimer: (milliseconds, callback) => {
          callbacks.push(callback);
          return () => undefined;
        },
      },
      {
        engine,
        channel: channelAnswering(0),
        containerId: 'c1',
        remoteUser: 'node',
        nodePath: '/srv/node',
        dataFolder: '/d',
        kinds: harnessRelayKindsOf(ECHO_ON),
        cancellation: new AbortController().signal,
      },
    );
    await settle();
    await settle();
    for (const callback of callbacks) {
      callback();
    }
    deepStrictEqual(
      [await starting, engine.processes[0]?.killed],
      [
        {
          kind: 'failed',
          detail: 'its sockets were not listening within the bound',
        },
        true,
      ],
    );
  });

  it('a connect cancelled before or while it waits for ready fails the start and ends the process', async () => {
    const early = new AbortController();
    const before = await started({
      plan: () => {
        early.abort();
      },
      cancellation: early.signal,
    });
    const late = new AbortController();
    const engine = fakeEngine(() => undefined);
    const starting = startRelayHost(
      {
        logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
        randomName: () => 'r4nd0m',
        setTimer: () => () => undefined,
      },
      {
        engine,
        channel: channelAnswering(0),
        containerId: 'c1',
        remoteUser: 'node',
        nodePath: '/srv/node',
        dataFolder: '/d',
        kinds: harnessRelayKindsOf(ECHO_ON),
        cancellation: late.signal,
      },
    );
    await settle();
    await settle();
    late.abort();
    const during = await starting;
    deepStrictEqual(
      [
        before.start.kind,
        before.process?.killed,
        during.kind,
        engine.processes[0]?.killed,
      ],
      ['failed', true, 'failed', true],
    );
  });
});

describe('the harness’s echo relay (card containers-179, part 2)', () => {
  it('is set up only while the acceptance switch and its own variable are both exactly 1', () => {
    deepStrictEqual(
      [
        harnessRelayKindsOf(ECHO_ON).map(relay => relay.kind),
        harnessRelayKindsOf({REMOTE_OSS_ACCEPTANCE_RELAY_ECHO: '1'}),
        harnessRelayKindsOf({REMOTE_OSS_ACCEPTANCE: '1'}),
        harnessRelayKindsOf({...ECHO_ON, REMOTE_OSS_ACCEPTANCE: 'true'}),
      ],
      [['echo'], [], [], []],
    );
  });

  it('its host end writes back what it reads, and nothing once it has ended', async () => {
    const [echo] = harnessRelayKindsOf(ECHO_ON);
    const end = await echo?.connect(new AbortController().signal);
    const heard: string[] = [];
    end?.onData(bytes => heard.push(new TextDecoder().decode(bytes)));
    end?.onDrain(() => undefined);
    end?.onClose(() => undefined);
    const accepted = end?.write(TEXT.encode('one'));
    end?.end();
    end?.write(TEXT.encode('two'));
    deepStrictEqual([heard, accepted], [['one'], true]);
  });
});
