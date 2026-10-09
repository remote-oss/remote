import {deepStrictEqual} from 'node:assert';
import type {CopyRequest, ScriptRequest} from 'lib-host';
import {
  type LocalFiles,
  type SessionRun,
  type SessionRunEnd,
  SharedSessionChannel,
  type SharedSessionChannelOptions,
} from '../../src/index.ts';
import {asyncPieces} from './host-channel-fixture.ts';

const REQUEST: ScriptRequest = {
  script: 'echo hello',
  interpreter: 'posixShell',
  environment: {},
  input: {kind: 'text', text: ''},
  cancellation: new AbortController().signal,
};

describe('the host channel over the shared session', () => {
  let runs: SessionRun[];
  let waits: number[];
  let ending: Promise<SessionRunEnd>;
  let linesOfRun: string[];
  let copies: CopyRequest[];
  let files: LocalFiles;

  function channel(
    changes: Partial<SharedSessionChannelOptions> = {},
  ): SharedSessionChannel {
    return new SharedSessionChannel({
      session: {
        runOnSession: (started, onLine, waitMilliseconds) => {
          runs.push(started);
          waits.push(waitMilliseconds);
          for (const line of linesOfRun) {
            onLine(line);
          }
          return ending;
        },
      },
      direct: {
        identity: () => 'user@host:22',
        platformHint: () => 'linux',
        copyToHost: request => {
          copies.push(request);
          return Promise.resolve({kind: 'copied'});
        },
      },
      files,
      runDeadlineMilliseconds: 1000,
      runWaitMilliseconds: 5000,
      maximumInputBytes: 10,
      ...changes,
    });
  }

  beforeEach(() => {
    runs = [];
    waits = [];
    linesOfRun = [];
    copies = [];
    ending = Promise.resolve({kind: 'ended', status: 0});
    files = {
      exists: file => Promise.resolve(file === '/local/input'),
      read: () => asyncPieces([Uint8Array.from([1, 2, 3])]),
    };
  });

  it('is the host as the user wrote it, on the platform it was told', () => {
    const shared = channel();
    deepStrictEqual(
      [shared.identity(), shared.platformHint()],
      ['user@host:22', 'linux'],
    );
  });

  it('runs the script with the deadline and the wait it was given', async () => {
    await channel().runScript(REQUEST, () => undefined);
    deepStrictEqual(
      [runs.map(started => started.deadlineMilliseconds), waits],
      [[1000], [5000]],
    );
  });

  it('numbers its runs one after the other', async () => {
    const shared = channel();
    await shared.runScript(REQUEST, () => undefined);
    await shared.runScript(REQUEST, () => undefined);
    deepStrictEqual(
      runs.map(started => started.runId),
      [1, 2],
    );
  });

  it('puts the added environment variables in front of the script', async () => {
    await channel().runScript(
      {...REQUEST, environment: {NAME: "it's"}},
      () => undefined,
    );
    deepStrictEqual(
      runs[0]?.script,
      "NAME='it'\\''s'\nexport NAME\necho hello",
    );
  });

  it('refuses the PowerShell interpreter, and a name no variable can have, before it runs anything', async () => {
    const shared = channel();
    const outcomes = [
      await shared.runScript(
        {...REQUEST, interpreter: 'powershell'},
        () => undefined,
      ),
      await shared.runScript(
        {...REQUEST, environment: {'a b': 'x'}},
        () => undefined,
      ),
    ];
    deepStrictEqual(
      [outcomes.map(outcome => outcome.kind), runs.length],
      [['failed', 'failed'], 0],
    );
  });

  it('gives a text input to the session as base64, and none for an empty text', async () => {
    const shared = channel();
    await shared.runScript(
      {...REQUEST, input: {kind: 'text', text: 'hé'}},
      () => undefined,
    );
    await shared.runScript(REQUEST, () => undefined);
    deepStrictEqual(
      runs.map(started => started.inputBase64),
      [Buffer.from('hé').toString('base64'), null],
    );
  });

  it('gives the bytes of a local file to the session as base64', async () => {
    await channel().runScript(
      {...REQUEST, input: {kind: 'file', localFile: '/local/input'}},
      () => undefined,
    );
    deepStrictEqual(runs[0]?.inputBase64, 'AQID');
  });

  it('fails a file that is not there, naming it, before it runs anything', async () => {
    const outcome = await channel().runScript(
      {...REQUEST, input: {kind: 'file', localFile: '/local/missing'}},
      () => undefined,
    );
    deepStrictEqual(
      [outcome, runs.length],
      [
        {
          kind: 'failed',
          failure: {
            kind: 'spawnFailed',
            detail: 'no such local file: /local/missing',
          },
        },
        0,
      ],
    );
  });

  it('fails a file larger than the session can carry, and says to copy it', async () => {
    const outcome = await channel({maximumInputBytes: 2}).runScript(
      {...REQUEST, input: {kind: 'file', localFile: '/local/input'}},
      () => undefined,
    );
    deepStrictEqual(
      [
        outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
        outcome.kind === 'failed' && outcome.failure.detail.includes('scp'),
        runs.length,
      ],
      ['spawnFailed', true, 0],
    );
  });

  it('gives each line to the caller and the exit status as the result', async () => {
    linesOfRun = ['one', 'two'];
    ending = Promise.resolve({kind: 'ended', status: 5});
    const lines: string[] = [];
    const outcome = await channel().runScript(REQUEST, line =>
      lines.push(line),
    );
    deepStrictEqual(
      [lines, outcome],
      [['one', 'two'], {kind: 'exited', status: 5}],
    );
  });

  it('maps a session that ended to a closed channel and a late script to a timeout, keeping the text', async () => {
    const shared = channel();
    ending = Promise.resolve({
      kind: 'failed',
      reason: 'channelClosed',
      detail: 'the session ended',
    });
    const closed = await shared.runScript(REQUEST, () => undefined);
    ending = Promise.resolve({
      kind: 'failed',
      reason: 'timeout',
      detail: 'no end within 1000 ms',
    });
    const late = await shared.runScript(REQUEST, () => undefined);
    deepStrictEqual(
      [closed, late],
      [
        {
          kind: 'failed',
          failure: {kind: 'channelClosed', detail: 'the session ended'},
        },
        {
          kind: 'failed',
          failure: {kind: 'timeout', detail: 'no end within 1000 ms'},
        },
      ],
    );
  });

  it('maps a connection that is not set up to a closed channel', async () => {
    ending = Promise.resolve({
      kind: 'failed',
      reason: 'notConnected',
      detail: 'the connection is not set up',
    });
    const outcome = await channel().runScript(REQUEST, () => undefined);
    deepStrictEqual(outcome, {
      kind: 'failed',
      failure: {
        kind: 'channelClosed',
        detail: 'the connection is not set up',
      },
    });
  });

  it('ends as cancelled at once when the caller cancels, and delivers no later line', async () => {
    const controller = new AbortController();
    let late: (() => void) | undefined;
    ending = new Promise(resolve => {
      late = () => {
        resolve({kind: 'ended', status: 0});
      };
    });
    const lines: string[] = [];
    const running = channel().runScript(
      {...REQUEST, cancellation: controller.signal},
      line => lines.push(line),
    );
    await Promise.resolve();
    controller.abort();
    const outcome = await running;
    late?.();
    deepStrictEqual(
      [outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind, lines],
      ['cancelled', []],
    );
  });

  it('copies through the channel it was given, with a login of its own', async () => {
    const request: CopyRequest = {
      localFile: '/local/archive',
      remotePath: '/remote/archive',
      cancellation: new AbortController().signal,
    };
    deepStrictEqual(
      [await channel().copyToHost(request), copies],
      [{kind: 'copied'}, [request]],
    );
  });
});
