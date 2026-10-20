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

describe('a launch in socket mode', () => {
  let portServersBefore: string[] = [];

  before(async () => {
    portServersBefore = await portServerPids();
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
    if (portServersBefore.length === 0) {
      throw new Error('no port-kind server was running when the launch began');
    }
    const now = await portServerPids();
    deepStrictEqual(
      portServersBefore.filter(processId => !now.includes(processId)),
      [],
    );
  });
});
