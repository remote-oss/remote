import {deepStrictEqual, notStrictEqual, strictEqual} from 'node:assert';
import {hostname} from 'node:os';
import * as vscode from 'vscode';
import {connectionLog, onHost, recordLines} from '../suite/harness.ts';
import {hostServer, isRunning, keepServer} from '../suite/host-server.ts';

/** The harness host's home folder, as the remote window names it. */
const HOME_URI = vscode.Uri.parse(
  'vscode-remote://ssh-remote+harness/home/harness',
);

/** Polls `read` until it gives a value other than `undefined`, for up to 20 s. */
async function eventually<Value>(
  read: () => Promise<Value | undefined>,
): Promise<Value> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) {
      return value;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('the host never showed the expected state');
}

describe('the remote window of the VSCodium run', () => {
  it('#253 Q14 ruling 3: the window is on ssh-remote', () => {
    strictEqual(vscode.env.remoteName, 'ssh-remote');
  });

  it("#253 Q14 ruling 3: the tests run outside the host, in the window's local extension host", async () => {
    notStrictEqual((await onHost('hostname')).trim(), hostname());
  });

  it("#140: the window's folder is the home folder on the harness host", () => {
    deepStrictEqual(
      vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()),
      [HOME_URI.toString()],
    );
  });

  it('#140: a file written through the window is on the host', async () => {
    const file = vscode.Uri.joinPath(HOME_URI, 'written-by-window.txt');
    await vscode.workspace.fs.writeFile(
      file,
      new TextEncoder().encode('from the window'),
    );
    strictEqual(
      await onHost('cat', '/home/harness/written-by-window.txt'),
      'from the window',
    );
  });

  it('#140: a file written on the host is read through the window', async () => {
    await onHost(
      'sh',
      '-c',
      'printf "from the host" > /home/harness/written-on-host.txt',
    );
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(HOME_URI, 'written-on-host.txt'),
    );
    strictEqual(new TextDecoder().decode(bytes), 'from the host');
  });

  it('#140: a terminal of the window runs on the host', async () => {
    const terminal = vscode.window.createTerminal({name: 'acceptance'});
    terminal.sendText('hostname > /home/harness/terminal-host.txt');
    const written = await eventually(async () => {
      const text = (
        await onHost('cat', '/home/harness/terminal-host.txt')
      ).trim();
      return text === '' ? undefined : text;
    });
    terminal.dispose();
    strictEqual(written, (await onHost('hostname')).trim());
  });

  it('#140: one server is installed on the host', async () => {
    strictEqual((await hostServer()).commits.length, 1);
  });

  it('#140: the installed server runs on the host', async () => {
    const server = await hostServer();
    keepServer(server);
    strictEqual(await isRunning(server.processId), true);
  });

  it("D-85: the connect's progress is in the record, title first", () => {
    strictEqual(
      recordLines('progress')[0]?.question.startsWith(
        'Setting up SSH Host harness',
      ),
      true,
    );
  });

  it("D-85: the log the tests read holds the connect's lines", () => {
    strictEqual(
      connectionLog().some(line => line.startsWith('Log level:')),
      true,
    );
  });
});
