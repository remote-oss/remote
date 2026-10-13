import {deepStrictEqual, notStrictEqual, strictEqual} from 'node:assert';
import {hostname} from 'node:os';
import * as vscode from 'vscode';
import {cliNotUsedLine} from '../../../packages/remote-ssh/src/pipeline/server-steps.ts';
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

  /** The texts of the connect's progress, title first, and the phases' details flags. */
  function progress(): Array<{text: string; details: boolean | undefined}> {
    return recordLines('progress').map(line => ({
      text: line.question,
      details: line.details,
    }));
  }

  it('F-2304 AC-1: the progress starts as "Setting up SSH Host harness" with "Initializing VS Code Server" and its details link', () => {
    deepStrictEqual(progress().slice(0, 2), [
      {text: 'Setting up SSH Host harness', details: undefined},
      {text: 'Initializing VS Code Server', details: true},
    ]);
  });

  it('F-2304 AC-6: the tunnel stage comes after every other stage', () => {
    const texts = progress().map(line => line.text);
    const tunnelAt = texts.findIndex(
      text =>
        text === 'Setting up SSH tunnel' ||
        text === 'Waiting for port forwarding to be ready',
    );
    deepStrictEqual(
      tunnelAt > 1 &&
        texts
          .slice(tunnelAt + 1)
          .every(
            text =>
              text === 'Setting up SSH tunnel' ||
              text === 'Waiting for port forwarding to be ready',
          ),
      true,
    );
  });

  it('F-2304 AC-11: on a host without a server the stages are Initializing, Downloading, then Installing', () => {
    const texts = progress().map(line => line.text);
    const order = [
      'Initializing VS Code Server',
      'Downloading VS Code Server',
      'Installing VS Code Server',
    ].map(text => texts.indexOf(text));
    deepStrictEqual(
      order.every(
        (position, index) =>
          position >= 0 && (index === 0 || position > (order[index - 1] ?? 0)),
      ),
      true,
    );
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

  it('F-3902 AC-6: the host has bin/<commit> and no CLI, and the log says once that the CLI was not used', async () => {
    deepStrictEqual(
      {
        serverCommits: (await hostServer()).commits.length,
        dataFolderEntries: (
          await onHost('ls', '-1', '/home/harness/.vscodium-server-insiders')
        )
          .split('\n')
          .filter(name => name !== ''),
        notUsedLines: connectionLog().filter(
          line => line === cliNotUsedLine('noCliSource'),
        ).length,
      },
      {serverCommits: 1, dataFolderEntries: ['bin'], notUsedLines: 1},
    );
  });
});

describe('the connect commands of the remote window (card connect-21)', () => {
  it('F-2301 AC-1: Connect to Host... is a registered command, with the other three connect commands', async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    deepStrictEqual(
      [
        'opensshremotes.openEmptyWindow',
        'opensshremotes.openEmptyWindowInCurrentWindow',
        'opensshremotes.openEmptyWindowOnCurrentHost',
        'opensshremotes.cleanLocalServer',
      ].filter(command => !registered.has(command)),
      [],
    );
  });
});
