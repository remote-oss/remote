import {strictEqual} from 'node:assert';
import * as vscode from 'vscode';
import {onHost, overSsh} from './harness.ts';

describe('the acceptance harness', () => {
  it('runs the editor under test at the version floor', () => {
    strictEqual(vscode.version, '1.139.1');
  });

  it('reaches the host over SSH as the user harness', async () => {
    strictEqual((await overSsh('id -un')).trim(), 'harness');
  });

  it("gives the host's user a POSIX sh login shell", async () => {
    strictEqual((await overSsh('echo "$0"')).trim(), 'sh');
  });

  it('sees on the host a file written over SSH', async () => {
    await overSsh('printf written > "$HOME/acceptance-marker"');
    strictEqual(
      await onHost('cat', '/home/harness/acceptance-marker'),
      'written',
    );
  });
});
