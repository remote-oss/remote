import {deepStrictEqual, rejects} from 'node:assert';
import {
  type Connected,
  type ConnectInput,
  type ConnectPhase,
  type Connector,
  type EditorResolver,
  type Failed,
  type FailurePresenter,
  type PresenterOutcome,
  type ProgressRequest,
  type Readiness,
  registerResolver,
  type Registration,
  type ResolverEditor,
  type ResolverHandle,
  type ResolverOptions,
} from '../../src/index.ts';

const AUTHORITY = 'ssh-remote+my-alias';

const CONNECTED: Connected = {
  address: {host: '127.0.0.1', port: 4321},
  connectionToken: 'token-value',
  extensionHostEnv: {SSH_AUTH_SOCK: '/tmp/agent'},
  environmentTunnels: [{remotePort: 80}],
  tunnelFeatures: {elevation: false},
  tunnelFactory: 'factory-of-the-connection',
  trusted: false,
};

const FAILURE: Failed = {
  kind: 'unreachable',
  reason: {text: 'Could not reach the host.'},
  retryable: false,
  silent: false,
  userAlreadyNotified: false,
  hints: [],
  diagnostics: [],
};

/** An error of the editor, with the way it was made. */
class EditorError extends Error {
  readonly origin: string;

  constructor(origin: string, message: string | undefined) {
    super(message);
    this.origin = origin;
  }
}

/** A connector the test steers: what connect answers, the phases it reports, and what was asked of it. */
class FakeConnector implements Connector {
  answer: Connected | Failed = CONNECTED;
  failure: Error | undefined;
  phases: ConnectPhase[] = [];
  inputs: ConnectInput[] = [];
  cancels = 0;
  reveals = 0;
  during: (() => void) | undefined;
  private readonly phaseListeners = new Set<(phase: ConnectPhase) => void>();
  private readonly lostListeners = new Set<() => void>();
  private readonly closedListeners = new Set<() => void>();

  connect(input: ConnectInput): Promise<Connected | Failed> {
    this.inputs.push(input);
    for (const phase of this.phases) {
      for (const listener of this.phaseListeners) {
        listener(phase);
      }
    }
    this.during?.();
    return this.failure === undefined
      ? Promise.resolve(this.answer)
      : Promise.reject(this.failure);
  }

  cancel(): void {
    this.cancels += 1;
  }

  revealDetails(): void {
    this.reveals += 1;
  }

  onPhase(listener: (phase: ConnectPhase) => void): () => void {
    this.phaseListeners.add(listener);
    return () => {
      this.phaseListeners.delete(listener);
    };
  }

  onTransportLost(listener: () => void): () => void {
    this.lostListeners.add(listener);
    return () => {
      this.lostListeners.delete(listener);
    };
  }

  onTransportClosed(listener: () => void): () => void {
    this.closedListeners.add(listener);
    return () => {
      this.closedListeners.delete(listener);
    };
  }

  listenerCount(): number {
    return (
      this.phaseListeners.size +
      this.lostListeners.size +
      this.closedListeners.size
    );
  }

  lose(): void {
    for (const listener of this.lostListeners) {
      listener();
    }
  }

  close(): void {
    for (const listener of this.closedListeners) {
      listener();
    }
  }
}

/** An editor that records what the host asked of it. */
class FakeEditor implements ResolverEditor {
  registered: Array<{prefix: string; resolver: EditorResolver}> = [];
  disposed = 0;
  progressRuns: Array<ProgressRequest & {updates: string[]}> = [];
  actions: string[] = [];
  readonly progress = {
    withProgress: async <Result>(
      request: ProgressRequest,
      task: (update: (title: string) => void) => Promise<Result>,
    ): Promise<Result> => {
      const entry = {...request, updates: [] as string[]};
      this.progressRuns.push(entry);
      return task(title => {
        entry.updates.push(title);
      });
    },
  };

  registerRemoteAuthorityResolver(
    prefix: string,
    resolver: EditorResolver,
  ): {dispose(): void} {
    this.registered.push({prefix, resolver});
    return {
      dispose: () => {
        this.disposed += 1;
      },
    };
  }

  notAvailable(message: string | undefined, handled: boolean): Error {
    return new EditorError(`notAvailable(handled=${String(handled)})`, message);
  }

  temporarilyNotAvailable(message: string | undefined): Error {
    return new EditorError('temporarilyNotAvailable', message);
  }

  windowId(): string {
    return 'window-1';
  }

