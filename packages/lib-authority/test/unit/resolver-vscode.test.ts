import {deepStrictEqual} from 'node:assert';
import type * as vscode from 'vscode';
import {
  type EditorResolver,
  type ResolvedConnection,
  resolverEditorOf,
} from '../../src/index.ts';

const DETAILS = 'opensshremotes.showDetails';

/** What the fake editor saw, and the hooks a test drives it by. */
interface Seen {
  events: string[];
  registered?: vscode.RemoteAuthorityResolver;
  /** Fires the cancellation of the running progress. */
  cancel?: () => void;
}

class FakeResolvedAuthority {
  readonly host: string;
  readonly port: number;
  readonly connectionToken: string | undefined;

  constructor(host: string, port: number, connectionToken?: string) {
    this.host = host;
    this.port = port;
    this.connectionToken = connectionToken;
  }
}

/** A URI that prints as `text`. */
function uriOf(text: string): {toString(): string} {
  return {toString: () => text};
}

/** A fake editor with the workspace `place`: a workspace file, a folder, or neither. */
function fakeEditor(
  seen: Seen,
  place: {file?: string; folder?: string} = {},
): typeof vscode {
  return {
    ResolvedAuthority: FakeResolvedAuthority,
    ProgressLocation: {Notification: 'notification'},
    RemoteAuthorityResolverError: {
      NotAvailable: (message?: string, handled?: boolean) =>
        new Error(`NotAvailable ${String(message)} ${String(handled)}`),
      TemporarilyNotAvailable: (message?: string) =>
        new Error(`TemporarilyNotAvailable ${String(message)}`),
    },
    env: {sessionId: 'session-7'},
    workspace: {
      workspaceFile: place.file === undefined ? undefined : uriOf(place.file),
      workspaceFolders:
        place.folder === undefined ? undefined : [{uri: uriOf(place.folder)}],
      registerRemoteAuthorityResolver: (
        prefix: string,
        resolver: vscode.RemoteAuthorityResolver,
      ) => {
        seen.events.push(`register ${prefix}`);
        seen.registered = resolver;
        return {dispose: () => undefined};
      },
    },
    window: {
      withProgress: (
        options: vscode.ProgressOptions,
        task: (
          progress: {report(value: {message?: string}): void},
          token: {
            onCancellationRequested(listener: () => void): {
              dispose(): void;
            };
          },
        ) => Promise<unknown>,
      ) => {
        seen.events.push(
          `progress ${String(options.title)} ${String(options.cancellable)} ${options.location as unknown as string}`,
        );
        let listener: (() => void) | undefined;
        seen.cancel = () => listener?.();
        return task(
          {
            report: value => {
              seen.events.push(`message ${String(value.message)}`);
            },
          },
          {
            onCancellationRequested: given => {
              listener = given;
              return {
                dispose: () => {
                  listener = undefined;
                },
              };
            },
          },
        );
      },
    },
    commands: {
      executeCommand: (command: string) => {
        seen.events.push(`execute ${command}`);
        return Promise.resolve();
      },
    },
  } as unknown as typeof vscode;
}

const CONNECTION: ResolvedConnection = {
  host: '127.0.0.1',
  port: 4000,
  connectionToken: 'token-1',
  extensionHostEnv: {SSH_AUTH_SOCK: '/run/agent'},
  environmentTunnels: [],
};

/** A host resolver that answers `connection`. */
function hostResolver(connection: ResolvedConnection): EditorResolver {
  return {resolve: () => Promise.resolve(connection)};
}

/** Registers `connection`'s resolver and resolves once through what the editor was given. */
async function resolvedThrough(
  connection: ResolvedConnection,
): Promise<Record<string, unknown>> {
  const seen: Seen = {events: []};
  resolverEditorOf(fakeEditor(seen), {
    detailsCommand: DETAILS,
  }).registerRemoteAuthorityResolver('ssh-remote', hostResolver(connection));
  const result = await seen.registered?.resolve('ssh-remote+box', {
    resolveAttempt: 1,
  });
  return result as unknown as Record<string, unknown>;
}

