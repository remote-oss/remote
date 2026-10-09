import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {probeApiOf} from '../../src/index.ts';

/** A fake of the editor's API whose members record when they are read. */
function fakeEditor(reads: string[]): typeof vscode {
  return {
    env: {
      get remoteAuthority() {
        reads.push('env.remoteAuthority');
        return 'ssh-remote+host';
      },
    },
    workspace: {
      get tunnels() {
        reads.push('workspace.tunnels');
        return Promise.resolve([]);
      },
    },
    window: {
      onDidWriteTerminalData: () => {
        reads.push('window.onDidWriteTerminalData');
        return {dispose: () => undefined};
      },
    },
    commands: {
      getCommands: (filterInternal?: boolean) => {
        reads.push(`commands.getCommands(${String(filterInternal)})`);
        return Promise.resolve(['one.focus']);
      },
    },
  } as unknown as typeof vscode;
}

describe('the editor behind the probes', () => {
  it('reads no member while the adapter is made', () => {
    const reads: string[] = [];
    probeApiOf(fakeEditor(reads));
    deepStrictEqual(reads, []);
  });

  it('reads the remote authority when the probe asks for it', () => {
    const reads: string[] = [];
    const authority = probeApiOf(fakeEditor(reads)).remoteAuthority;
    deepStrictEqual(
      [authority, reads],
      ['ssh-remote+host', ['env.remoteAuthority']],
    );
  });

  it('reads the tunnels when the probe asks for them', async () => {
    const reads: string[] = [];
    await probeApiOf(fakeEditor(reads)).tunnels;
    deepStrictEqual(reads, ['workspace.tunnels']);
  });

  it('subscribes to the terminal data through the editor', () => {
    const reads: string[] = [];
    probeApiOf(fakeEditor(reads)).onDidWriteTerminalData(() => undefined);
    deepStrictEqual(reads, ['window.onDidWriteTerminalData']);
  });

  it('lists the commands with the filter the probe gives', async () => {
    const reads: string[] = [];
    const commands = await probeApiOf(fakeEditor(reads)).getCommands(true);
    deepStrictEqual(
      [commands, reads],
      [['one.focus'], ['commands.getCommands(true)']],
    );
  });
});
