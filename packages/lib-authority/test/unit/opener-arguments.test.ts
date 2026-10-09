import {deepStrictEqual} from 'node:assert';
import {openLocalCommand, openRemoteCommand} from '../../src/index.ts';

describe('openRemoteCommand (card authority-02 table)', () => {
  it("openRemoteCommand('ssh-remote+h', '/home/u/p', 'folder', 'current') -> openFolder, the vscode-remote uri, reuse", () => {
    deepStrictEqual(
      openRemoteCommand('ssh-remote+h', '/home/u/p', 'folder', 'current'),
      {
        command: 'vscode.openFolder',
        uri: {
          scheme: 'vscode-remote',
          authority: 'ssh-remote+h',
          path: '/home/u/p',
        },
        options: {forceNewWindow: false, forceReuseWindow: true},
      },
    );
  });

  it("openRemoteCommand('ssh-remote+h', '/home/u/p', 'folder', 'new') -> openFolder, forceNewWindow", () => {
    deepStrictEqual(
      openRemoteCommand('ssh-remote+h', '/home/u/p', 'folder', 'new'),
      {
        command: 'vscode.openFolder',
        uri: {
          scheme: 'vscode-remote',
          authority: 'ssh-remote+h',
          path: '/home/u/p',
        },
        options: {forceNewWindow: true, forceReuseWindow: false},
      },
    );
  });

  it("openRemoteCommand('ssh-remote+h', '/p/a.code-workspace', 'workspace', 'current') -> openFolder with that uri path, the same command", () => {
    deepStrictEqual(
      openRemoteCommand(
        'ssh-remote+h',
        '/p/a.code-workspace',
        'workspace',
        'current',
      ),
      {
        command: 'vscode.openFolder',
        uri: {
          scheme: 'vscode-remote',
          authority: 'ssh-remote+h',
          path: '/p/a.code-workspace',
        },
        options: {forceNewWindow: false, forceReuseWindow: true},
      },
    );
  });

  it("openRemoteCommand('ssh-remote+h', undefined, 'folder', 'current') -> newWindow, reuse", () => {
    deepStrictEqual(
      openRemoteCommand('ssh-remote+h', undefined, 'folder', 'current'),
      {
        command: 'vscode.newWindow',
        options: {remoteAuthority: 'ssh-remote+h', reuseWindow: true},
      },
    );
  });

  it("openRemoteCommand('ssh-remote+h', undefined, 'folder', 'new') -> newWindow, no reuse", () => {
    deepStrictEqual(
      openRemoteCommand('ssh-remote+h', undefined, 'folder', 'new'),
      {
        command: 'vscode.newWindow',
        options: {remoteAuthority: 'ssh-remote+h', reuseWindow: false},
      },
    );
  });
});

describe('openRemoteCommand (the local-window rule)', () => {
  it('openRemoteCommand with a path -> the options carry no forceLocalWindow key', () => {
    deepStrictEqual(
      openRemoteCommand('ssh-remote+h', '/home/u/p', 'folder', 'new').options,
      {forceNewWindow: true, forceReuseWindow: false},
    );
  });
});

describe('openLocalCommand (card authority-02 table)', () => {
  it("openLocalCommand('/p', 'folder', 'new') -> openFolder, the file uri, forceNewWindow, forceLocalWindow", () => {
    deepStrictEqual(openLocalCommand('/p', 'folder', 'new'), {
      command: 'vscode.openFolder',
      uri: {scheme: 'file', path: '/p'},
      options: {
        forceNewWindow: true,
        forceReuseWindow: false,
        forceLocalWindow: true,
      },
    });
  });

  it("openLocalCommand('/p/a.code-workspace', 'workspace', 'current') -> openFolder, reuse, forceLocalWindow", () => {
    deepStrictEqual(
      openLocalCommand('/p/a.code-workspace', 'workspace', 'current'),
      {
        command: 'vscode.openFolder',
        uri: {scheme: 'file', path: '/p/a.code-workspace'},
        options: {
          forceNewWindow: false,
          forceReuseWindow: true,
          forceLocalWindow: true,
        },
      },
    );
  });

  it("openLocalCommand(undefined, 'folder', 'new') -> newWindow, remoteAuthority null, no reuse", () => {
    deepStrictEqual(openLocalCommand(undefined, 'folder', 'new'), {
      command: 'vscode.newWindow',
      options: {remoteAuthority: null, reuseWindow: false},
    });
  });

  it("openLocalCommand(undefined, 'folder', 'current') -> newWindow, remoteAuthority null, reuse", () => {
    deepStrictEqual(openLocalCommand(undefined, 'folder', 'current'), {
      command: 'vscode.newWindow',
      options: {remoteAuthority: null, reuseWindow: true},
    });
  });
});
