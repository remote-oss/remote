/**
 * @fileoverview S9, the window side: a window acquires the shared connection of a host (starting its helper or
 * joining the one that runs), waits for the login, answers the questions `ssh` asks, and releases it. Nothing here
 * logs or keeps an answer.
 */

import {
  acquire,
  type AcquireFailure,
  type ClientEnvironment,
  type EndPolicy,
  type HelperEvent,
  type HelperLease,
  type PlainData,
  recordPath,
  stop,
  type Timer,
} from 'lib-helper';
import type {EffectiveOptions} from '../config/effective.ts';
import type {FailureHint, FailureReason} from '../diagnostics/classify.ts';
import type {FailureKind} from '../diagnostics/rules.ts';
import type {SpawnFailure} from '../process/session.ts';
import type {ConnectionHelperOptions} from './helper.ts';
import {
  type ConnectionEvent,
  type ConnectionReply,
  readConnectionEvent,
  readConnectionReply,
  type Refusal,
  type ScriptFailureReason,
  type SharedRecord,
} from './messages.ts';

/** The registry namespace of the connection helpers. */
export const CONNECTION_NAMESPACE = 'ssh.connection';

/** What the client lookup found: the programs to run and the options `ssh` computes for the host. */
export interface RunFacts {
  sshProgram: string;
  scpProgram: string;
  effective: EffectiveOptions;
}

/** What a window that starts the helper decides once it has the key: the helper's start values, or why it won't. */
export type PreparedConnection<Rejection> =
  | {
      kind: 'ready';
      /** The helper's start values; the client adds the SOCKS port and the record's file. */
      options: Omit<ConnectionHelperOptions, 'socksPort' | 'recordFile'>;
      /** The lookup's results, which every window that joins the helper reads from its welcome. */
      runFacts: RunFacts;
    }
  | {kind: 'refused'; refusal: Rejection};

/** What a window asks of the helper registry: the host's helper, started if none runs. */
export interface ConnectionAcquireRequest<Rejection = never> {
  /** The registry folder of the profile. */
  folder: string;
  /** The helper's key: the target's connection identity (one helper per identity, transport contracts §9), or a maintenance run's own key. */
  hostString: string;
  /** The bundled helper script. */
  script: string;
  /**
   * Called once, only when this window starts the helper: it makes the helper's start values, which includes the
   * client lookup. A window that joins a running helper never calls it.
   */
  prepare: () => Promise<PreparedConnection<Rejection>>;
  /** The end policy of the helper: the grace after its last lease (a policy value, 2 to 4 seconds). */
  policy: EndPolicy;
  cancellation: AbortSignal;
}

/** What the client side needs beyond lib-helper's environment. */
export interface ConnectionClientEnvironment {
  helper: ClientEnvironment;
  /** A free loopback port for the SOCKS forward; it is bound and released, never held. */
  freePort: () => Promise<number>;
}

/** The limits of the waits of one connection, all in milliseconds and all policy values. */
export interface ConnectionLimits {
  /** How long the helper may take to answer one request. */
  requestMilliseconds: number;
  /** How long the whole wait for the login may take. */
  loginMilliseconds: number;
}

/** What a window is told while it holds the connection, or waits for it. */
export type ConnectionNotice =
  | {
      type: 'prompt';
      promptId: number;
      surface: Extract<ConnectionEvent, {type: 'prompt'}>['surface'];
      text: string;
    }
  | {type: 'promptClosed'; promptId: number}
  | {type: 'ownerChanged'; owner: number}
  | {type: 'waitingForOtherWindow'}
  /** The login fell to this window after it had been told to wait: the owner gave up. */
  | {type: 'loginOwned'}
  /** This window's first request started the login: it was accepted without a wait. */
  | {type: 'loginStarted'}
  | {type: 'transportLost'}
  /** Lines of ssh's error stream, in order, for the window's log. */
  | {type: 'sshLines'; lines: string[]}
  | {type: 'helperGone'};

