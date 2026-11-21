import {deepStrictEqual} from 'node:assert';
import {
  RecordingChannel,
  type ScriptAnswer,
} from 'lib-host/testing/recording-channel';
import {
  releaseSessionLockOf,
  sessionLockPath,
} from '../../src/locks/session-lock.ts';
import {parametersFor} from './fake-host.ts';

const NEVER_CANCELLED = new AbortController().signal;

function placeAnswer(
  ending: ScriptAnswer['ending'],
  ...output: string[]
): ScriptAnswer {
  return {
    interpreter: 'posixShell',
    matches: script => script.includes('lock-path='),
    lines: output,
    ending,
  };
}

const RELEASE: ScriptAnswer = {
  interpreter: 'posixShell',
  matches: script => script === ':',
  lines: [],
  ending: {kind: 'exit', status: 0},
};

function channelOf(
  platformHint: 'linux' | 'windows',
  ...scripts: ScriptAnswer[]
): RecordingChannel {
  return new RecordingChannel({identity: 'host', platformHint, scripts});
}

function pathOver(channel: RecordingChannel): Promise<string | undefined> {
  return sessionLockPath(channel, parametersFor(), NEVER_CANCELLED);
}

describe('the host lock of a session (the place the host names)', () => {
  it('F-2408 BR-4: a flock host names the path of its lock', async () => {
    const channel = channelOf(
      'linux',
      placeAnswer(
        {kind: 'exit', status: 0},
        'lock-method=flock',
        'lock-path=/tmp/lock',
      ),
    );
    deepStrictEqual(await pathOver(channel), '/tmp/lock');
  });

  it('F-2408 BR-4: a Windows host takes no session lock, and is not asked anything', async () => {
    const channel = channelOf('windows');
    deepStrictEqual(
      [await pathOver(channel), channel.calls.length],
      [undefined, 0],
    );
  });

  it('F-2408 BR-4: a host that does not answer, by failing the run or by a status other than 0, takes no session lock', async () => {
    const failing = channelOf(
      'linux',
      placeAnswer({
        kind: 'fail',
        failure: {kind: 'channelClosed', detail: 'gone'},
      }),
    );
    const failed = channelOf(
      'linux',
      placeAnswer(
        {kind: 'exit', status: 3},
        'lock-method=flock',
        'lock-path=/tmp/lock',
      ),
    );
    deepStrictEqual(
      [await pathOver(failing), await pathOver(failed)],
      [undefined, undefined],
    );
  });

  it('F-2408 BR-4: a host with no flock, one that names no path and one that names an empty path take no session lock', async () => {
    const answers = [
      ['lock-method=link', 'lock-path=/tmp/lock'],
      ['lock-method=flock'],
      ['lock-method=flock', 'lock-path='],
    ];
    deepStrictEqual(
      await Promise.all(
        answers.map(output =>
          pathOver(
            channelOf(
              'linux',
              placeAnswer({kind: 'exit', status: 0}, ...output),
            ),
          ),
        ),
      ),
      [undefined, undefined, undefined],
    );
  });

  it('F-2408 BR-4: giving the hold up of a flock host runs the release at the path the host names, and of a Windows host runs nothing', async () => {
    const flock = channelOf(
      'linux',
      placeAnswer(
        {kind: 'exit', status: 0},
        'lock-method=flock',
        'lock-path=/tmp/lock',
      ),
      RELEASE,
    );
    await releaseSessionLockOf(flock, parametersFor());
    const windows = channelOf('windows');
    await releaseSessionLockOf(windows, parametersFor());
    deepStrictEqual(
      [flock.sessionLocks(), windows.calls.length],
      [[{path: '/tmp/lock', action: 'release'}], 0],
    );
  });
});
