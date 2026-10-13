/**
 * @fileoverview S9, the helper side: the one `ssh` connection of a host, shared by the windows that hold a lease.
 * The oldest live lease owns the login; the others wait. The connection counts as set up at the first setup report
 * of `ssh -v`. A login that fails is classified and handed to the next window; a connection that is lost after it
 * was set up ends the helper. The shared record stays in this process's memory.
 */

import type {
  EndpointConnection,
  HelperControl,
  MessageHandler,
  PlainData,
  RequestContext,
  Scheduler,
} from 'lib-helper';
import {AskpassEndpoint} from '../askpass/endpoint.ts';
import type {Invocation} from '../arguments/invocation.ts';
import {classify} from '../diagnostics/classify.ts';
import {
  ConnectWait,
  type ConnectWaitSettings,
} from '../process/connect-wait.ts';
import {LineSplitter} from '../process/line-splitter.ts';
import type {ProcessSpawner} from '../process/ports.ts';
import {spawnSession, type SshSession} from '../process/session.ts';
import {
  type ConnectionEvent,
  type ConnectionReply,
  type ConnectionRequest,
  readConnectionRequest,
  type SharedRecord,
} from './messages.ts';
import {LoginOwnership} from './ownership.ts';
import {
  type BootstrapEvent,
  bootstrapEventOf,
  bootstrapLogLine,
} from './session-bootstrap.ts';
import {ShellRuns} from './shell-runs.ts';

/** What the handler needs to run the connection. */
export interface ConnectionHandlerOptions {
  /** The `ssh` run that opens the connection, with its SOCKS forward. */
  invocation: Invocation;
  /** The loopback port the invocation forwards, reported to the windows once the connection is set up. */
  socksPort: number;
  spawner: ProcessSpawner;
  /** The environment the askpass adds to the run. */
  askpassEnvironment: Readonly<Record<string, string>>;
  editorEnvironment: Readonly<Record<string, string | undefined>>;
  waitSettings: ConnectWaitSettings;
  /** Written to the session's standard input once, before any run's commands: the session bootstrap. */
  sessionPrelude: string;
  scheduler: Scheduler;
  /** What the askpass endpoint needs: the nonce its program presents, the host's name and its first-message deadline. */
  askpass: {
    nonce: string;
    displayHost: string;
    firstMessageMilliseconds: number;
  };
  /** A marker for the commands of one script run on the session; unguessable and new on every call. */
  newMarker: () => string;
  logLine: (line: string) => void;
}

type ConnectionState = 'idle' | 'connecting' | 'connected';

/** The events and requests of one shared connection. */
export class ConnectionHandler implements MessageHandler {
  private readonly options: ConnectionHandlerOptions;
  private readonly ownership: LoginOwnership;
  private readonly askpass: AskpassEndpoint;
  private control!: HelperControl;
  private wait: ConnectWait | undefined;
  private runs: ShellRuns | undefined;
  private leaseCount = 0;
  private state: ConnectionState = 'idle';
  private session: SshSession | undefined;
  private sharedRecord: SharedRecord | null = null;
  private killed = false;

  /** A handler with no connection yet. */
  constructor(options: ConnectionHandlerOptions) {
    this.options = options;
    this.ownership = new LoginOwnership(owner => {
      this.tell({type: 'ownerChanged', owner});
    });
    this.askpass = new AskpassEndpoint({
      ...options.askpass,
      scheduler: options.scheduler,
      logLine: options.logLine,
      onPrompt: prompt => {
        this.tell({type: 'prompt', ...prompt});
        this.wait?.promptOpened();
      },
      onPromptClosed: promptId => {
        this.tell({type: 'promptClosed', promptId});
        this.wait?.promptAnswered();
      },
    });
  }

  /** Takes a connection of the askpass program; pass it to the askpass endpoint's `listen`. */
  acceptAskpass(connection: EndpointConnection): void {
    this.askpass.accept(connection);
  }

  /** Takes the helper's control, before the endpoint listens. */
  attach(control: HelperControl): void {
    this.control = control;
  }

  /** Passes the live leases to the login ownership. */
  onLeasesChanged(leaseIds: readonly number[]): void {
    this.ownership.leasesChanged(leaseIds);
    if (leaseIds.length > this.leaseCount) {
      // A window that joined has not seen the questions that are open; windows that have seen them ignore the repeat.
      for (const prompt of this.askpass.pending()) {
        this.tell({type: 'prompt', ...prompt});
      }
    }
    this.leaseCount = leaseIds.length;
  }

  /** The helper ends: `ssh` ends with it and the open questions close, whichever way the helper came to its end. */
  close(): void {
    this.killed = true;
    this.runs?.end();
    this.session?.kill();
    this.askpass.closeAll();
  }

  /** The helper has no end action: its policy only waits out a grace. */
  runAction(): Promise<void> {
    return Promise.resolve();
  }

  /** Answers one request of a window. */
  async onRequest(
    body: PlainData,
    context: RequestContext,
  ): Promise<PlainData> {
    const request = readConnectionRequest(body);
    switch (request?.type) {
      case 'connect':
        return this.connect(context.lease);
      case 'sharedRecord':
        return {
          type: 'sharedRecord',
          record: this.sharedRecord && {...this.sharedRecord},
        };
      case 'setSharedRecord':
        if (this.state !== 'connected') {
          throw new Error('the connection is not set up');
        }
        this.sharedRecord = request.record;
        return {type: 'accepted'};
      case 'answer':
        return this.answer(request.promptId, request.text);
      case 'refuse':
        return this.refuse(request.promptId, context.lease);
      case 'runScript':
        return this.runScript(request, context);
      case 'kill':
        this.close();
        this.control.stop();
        return {type: 'accepted'};
      default:
        throw new Error('not a connection request');
    }
  }

