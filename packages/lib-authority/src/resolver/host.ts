/**
 * @fileoverview The resolver host: the one place where an extension's connector meets the editor's remote authority
 * resolution. For each resolve the editor asks, it decodes the authority, runs the connector with progress the user
 * sees, hands the editor the connection, or turns a failure into the editor's own errors by the fixed order of the
 * failure mapping. It follows the window's connection, and calls the connector's cancel only when the window is torn
 * down. The editor, the progress and the failure dialogs are behind ports.
 */

import {decodeAuthority} from '../codecs/registry.ts';
import type {DecodedTarget, Family} from '../codecs/types.ts';
import type {Connected, Failed} from '../connector/results.ts';
import {
  type ConnectionState,
  ConnectionTracker,
  type LastResolve,
} from './connection-state.ts';
import {mapFailure} from './failure-mapping.ts';

/** The stages of a connect the user is shown, named by the connector. */
export type PhaseName =
  | 'initializing'
  | 'waitingForOtherWindow'
  | 'downloading'
  | 'downloadingLocally'
  | 'copyingWithScp'
  | 'installing'
  | 'settingUpTunnel'
  | 'waitingForForwarding'
  | 'startingServer'
  | 'serverDownloadPercent';

/** The latest the progress opens after a resolve starts. */
const PROGRESS_FALLBACK_MILLISECONDS = 1500;

/** A stage the connector reports, with the share downloaded for `serverDownloadPercent`. */
export interface ConnectPhase {
  name: PhaseName;
  percent?: number;
  /** Whether the progress shows the "(details)" link in front of this stage's text. */
  details?: boolean;
  /** Sets the text the progress shows without opening it; a stage that is not quiet opens it. */
  quiet?: true;
}

/** What the connector is asked to connect to. */
export interface ConnectInput {
  target: DecodedTarget['target'];
  /** The payload exactly as the authority wrote it. */
  rawHostString: string;
  attempt: number;
  /** Whether this window was connected before, so that the editor is reconnecting rather than connecting. */
  isReconnection: boolean;
  windowId: string;
  /** The window's folder or workspace, if it has one. */
  windowWorkspace: string | undefined;
}

/** What an extension supplies: its own way to connect, and the events it reports on the way. */
export interface Connector {
  connect(input: ConnectInput): Promise<Connected | Failed>;
  /** Ends prompts and processes. The host calls it only when the window is torn down, or on the user's Cancel. */
  cancel(): void;
  /** Shows the detail of the connect, as the log. */
  revealDetails(): void;
  onPhase(listener: (phase: ConnectPhase) => void): () => void;
  onTransportLost(listener: () => void): () => void;
  onTransportClosed(listener: () => void): () => void;
}

/** What the user's failure dialog decided for the window. */
export type PresenterOutcome = 'handled' | 'reload' | 'closeRemote';

/** What an extension supplies to tell the user of a failure. */
export interface FailurePresenter {
  present(failed: Failed): Promise<PresenterOutcome>;
}

/** What the editor takes of a resolved connection. */
export interface ResolvedConnection {
  host: string;
  port: number;
  connectionToken: string;
  extensionHostEnv: Readonly<Record<string, string | null>>;
  environmentTunnels: readonly unknown[];
  isTrusted?: boolean;
}

/** What the editor calls on a registered resolver. */
export interface EditorResolver {
  resolve(
    authority: string,
    context: {resolveAttempt: number},
  ): Promise<ResolvedConnection>;
  /** The local path a URI of this window stands for, for a family that maps one (windows contracts §3.2). */
  canonicalPath?: (
    authority: string,
    path: string,
  ) => Promise<string | undefined>;
}

/** What the progress shows and how the user can act on it. */
export interface ProgressRequest {
  title: string;
  cancellable: boolean;
  onCancel: () => void;
  onDetails: () => void;
}

/** Progress the user sees while a connect runs. */
export interface ProgressPort {
  withProgress<Result>(
    request: ProgressRequest,
    task: (
      update: (title: string, details: boolean) => void,
    ) => Promise<Result>,
  ): Promise<Result>;
}

/** What the host needs of the editor. */
export interface ResolverEditor {
  registerRemoteAuthorityResolver(
    authorityPrefix: string,
    resolver: EditorResolver,
  ): {dispose(): void};
  progress: ProgressPort;
  /** Calls `callback` once after `milliseconds`; the returned function cancels it. */
  startTimer(milliseconds: number, callback: () => void): () => void;
  /** The editor's error for an authority that cannot be resolved; `handled` tells it nothing more is to be shown. */
  notAvailable(message: string | undefined, handled: boolean): Error;
  /** The editor's error for one that may be tried again. */
  temporarilyNotAvailable(message: string | undefined): Error;
  windowId(): string;
  windowWorkspace(): string | undefined;
  reloadWindow(): PromiseLike<unknown>;
  closeRemote(): PromiseLike<unknown>;
}

