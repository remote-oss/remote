import {deepStrictEqual} from 'node:assert';
import {type ChildProcess, spawn} from 'node:child_process';
import {mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {connect, type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  encodeFrame,
  type Frame,
  FrameReader,
} from '../../src/relays/relay-frames.ts';
import {
  installRelayHostScript,
  RELAY_HOST_SCRIPT,
  relayHostScriptPath,
} from '../../src/relays/relay-host-script.ts';
import {RecordingChannel} from 'lib-host/testing/recording-channel';

const TEXT = new TextEncoder();

/** Waits until `check` holds, polling every 20 ms for up to 5 s. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe('the relay host in the container (card containers-179)', function () {
  this.timeout(20_000);
  let folder = '';
  let host: ChildProcess;
  const frames: Frame[] = [];

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'relay-host-'));
    writeFileSync(path.join(folder, 'relay-host.js'), RELAY_HOST_SCRIPT);
    frames.length = 0;
    const reader = new FrameReader();
    host = spawn(process.execPath, [
      path.join(folder, 'relay-host.js'),
      `ssh-agent=${path.join(folder, 'agent.sock')}`,
      `gpg=${path.join(folder, 'gpg.sock')}`,
    ]);
    host.stdout?.on('data', (chunk: Buffer) => {
      frames.push(...reader.push(new Uint8Array(chunk)).frames);
    });
  });

  afterEach(() => {
    host.kill();
    rmSync(folder, {recursive: true, force: true});
  });

  it('once both its sockets listen, mode 0600, it says ready; a connection to one is a stream of frames both ways, and its end closes the stream', async () => {
    const socketPath = path.join(folder, 'agent.sock');
    await until(() => frames.length >= 1);
    const modes = ['agent.sock', 'gpg.sock'].map(name =>
      (statSync(path.join(folder, name)).mode & 0o777).toString(8),
    );
    const client: Socket = connect(socketPath);
    const received: string[] = [];
    client.on('data', (chunk: Buffer) => received.push(chunk.toString()));
    client.write('question');
    await until(() => frames.length >= 3);
    host.stdin?.write(
      encodeFrame({type: 'data', stream: 1, payload: TEXT.encode('answer')}),
    );
    await until(() => received.length > 0);
    client.end();
    await until(() => frames.length >= 4);
    deepStrictEqual(
      {
        modes,
        frames: frames.map(each =>
          `${each.type} ${String(each.stream)} ${new TextDecoder().decode(each.payload)}`.trim(),
        ),
        received,
      },
      {
        modes: ['600', '600'],
        frames: ['ready 0', 'open 1 ssh-agent', 'data 1 question', 'close 1'],
        received: ['answer'],
      },
    );
  });

  it('the extension’s close ends the connection, and the end of its input ends the relay host', async () => {
    await until(() => frames.length >= 1);
    const client = connect(path.join(folder, 'agent.sock'));
    let closed = false;
    client.on('close', () => {
      closed = true;
    });
    await until(() => frames.length >= 2);
    host.stdin?.write(
      encodeFrame({type: 'close', stream: 1, payload: new Uint8Array(0)}),
    );
    await until(() => closed);
    const exited = new Promise(resolve => host.once('exit', resolve));
    host.stdin?.end();
    deepStrictEqual([closed, await exited], [true, 0]);
  });

  it('the script goes in the data folder under a name that follows its text, mode 0644, given as the script’s input', async () => {
    const channel = new RecordingChannel({
      identity: 'c1',
      platformHint: 'linux',
      scripts: [
        {
          interpreter: 'posixShell',
          matches: () => true,
          lines: [],
          ending: {kind: 'exit', status: 0},
        },
      ],
    });
    const installed = await installRelayHostScript(
      channel,
      '/d',
      new AbortController().signal,
    );
    const [call] = channel.calls;
    const request = call?.operation === 'runScript' ? call.request : undefined;
    deepStrictEqual(
      [
        /^\/d\/relay-host-[0-9a-f]{12}\.js$/.test(relayHostScriptPath('/d')),
        installed,
        request?.script.includes('chmod 0644'),
        request?.input,
      ],
      [
        true,
        {kind: 'written', path: relayHostScriptPath('/d')},
        true,
        {kind: 'text', text: RELAY_HOST_SCRIPT},
      ],
    );
  });
});
