import {deepStrictEqual} from 'node:assert';
import * as vscode from 'vscode';
import {connectionLog} from '../suite/harness.ts';

/** The harness host's home folder, as the remote window names it. */
const HOME_URI = vscode.Uri.parse(
  'vscode-remote://ssh-remote+harness/home/harness',
);

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

describe('a launch in terminal mode', () => {
  it('D-85: a launch with remote.SSH.useLocalServer false connects in terminal mode', () => {
    deepStrictEqual(
      [
        vscode.env.remoteName,
        vscode.workspace.getConfiguration('remote.SSH').get('useLocalServer'),
      ],
      ['ssh-remote', false],
    );
  });

  it("#639: in terminal mode the window's connection works (the login terminal is local)", async () => {
    deepStrictEqual(
      [
        await homeType(),
        connectionLog().filter(line => line.includes('connect failed')),
      ],
      [vscode.FileType.Directory, []],
    );
  });
});