  private async runScript(
    request: Extract<ConnectionRequest, {type: 'runScript'}>,
    context: RequestContext,
  ): Promise<PlainData> {
    const {runs} = this;
    if (this.state !== 'connected' || runs === undefined) {
      return {
        type: 'scriptFailed',
        reason: 'notConnected',
        detail: 'the connection is not set up',
      };
    }
    const end = await runs.execute(request, line => {
      context.notify({type: 'scriptLine', runId: request.runId, line});
    });
    return end.kind === 'ended'
      ? {type: 'scriptEnded', status: end.status}
      : {type: 'scriptFailed', reason: end.reason, detail: end.detail};
  }

  private answer(promptId: number, text: string): PlainData {
    const accepted = this.askpass.answer(promptId, text);
    if (accepted) {
      this.tell({type: 'promptClosed', promptId});
      this.wait?.promptAnswered();
    }
    return {type: 'answered', accepted};
  }

  /**
   * The owner's window cancels one of the run's questions: the question closes and the attempt is marked cancelled,
   * so the questions the run asks after it are closed on arrival. A window that is not the owner closes nothing.
   */
  private refuse(promptId: number, lease: number): PlainData {
    if (lease !== this.ownership.current()) {
      return {type: 'questionRefused', accepted: false};
    }
    const accepted = this.askpass.refuse(promptId);
    if (accepted) {
      this.askpass.refuseRun();
    }
    return {type: 'questionRefused', accepted};
  }

  private async connect(
    lease: number,
  ): Promise<Extract<ConnectionReply, {type: 'accepted' | 'refused'}>> {
    if (this.state === 'connected') {
      return {type: 'refused', reason: 'alreadyConnected'};
    }
    if (this.state === 'connecting') {
      return {type: 'refused', reason: 'alreadyConnecting'};
    }
    if (lease !== this.ownership.current()) {
      return {type: 'refused', reason: 'notOwner'};
    }
    this.state = 'connecting';
    const {invocation, askpassEnvironment, editorEnvironment} = this.options;
    const outcome = await spawnSession(
      this.options.spawner,
      invocation,
      askpassEnvironment,
      editorEnvironment,
    );
    if (outcome.kind === 'failed') {
      this.options.logLine(`ssh did not start: ${outcome.failure}`);
      this.state = 'idle';
      this.tell({
        type: 'spawnFailed',
        cause: outcome.failure,
        detail: outcome.detail,
      });
      this.ownership.ownerGaveUp();
    } else if (this.killed) {
      outcome.session.kill();
    } else {
      this.watch(outcome.session);
    }
    return {type: 'accepted'};
  }

  private watch(session: SshSession): void {
    this.session = session;
    const errorLines: string[] = [];
    let timedOut = false;
    const wait = new ConnectWait(
      this.options.waitSettings,
      this.options.scheduler,
      () => {
        timedOut = true;
        session.kill();
      },
    );
    this.wait = wait;
    void session.write(this.options.sessionPrelude);
    const runs = new ShellRuns({
      write: text => {
        void session.write(text);
      },
      scheduler: this.options.scheduler,
      newMarker: this.options.newMarker,
      onWedged: () => {
        session.kill();
      },
    });
    this.runs = runs;
    let ready = false;
    let early: Exclude<BootstrapEvent, {kind: 'ready'}> | undefined;
    const output = new LineSplitter(line => {
      const event = ready ? undefined : bootstrapEventOf(line);
      if (event === undefined) {
        runs.hear(line);
      } else if (event.kind === 'ready') {
        ready = true;
        if (this.state === 'connecting') {
          wait.stop();
          this.askpass.closeAll();
          this.state = 'connected';
          this.ownership.finish();
          this.tell({type: 'connected', socksPort: this.options.socksPort});
        }
      } else {
        early = event;
        this.options.logLine(bootstrapLogLine(event));
      }
    });
    session.onOutput(piece => {
      output.push(piece);
    });
    const lines = new LineSplitter(line => {
      if (this.state === 'connecting') {
        errorLines.push(line);
      }
    });
    session.onError(piece => {
      lines.push(piece);
    });
    wait.start();
    void session.exit().then(status => {
      runs.end();
      wait.stop();
      this.askpass.closeAll();
      lines.flush();
      if (this.killed) {
        return;
      }
      if (this.state === 'connected') {
        this.tell({type: 'transportLost'});
        this.control.stop();
        return;
      }
      this.loginFailed(errorLines, status, timedOut, early);
    });
  }

  private loginFailed(
    errorLines: readonly string[],
    status: number | undefined,
    timedOut: boolean,
    early: Exclude<BootstrapEvent, {kind: 'ready'}> | undefined,
  ): void {
    if (early?.kind === 'exited') {
      // The login shell's own startup ended the session: no reason of ssh's, only the log line already written.
      this.state = 'idle';
      this.tell({type: 'loginFailed', kind: 'unknown', hints: []});
      this.ownership.ownerGaveUp();
      return;
    }
    const classification = classify(errorLines, status, 'connection', 'shared');
    this.state = 'idle';
    this.tell({
      type: 'loginFailed',
      kind:
        (timedOut || early?.kind === 'timeout') &&
        classification.kind === 'unknown'
          ? 'timeout'
          : classification.kind,
      ...(classification.reason === undefined
        ? {}
        : {reason: classification.reason}),
      hints: classification.hints,
    });
    this.ownership.ownerGaveUp();
  }

  private tell(event: ConnectionEvent): void {
    // The events are plain data; the round trip gives them the type of one.
    this.control.broadcast(JSON.parse(JSON.stringify(event)) as PlainData);
  }
}
