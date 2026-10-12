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
  tunnelFeatures: undefined,
};

/** A host resolver that answers `connection`, with a factory a test can replace. */
function hostResolver(connection: ResolvedConnection): EditorResolver & {
  tunnelFactory: unknown;
} {
  return {
    resolve: () => Promise.resolve(connection),
    tunnelFactory: undefined,
  };
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

  it('contracts §3.2: no isTrusted and no tunnelFeatures key when the connection has none', async () => {
    const result = await resolvedThrough(CONNECTION);
    deepStrictEqual(
      ['isTrusted' in result, 'tunnelFeatures' in result],
      [false, false],
    );
  });

  it('contracts §3.2: isTrusted and tunnelFeatures pass through when present', async () => {
    const features = {elevation: false, privacyOptions: []};
    const result = await resolvedThrough({
      ...CONNECTION,
      isTrusted: true,
      tunnelFeatures: features,
    });
    deepStrictEqual(
      [result.isTrusted, result.tunnelFeatures],
      [true, features],
    );
  });

  it('contracts §3.2: the editor reads the factory the host holds now, not the one at registration', () => {
    const seen: Seen = {events: []};
    const host = hostResolver(CONNECTION);
    resolverEditorOf(fakeEditor(seen), {
      detailsCommand: DETAILS,
    }).registerRemoteAuthorityResolver('ssh-remote', host);
    function factory(): undefined {
      return undefined;
    }
    host.tunnelFactory = factory;
    deepStrictEqual(seen.registered?.tunnelFactory, factory);
  });

  it('F-2304 §3.3: the progress shows the details link on the first stage only', async () => {
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
        update('Initializing VS Code Server');
        update('Downloading VS Code Server');
        return Promise.resolve();
      },
    );
    deepStrictEqual(seen.events, [
      'progress Setting up SSH Host box false notification',
      `message ([details](command:${DETAILS})) Initializing VS Code Server`,
      'message Downloading VS Code Server',
    ]);
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