/** Why the connection is not there. */
export type ConnectionFailure =
  | {
      kind: 'loginFailed';
      failure: FailureKind;
      reason?: FailureReason;
      hints: FailureHint[];
      /** `ssh`'s exit status, or `null` when it ended on a signal; absent from a helper of an earlier build. */
      exitStatus?: number | null;
      /** What the helper logged about the failure, for the window's own log. */
      detail?: string;
    }
  | {kind: 'spawnFailed'; cause: SpawnFailure; detail: string}
  | {kind: 'transportLost'}
  | {kind: 'helperGone'}
  | {kind: 'helperRefused'; reason: string}
  | {kind: 'timeout'}
  | {kind: 'cancelled'};

/** The connection a window holds once the login is done. */
export interface ConnectedState {
  socksPort: number;
  /** What the window that started the helper found when it looked the client up. */
  runFacts: RunFacts;
  /** What an earlier window left for reuse, or null when nothing was stored yet. */
  sharedRecord: SharedRecord | null;
}

/** How the wait for the login ended. */
export type ConnectOutcome =
  | ({kind: 'connected'} & ConnectedState)
  | {kind: 'failed'; failure: ConnectionFailure};

/** What one wait for the login needs from the connection that holds it. */
interface LoginSteps {
  limitMilliseconds: number;
  timer: Timer;
  leaseId: number;
  askConnect(): Promise<Asked>;
  /** The state of a connection that is set up: the SOCKS port the helper announced, if it did. */
  setUp(announced: number | undefined): Promise<ConnectOutcome>;
  /** Another window owns the login. */
  waiting(): void;
  /** The login fell to this window after it was told to wait. */
  owned(): void;
  started(): void;
  /** Ends the helper's attempt: the window that owns the login sends it when the wait times out. */
  kill(): void;
}

/**
 * One wait for the login. The helper's answer to the request to connect says whether this window owns the login, and
 * what follows is told by events, so an event that comes before the answer waits for it. The time limit stops while a
 * question is open, because only the user can answer it, and starts over when the last question closes.
 */
class LoginWait {
  private readonly steps: LoginSteps;
  private readonly finish: (outcome: ConnectOutcome) => void;
  private readonly early: ConnectionEvent[] = [];
  private readonly openPrompts = new Set<number>();
  private cancelTimer: (() => void) | undefined;
  private owner = false;
  private waited = false;
  private asking = false;
  private finished = false;

  /** A wait that has not started; `finish` receives how it ended, once. */
  constructor(steps: LoginSteps, finish: (outcome: ConnectOutcome) => void) {
    this.steps = steps;
    this.finish = finish;
  }

  /** Starts the time limit and asks to connect. */
  start(): void {
    this.armTimer();
    void this.request();
  }

  /** The caller cancelled. */
  abort(): void {
    this.end({kind: 'failed', failure: {kind: 'cancelled'}});
  }

  /** An event of the helper, or the loss of the helper itself. */
  hear(event: ConnectionEvent | 'helperGone'): void {
    if (event === 'helperGone') {
      this.end({kind: 'failed', failure: {kind: 'helperGone'}});
    } else if (event.type === 'transportLost') {
      this.end({kind: 'failed', failure: {kind: 'transportLost'}});
    } else if (this.asking) {
      this.early.push(event);
    } else {
      this.handle(event);
    }
  }

  private end(outcome: ConnectOutcome): void {
    if (!this.finished) {
      this.finished = true;
      this.cancelTimer?.();
      this.finish(outcome);
    }
  }

