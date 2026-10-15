import {deepStrictEqual} from 'node:assert';
import {
  type ConnectPhase,
  type Connected,
  encodeAuthority,
  type Failed,
  type ProgressRequest,
  type ResourceLabelFormatter,
} from 'lib-authority';
import {recordingResolverEditor} from 'lib-authority/testing/recording-resolver-editor';
import type {CommandHost} from 'lib-identifiers';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {devContainerPayloadOf} from '../../src/authority/payload.ts';
import {containerSetupFailed} from '../../src/connect/failures.ts';
import {inertRecoveryPorts} from './inert-recovery-ports.ts';
import type {ContainerConnector} from '../../src/connect/connector.ts';
import {registerContainerResolver} from '../../src/connect/register-connector.ts';

const AUTHORITY = encodeAuthority({
  family: 'dev-container',
  target: {payload: '7b7d'},
  rawHostString: '7b7d',
});

const CONNECTED: Connected = {
  address: {host: '127.0.0.1', port: 4321},
  connectionToken: 'token',
  extensionHostEnv: {},
  environmentTunnels: [],
  trusted: false,
};

/** The registration over fakes. */
async function registered(
  options: {
    resolversGranted?: boolean;
    failure?: Failed;
    /** What each connect answers in turn; the last answer is repeated. */
    answers?: Array<Connected | Failed>;
    /** What the user does with a failure dialog: a button, Escape, or leaves it open until `closeDialog`. */
    dialog?: {button: string} | 'escape' | 'open';
    identity?: {name: string | undefined; context: string | undefined};
    canonical?: (
      authority: string,
      path: string,
    ) => Promise<string | undefined>;
  } = {},
) {
  const warned: string[] = [];
  const answers = [...(options.answers ?? [])];
  let identity = options.identity;
  const dialogHold: {close: (choice: string | undefined) => void} = {
    close: () => undefined,
  };
  const events: string[] = [];
  const shown: string[][] = [];
  const requests: ProgressRequest[] = [];
  const formatters: ResourceLabelFormatter[] = [];
  const disposed: string[] = [];
  const commands = new Map<string, () => unknown>();
  const recording = recordingResolverEditor(events);
  const listeners: Array<(phase: ConnectPhase) => void> = [];
  const connector: ContainerConnector = {
    connect: () => {
      for (const listener of listeners) {
        listener({name: 'installing'});
      }
      return Promise.resolve(
        (answers.length > 1 ? answers.shift() : answers[0]) ??
          options.failure ??
          CONNECTED,
      );
    },
    cancel: () => undefined,
    onHeldChanged: () => () => undefined,
    revealDetails: () => undefined,
    heldConnection: () => undefined,
    heldIdentity: () => identity,
    canonicalPathOf: options.canonical ?? (() => Promise.resolve(undefined)),
    onPhase: listener => {
      listeners.push(listener);
      return () => undefined;
    },
    onTransportLost: () => () => undefined,
    onTransportClosed: () => () => undefined,
  };
  const host: CommandHost = {
    registerCommand: (commandId, callback) => {
      commands.set(commandId, callback);
      return {
        dispose: () => {
          disposed.push(commandId);
        },
      };
    },
    showOutOfContext: () => undefined,
  };
  let revealed = 0;
  const result = await registerContainerResolver(
    {
      resolverEditor: {
        ...recording.editor,
        progress: {
          withProgress: (request, task) => {
            requests.push(request);
            return recording.editor.progress.withProgress(request, task);
          },
        },
      },
      labels: {
        registerResourceLabelFormatter: formatter => {
          formatters.push(formatter);
          return {
            dispose: () => {
              disposed.push('label');
            },
          };
        },
      },
      commands: host,
      presenter: inertRecoveryPorts({
        showError: (message, detail, buttons) => {
          shown.push(buttons.map(button => button.title));
          if (options.dialog === 'open') {
            return new Promise<string | undefined>(resolve => {
              dialogHold.close = resolve;
            });
          }
          return Promise.resolve(
            options.dialog === 'escape'
              ? undefined
              : (options.dialog?.button ?? 'Retry'),
          );
        },
      }),
      translate: template => template,
    },
    connector,
    {
      resolversGranted: options.resolversGranted ?? true,
      revealLog: () => {
        revealed += 1;
      },
      logger: {
        ...createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
        warn: message => {
          warned.push(message);
        },
      },
    },
  );
  return {
    result,
    events,
    shown,
    requests,
    formatters,
    disposed,
    commands,
    recording,
    revealed: () => revealed,
    warned,
    identify: (next: typeof identity) => {
      identity = next;
    },
    closeDialog: (choice: string | undefined) => {
      dialogHold.close(choice);
    },
  };
}

/** The authority of a window whose folder is known, so the dialog offers Edit. */
const FOLDER_PAYLOAD = devContainerPayloadOf({
  kind: 'folder',
  hostPath: '/w',
  localDocker: false,
  configFile: {
    $mid: 1,
    path: '/w/.devcontainer/devcontainer.json',
    scheme: 'file',
  },
});
const FOLDER_AUTHORITY = encodeAuthority({
  family: 'dev-container',
  target: {payload: FOLDER_PAYLOAD},
  rawHostString: FOLDER_PAYLOAD,
});

