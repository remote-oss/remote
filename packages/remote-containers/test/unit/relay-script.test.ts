import {deepStrictEqual} from 'node:assert';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer, type Server, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {RecordingChannel} from 'lib-host/testing/recording-channel';
import {
  installRelayScript,
  RELAY_SCRIPT,
  relayScriptPath,
} from '../../src/exec/relay-script.ts';

const NEVER = new AbortController().signal;

/** A channel that answers the install script with `status`. */
function channelAnswering(status: number): RecordingChannel {
  return new RecordingChannel({
    identity: 'c1',
    platformHint: 'linux',
    scripts: [
      {
        interpreter: 'posixShell',
        matches: () => true,
        lines: [],
        ending: {kind: 'exit', status},
      },
    ],
  });
}

describe('the relay script of the exec dialer (card containers-02)', () => {
  it('relay: the path is in the data folder, with 12 hex digits of the text’s SHA-256', () => {
    const digest = createHash('sha256').update(RELAY_SCRIPT).digest('hex');
    deepStrictEqual(
      relayScriptPath('/home/u/.vscodium-server'),
      `/home/u/.vscodium-server/relay-${digest.slice(0, 12)}.js`,
    );
  });

  it('relay: installing runs one script with umask 022, chmod 0644 and the quoted path, giving the script as input', async () => {
    const channel = channelAnswering(0);
    const outcome = await installRelayScript(channel, "/home/u/it's", NEVER);
    const [call] = channel.calls;
    const request = call?.operation === 'runScript' ? call.request : undefined;
    const target = relayScriptPath("/home/u/it's");
    deepStrictEqual(
      [
        outcome,
        channel.calls.length,
        request?.script.includes('umask 022'),
        request?.script.includes('chmod 0644'),
        request?.script.includes(`'${target.replaceAll("'", `'\\''`)}'`),
        request?.input,
      ],
      [
        {kind: 'written', path: target},
        1,
        true,
        true,
        true,
        {kind: 'text', text: RELAY_SCRIPT},
      ],
    );
  });

  it('relay: a script that ends with a failing status is not written, and says so', async () => {
    deepStrictEqual(
      await installRelayScript(channelAnswering(1), '/d', NEVER),
      {kind: 'failed', detail: 'relay script not written (exit 1)'},
    );
  });

  it('relay: a channel failure is not written, with its detail', async () => {
    const channel = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: () => true,
          lines: [],
          ending: {
            kind: 'fail',
            failure: {kind: 'channelClosed', detail: 'container stopped'},
          },
        },
      ],
    });
    deepStrictEqual(await installRelayScript(channel, '/d', NEVER), {
      kind: 'failed',
      detail: 'container stopped',
    });
  });
});

describe('the relay script on real Node (card containers-02)', () => {
  let folder = '';
  let server: Server | undefined;
  const connections: Socket[] = [];

  before(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'relay-'));
    writeFileSync(path.join(folder, 'relay.js'), RELAY_SCRIPT);
  });

  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  afterEach(async () => {
    for (const connection of connections) {
      connection.destroy();
    }
    connections.length = 0;
    await new Promise<void>(resolve => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => {
        resolve();
      });
    });
  });

  /** Echoes what connections send; gives the port. */
  async function echoServer(): Promise<number> {
    server = createServer(connection => {
      connections.push(connection);
      connection.pipe(connection);
    });
    await new Promise<void>(resolve => {
      server?.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  function relay(port: number) {
    const child = spawn(process.execPath, [
      path.join(folder, 'relay.js'),
      String(port),
    ]);
    const printed: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => printed.push(chunk));
    const exited = new Promise<number | null>(resolve => {
      child.once('close', code => {
        resolve(code);
      });
    });
    return {child, printed, exited};
  }

  it('relay: what goes in on stdin comes back on stdout, and the end of stdin ends the process with 0', async () => {
    const {child, printed, exited} = relay(await echoServer());
    child.stdin.write('hello');
    await new Promise<void>(resolve => {
      const timer = setInterval(() => {
        if (Buffer.concat(printed).toString() === 'hello') {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    child.stdin.end();
    deepStrictEqual(
      [Buffer.concat(printed).toString(), await exited],
      ['hello', 0],
    );
  });

  it('relay: a closed port ends the process with 1 and prints nothing', async () => {
    const port = await echoServer();
    await new Promise<void>(resolve => {
      server?.close(() => {
        resolve();
      });
    });
    const {printed, exited} = relay(port);
    deepStrictEqual([await exited, Buffer.concat(printed).length], [1, 0]);
  });

  it('relay: when the server closes the connection the process ends with 0', async () => {
    const port = await echoServer();
    const {exited} = relay(port);
    await new Promise<void>(resolve => {
      const timer = setInterval(() => {
        if (connections.length > 0) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    connections[0]?.destroy();
    deepStrictEqual(await exited, 0);
  });
});