  windowWorkspace(): string | undefined {
    return '/home/user/project';
  }

  reloadWindow(): PromiseLike<unknown> {
    this.actions.push('reload');
    return Promise.resolve(undefined);
  }

  closeRemote(): PromiseLike<unknown> {
    this.actions.push('closeRemote');
    return Promise.resolve(undefined);
  }
}

/** A presenter that answers as told and records the failures it was asked about. */
class FakePresenter implements FailurePresenter {
  outcome: PresenterOutcome = 'handled';
  seen: Failed[] = [];
  gate: Promise<void> = Promise.resolve();

  async present(failed: Failed): Promise<PresenterOutcome> {
    this.seen.push(failed);
    await this.gate;
    return this.outcome;
  }
}

interface Setup {
  editor: FakeEditor;
  connector: FakeConnector;
  presenter: FakePresenter;
  options: ResolverOptions;
  asked: string[];
  registration: Registration;
}

async function setup(
  changes: Partial<ResolverOptions> = {},
  readiness: Partial<Readiness> = {},
): Promise<Setup> {
  const editor = new FakeEditor();
  const connector = new FakeConnector();
  const presenter = new FakePresenter();
  const asked: string[] = [];
  const options: ResolverOptions = {
    family: 'ssh-remote',
    connector,
    presenter,
    cancellable: false,
    allowsTrust: false,
    titleOf: phase => `phase ${phase.name}`,
    startTitle: () => 'starting',
    ...changes,
  };
  const registration = await registerResolver(editor, options, {
    guard: () => {
      asked.push('guard');
      return Promise.resolve('serving');
    },
    resolversGranted: () => {
      asked.push('granted');
      return Promise.resolve(true);
    },
    ...readiness,
  });
  return {editor, connector, presenter, options, asked, registration};
}

function handleOf(registration: Registration): ResolverHandle {
  if (registration.kind !== 'registered') {
    throw new Error('the resolver did not register');
  }
  return registration.resolver;
}

function resolverOf(editor: FakeEditor): EditorResolver {
  const registered = editor.registered[0];
  if (registered === undefined) {
    throw new Error('no resolver registered');
  }
  return registered.resolver;
}

async function resolve(
  context: Setup,
  authority = AUTHORITY,
  attempt = 1,
): ReturnType<EditorResolver['resolve']> {
  return resolverOf(context.editor).resolve(authority, {
    resolveAttempt: attempt,
  });
}

async function failureOf(context: Setup, attempt = 1): Promise<string> {
  try {
    await resolve(context, AUTHORITY, attempt);
    return 'resolved';
  } catch (caught) {
    return caught instanceof EditorError
      ? `${caught.origin}: ${caught.message}`
      : String(caught);
  }
}

describe('the resolver host: registration (contracts section 3.2)', () => {
  it('F-2501: it registers the resolver for the family', async () => {
    const {editor} = await setup();
    deepStrictEqual(
      editor.registered.map(entry => entry.prefix),
      ['ssh-remote'],
    );
  });

  it('F-2501: the answer says the resolver is registered', async () => {
    const {registration} = await setup();
    deepStrictEqual(registration.kind, 'registered');
  });

  it('R-54: when the other extension stands in nothing is registered', async () => {
    const {editor} = await setup(
      {},
      {guard: () => Promise.resolve('standing')},
    );
    deepStrictEqual(editor.registered, []);
  });

  it('R-54: when the other extension stands in the answer says so', async () => {
    const {registration} = await setup(
      {},
      {guard: () => Promise.resolve('standing')},
    );
    deepStrictEqual(registration.kind, 'standing');
  });

  it('R-54: when the other extension stands in the proposal is not even asked about', async () => {
    const {asked} = await setup({}, {guard: () => Promise.resolve('standing')});
    deepStrictEqual(asked, ['granted'].slice(1));
  });

  it('F-1403: without the resolvers proposal nothing is registered', async () => {
    const {editor} = await setup(
      {},
      {resolversGranted: () => Promise.resolve(false)},
    );
    deepStrictEqual(editor.registered, []);
  });

  it('F-1403: without the resolvers proposal the answer says so', async () => {
    const {registration} = await setup(
      {},
      {resolversGranted: () => Promise.resolve(false)},
    );
    deepStrictEqual(registration.kind, 'proposalMissing');
  });

  it('F-1403: the guard is asked before the proposal', async () => {
    const {asked} = await setup();
    deepStrictEqual(asked, ['guard', 'granted']);
  });
});