  private armTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = this.steps.timer(this.steps.limitMilliseconds, () => {
      if (this.owner && !this.finished) {
        this.steps.kill();
      }
      this.end({kind: 'failed', failure: {kind: 'timeout'}});
    });
  }

  private async request(): Promise<void> {
    this.asking = true;
    const asked = await this.steps.askConnect();
    this.asking = false;
    if (asked.kind === 'failed') {
      this.end({kind: 'failed', failure: asked.failure});
    } else if (asked.reply.type === 'accepted') {
      this.owner = true;
      if (this.waited) {
        this.steps.owned();
      } else {
        this.steps.started();
      }
    } else if (asked.reply.type === 'refused') {
      await this.refused(asked.reply.reason);
    } else {
      this.end({
        kind: 'failed',
        failure: {kind: 'helperRefused', reason: 'unexpected reply'},
      });
    }
    for (const event of this.early.splice(0)) {
      this.handle(event);
    }
  }

  private async refused(reason: Refusal): Promise<void> {
    if (reason === 'alreadyConnected') {
      this.end(await this.steps.setUp(undefined));
    } else {
      this.waited = true;
      this.steps.waiting();
    }
  }

  private handle(event: ConnectionEvent): void {
    switch (event.type) {
      case 'prompt':
        this.openPrompts.add(event.promptId);
        this.cancelTimer?.();
        break;
      case 'promptClosed':
        this.openPrompts.delete(event.promptId);
        if (this.openPrompts.size === 0) {
          this.armTimer();
        }
        break;
      case 'connected':
        void this.steps.setUp(event.socksPort).then(outcome => {
          this.end(outcome);
        });
        break;
      case 'loginFailed':
        if (this.owner) {
          this.end({
            kind: 'failed',
            failure: {
              kind: 'loginFailed',
              failure: event.kind,
              ...(event.reason === undefined ? {} : {reason: event.reason}),
              hints: event.hints,
              ...(event.exitStatus === undefined
                ? {}
                : {exitStatus: event.exitStatus}),
              ...(event.detail === undefined ? {} : {detail: event.detail}),
            },
          });
        }
        break;
      case 'spawnFailed':
        if (this.owner) {
          this.end({
            kind: 'failed',
            failure: {
              kind: 'spawnFailed',
              cause: event.cause,
              detail: event.detail,
            },
          });
        }
        break;
      case 'ownerChanged':
        if (event.owner === this.steps.leaseId && !this.owner) {
          void this.request();
        }
        break;
      default:
        break;
    }
  }
}

/** A script to run on the shared session. */
export interface SessionRun {
  script: string;
  /** Variables added to the script's environment. */
  environment: Readonly<Record<string, string>>;
  /** What the script reads, as base64; null for none. */
  inputBase64: string | null;
  /** How long the script may take once it has started, in milliseconds. */
  deadlineMilliseconds: number;
}

/** How a script run on the shared session ended. */
export type SessionRunEnd =
  | {kind: 'ended'; status: number}
  | {kind: 'failed'; reason: ScriptFailureReason; detail: string};

/** The helper's answer to one request, or why there is none. */
type Asked =
  | {kind: 'answered'; reply: ConnectionReply}
  | {kind: 'failed'; failure: ConnectionFailure};

/** The shared connection of one host, as one window holds it. */
export class SharedConnection {
  private readonly lease: HelperLease;
  private readonly limits: () => ConnectionLimits;
  private readonly timer: Timer;
  private readonly listeners = new Set<(notice: ConnectionNotice) => void>();
  private readonly openPrompts = new Set<number>();
  private readonly lineListeners = new Map<number, (line: string) => void>();
  private lastRunId = 0;
  private watcher:
    ((event: ConnectionEvent | 'helperGone') => void) | undefined;

  /** A connection over `lease`. */
  constructor(
    lease: HelperLease,
    limits: () => ConnectionLimits,
    timer: Timer,
  ) {
    this.lease = lease;
    this.limits = limits;
    this.timer = timer;
    lease.onEvent(event => {
      this.receive(event);
    });
  }