describe('the editor behind the resolver host', () => {
  it('contracts §3.2: registers under the prefix it is given', () => {
    const seen: Seen = {events: []};
    resolverEditorOf(fakeEditor(seen), {
      detailsCommand: DETAILS,
    }).registerRemoteAuthorityResolver('ssh-remote', hostResolver(CONNECTION));
    deepStrictEqual(seen.events, ['register ssh-remote']);
  });

  it("contracts §3.2: a resolve gives the editor's authority with its options", async () => {
    const result = await resolvedThrough(CONNECTION);
    deepStrictEqual(
      [
        result instanceof FakeResolvedAuthority,
        result.host,
        result.port,
        result.connectionToken,
        result.extensionHostEnv,
        result.environmentTunnels,
      ],
      [true, '127.0.0.1', 4000, 'token-1', {SSH_AUTH_SOCK: '/run/agent'}, []],
    );
  });

  it('contracts §3.2: no isTrusted key when the connection has none', async () => {
    deepStrictEqual('isTrusted' in (await resolvedThrough(CONNECTION)), false);
  });

  it('contracts §3.2: isTrusted passes through when present', async () => {
    const result = await resolvedThrough({...CONNECTION, isTrusted: true});
    deepStrictEqual(result.isTrusted, true);
  });

  it('F-2507 6.3, BR-9: the editor gets neither tunnel features nor a tunnel factory, before and after a resolve', async () => {
    const seen: Seen = {events: []};
    resolverEditorOf(fakeEditor(seen), {
      detailsCommand: DETAILS,
    }).registerRemoteAuthorityResolver('ssh-remote', hostResolver(CONNECTION));
    const before = 'tunnelFactory' in (seen.registered ?? {});
    const result = await seen.registered?.resolve('ssh-remote+box', {
      resolveAttempt: 1,
    });
    deepStrictEqual(
      [
        before,
        'tunnelFactory' in (seen.registered ?? {}),
        'tunnelFeatures' in (result ?? {}),
      ],
      [false, false, false],
    );
  });

  /** The progress messages for the stages `run` reports, in order. */
  async function messagesFor(
    report: (update: (title: string, details: boolean) => void) => void,
  ): Promise<string[]> {
    const seen: Seen = {events: []};
    await resolverEditorOf(fakeEditor(seen), {
      detailsCommand: DETAILS,
    }).progress.withProgress(
      {
        title: 'Setting up SSH Host box',
        cancellable: false,
        onCancel: () => undefined,
        onDetails: () => undefined,
      },
      update => {
        report(update);
        return Promise.resolve();
      },
    );
    return seen.events.filter(event => event.startsWith('message '));
  }

  it('contracts §3.2: the details link goes with the stage that has it, whatever its position', async () => {
    deepStrictEqual(
      await messagesFor(update => {
        update('Waiting', false);
        update('Initializing VS Code Server', true);
        update('Downloading VS Code Server', false);
      }),
      [
        'message Waiting',
        `message ([details](command:${DETAILS})) Initializing VS Code Server`,
        'message Downloading VS Code Server',
      ],
    );
  });

  it('F-2308 6.2: the link also goes with a later stage that has it', async () => {
    deepStrictEqual(
      await messagesFor(update => {
        update('Initializing VS Code Server', true);
        update('Setting up SSH tunnel', true);
      }),
      [
        `message ([details](command:${DETAILS})) Initializing VS Code Server`,
        `message ([details](command:${DETAILS})) Setting up SSH tunnel`,
      ],
    );
  });

  it('contracts §3.2: the first stage has no link when it is not flagged', async () => {
    deepStrictEqual(
      await messagesFor(update => {
        update('Initializing VS Code Server', false);
      }),
      ['message Initializing VS Code Server'],
    );
  });

  it('contracts §3.2: the progress gives back what its task gave', async () => {
    const seen: Seen = {events: []};
    const value = await resolverEditorOf(fakeEditor(seen), {
      detailsCommand: DETAILS,
    }).progress.withProgress(
      {
        title: 't',
        cancellable: true,
        onCancel: () => undefined,
        onDetails: () => undefined,
      },
      () => Promise.resolve('done'),
    );
    deepStrictEqual(value, 'done');
  });

  /** How many times `onCancel` ran when the editor cancels twice during the task, or after it, as `when` says. */
  async function cancelsWhen(when: 'during' | 'after'): Promise<number> {
    const seen: Seen = {events: []};
    let cancels = 0;
    await resolverEditorOf(fakeEditor(seen), {
      detailsCommand: DETAILS,
    }).progress.withProgress(
      {
        title: 't',
        cancellable: true,
        onCancel: () => {
          cancels += 1;
        },
        onDetails: () => undefined,
      },
      () => {
        if (when === 'during') {
          seen.cancel?.();
          seen.cancel?.();
        }
        return Promise.resolve();
      },
    );
    if (when === 'after') {
      seen.cancel?.();
    }
    return cancels;
  }

  it("contracts §3.2: the editor's cancel calls onCancel once", async () => {
    deepStrictEqual(await cancelsWhen('during'), 1);
  });

  it('contracts §3.2: no cancel after the task has ended', async () => {
    deepStrictEqual(await cancelsWhen('after'), 0);
  });

  it("contracts §3.2: notAvailable is the editor's NotAvailable", () => {
    const seen: Seen = {events: []};
    const error = resolverEditorOf(fakeEditor(seen), {
      detailsCommand: DETAILS,
    }).notAvailable('x', true);
    deepStrictEqual(error.message, 'NotAvailable x true');
  });

  it("contracts §3.2: temporarilyNotAvailable is the editor's", () => {
    const seen: Seen = {events: []};
    const error = resolverEditorOf(fakeEditor(seen), {
      detailsCommand: DETAILS,
    }).temporarilyNotAvailable('y');
    deepStrictEqual(error.message, 'TemporarilyNotAvailable y');
  });

  it("contracts §3.2: the window's id is the session's", () => {
    const seen: Seen = {events: []};
    deepStrictEqual(
      resolverEditorOf(fakeEditor(seen), {detailsCommand: DETAILS}).windowId(),
      'session-7',
    );
  });

  it('contracts §3.2: the workspace file comes before a folder', () => {
    const seen: Seen = {events: []};
    deepStrictEqual(
      resolverEditorOf(
        fakeEditor(seen, {
          file: 'file:///w.code-workspace',
          folder: 'file:///f',
        }),
        {detailsCommand: DETAILS},
      ).windowWorkspace(),
      'file:///w.code-workspace',
    );
  });

  it('contracts §3.2: a window with a folder only gives the folder', () => {
    const seen: Seen = {events: []};
    deepStrictEqual(
      resolverEditorOf(fakeEditor(seen, {folder: 'file:///f'}), {
        detailsCommand: DETAILS,
      }).windowWorkspace(),
      'file:///f',
    );
  });

  it('contracts §3.2: a window without a workspace gives nothing', () => {
    const seen: Seen = {events: []};
    deepStrictEqual(
      resolverEditorOf(fakeEditor(seen), {
        detailsCommand: DETAILS,
      }).windowWorkspace(),
      undefined,
    );
  });

  it("contracts §3.2: reload and close run the editor's commands", async () => {
    const seen: Seen = {events: []};
    const resolverEditor = resolverEditorOf(fakeEditor(seen), {
      detailsCommand: DETAILS,
    });
    await resolverEditor.reloadWindow();
    await resolverEditor.closeRemote();
    deepStrictEqual(seen.events, [
      'execute workbench.action.reloadWindow',
      'execute workbench.action.remote.close',
    ]);
  });
});

