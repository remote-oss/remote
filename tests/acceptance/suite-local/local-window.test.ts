import {strictEqual} from 'node:assert';
import * as vscode from 'vscode';

describe('the local window of the VSCodium run', () => {
  it('#253 Q14: the runner loaded in a window with no remote', () => {
    strictEqual(vscode.env.remoteName, undefined);
  });
});
