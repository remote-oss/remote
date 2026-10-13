import {deepStrictEqual} from 'node:assert';
import * as vscode from 'vscode';

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
});