describe('the editor behind the resolver host: getCanonicalURI (card containers-22)', () => {
  /** What the editor was given for a host resolver with the mapping `canonicalPath`, or none. */
  function canonicalThrough(
    canonicalPath: EditorResolver['canonicalPath'],
  ): vscode.RemoteAuthorityResolver | undefined {
    const seen: Seen = {events: []};
    const editor = Object.assign(fakeEditor(seen), {
      // eslint-disable-next-line id-length -- the editor's class is named Uri
      Uri: {file: (path: string) => ({scheme: 'file', path})},
    });
    resolverEditorOf(editor, {
      detailsCommand: DETAILS,
    }).registerRemoteAuthorityResolver('dev-container', {
      ...hostResolver(CONNECTION),
      ...(canonicalPath === undefined ? {} : {canonicalPath}),
    });
    return seen.registered;
  }

  /** A URI of the fixture's dev container window, with `scheme` and `path`. */
  function remoteUri(scheme: string, path: string): vscode.Uri {
    const parts = {scheme, authority: 'dev-container+7b7d', path};
    return parts as unknown as vscode.Uri;
  }

  it('contracts §3.2: getCanonicalURI gives the local file URI of the mapped path', async () => {
    const registered = canonicalThrough(() => Promise.resolve('/home/u/p'));
    deepStrictEqual(
      await registered?.getCanonicalURI?.(remoteUri('vscode-remote', '/w/p')),
      {scheme: 'file', path: '/home/u/p'},
    );
  });

  it("contracts §3.2: a URI the mapping doesn't know gives undefined", async () => {
    const registered = canonicalThrough(() => Promise.resolve(undefined));
    deepStrictEqual(
      await registered?.getCanonicalURI?.(remoteUri('vscode-remote', '/etc')),
      undefined,
    );
  });

  it("contracts §3.2: a file URI isn't asked", async () => {
    const asked: string[] = [];
    const registered = canonicalThrough((authority, path) => {
      asked.push(`${authority}${path}`);
      return Promise.resolve('/x');
    });
    deepStrictEqual(
      [await registered?.getCanonicalURI?.(remoteUri('file', '/x')), asked],
      [undefined, []],
    );
  });

  it('contracts §3.2: getCanonicalURI waits for an async mapping', async () => {
    const registered = canonicalThrough(
      () =>
        new Promise(resolve => {
          setImmediate(() => {
            resolve('/home/u/p');
          });
        }),
    );
    deepStrictEqual(
      await registered?.getCanonicalURI?.(remoteUri('vscode-remote', '/w/p')),
      {scheme: 'file', path: '/home/u/p'},
    );
  });

  it('contracts §3.2: no mapping, no getCanonicalURI', () => {
    const registered = canonicalThrough(undefined);
    deepStrictEqual(
      registered === undefined ? 'none' : 'getCanonicalURI' in registered,
      false,
    );
  });
});