describe('the resolver host: a connection (F-2501)', () => {
  it('F-2501: the editor gets the address and the connection token', async () => {
    const context = await setup();
    const resolved = await resolve(context);
    deepStrictEqual(
      [resolved.host, resolved.port, resolved.connectionToken],
      ['127.0.0.1', 4321, 'token-value'],
    );
  });

  it('F-2501: the environment of the extension host and the tunnel pieces go to the editor unchanged', async () => {
    const context = await setup();
    const resolved = await resolve(context);
    deepStrictEqual(
      [
        resolved.extensionHostEnv,
        resolved.environmentTunnels,
        resolved.tunnelFeatures,
      ],
      [
        CONNECTED.extensionHostEnv,
        CONNECTED.environmentTunnels,
        CONNECTED.tunnelFeatures,
      ],
    );
  });

  it('F-2001.BR-12: a connection is trusted only when the connector says so and the family allows it', async () => {
    const context = await setup({allowsTrust: true});
    context.connector.answer = {...CONNECTED, trusted: true};
    deepStrictEqual((await resolve(context)).isTrusted, true);
  });

  it('F-2001.BR-12: a family that does not allow trust never passes it on', async () => {
    const context = await setup({allowsTrust: false});
    context.connector.answer = {...CONNECTED, trusted: true};
    deepStrictEqual('isTrusted' in (await resolve(context)), false);
  });

  it('F-2001.BR-12: a connection the connector does not call trusted is not passed on as trusted', async () => {
    const context = await setup({allowsTrust: true});
    deepStrictEqual('isTrusted' in (await resolve(context)), false);
  });

  it('F-8202: the tunnel factory of the connection is the one the editor reads', async () => {
    const context = await setup();
    await resolve(context);
    deepStrictEqual(
      resolverOf(context.editor).tunnelFactory,
      'factory-of-the-connection',
    );
  });

  it('F-8202: before a connection there is no tunnel factory', async () => {
    const context = await setup();
    deepStrictEqual(resolverOf(context.editor).tunnelFactory, undefined);
  });

  it('F-2501: the connector is given the target, the attempt, the window and its workspace', async () => {
    const context = await setup();
    await resolve(context, AUTHORITY, 1);
    deepStrictEqual(context.connector.inputs, [
      {
        target: {kind: 'plain', text: 'my-alias'},
        rawHostString: 'my-alias',
        attempt: 1,
        isReconnection: false,
        windowId: 'window-1',
        windowWorkspace: '/home/user/project',
      },
    ]);
  });

  it('F-2505: the second resolve after a connection is a reconnection', async () => {
    const context = await setup();
    await resolve(context, AUTHORITY, 1);
    await resolve(context, AUTHORITY, 2);
    deepStrictEqual(
      context.connector.inputs.map(input => input.isReconnection),
      [false, true],
    );
  });

  it('F-2501: an authority that does not decode is not available and not handled', async () => {
    const context = await setup();
    deepStrictEqual(
      await failureOf({...context, editor: context.editor}, 1).then(() =>
        resolve(context, 'nope+x').then(
          () => 'resolved',
          (caught: unknown) =>
            caught instanceof EditorError ? caught.origin : String(caught),
        ),
      ),
      'notAvailable(handled=false)',
    );
  });

  it('F-2501: an authority that does not decode never reaches the connector', async () => {
    const context = await setup();
    await resolve(context, 'nope+x').catch(() => undefined);
    deepStrictEqual(context.connector.inputs, []);
  });

  it('F-2501: an authority of another family is not available', async () => {
    const context = await setup();
    await rejects(resolve(context, 'wsl+Ubuntu'), EditorError);
  });
});

