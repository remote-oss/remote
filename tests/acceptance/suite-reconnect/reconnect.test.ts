import {deepStrictEqual, strictEqual} from 'node:assert';
import * as vscode from 'vscode';
import {hostServer, keptServer} from '../suite/host-server.ts';

describe('a second launch on the same host (ruling 2)', () => {
  it('#140: the second window is on ssh-remote', () => {
    strictEqual(vscode.env.remoteName, 'ssh-remote');
  });

  it('#140, F-2103 BR-8: the second connect installed nothing new', async () => {
    deepStrictEqual((await hostServer()).commits, keptServer().commits);
  });

  it('#140, F-2103 BR-8: the second connect reused the running server', async () => {
    strictEqual((await hostServer()).processId, keptServer().processId);
  });
});
