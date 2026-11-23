import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {noWindowLeft} from './support.ts';

const runFile = promisify(execFile);

/** Where the row's postStartCommand writes the echo relay's socket path, in the container. */
const SOCKET_RECORD = '/tmp/c179-socket';

/** The bytes the client sends: more than one frame's 64 KiB, in a pattern a lost or reordered chunk would break. */
const SENT_BYTES = 150_000;

/**
 * The client, for the server's own `node`: it sends `SENT_BYTES` patterned bytes to the socket in its argument and prints
 * whether what came back is the same, then ends.
 */
const CLIENT = `const net = require('net');
const sent = Buffer.alloc(${String(SENT_BYTES)}, 0);
for (let index = 0; index < sent.length; index += 1) sent[index] = index % 251;
const chunks = [];
let length = 0;
const socket = net.connect(process.argv[1], () => socket.write(sent));
socket.on('data', chunk => {
  chunks.push(chunk);
  length += chunk.length;
  if (length >= sent.length) {
    process.stdout.write(Buffer.concat(chunks).equals(sent) ? 'same' : 'different');
    socket.end();
  }
});
socket.on('error', error => {
  process.stdout.write('error ' + error.code);
});`;

/** The text `docker exec` prints for `argv` in container `containerId`, as `user`. */
async function inContainer(
  containerId: string,
  user: string,
  argv: readonly string[],
): Promise<string> {
  const {stdout} = await runFile('docker', [
    'exec',
    '--user',
    user,
    containerId,
    ...argv,
  ]);
  return stdout.trim();
}

/** The socket path the postStartCommand recorded, once it has run. */
async function recordedSocket(containerId: string): Promise<string> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const recorded = await inContainer(containerId, 'node', [
      'cat',
      SOCKET_RECORD,
    ]).catch(() => '');
    if (recorded !== '') {
      return recorded;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${SOCKET_RECORD}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

describe('Dev Containers: the connection’s relay host (card containers-179)', function () {
  this.timeout(900_000);
  beforeEach(noWindowLeft);

  it('containers-179 (c179-echo): the harness’s echo relay listens at a socket of mode 0600 owned by the remote user, its variable reaches the lifecycle commands, and a stream longer than one frame comes back unchanged', async () => {
    const folder = devContainerFolder('c179-echo', {
      remoteUser: 'node',
      postStartCommand: `printf %s "$REMOTE_OSS_RELAY_ECHO_SOCK" > ${SOCKET_RECORD}`,
    });
    const name = await openFolderWindow(folder);
    try {
      await reopenInContainer(name);
      const [containerId = ''] = await devContainersOf(folder);
      const socket = await recordedSocket(containerId);
      const node = await inContainer(containerId, 'node', [
        'sh',
        '-c',
        'for file in "$HOME"/.*/bin/*/node; do [ -x "$file" ] && echo "$file" && break; done',
      ]);
      const owner = await inContainer(containerId, 'root', [
        'stat',
        '-c',
        '%a %U',
        socket,
      ]);
      const echoed = await inContainer(containerId, 'node', [
        node,
        '-e',
        CLIENT,
        socket,
      ]);
      deepStrictEqual(
        [
          /^\/tmp\/remote-oss-echo-[0-9a-f]{16}\.sock$/.test(socket),
          owner,
          echoed,
        ],
        [true, '600 node', 'same'],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
