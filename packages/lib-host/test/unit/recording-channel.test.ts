import {deepStrictEqual, rejects} from 'node:assert';
import type {CopyRequest, ScriptRequest} from '../../src/index.ts';
import {
  RecordingChannel,
  type ScriptAnswer,
} from '../../src/testing/recording-channel.ts';

const PROBE = 'uname -sm';

function scriptRequest(
  script: string,
  cancellation = new AbortController().signal,
): ScriptRequest {
  return {
    script,
    interpreter: 'posixShell',
    environment: {},
    input: {kind: 'text', text: ''},
    cancellation,
  };
}

function copyRequest(
  remotePath: string,
  cancellation = new AbortController().signal,
): CopyRequest {
  return {localFile: '/local/server.tar.gz', remotePath, cancellation};
}

function probeAnswer(status: number): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches: script => script === PROBE,
    lines: [`status ${String(status)}`],
    ending: {kind: 'exit', status},
  };
}

async function linesAndOutcome(
  channel: RecordingChannel,
  request: ScriptRequest,
): Promise<[string[], unknown]> {
  const lines: string[] = [];
  const outcome = await channel.runScript(request, line => {
    lines.push(line);
  });
  return [lines, outcome];
}

describe('recording channel (lib-host fake)', () => {
  it('answers identity and platform hint as set up', () => {
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'linux',
    });
    deepStrictEqual(
      [channel.identity(), channel.platformHint()],
      ['build-host', 'linux'],
    );
  });

  it('delivers the scripted lines in order, then the exit status', async () => {
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: () => true,
          lines: ['one', 'two'],
          ending: {kind: 'exit', status: 0},
        },
      ],
    });
    deepStrictEqual(await linesAndOutcome(channel, scriptRequest(PROBE)), [
      ['one', 'two'],
      {kind: 'exited', status: 0},
    ]);
  });

  it('ends a run with the scripted failure', async () => {
    const failure = {kind: 'timeout', detail: 'no answer in 15 s'} as const;
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: () => true,
          lines: [],
          ending: {kind: 'fail', failure},
        },
      ],
    });
    deepStrictEqual((await linesAndOutcome(channel, scriptRequest(PROBE)))[1], {
      kind: 'failed',
      failure,
    });
  });

  it('holds a run open until it is cancelled', async () => {
    const controller = new AbortController();
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: () => true,
          lines: ['waiting'],
          ending: {kind: 'holdUntilCancelled'},
        },
      ],
    });
    const pending = channel.runScript(
      scriptRequest(PROBE, controller.signal),
      () => undefined,
    );
    controller.abort(new Error('the user cancelled'));
    deepStrictEqual(await pending, {
      kind: 'failed',
      failure: {kind: 'cancelled', detail: 'the user cancelled'},
    });
  });

  it('matches an answer by interpreter as well as by script', async () => {
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'windows',
      scripts: [{...probeAnswer(1), interpreter: 'powershell'}, probeAnswer(2)],
    });
    deepStrictEqual((await linesAndOutcome(channel, scriptRequest(PROBE)))[1], {
      kind: 'exited',
      status: 2,
    });
  });

  it('uses each answer once, in order', async () => {
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'linux',
      scripts: [probeAnswer(1), probeAnswer(2)],
    });
    const first = await linesAndOutcome(channel, scriptRequest(PROBE));
    const second = await linesAndOutcome(channel, scriptRequest(PROBE));
    deepStrictEqual(
      [first[1], second[1]],
      [
        {kind: 'exited', status: 1},
        {kind: 'exited', status: 2},
      ],
    );
  });

  it('throws for a script no answer fits', async () => {
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'linux',
      scripts: [probeAnswer(0)],
    });
    await rejects(
      channel.runScript(scriptRequest('id -u'), () => undefined),
      {
        message: 'no scripted answer left for a posixShell script: id -u',
      },
    );
  });

  it('ends a script cancelled before the call as cancelled and keeps its answer', async () => {
    const controller = new AbortController();
    controller.abort(new Error('closed'));
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'linux',
      scripts: [probeAnswer(0)],
    });
    const cancelled = await linesAndOutcome(
      channel,
      scriptRequest(PROBE, controller.signal),
    );
    const later = await linesAndOutcome(channel, scriptRequest(PROBE));
    deepStrictEqual(
      [cancelled, later[1]],
      [
        [[], {kind: 'failed', failure: {kind: 'cancelled', detail: 'closed'}}],
        {kind: 'exited', status: 0},
      ],
    );
  });

  it('records every call of both operations in order', async () => {
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'linux',
      scripts: [probeAnswer(0)],
      copies: [{matches: () => true, ending: {kind: 'copied'}}],
    });
    const probe = scriptRequest(PROBE);
    const copy = copyRequest('/home/user/server.tar.gz');
    await channel.runScript(probe, () => undefined);
    await channel.copyToHost(copy);
    deepStrictEqual(channel.calls, [
      {operation: 'runScript', request: probe},
      {operation: 'copyToHost', request: copy},
    ]);
  });

  describe('input', () => {
    function streamingChannel(): RecordingChannel {
      return new RecordingChannel({
        identity: 'build-host',
        platformHint: 'linux',
        localFiles: new Map([['/local/data', Uint8Array.from([0, 255])]]),
        scripts: [
          {
            interpreter: 'posixShell',
            matches: () => true,
            lines: input => [Array.from(input).join(',')],
            ending: {kind: 'exit', status: 0},
          },
        ],
      });
    }

    it('gives a streamed local file to the answer as its bytes', async () => {
      const request = {
        ...scriptRequest(PROBE),
        input: {kind: 'file', localFile: '/local/data'},
      } as const;
      deepStrictEqual(await linesAndOutcome(streamingChannel(), request), [
        ['0,255'],
        {kind: 'exited', status: 0},
      ]);
    });

    it('gives a text input to the answer as UTF-8', async () => {
      const request = {
        ...scriptRequest(PROBE),
        input: {kind: 'text', text: 'é'},
      } as const;
      deepStrictEqual((await linesAndOutcome(streamingChannel(), request))[0], [
        '195,169',
      ]);
    });

    it('fails a missing local file with spawnFailed and keeps the answer', async () => {
      const channel = streamingChannel();
      const missing = {
        ...scriptRequest(PROBE),
        input: {kind: 'file', localFile: '/local/missing'},
      } as const;
      const failed = await linesAndOutcome(channel, missing);
      const later = await linesAndOutcome(channel, scriptRequest(PROBE));
      deepStrictEqual(
        [failed, later[1]],
        [
          [
            [],
            {
              kind: 'failed',
              failure: {
                kind: 'spawnFailed',
                detail: 'no such local file: /local/missing',
              },
            },
          ],
          {kind: 'exited', status: 0},
        ],
      );
    });
  });

  it('gives no host path for a client file by default', async () => {
    const channel = new RecordingChannel({
      identity: 'build-host',
      platformHint: 'linux',
    });
    deepStrictEqual(await channel.clientPathOnHost('/local/data'), undefined);
  });

  describe('copies', () => {
    const failure = {
      kind: 'copyToolMissing',
      detail: 'scp: not found',
    } as const;

    function copyingChannel(): RecordingChannel {
      return new RecordingChannel({
        identity: 'build-host',
        platformHint: 'linux',
        copies: [
          {matches: path => path === '/done', ending: {kind: 'copied'}},
          {matches: path => path === '/fails', ending: {kind: 'fail', failure}},
          {
            matches: path => path === '/held',
            ending: {kind: 'holdUntilCancelled'},
          },
        ],
      });
    }

    it('answers a copy by its remote path', async () => {
      const channel = copyingChannel();
      deepStrictEqual(
        [
          await channel.copyToHost(copyRequest('/fails')),
          await channel.copyToHost(copyRequest('/done')),
        ],
        [{kind: 'failed', failure}, {kind: 'copied'}],
      );
    });

    it('holds a copy open until it is cancelled', async () => {
      const controller = new AbortController();
      const pending = copyingChannel().copyToHost(
        copyRequest('/held', controller.signal),
      );
      controller.abort(new Error('stopped'));
      deepStrictEqual(await pending, {
        kind: 'failed',
        failure: {kind: 'cancelled', detail: 'stopped'},
      });
    });

    it('ends a copy cancelled before the call as cancelled', async () => {
      const controller = new AbortController();
      controller.abort(new Error('stopped'));
      deepStrictEqual(
        await copyingChannel().copyToHost(
          copyRequest('/done', controller.signal),
        ),
        {kind: 'failed', failure: {kind: 'cancelled', detail: 'stopped'}},
      );
    });

    it('throws for a copy no answer fits', async () => {
      await rejects(copyingChannel().copyToHost(copyRequest('/elsewhere')), {
        message: 'no scripted answer left for a copy to /elsewhere',
      });
    });
  });
});