describe('the resolver host: progress (F-2304)', () => {
  it("F-2304: the progress starts with the extension's title", async () => {
    const context = await setup();
    await resolve(context);
    deepStrictEqual(
      context.editor.progressRuns.map(entry => entry.title),
      ['starting'],
    );
  });

  it('F-2304: each stage the connector reports becomes the progress title, in order', async () => {
    const context = await setup();
    context.connector.phases = [{name: 'initializing'}, {name: 'installing'}];
    await resolve(context);
    deepStrictEqual(context.editor.progressRuns[0]?.updates, [
      'phase initializing',
      'phase installing',
    ]);
  });

  it('F-2304: the progress offers Cancel only to a family that allows it', async () => {
    const context = await setup({cancellable: true});
    await resolve(context);
    deepStrictEqual(
      context.editor.progressRuns.map(entry => entry.cancellable),
      [true],
    );
  });

  it('F-2304.BR-2: the progress of the ssh family has no Cancel', async () => {
    const context = await setup();
    await resolve(context);
    deepStrictEqual(
      context.editor.progressRuns.map(entry => entry.cancellable),
      [false],
    );
  });

  it("F-2304: the user's Cancel cancels the connector", async () => {
    const context = await setup({cancellable: true});
    await resolve(context);
    context.editor.progressRuns[0]?.onCancel();
    deepStrictEqual(context.connector.cancels, 1);
  });

  it('F-2304: the details link reveals the detail of the connect', async () => {
    const context = await setup();
    await resolve(context);
    context.editor.progressRuns[0]?.onDetails();
    deepStrictEqual(context.connector.reveals, 1);
  });

  it('F-2304.BR-8: the connector is not cancelled by a connect that ends', async () => {
    const context = await setup();
    await resolve(context);
    deepStrictEqual(context.connector.cancels, 0);
  });

  it('F-2304: after the connect no stage is listened for', async () => {
    const context = await setup();
    await resolve(context);
    deepStrictEqual(context.connector.listenerCount(), 2);
  });
});

describe('the resolver host: a failure (contracts section 3.2)', () => {
  it('F-2505: a failure that may pass is temporarily not available, with its text', async () => {
    const context = await setup();
    context.connector.answer = {...FAILURE, retryable: true};
    deepStrictEqual(
      await failureOf(context),
      'temporarilyNotAvailable: Could not reach the host.',
    );
  });

  it('F-2601.BR-9: a failure while reconnecting is plain not available and the presenter is not asked', async () => {
    const context = await setup();
    await resolve(context);
    context.connector.answer = FAILURE;
    deepStrictEqual(
      [await failureOf(context, 2), context.presenter.seen.length],
      ['notAvailable(handled=false): Could not reach the host.', 0],
    );
  });

  it('F-0502: a silent failure is plain not available and the presenter is not asked', async () => {
    const context = await setup();
    context.connector.answer = {...FAILURE, silent: true};
    deepStrictEqual(
      [await failureOf(context), context.presenter.seen.length],
      ['notAvailable(handled=false): Could not reach the host.', 0],
    );
  });

  it('F-2108: a user who was told already gets a handled error and the presenter is not asked', async () => {
    const context = await setup();
    context.connector.answer = {...FAILURE, userAlreadyNotified: true};
    deepStrictEqual(
      [await failureOf(context), context.presenter.seen.length],
      ['notAvailable(handled=true): Could not reach the host.', 0],
    );
  });

  it('F-2601: any other failure goes to the presenter', async () => {
    const context = await setup();
    context.connector.answer = FAILURE;
    await failureOf(context);
    deepStrictEqual(context.presenter.seen, [FAILURE]);
  });

  it('F-2601: a presenter that handled it makes the error handled', async () => {
    const context = await setup();
    context.connector.answer = FAILURE;
    deepStrictEqual(
      await failureOf(context),
      'notAvailable(handled=true): Could not reach the host.',
    );
  });

  it('F-6208.BR-4: the editor is answered only after the presenter has', async () => {
    const context = await setup();
    context.connector.answer = FAILURE;
    const latch = {open: (): void => undefined};
    context.presenter.gate = new Promise<void>(resolveGate => {
      latch.open = resolveGate;
    });
    let answered = false;
    const pending = failureOf(context).then(text => {
      answered = true;
      return text;
    });
    await new Promise(resolveTimer => setTimeout(resolveTimer, 10));
    const before = answered;
    latch.open();
    await pending;
    deepStrictEqual([before, answered], [false, true]);
  });

  it('F-6208.BR-4: a presenter that says reload reloads the window', async () => {
    const context = await setup();
    context.connector.answer = FAILURE;
    context.presenter.outcome = 'reload';
    await failureOf(context);
    deepStrictEqual(context.editor.actions, ['reload']);
  });

  it('F-6208.BR-4: a presenter that says closeRemote leaves the remote', async () => {
    const context = await setup();
    context.connector.answer = FAILURE;
    context.presenter.outcome = 'closeRemote';
    await failureOf(context);
    deepStrictEqual(context.editor.actions, ['closeRemote']);
  });

  it('F-2601: a handled outcome changes nothing about the window', async () => {
    const context = await setup();
    context.connector.answer = FAILURE;
    await failureOf(context);
    deepStrictEqual(context.editor.actions, []);
  });

  it('F-2601: a reason that is a string id has no text for the editor', async () => {
    const context = await setup();
    context.connector.answer = {...FAILURE, reason: {id: 'S030'}};
    deepStrictEqual(await failureOf(context), 'notAvailable(handled=true): ');
  });

  it('F-2601: a connector that throws is a failed resolve and the error goes on', async () => {
    const context = await setup();
    context.connector.failure = new Error('the connector broke');
    await rejects(resolve(context), {message: 'the connector broke'});
  });

  it('F-2601: a connector that throws leaves the connection failed', async () => {
    const context = await setup();
    context.connector.failure = new Error('the connector broke');
    await resolve(context).catch(() => undefined);
    deepStrictEqual(
      handleOf(context.registration).currentConnection()?.state,
      'failed',
    );
  });
});

