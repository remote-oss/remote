import {deepStrictEqual} from 'node:assert';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {RecordingChannel} from 'lib-host/testing/recording-channel';
import {hostOverrideStoreOf} from '../../src/cli/host-override-store.ts';
import {localHostChannel} from './local-host-channel.fixture.ts';

const NEVER = new AbortController().signal;

/** How the error of a refused write begins. */
const REFUSED =
  'the override file was not written on the host: the script on the host ended with status 1';

describe('the override file on the SSH host (card #3244)', () => {
  let folder = '';

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'host-override-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  /** The store over this machine's shell, whose temporary folder is `folder` and which has no runtime folder. */
  function storeOnThisMachine(name = 'first') {
    return hostOverrideStoreOf(
      localHostChannel({
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        TMPDIR: folder,
      }),
      () => name,
      NEVER,
    );
  }

  it('F-1302 BR-11: the text is written to a file of the user alone in a folder of the user alone, and the file is gone after the remove', async () => {
    const store = storeOnThisMachine();
    const file = await store.write('{"name": "secret ${localEnv:HOME}"}');
    const modes = [
      file,
      path.dirname(file),
      path.dirname(path.dirname(file)),
    ].map(each => statSync(each).mode & 0o777);
    const text = readFileSync(file, 'utf8');
    await store.remove(file);
    await store.remove(file);
    deepStrictEqual(
      [
        path.dirname(path.dirname(path.dirname(file))),
        modes,
        text,
        existsSync(file),
      ],
      [
        folder,
        [0o600, 0o700, 0o700],
        '{"name": "secret ${localEnv:HOME}"}',
        false,
      ],
    );
  });

  it('the runtime folder is used when the host sets one, and two files do not meet', async () => {
    const runtime = path.join(folder, 'run');
    const channel = localHostChannel({
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      TMPDIR: folder,
      XDG_RUNTIME_DIR: runtime,
    });
    let count = 0;
    const store = hostOverrideStoreOf(
      channel,
      () => `file${String(++count)}`,
      NEVER,
    );
    chmodSync(folder, 0o700);
    const first = await store.write('one');
    const second = await store.write('two');
    deepStrictEqual(
      [
        path.dirname(path.dirname(first)),
        first === second,
        readFileSync(first, 'utf8'),
      ],
      [runtime, false, 'one'],
    );
  });

  it('a folder that is not the user’s alone is refused, and nothing is written', async () => {
    const store = storeOnThisMachine();
    const file = await store.write('first');
    await store.remove(file);
    chmodSync(path.dirname(path.dirname(file)), 0o755);
    const refused = await store.write('second').then(
      () => 'written',
      (caught: unknown) => (caught as Error).message,
    );
    deepStrictEqual(
      [refused.startsWith(REFUSED), existsSync(file)],
      [true, false],
    );
  });

  it('the text goes on the script’s input and the name in its environment, never in the script, and the remove names its file in the environment', async () => {
    const channel = new RecordingChannel({
      identity: 'host',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: script => script.includes('cat >'),
          lines: ['override=/run/user/1000/remote-oss/cli-overrides/n.json'],
          ending: {kind: 'exit', status: 0},
        },
        {
          interpreter: 'posixShell',
          matches: script => script.includes('rm -f'),
          lines: [],
          ending: {kind: 'exit', status: 0},
        },
      ],
    });
    const store = hostOverrideStoreOf(channel, () => 'n', NEVER);
    const file = await store.write('secret text');
    await store.remove(file);
    deepStrictEqual(
      [
        file,
        channel.calls.map(call =>
          call.operation === 'runScript'
            ? [
                call.request.environment,
                call.request.input,
                call.request.script.includes('secret text'),
              ]
            : [],
        ),
      ],
      [
        '/run/user/1000/remote-oss/cli-overrides/n.json',
        [
          [{OVERRIDE_NAME: 'n'}, {kind: 'text', text: 'secret text'}, false],
          [{OVERRIDE_FILE: file}, {kind: 'text', text: ''}, false],
        ],
      ],
    );
  });

  it('a channel that fails, a script that gives no path, and a remove that fails are errors with their reason', async () => {
    function failing(): RecordingChannel {
      return new RecordingChannel({
        identity: 'host',
        platformHint: 'linux',
        scripts: [
          {
            interpreter: 'posixShell',
            matches: () => true,
            lines: [],
            ending: {
              kind: 'fail',
              failure: {kind: 'channelClosed', detail: 'the connection closed'},
            },
          },
        ],
      });
    }
    const silent = new RecordingChannel({
      identity: 'host',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: () => true,
          lines: ['noise'],
          ending: {kind: 'exit', status: 0},
        },
      ],
    });
    const messages: string[] = [];
    for (const attempt of [
      () => hostOverrideStoreOf(failing(), () => 'n', NEVER).write('text'),
      () => hostOverrideStoreOf(silent, () => 'n', NEVER).write('text'),
      () => hostOverrideStoreOf(failing(), () => 'n', NEVER).remove('/f'),
    ]) {
      await attempt().catch((caught: unknown) => {
        messages.push((caught as Error).message);
      });
    }
    deepStrictEqual(messages, [
      'the override file was not written on the host: the connection closed',
      'the override file was not written on the host: the script gave no path',
      'the override file was not removed on the host: the connection closed',
    ]);
  });
});