/** What an extension decides about its resolver. */
export interface ResolverOptions {
  family: Family;
  connector: Connector;
  presenter: FailurePresenter;
  /** Whether the progress offers Cancel. */
  cancellable: boolean;
  /** Whether a connection the connector calls trusted is passed to the editor as trusted. */
  allowsTrust: boolean;
  /** The text of a stage, in the display language and the extension's wording. */
  titleOf(phase: ConnectPhase, target: DecodedTarget): string;
  /** The title the progress starts with. */
  startTitle(target: DecodedTarget): string;
  /**
   * The family's canonical mapping, registered as the resolver's `getCanonicalURI` (windows contracts §3.2): the local
   * path a `vscode-remote` URI of this window stands for, or nothing. `warn` logs a mapping that failed.
   */
  canonical?: {
    pathOf(
      uri: {authority: string; path: string},
      decodedTarget: DecodedTarget,
    ): Promise<string | undefined>;
    warn(message: string): void;
  };
}

/** Whether the extension registers: the other extension stands in, or the proposal is missing. */
export type Registration =
  | {kind: 'registered'; resolver: ResolverHandle}
  | {kind: 'standing'}
  | {kind: 'proposalMissing'};

/** What a registered resolver offers its extension. */
export interface ResolverHandle {
  /** The window's connection, or nothing before the first resolve starts. */
  currentConnection():
    {decodedTarget: DecodedTarget; state: ConnectionState} | undefined;
  /** How the last settled resolve of this window ended, from the tracker. */
  lastResolve(): LastResolve;
  /** Calls `listener` once, when the first resolve of this extension host settles. */
  onFirstResolveSettled(listener: () => void): void;
  /** The window is about to leave its remote: later resolves end at once, handled and silent, until `stay()`. */
  leave(): void;
  /** Puts the resolver back after `leave()`, so the next resolve runs as before. */
  stay(): void;
  /** Stops following the connector, unregisters the resolver and cancels the connect: the window is torn down. */
  dispose(): void;
}

/**
 * The failure a connector that threw becomes, so that a fault of the extension shows as every other failure does: of
 * the kind `unknown`, with the exception's message as its reason, to be told once and not tried again.
 */
function failureOfThrown(caught: unknown): Failed {
  return {
    kind: 'unknown',
    reason: {text: caught instanceof Error ? caught.message : String(caught)},
    retryable: false,
    silent: false,
    userAlreadyNotified: false,
    hints: [],
    diagnostics: [],
  };
}

function isConnected(result: Connected | Failed): result is Connected {
  return 'address' in result;
}

function messageOf(failed: Failed): string | undefined {
  return failed.reason !== undefined && 'text' in failed.reason
    ? failed.reason.text
    : undefined;
}

/** What an extension asks before it registers. */
export interface Readiness {
  /** The stand-down guard: `standing` registers nothing. */
  guard(): Promise<'standing' | 'serving'>;
  /** Whether the editor grants the `resolvers` proposal. */
  resolversGranted(): Promise<boolean>;
}

/** What the host remembers between two resolves of one window. */
interface Memory {
  connectedBefore: boolean;
  settled: boolean;
  listeners: Array<() => void>;
}

function connectionOf(
  connected: Connected,
  allowsTrust: boolean,
): ResolvedConnection {
  return {
    host: connected.address.host,
    port: connected.address.port,
    connectionToken: connected.connectionToken,
    extensionHostEnv: connected.extensionHostEnv,
    environmentTunnels: connected.environmentTunnels,
    ...(connected.trusted && allowsTrust ? {isTrusted: true} : {}),
  };
}

/**
 * Registers the extension's resolver, unless the other extension stands in or the editor does not grant the
 * `resolvers` proposal; in both cases nothing is registered and the caller decides what the user is told. The editor
 * then asks the resolver to resolve, and the answer is the connection or one of the editor's errors, chosen by the
 * failure mapping: temporarily unavailable for a failure that may pass, plain unavailable during a reconnection or
 * for a silent failure, handled when the user has been told already, and otherwise what the extension's presenter
 * decides, awaited before the editor is answered.
 */
