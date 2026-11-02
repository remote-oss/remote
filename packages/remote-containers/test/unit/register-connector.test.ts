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
import {
  containerSetupFailed,
  containerUnusable,
  type FailedContainer,
} from '../../src/connect/failures.ts';
import {inertRecoveryPorts} from './inert-recovery-ports.ts';
import type {ContainerConnector} from '../../src/connect/connector.ts';
import type {DeclaredPorts} from '../../src/ports/declared-forwards.ts';
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
    /** What the connector says its latest attempt read from the configuration. */
    attemptIdentity?: {name: string | undefined; context: string | undefined};
    /** The container the connector says its last connect found. */
    failedContainer?: FailedContainer;
    canonical?: (
      authority: string,
      path: string,
    ) => Promise<string | undefined>;
    /** The ports the connector says the connection declares. */
    ports?: DeclaredPorts;
    /** The editor's registration of the resolver throws, as it does when the proposal is not enabled. */
    registerThrows?: boolean;
    /** What the profile's global state holds of the names it connected. */
    known?: Record<string, unknown>;
    /** The state's update fails. */
    updateFails?: boolean;
  } = {},
) {
  const warned: string[] = [];
  const memento: Record<string, unknown> = {...options.known};
  const stored: string[] = [];
  const answers = [...(options.answers ?? [])];
  let identity = options.identity;
  const dialogHold: {close: (choice: string | undefined) => void} = {
    close: () => undefined,
  };
  const events: string[] = [];
  const forwarded: Array<DeclaredPorts | undefined> = [];
  const shown: string[][] = [];
  const requests: ProgressRequest[] = [];
  let portsViewCalls = 0;
  const formatters: ResourceLabelFormatter[] = [];
  const disposed: string[] = [];
  const recentAdded: string[] = [];
  const commands = new Map<string, () => unknown>();
  const recording = recordingResolverEditor(events);
  const listeners: Array<(phase: ConnectPhase) => void> = [];
  const connector: ContainerConnector = {
    connect: () => {
      for (const listener of listeners) {
        listener({name: 'installing'});
      }
      // The progress opens after its delay, which a connect that lasts has passed.
      recording.fireTimers();
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
    announceShutdown: () => undefined,
    leaveShutdown: () => Promise.resolve(),
    failedContainer: () => options.failedContainer,
    heldIdentity: () => identity,
    attemptIdentity: () => options.attemptIdentity,
    heldPorts: () => options.ports,
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
  const thrown: string[] = [];
  const result = await registerContainerResolver(
    {
      resolverEditor: {
        ...recording.editor,
        ...(options.registerThrows === true
          ? {
              registerRemoteAuthorityResolver: () => {
                throw new Error('the resolvers proposal is not enabled');
              },
            }
          : {}),
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
      knownNames: {
        get: key => memento[key],
        update: (key, value) => {
          if (options.updateFails === true) {
            return Promise.reject(new Error('the state is read-only'));
          }
          memento[key] = value;
          return Promise.resolve();
        },
      },
      recentLabel: {
        homeFolder: () => '/home/al',
        windowEntry: () => ({
          type: 'folder',
          uri: 'vscode-remote://dev-container%2B7b7d/workspaces/w',
          remoteAuthority: 'dev-container+7b7d',
        }),
        recentEntries: () => Promise.resolve([]),
        addEntry: entry => {
          recentAdded.push(entry.label);
          return Promise.resolve();
        },
      },
      presenter: inertRecoveryPorts({
        storePausedRetry: containerId => {
          stored.push(containerId);
          return Promise.resolve();
        },
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
      forwarder: {
        forward: declared => {
          forwarded.push(declared);
          return Promise.resolve();
        },
      },
      portsView: {
        enablePortsView: () => {
          portsViewCalls += 1;
          return Promise.resolve();
        },
      },
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
  ).catch((caught: unknown) => {
    thrown.push(caught instanceof Error ? caught.message : String(caught));
    return {registration: 'proposalMissing' as const, dispose: () => undefined};
  });
  return {
    thrown,
    result,
    events,
    forwarded,
    shown,
    portsViewCalls: () => portsViewCalls,
    requests,
    formatters,
    disposed,
    commands,
    recording,
    revealed: () => revealed,
    warned,
    memento,
    stored,
    recentAdded,
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
  it('F-1101 AC-1, AC-22: every resolve that settles connected hands the connection’s ports to the forwarder', async () => {
    const ports = {
      forwardPorts: [3000],
      portsAttributes: undefined,
      otherPortsAttributes: undefined,
    };
    const seen = await registered({ports});
    await seen.recording.registered()?.resolve(AUTHORITY, {resolveAttempt: 1});
    await seen.recording.registered()?.resolve(AUTHORITY, {resolveAttempt: 2});
    deepStrictEqual(seen.forwarded, [ports, ports]);
  });

  it('F-1101 AC-1: a resolve that fails forwards nothing', async () => {
    const seen = await registered({
      failure: containerSetupFailed(),
      dialog: 'escape',
    });
    await settledResolve(seen, 1);
    deepStrictEqual(seen.forwarded, []);
  });

  it('F-1102 duty 2: the resolver gives core no tunnel factory, no tunnel features and no candidatePortSource, and the window sets forwardedPortsViewEnabled once connected', async () => {
    const connectedRow = await registered();
    await settledResolve(connectedRow, 1);
    const failedRow = await registered({
      failure: containerSetupFailed(),
      dialog: 'escape',
    });
    await settledResolve(failedRow, 1);
    deepStrictEqual(
      [connectedRow.portsViewCalls(), failedRow.portsViewCalls()],
      [1, 0],
    );
  });

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

  it('F-0101 AC-15: the log command is registered before the resolver, so a registration that throws leaves it there', async () => {
    const seen = await registered({registerThrows: true});
    deepStrictEqual(
      [seen.thrown, [...seen.commands.keys()]],
      [
        ['the resolvers proposal is not enabled'],
        ['remote-containers.revealLogTerminal'],
      ],
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

  it('containers-116: the progress waits half a second: the resolver’s timer is 500 ms', async () => {
    const seen = await registered();
    await seen.recording.registered()?.resolve(AUTHORITY, {resolveAttempt: 1});
    deepStrictEqual(
      seen.events.filter(event => event.startsWith('timer')),
      ['timer 500', 'timer 2000'],
    );
  });

  it('F-0503 AC-2 (our half), containers-55: a stage the connector reports is the message after the title, which core joins with a colon, and the progress is determinate while it shows (increment 0)', async () => {
    const seen = await registered();
    await seen.recording.registered()?.resolve(AUTHORITY, {resolveAttempt: 1});
    deepStrictEqual(
      seen.events.filter(event => event.startsWith('phase')),
      ['phase Installing server +0'],
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

  it('F-0409 BR-9: a folder this profile connected before keeps its name when the connect fails, and one it never connected is bare', async () => {
    const known = {
      'remote-oss.remote-containers.connectedNames': {
        '/w#/w/.devcontainer/devcontainer.json': {
          name: 'Proj',
          context: undefined,
        },
      },
    };
    const knownFolder = await registered({
      failure: containerSetupFailed(),
      dialog: 'escape',
      known,
    });
    await settledResolve(knownFolder, 1, FOLDER_AUTHORITY);
    const otherFolder = await registered({
      failure: containerSetupFailed(),
      dialog: 'escape',
    });
    await settledResolve(otherFolder, 1, FOLDER_AUTHORITY);
    deepStrictEqual(
      [suffixesOf(knownFolder), suffixesOf(otherFolder)],
      [['Dev Container: Proj'], ['Dev Container']],
    );
  });

  it('F-0503 AC-15: the name the failed attempt read names the disconnected label, and a read that gives none falls back to the known name', async () => {
    const known = {
      'remote-oss.remote-containers.connectedNames': {
        '/w#/w/.devcontainer/devcontainer.json': {
          name: 'Proj',
          context: undefined,
        },
      },
    };
    async function settled(options?: Parameters<typeof registered>[0]) {
      const seen = await registered({
        failure: containerSetupFailed(),
        dialog: 'escape',
        ...options,
      });
      await settledResolve(seen, 1, FOLDER_AUTHORITY);
      return seen;
    }
    deepStrictEqual(
      [
        suffixesOf(
          await settled({
            attemptIdentity: {name: 'Old Glibc', context: undefined},
          }),
        ),
        suffixesOf(await settled({known})),
      ],
      [['Dev Container: Old Glibc'], ['Dev Container: Proj']],
    );
  });

  it('F-0409 BR-9: a connect that settles connected records the folder’s identity, and a state that cannot be written is only logged', async () => {
    const recorded = await registered({
      identity: {name: 'Proj', context: undefined},
    });
    await settledResolve(recorded, 1, FOLDER_AUTHORITY);
    const readOnly = await registered({
      identity: {name: 'Proj', context: undefined},
      updateFails: true,
    });
    await settledResolve(readOnly, 1, FOLDER_AUTHORITY);
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(
      [
        recorded.memento['remote-oss.remote-containers.connectedNames'],
        readOnly.warned,
      ],
      [
        {
          '/w#/w/.devcontainer/devcontainer.json': {
            name: 'Proj',
            context: undefined,
          },
        },
        [
          'the name of the connection could not be kept: the state is read-only',
        ],
      ],
    );
  });

  it('F-0409 BR-9: a connection with no identity yet records the unnamed one', async () => {
    const seen = await registered();
    await settledResolve(seen, 1, FOLDER_AUTHORITY);
    deepStrictEqual(
      seen.memento['remote-oss.remote-containers.connectedNames'],
      {
        '/w#/w/.devcontainer/devcontainer.json': {
          name: undefined,
          context: undefined,
        },
      },
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

  it('F-0409 AC-22, ruling 12: Retry stores the paused retry for the container the connector says its last connect found', async () => {
    const seen = await registered({
      failure: containerUnusable('paused'),
      failedContainer: {containerId: 'e'.repeat(64), paused: true},
      dialog: {button: 'Retry'},
    });
    await settledResolve(seen, 1);
    deepStrictEqual(seen.stored, ['e'.repeat(64)]);
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

  it('F-0501 AC-1: the first connected resolve of a folder window stores its Open Recent entry with the tilded host path and the static suffix, once', async () => {
    const seen = await registered({
      identity: {name: 'Proj', context: undefined},
    });
    await settledResolve(seen, 1, FOLDER_AUTHORITY);
    await settledResolve(seen, 2, FOLDER_AUTHORITY);
    deepStrictEqual(seen.recentAdded, ['/w [Dev Container]']);
  });

  it('F-0501 AC-1: an authority that names no folder stores no Open Recent entry', async () => {
    const seen = await registered();
    await settledResolve(seen, 1);
    deepStrictEqual(seen.recentAdded, []);
  });

  it('F-0501 AC-1: a connect that fails stores no Open Recent entry', async () => {
    const seen = await registered({
      failure: containerSetupFailed(),
      dialog: 'escape',
    });
    await settledResolve(seen, 1, FOLDER_AUTHORITY);
    deepStrictEqual(seen.recentAdded, []);
  });
});
