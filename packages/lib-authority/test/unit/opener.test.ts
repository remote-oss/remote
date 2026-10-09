import {deepStrictEqual} from 'node:assert';
import {
  closeRemote,
  openLocal,
  type OpenerHost,
  openRemote,
  reload,
} from '../../src/index.ts';

/** A host that records the commands it is given and answers or refuses as told. */
function refusing(reason: unknown): PromiseLike<never> {
  return {
    then: (...handlers) => {
      handlers[1]?.(reason);
      return Promise.resolve(undefined as never);
    },
  };
}

function recordingHost(refusal?: unknown): {
  host: OpenerHost;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  return {
    calls,
    host: {
      executeCommand: (command, ...parameters) => {
        calls.push([command, ...parameters]);
        return refusal === undefined
          ? Promise.resolve(undefined)
          : refusing(refusal);
      },
      addressOf: parts => ({address: parts}),
    },
  };
}

describe('opening a window on a remote authority (F-2502, F-5902 section 5)', () => {
  it('F-2502: a folder in the current window runs openFolder with the editor address and the reuse option', async () => {
    const {host, calls} = recordingHost();
    await openRemote(host, 'ssh-remote+h', {
      path: '/home/u/p',
      pathKind: 'folder',
      target: 'current',
    });
    deepStrictEqual(calls, [
      [
        'vscode.openFolder',
        {
          address: {
            scheme: 'vscode-remote',
            authority: 'ssh-remote+h',
            path: '/home/u/p',
          },
        },
        {forceNewWindow: false, forceReuseWindow: true},
      ],
    ]);
  });

  it('F-2502: a folder in a new window forces a new window and no reuse', async () => {
    const {host, calls} = recordingHost();
    await openRemote(host, 'ssh-remote+h', {
      path: '/home/u/p',
      pathKind: 'folder',
      target: 'new',
    });
    deepStrictEqual(
      calls.map(call => call[2]),
      [{forceNewWindow: true, forceReuseWindow: false}],
    );
  });

  it('F-5902: a workspace file opens with the same command', async () => {
    const {host, calls} = recordingHost();
    await openRemote(host, 'ssh-remote+h', {
      path: '/p/a.code-workspace',
      pathKind: 'workspace',
      target: 'new',
    });
    deepStrictEqual(
      calls.map(call => call[0]),
      ['vscode.openFolder'],
    );
  });

  it('F-2502: without a path the empty window of the authority opens through newWindow, with no address', async () => {
    const {host, calls} = recordingHost();
    await openRemote(host, 'ssh-remote+h', {
      pathKind: 'folder',
      target: 'new',
    });
    deepStrictEqual(calls, [
      [
        'vscode.newWindow',
        {remoteAuthority: 'ssh-remote+h', reuseWindow: false},
      ],
    ]);
  });

  it('F-2502: a successful open is reported as opened', async () => {
    const {host} = recordingHost();
    deepStrictEqual(
      await openRemote(host, 'ssh-remote+h', {
        path: '/p',
        pathKind: 'folder',
        target: 'current',
      }),
      {kind: 'opened'},
    );
  });

  it('F-5902: a refusal of the editor is a value with its message, and nothing is thrown', async () => {
    const {host} = recordingHost(new Error('no such authority'));
    deepStrictEqual(
      await openRemote(host, 'ssh-remote+h', {
        path: '/p',
        pathKind: 'folder',
        target: 'current',
      }),
      {kind: 'rejected', reason: 'no such authority'},
    );
  });

  it('F-5902: a refusal that is not an Error is worded from its text', async () => {
    const {host} = recordingHost('cancelled');
    deepStrictEqual(
      await openRemote(host, 'ssh-remote+h', {
        pathKind: 'folder',
        target: 'new',
      }),
      {kind: 'rejected', reason: 'cancelled'},
    );
  });
});

describe('opening a window on this machine (F-0406)', () => {
  it('F-0406: a folder opens with a file address', async () => {
    const {host, calls} = recordingHost();
    await openLocal(host, {path: '/p', pathKind: 'folder', target: 'new'});
    deepStrictEqual(
      calls.map(call => call[1]),
      [{address: {scheme: 'file', path: '/p'}}],
    );
  });

  it('F-0406: a folder opens in a local window, whatever the window it is asked from', async () => {
    const {host, calls} = recordingHost();
    await openLocal(host, {path: '/p', pathKind: 'folder', target: 'new'});
    deepStrictEqual(
      calls.map(call => call[2]),
      [{forceNewWindow: true, forceReuseWindow: false, forceLocalWindow: true}],
    );
  });

  it('F-0406: without a path an empty local window opens through newWindow, with no authority', async () => {
    const {host, calls} = recordingHost();
    await openLocal(host, {pathKind: 'folder', target: 'current'});
    deepStrictEqual(calls, [
      ['vscode.newWindow', {remoteAuthority: null, reuseWindow: true}],
    ]);
  });

  it('F-0406: a refusal is a value', async () => {
    const {host} = recordingHost(new Error('refused'));
    deepStrictEqual(
      await openLocal(host, {path: '/p', pathKind: 'folder', target: 'new'}),
      {kind: 'rejected', reason: 'refused'},
    );
  });
});

describe('reloading and leaving the remote side', () => {
  it('reload runs the editor command that reloads the window', async () => {
    const {host, calls} = recordingHost();
    await reload(host);
    deepStrictEqual(calls, [['workbench.action.reloadWindow']]);
  });

  it('closeRemote runs the editor command that closes the remote connection', async () => {
    const {host, calls} = recordingHost();
    await closeRemote(host);
    deepStrictEqual(calls, [['workbench.action.remote.close']]);
  });

  it('a refused reload is a value', async () => {
    const {host} = recordingHost(new Error('busy'));
    deepStrictEqual(await reload(host), {kind: 'rejected', reason: 'busy'});
  });

  it('a refused closeRemote is a value', async () => {
    const {host} = recordingHost(new Error('no remote'));
    deepStrictEqual(await closeRemote(host), {
      kind: 'rejected',
      reason: 'no remote',
    });
  });
});