export async function registerResolver(
  editor: ResolverEditor,
  options: ResolverOptions,
  readiness: Readiness,
): Promise<Registration> {
  if ((await readiness.guard()) === 'standing') {
    return {kind: 'standing'};
  }
  if (!(await readiness.resolversGranted())) {
    return {kind: 'proposalMissing'};
  }
  const tracker = new ConnectionTracker();
  const memory: Memory = {
    connectedBefore: false,
    settled: false,
    listeners: [],
  };
  const {connector} = options;
  const state = {disposed: false, leaving: false, queue: Promise.resolve()};

  function applyAndAnnounce(
    event: Parameters<ConnectionTracker['apply']>[0],
  ): void {
    const applied = tracker.apply(event);
    if (applied.firstResolveSettled) {
      memory.settled = true;
      const listeners = memory.listeners.splice(0);
      for (const listener of listeners) {
        listener();
      }
    }
  }

  async function errorFor(
    failed: Failed,
    isReconnection: boolean,
  ): Promise<Error> {
    const message = messageOf(failed);
    if (state.disposed) {
      return editor.notAvailable(message, true);
    }
    const outcome = mapFailure({
      kind: failed.kind,
      retryable: failed.retryable,
      isReconnection,
      silent: failed.silent,
      userAlreadyNotified: failed.userAlreadyNotified,
    });
    if (outcome.kind === 'temporarilyNotAvailable') {
      return editor.temporarilyNotAvailable(message);
    }
    if (outcome.kind === 'notAvailable') {
      return editor.notAvailable(message, outcome.handled);
    }
    const decided = await options.presenter.present(failed);
    if (decided === 'reload') {
      await editor.reloadWindow();
    } else if (decided === 'closeRemote') {
      await editor.closeRemote();
    }
    return editor.notAvailable(message, true);
  }

  async function connect(
    decoded: DecodedTarget,
    input: ConnectInput,
  ): Promise<Connected | Failed> {
    let shown: {title: string; details: boolean} | undefined;
    let report: ((title: string, details: boolean) => void) | undefined;
    let opened = false;
    const releases: Array<() => void> = [];
    const settled = new Promise<void>(resolve => {
      releases.push(resolve);
    });
    function open(): void {
      if (opened) {
        return;
      }
      opened = true;
      stopTimer();
      void editor.progress.withProgress(
        {
          title: options.startTitle(decoded),
          cancellable: options.cancellable,
          onCancel: () => {
            connector.cancel();
          },
          onDetails: () => {
            connector.revealDetails();
          },
        },
        async update => {
          report = update;
          if (shown !== undefined) {
            update(shown.title, shown.details);
          }
          await settled;
        },
      );
    }
    const stopTimer = editor.startTimer(PROGRESS_FALLBACK_MILLISECONDS, open);
    const stop = connector.onPhase(phase => {
      shown = {
        title: options.titleOf(phase, decoded),
        details: phase.details === true,
      };
      if (report !== undefined) {
        report(shown.title, shown.details);
      } else if (phase.quiet !== true) {
        open();
      }
    });
    try {
      return await connector.connect(input);
    } finally {
      stop();
      stopTimer();
      for (const release of releases) {
        release();
      }
    }
  }

  async function resolveOne(
    authority: string,
    context: {resolveAttempt: number},
  ): Promise<ResolvedConnection> {
    const decoded = decodeAuthority(authority);
    if ('malformed' in decoded || decoded.family !== options.family) {
      throw editor.notAvailable(undefined, false);
    }
    if (state.leaving) {
      throw editor.notAvailable(undefined, true);
    }
    const isReconnection = memory.connectedBefore;
    applyAndAnnounce({
      kind: 'resolveStarted',
      target: decoded,
      attempt: context.resolveAttempt,
    });
    let result: Connected | Failed;
    try {
      result = await connect(decoded, {
        target: decoded.target,
        rawHostString: decoded.rawHostString,
        attempt: context.resolveAttempt,
        isReconnection,
        windowId: editor.windowId(),
        windowWorkspace: editor.windowWorkspace(),
      });
    } catch (caught) {
      result = failureOfThrown(caught);
    }
    if (isConnected(result)) {
      memory.connectedBefore = true;
      applyAndAnnounce({kind: 'resolveSucceeded'});
      return connectionOf(result, options.allowsTrust);
    }
    applyAndAnnounce({kind: 'resolveFailed'});
    throw await errorFor(result, isReconnection);
  }

  const resolver: EditorResolver = {
    resolve: (authority, context) => {
      const turn = state.queue.then(() => resolveOne(authority, context));
      state.queue = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
  };
  const {canonical} = options;
  if (canonical !== undefined) {
    resolver.canonicalPath = async (authority, path) => {
      const decoded = decodeAuthority(authority);
      if (!('target' in decoded) || decoded.family !== options.family) {
        return undefined;
      }
      try {
        return await canonical.pathOf({authority, path}, decoded);
      } catch (caught) {
        canonical.warn(
          `the canonical URI of ${authority}${path} could not be mapped: ${String(caught)}`,
        );
        return undefined;
      }
    };
  }
  const registration = editor.registerRemoteAuthorityResolver(
    options.family,
    resolver,
  );
  const stops = [
    connector.onTransportLost(() => {
      applyAndAnnounce({kind: 'transportLost'});
    }),
    connector.onTransportClosed(() => {
      applyAndAnnounce({kind: 'transportClosed'});
    }),
  ];
  return {
    kind: 'registered',
    resolver: {
      currentConnection: () => {
        const current = tracker.current();
        return current === undefined
          ? undefined
          : {decodedTarget: current.target, state: current.state};
      },
      lastResolve: () => tracker.lastResolve(),
      onFirstResolveSettled: listener => {
        if (memory.settled) {
          listener();
        } else {
          memory.listeners.push(listener);
        }
      },
      leave: () => {
        state.leaving = true;
      },
      stay: () => {
        state.leaving = false;
      },
      dispose: () => {
        state.disposed = true;
        for (const stop of stops) {
          stop();
        }
        registration.dispose();
        connector.cancel();
      },
    },
  };
}
