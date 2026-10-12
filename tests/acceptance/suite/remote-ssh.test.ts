import {deepStrictEqual} from 'node:assert';
import * as vscode from 'vscode';

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

  it('F-2002: Open Web UI is served once the connect is registered', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes('opensshremotes.openWebUI'),
      true,
    );
  });

  it('F-2004: the help commands are served', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes('opensshremotes.getHelp'),
      true,
    );
  });
});