describe("the resolver host: the window's connection (F-8201.BR-3)", () => {
  it('F-8201.BR-3: before any resolve there is no connection', async () => {
    const {registration} = await setup();
    deepStrictEqual(handleOf(registration).currentConnection(), undefined);
  });

  it('F-8201.BR-3: while the connector works the connection is resolving', async () => {
    const context = await setup();
    let seen: string | undefined;
    context.connector.during = () => {
      seen = handleOf(context.registration).currentConnection()?.state;
    };
    await resolve(context);
    deepStrictEqual(seen, 'resolving');
  });

  it('F-8201.BR-3: after a success it is connected, with the decoded target', async () => {
    const context = await setup();
    await resolve(context);
    deepStrictEqual(
      handleOf(context.registration).currentConnection()?.state,
      'connected',
    );
  });

  it('F-8201.BR-3: the connection names the target the authority decoded to', async () => {
    const context = await setup();
    await resolve(context);
    deepStrictEqual(
      handleOf(context.registration).currentConnection()?.decodedTarget
        .rawHostString,
      'my-alias',
    );
  });

  it('F-8201.BR-3: after a failure it is failed', async () => {
    const context = await setup();
    context.connector.answer = FAILURE;
    await failureOf(context);
    deepStrictEqual(
      handleOf(context.registration).currentConnection()?.state,
      'failed',
    );
  });

  it('F-2505: a lost transport is reported by the connector and followed', async () => {
    const context = await setup();
    await resolve(context);
    context.connector.lose();
    deepStrictEqual(
      handleOf(context.registration).currentConnection()?.state,
      'transportLost',
    );
  });

  it('F-2505: a closed transport is reported by the connector and followed', async () => {
    const context = await setup();
    await resolve(context);
    context.connector.close();
    deepStrictEqual(
      handleOf(context.registration).currentConnection()?.state,
      'transportClosed',
    );
  });

  it('F-3906.rule7: the first resolve to settle is announced once', async () => {
    const context = await setup();
    let calls = 0;
    handleOf(context.registration).onFirstResolveSettled(() => {
      calls += 1;
    });
    await resolve(context, AUTHORITY, 1);
    await resolve(context, AUTHORITY, 2);
    deepStrictEqual(calls, 1);
  });

  it('F-3906.rule7: a failed first resolve counts as settled', async () => {
    const context = await setup();
    context.connector.answer = FAILURE;
    let calls = 0;
    handleOf(context.registration).onFirstResolveSettled(() => {
      calls += 1;
    });
    await failureOf(context);
    deepStrictEqual(calls, 1);
  });

  it('F-3906.rule7: a listener that comes after the first settle is called at once', async () => {
    const context = await setup();
    await resolve(context);
    let calls = 0;
    handleOf(context.registration).onFirstResolveSettled(() => {
      calls += 1;
    });
    deepStrictEqual(calls, 1);
  });
});

describe('the resolver host: teardown (F-2304.BR-8)', () => {
  it('F-2304.BR-8: disposing unregisters the resolver', async () => {
    const context = await setup();
    handleOf(context.registration).dispose();
    deepStrictEqual(context.editor.disposed, 1);
  });

  it('F-2304.BR-8: disposing cancels the connector, once', async () => {
    const context = await setup();
    handleOf(context.registration).dispose();
    deepStrictEqual(context.connector.cancels, 1);
  });

  it('F-2304.BR-8: after disposing the transport events are not followed', async () => {
    const context = await setup();
    await resolve(context);
    handleOf(context.registration).dispose();
    context.connector.lose();
    deepStrictEqual(
      handleOf(context.registration).currentConnection()?.state,
      'connected',
    );
  });
});
