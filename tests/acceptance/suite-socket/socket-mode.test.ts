import {deepStrictEqual} from 'node:assert';
import * as vscode from 'vscode';
import {onHost} from '../suite/harness.ts';

/** The harness host's home folder, as the remote window names it. */
const HOME_URI = vscode.Uri.parse(
  'vscode-remote://ssh-remote+harness/home/harness',
);

/** The pid files of the socket kind's servers in the data folders of the host's home. */
const SOCKET_PID_FILES =
  'for f in "$HOME"/.*/.*.socket.pid; do [ -f "$f" ] && echo "$f"; done';

/** Reads the type of the remote home folder, retrying every 500 ms for up to a minute; a refusal at the end is thrown. */
async function homeType(): Promise<vscode.FileType> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await vscode.workspace.fs.stat(HOME_URI)).type;
    } catch (caught) {
      if (attempt === 119) {
        throw caught;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

/** The lines of `text` that are not empty. */
function linesOf(text: string): string[] {
  return text.split('\n').filter(line => line !== '');
}

/** The process ids that the `--port` servers of the host have, outside the socket kind. */
async function portServerPids(): Promise<string[]> {
  return linesOf(
    await onHost(
      'sh',
      '-c',
      "ps -o pid=,args= | grep -- '--port' | grep -v grep | awk '{print $1}'",
    ),
  );
}

/** The words the host's socket kind server was started with, from its pid file; throws when the host has none. */
async function socketServerWords(): Promise<string[]> {
  const [pidFile] = linesOf(await onHost('sh', '-c', SOCKET_PID_FILES));
  if (pidFile === undefined) {
    throw new Error('the host has no pid file of a socket kind server');
  }
  const processId = (await onHost('cat', pidFile)).trim();
  return (await onHost('cat', `/proc/${processId}/cmdline`))
    .split('\0')
    .filter(word => word !== '');
}

/** The words of a server of the port kind: the socket kind server's, with its endpoint, token file and auto shutdown replaced. */
function portServerWords(
  words: readonly string[],
  tokenFile: string,
): string[] {
  const kept: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? '';
    if (word === '--socket-path' || word === '--connection-token-file') {
      index += 1;
    } else if (word !== '--enable-remote-auto-shutdown') {
      kept.push(word);
    }
  }
  return [
    ...kept,
    '--host',
    '127.0.0.1',
    '--port',
    '0',
    '--connection-token-file',
    tokenFile,
  ];
}

describe('a launch in socket mode', () => {
  const TOKEN_FILE = '/tmp/socket-mode-port-server.token';
  let ownPortServer = '';
  let portServersBefore: string[] = [];

  before(async () => {
    // The row is about a port kind server that is already running, as the terminal kind leaves one: this file starts its
    // own beside the window's socket kind server and removes it after, so no other launch has to have run before.
    const words = portServerWords(await socketServerWords(), TOKEN_FILE);
    await onHost('sh', '-c', `printf '%s' own-token > ${TOKEN_FILE}`);
    ownPortServer =
      linesOf(
        await onHost(
          'sh',
          '-c',
          'nohup "$@" >/dev/null 2>&1 & echo $!',
          'sh',
          ...words,
        ),
      )[0] ?? '';
    portServersBefore = await portServerPids();
  });

  after(async () => {
    if (ownPortServer !== '') {
      await onHost(
        'sh',
        '-c',
        `kill ${ownPortServer} 2>/dev/null; rm -f ${TOKEN_FILE}; true`,
      );
    }
  });

  it('F-2410 AC-2, AC-3: in socket mode the window connects and the server listens on a socket in /tmp', async () => {
    const homeKind = await homeType();
    const sockets = linesOf(
      await onHost(
        'sh',
        '-c',
        'for f in /tmp/code-*; do [ -S "$f" ] && echo "$f"; done',
      ),
    );
    const [pidFile] = linesOf(await onHost('sh', '-c', SOCKET_PID_FILES));
    if (pidFile === undefined) {
      throw new Error('the host has no pid file of a socket kind server');
    }
    const processId = (await onHost('cat', pidFile)).trim();
    const commandLine = (
      await onHost('cat', `/proc/${processId}/cmdline`)
    ).replaceAll('\0', ' ');
    deepStrictEqual(
      [
        homeKind,
        sockets.length > 0,
        commandLine.includes('--socket-path'),
        commandLine.includes('--port'),
      ],
      [vscode.FileType.Directory, true, true, false],
    );
  });

  it('F-2410 AC-9: a running port-kind server is left as it is (BR-7)', async () => {
    if (!portServersBefore.includes(ownPortServer)) {
      throw new Error(
        `the port-kind server this file started (${ownPortServer}) was not running when its rows began`,
      );
    }
    const now = await portServerPids();
    deepStrictEqual(
      [
        portServersBefore.filter(processId => !now.includes(processId)),
        now.includes(ownPortServer),
      ],
      [[], true],
    );
  });
});