/** Resolves the window's authority as attempt `attempt` and waits for it to settle, whatever its end. */
async function settledResolve(
  seen: Awaited<ReturnType<typeof registered>>,
  attempt: number,
  authority = AUTHORITY,
): Promise<void> {
  await seen.recording
    .registered()
    ?.resolve(authority, {resolveAttempt: attempt})
    .catch(() => undefined);
}

/** The workspace suffix of each label formatter registered so far. */
function suffixesOf(seen: Awaited<ReturnType<typeof registered>>): string[] {
  return seen.formatters.map(formatter => formatter.formatting.workspaceSuffix);
}

describe('the registration of the container connector (card containers-08)', () => {
  it('contracts §3.2: the resolver of dev-container is registered when the editor grants the proposal', async () => {
    const seen = await registered();
    deepStrictEqual(
      [seen.result.registration, seen.events],
      ['registered', ['register dev-container']],
    );
  });

  it('brief ruling 9: without the resolvers grant the registration reports the missing proposal, and the log command is still there', async () => {
    const seen = await registered({resolversGranted: false});
    deepStrictEqual(
      [seen.result.registration, seen.events, [...seen.commands.keys()]],
      ['proposalMissing', [], ['remote-containers.revealLogTerminal']],
    );
  });

  it('F-0408 BR-12: the progress starts with the S087 link and offers no Cancel', async () => {
    const seen = await registered();
    await seen.recording.registered()?.resolve(AUTHORITY, {resolveAttempt: 1});
    deepStrictEqual(
      seen.requests.map(request => [request.title, request.cancellable]),
      [
        [
          '[Connecting to Dev Container (show log)](command:remote-containers.revealLogTerminal)',
          false,
        ],
      ],
    );
  });

  it('F-0503 AC-2 (our half): a stage the connector reports is the title after the link, and the progress shows the details link', async () => {
    const seen = await registered();
    await seen.recording.registered()?.resolve(AUTHORITY, {resolveAttempt: 1});
    deepStrictEqual(
      seen.events.filter(event => event.startsWith('phase')),
      [
        'phase [Connecting to Dev Container (show log)](command:remote-containers.revealLogTerminal): Installing server',
      ],
    );
  });

  it('F-0504 AC-1: after the first resolve settles connected the label is registered once, with the window’s suffix', async () => {
    const seen = await registered({
      identity: {name: 'Proj', context: undefined},
    });
    await seen.recording.registered()?.resolve(AUTHORITY, {resolveAttempt: 1});
    deepStrictEqual(
      seen.formatters.map(formatter => [
        formatter.authority,
        formatter.formatting.workspaceSuffix,
      ]),
      [['dev-container+7b7d', 'Dev Container: Proj']],
    );
  });

  it('F-0504 AC-3: a connection with no name gets the plain suffix', async () => {
    const seen = await registered();
    await seen.recording.registered()?.resolve(AUTHORITY, {resolveAttempt: 1});
    deepStrictEqual(
      seen.formatters.map(formatter => formatter.formatting.workspaceSuffix),
      ['Dev Container'],
    );
  });

  it('F-0408 BR-6: the log command reveals the log', async () => {
    const seen = await registered();
    seen.commands.get('remote-containers.revealLogTerminal')?.();
    deepStrictEqual(seen.revealed(), 1);
  });

  it('contracts §3.2: disposing removes the label and the command, and a label that comes after is not registered', async () => {
    const seen = await registered({
      identity: {name: 'Proj', context: undefined},
    });
    await seen.recording.registered()?.resolve(AUTHORITY, {resolveAttempt: 1});
    seen.result.dispose();
    deepStrictEqual(seen.disposed, [
      'label',
      'remote-containers.revealLogTerminal',
    ]);
  });

  it('contracts §3.2: disposing before the first resolve registers no label later', async () => {
    const seen = await registered();
    seen.result.dispose();
    await seen.recording
      .registered()
      ?.resolve(AUTHORITY, {resolveAttempt: 1})
      .catch(() => undefined);
    deepStrictEqual(seen.formatters, []);
  });

  it('contracts §3.2: disposing a registration that never registered still removes the log command', async () => {
    const seen = await registered({resolversGranted: false});
    seen.result.dispose();
    deepStrictEqual(seen.disposed, ['remote-containers.revealLogTerminal']);
  });

  it('contracts §3.2: register-connector passes the mapping and the log', async () => {
    const asked: string[] = [];
    const answering = await registered({
      canonical: (authority, path) => {
        asked.push(`${authority}${path}`);
        return Promise.resolve('/home/u/proj');
      },
    });
    const failing = await registered({
      canonical: () => Promise.reject(new Error('boom')),
    });
    deepStrictEqual(
      [
        await answering.recording
          .registered()
          ?.canonicalPath?.(AUTHORITY, '/workspaces/proj'),
        asked,
        await failing.recording
          .registered()
          ?.canonicalPath?.(AUTHORITY, '/workspaces/proj'),
        failing.warned,
      ],
      [
        '/home/u/proj',
        [`${AUTHORITY}/workspaces/proj`],
        undefined,
        [
          `the canonical URI of ${AUTHORITY}/workspaces/proj could not be mapped: Error: boom`,
        ],
      ],
    );
  });

  it('F-0410 AC-1: a failed connect shows the dialog with Edit for the folder of the window’s authority', async () => {
    const seen = await registered({failure: containerSetupFailed()});
    await seen.recording
      .registered()
      ?.resolve(FOLDER_AUTHORITY, {resolveAttempt: 1})
      .catch(() => undefined);
    deepStrictEqual(seen.shown, [
      ['Retry', 'Edit devcontainer.json Locally', 'More Actions...'],
    ]);
  });

  it('F-0410: a failed connect of an authority that names no folder shows the dialog without Edit', async () => {
    const seen = await registered({failure: containerSetupFailed()});
    await seen.recording
      .registered()
      ?.resolve(AUTHORITY, {resolveAttempt: 1})
      .catch(() => undefined);
    deepStrictEqual(seen.shown, [['Retry', 'More Actions...']]);
  });

  it('F-0410 5.0 step 4: a window whose dialog is left by More Actions... registers the unnamed label, so it is titled Dev Container', async () => {
    const seen = await registered({
      failure: containerSetupFailed(),
      dialog: {button: 'More Actions...'},
    });
    await settledResolve(seen, 1);
    deepStrictEqual(
      [
        seen.formatters.map(formatter => formatter.authority),
        suffixesOf(seen),
        seen.disposed,
      ],
      [['dev-container+7b7d'], ['Dev Container'], []],
    );
  });

  it('F-0410 5.0 step 4: Escape on the dialog is More Actions..., and registers the label too', async () => {
    const seen = await registered({
      failure: containerSetupFailed(),
      dialog: 'escape',
    });
    await settledResolve(seen, 1);
    deepStrictEqual(suffixesOf(seen), ['Dev Container']);
  });

  it('F-0410 5.0 steps 2 and 4, AC-1: while the dialog is open there is no label, and it comes when the user leaves the dialog', async () => {
    const seen = await registered({
      failure: containerSetupFailed(),
      dialog: 'open',
    });
    const running = settledResolve(seen, 1);
    await new Promise(resolve => setImmediate(resolve));
    const whileOpen = suffixesOf(seen);
    seen.closeDialog('More Actions...');
    await running;
    deepStrictEqual([whileOpen, suffixesOf(seen)], [[], ['Dev Container']]);
  });

  it('F-0410 5.0 step 4: Retry reloads the window, so no label is registered', async () => {
    const seen = await registered({
      failure: containerSetupFailed(),
      dialog: {button: 'Retry'},
    });
    await settledResolve(seen, 1);
    deepStrictEqual(seen.formatters, []);
  });

  it('F-0410 5.0 step 4: Edit Locally leaves the authority, so no label is registered', async () => {
    const seen = await registered({
      failure: containerSetupFailed(),
      dialog: 'open',
    });
    const running = settledResolve(seen, 1, FOLDER_AUTHORITY);
    await new Promise(resolve => setImmediate(resolve));
    seen.closeDialog('Edit devcontainer.json Locally');
    await running;
    deepStrictEqual(seen.formatters, []);
  });

  it('F-0410 5.0 step 4: a failed settle that shows no dialog registers the label at once', async () => {
    const seen = await registered({
      failure: {...containerSetupFailed(), silent: true},
      dialog: 'open',
    });
    await settledResolve(seen, 1);
    deepStrictEqual(suffixesOf(seen), ['Dev Container']);
  });

  it('F-0410 5.0 step 4: a later failure leaves the label that is there, and a later connect replaces it with the named one', async () => {
    const seen = await registered({
      answers: [containerSetupFailed(), containerSetupFailed(), CONNECTED],
      dialog: {button: 'More Actions...'},
    });
    await settledResolve(seen, 1);
    await settledResolve(seen, 2);
    const afterFailures = seen.formatters.length;
    seen.identify({name: 'Proj', context: undefined});
    await settledResolve(seen, 3);
    deepStrictEqual(
      [afterFailures, suffixesOf(seen), seen.disposed],
      [1, ['Dev Container', 'Dev Container: Proj'], ['label']],
    );
  });

  it('F-0504 AC-1: a connected first resolve registers the named label only', async () => {
    const seen = await registered({
      identity: {name: 'Proj', context: undefined},
    });
    await settledResolve(seen, 1);
    deepStrictEqual(
      [suffixesOf(seen), seen.disposed],
      [['Dev Container: Proj'], []],
    );
  });

  it('F-0410 5.0 step 4: a label that comes after dispose is not registered, for a failure either', async () => {
    const seen = await registered({
      failure: containerSetupFailed(),
      dialog: {button: 'More Actions...'},
    });
    const running = settledResolve(seen, 1);
    seen.result.dispose();
    await running;
    deepStrictEqual(seen.formatters, []);
  });
});