  /** Calls `listener` with each notice from now on; the returned function stops it. */
  onNotice(listener: (notice: ConnectionNotice) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Waits until the connection is set up. This window asks to connect when it owns the login, waits while another
   * window owns it, and asks again when the login falls to it after the owner gave up. Cancelling ends the wait
   * only; the lease stays until it is released.
   */
  connect(cancellation: AbortSignal): Promise<ConnectOutcome> {
    return new Promise(resolve => {
      function onAbort(): void {
        wait.abort();
      }
      const wait = new LoginWait(
        {
          limitMilliseconds: this.limits().loginMilliseconds,
          timer: this.timer,
          leaseId: this.lease.leaseId,
          askConnect: () => this.askHelper({type: 'connect'}),
          setUp: announced => this.connected(announced),
          waiting: () => {
            this.notify({type: 'waitingForOtherWindow'});
          },
          owned: () => {
            this.notify({type: 'loginOwned'});
          },
          started: () => {
            this.notify({type: 'loginStarted'});
          },
          kill: () => {
            void this.askHelper({type: 'kill'});
          },
        },
        outcome => {
          this.watcher = undefined;
          cancellation.removeEventListener('abort', onAbort);
          resolve(outcome);
        },
      );
      this.watcher = event => {
        wait.hear(event);
      };
      if (cancellation.aborted) {
        wait.abort();
      } else {
        cancellation.addEventListener('abort', onAbort, {once: true});
        wait.start();
      }
    });
  }

  /** Gives the answer to a question that `ssh` asked; true when it was the first answer and went to `ssh`. */
  async answer(promptId: number, text: string): Promise<boolean> {
    const asked = await this.askHelper({type: 'answer', promptId, text});
    return (
      asked.kind === 'answered' &&
      asked.reply.type === 'answered' &&
      asked.reply.accepted
    );
  }

  /**
   * Cancels one of the run's questions: the question closes and the run's questions after it are never shown. True
   * when the question was open and closed; false when it was not, or when the helper is gone.
   */
  async refuse(promptId: number): Promise<boolean> {
    const asked = await this.askHelper({type: 'refuse', promptId});
    if (asked.kind !== 'answered' || asked.reply.type !== 'questionRefused') {
      return false;
    }
    return asked.reply.accepted;
  }

  /** Leaves what a later window needs to reuse the server; true when the helper took it. */
  async storeSharedRecord(record: SharedRecord): Promise<boolean> {
    const asked = await this.askHelper({
      type: 'setSharedRecord',
      record: {...record},
    });
    return asked.kind === 'answered' && asked.reply.type === 'accepted';
  }

  /**
   * Runs a script on the shared `ssh` session, after the runs that came before it. `onLine` receives each line the
   * script writes before the end is known; `waitMilliseconds` bounds the whole wait, the wait for earlier runs
   * included.
   */
  async runOnSession(
    script: SessionRun,
    onLine: (line: string) => void,
    waitMilliseconds: number,
  ): Promise<SessionRunEnd> {
    this.lastRunId += 1;
    const runId = this.lastRunId;
    this.lineListeners.set(runId, onLine);
    const outcome = await this.lease.request(
      {type: 'runScript', runId, ...script},
      waitMilliseconds,
    );
    this.lineListeners.delete(runId);
    if (outcome.kind === 'timeout') {
      return {kind: 'failed', reason: 'timeout', detail: 'no end in time'};
    }
    if (outcome.kind !== 'reply') {
      return {
        kind: 'failed',
        reason: 'channelClosed',
        detail:
          outcome.kind === 'rejected' ? outcome.reason : 'the helper is gone',
      };
    }
    const reply = readConnectionReply(outcome.body);
    if (reply?.type === 'scriptEnded') {
      return {kind: 'ended', status: reply.status};
    }
    return reply?.type === 'scriptFailed'
      ? {kind: 'failed', reason: reply.reason, detail: reply.detail}
      : {kind: 'failed', reason: 'channelClosed', detail: 'unreadable reply'};
  }

  /** Ends this window's lease; the helper ends a short grace after the last one. */
  release(): void {
    this.lease.release();
  }

  /** The state of a connection that is set up: the SOCKS port (given, or the helper's) and the shared record. */
  private async connected(
    announced: number | undefined,
  ): Promise<ConnectOutcome> {
    const socksPort = announced ?? this.lease.payload.socksPort;
    if (typeof socksPort !== 'number') {
      return {
        kind: 'failed',
        failure: {kind: 'helperRefused', reason: 'no SOCKS port'},
      };
    }
    const runFacts = runFactsOf(this.lease.payload.runFacts);
    if (runFacts === undefined) {
      return {
        kind: 'failed',
        failure: {kind: 'helperRefused', reason: 'no run facts'},
      };
    }
    const asked = await this.askHelper({type: 'sharedRecord'});
    if (asked.kind === 'failed') {
      return asked;
    }
    return {
      kind: 'connected',
      socksPort,
      runFacts,
      sharedRecord:
        asked.reply.type === 'sharedRecord' ? asked.reply.record : null,
    };
  }

  private async askHelper(body: PlainData): Promise<Asked> {
    const outcome = await this.lease.request(
      body,
      this.limits().requestMilliseconds,
    );
    switch (outcome.kind) {
      case 'reply': {
        const reply = readConnectionReply(outcome.body);
        return reply === undefined
          ? {
              kind: 'failed',
              failure: {kind: 'helperRefused', reason: 'unreadable reply'},
            }
          : {kind: 'answered', reply};
      }
      case 'rejected':
        return {
          kind: 'failed',
          failure: {kind: 'helperRefused', reason: outcome.reason},
        };
      case 'helperGone':
        return {kind: 'failed', failure: {kind: 'helperGone'}};
      default:
        return {kind: 'failed', failure: {kind: 'timeout'}};
    }
  }

  private receive(event: HelperEvent): void {
    if (event.kind === 'helperGone') {
      this.notify({type: 'helperGone'});
      this.watcher?.('helperGone');
      return;
    }
    if (event.kind !== 'message') {
      return;
    }
    const parsed = readConnectionEvent(event.body);
    if (parsed === undefined) {
      return;
    }
    if (parsed.type === 'scriptLine') {
      this.lineListeners.get(parsed.runId)?.(parsed.line);
      return;
    }
    this.noticeOf(parsed);
    this.watcher?.(parsed);
  }

  /** The notice a window shows for an event; a question already open is not shown twice. */
  private noticeOf(event: ConnectionEvent): void {
    switch (event.type) {
      case 'prompt':
        if (!this.openPrompts.has(event.promptId)) {
          this.openPrompts.add(event.promptId);
          this.notify(event);
        }
        break;
      case 'promptClosed':
        if (this.openPrompts.delete(event.promptId)) {
          this.notify(event);
        }
        break;
      case 'ownerChanged':
      case 'waitingForOtherWindow':
      case 'transportLost':
      case 'sshLines':
        this.notify(event);
        break;
      default:
        break;
    }
  }

  private notify(notice: ConnectionNotice): void {
    for (const listener of this.listeners) {
      listener(notice);
    }
  }
}

/** Why no connection was acquired, or the connection to wait on. */
export type AcquireConnectionOutcome<Rejection = never> =
  | {kind: 'acquired'; connection: SharedConnection}
  | ([Rejection] extends [never]
      ? never
      : {kind: 'refused'; refusal: Rejection})
  | {kind: 'failed'; failure: AcquireFailure};

/** The run facts a helper welcomed with, or undefined when the value is missing or unreadable. */
function runFactsOf(value: unknown): RunFacts | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Partial<RunFacts> | null;
    return typeof parsed?.sshProgram === 'string' &&
      typeof parsed.scpProgram === 'string' &&
      typeof parsed.effective === 'object'
      ? (parsed as RunFacts)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Takes this window's lease on the helper of a host, starting the helper when none runs. The login is not waited
 * for: the window subscribes to the notices it needs, then calls `connect`.
 */
export async function acquireConnection<Rejection = never>(
  environment: ConnectionClientEnvironment,
  request: ConnectionAcquireRequest<Rejection>,
  limits: () => ConnectionLimits,
): Promise<AcquireConnectionOutcome<Rejection>> {
  const outcome = await acquire<Rejection>(environment.helper, {
    folder: request.folder,
    namespace: CONNECTION_NAMESPACE,
    helperKey: request.hostString,
    script: request.script,
    policy: request.policy,
    prepare: async () => {
      const socksPort = await environment.freePort();
      const prepared = await request.prepare();
      if (prepared.kind === 'refused') {
        return prepared;
      }
      return {
        kind: 'ready',
        options: {
          ...prepared.options,
          socksPort,
          recordFile: recordPath(
            request.folder,
            CONNECTION_NAMESPACE,
            request.hostString,
          ),
        },
        payload: {socksPort, runFacts: JSON.stringify(prepared.runFacts)},
      };
    },
    cancellation: request.cancellation,
  });
  return outcome.kind === 'acquired'
    ? {
        kind: 'acquired',
        connection: new SharedConnection(
          outcome.lease,
          limits,
          environment.helper.timer,
        ),
      }
    : outcome;
}

/** Ends the helper of a host and its `ssh`, silently; done also when no helper runs. */
export function killConnection(
  environment: ConnectionClientEnvironment,
  folder: string,
  hostString: string,
): Promise<void> {
  return stop(environment.helper, folder, CONNECTION_NAMESPACE, hostString);
}
