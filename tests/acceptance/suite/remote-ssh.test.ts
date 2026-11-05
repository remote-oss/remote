import {deepStrictEqual} from 'node:assert';
import {homedir} from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {scriptFor} from '../suite-local/script.ts';

/** The commands the editor knows, after Remote - SSH has activated. */
async function commandsAfterActivation(): Promise<string[]> {
  await vscode.extensions.getExtension('remote-oss.remote-ssh')?.activate();
  return vscode.commands.getCommands(true);
}

describe('Remote - SSH, activated in the editor', () => {
  it('#140: the connect is registered: the details command the progress links to exists', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes('opensshremotes.showDetails'),
      true,
    );
  });

  it('Open Web UI is served once the connect is registered (F-2002)', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes('opensshremotes.openWebUI'),
      true,
    );
  });

  it('F-2203.AC-1: Open SSH Configuration File is served (#397)', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes(
        'opensshremotes.openConfigFile',
      ),
      true,
    );
  });

  it('F-2203 AC-2 (c119-select): with no configured file the picker gives the four rows, the user file first', async () => {
    const userFile = path.join(homedir(), '.ssh', 'config');
    const pick = scriptFor([
      {surface: 'filePick', match: 'SSH configuration file', answer: 'dismiss'},
    ]);
    await commandsAfterActivation();
    await vscode.commands.executeCommand('opensshremotes.openConfigFile');
    const line = pick.record().find(each => each.surface === 'filePick');
    deepStrictEqual(
      [line?.question, line?.items],
      [
        'Select SSH configuration file to update',
        [userFile, '/etc/ssh/ssh_config', 'Settings', 'Help'],
      ],
    );
  });

  it('the help commands are served (F-2004)', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes('opensshremotes.getHelp'),
      true,
    );
  });
});
