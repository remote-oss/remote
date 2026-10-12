import {strictEqual} from 'node:assert';
import * as vscode from 'vscode';

describe('the remote window of the VSCodium run', () => {
  it('#253 Q14 ruling 3: the runner loaded in the remote extension host of the ssh-remote window', () => {
    strictEqual(vscode.env.remoteName, 'ssh-remote');
  });
});
