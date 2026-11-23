import {strictEqual} from 'node:assert';
import * as vscode from 'vscode';

/** The harness host's home folder, as the remote window names it. */
const HOME_URI = vscode.Uri.parse(
  'vscode-remote://ssh-remote+harness/home/harness',
);

describe('the primer of the socket launch', () => {
  it('connects in terminal mode, which leaves a port-kind server on the host', async () => {
    strictEqual(
      (await vscode.workspace.fs.stat(HOME_URI)).type,
      vscode.FileType.Directory,
    );
  });
});
