/**
 * @fileoverview The ports of the connect pipeline: one function for each step it runs, with the results the
 * libraries already give. The pipeline knows the order and what a failure means; the steps know how to do the work
 * over the real client, helper, host and editor.
 */

import type {
  GateOutcome,
  Plan,
  PlanFailure,
  ProbeOutcome,
  ProbedHost,
  StartedServer,
  StartOutcome,
  TransferOutcome,
  TransferPhase,
} from 'lib-server';
import type {Connected} from 'lib-authority';
import type {HostChannel, PlatformHint} from 'lib-host';
import type {FailureHint, SharedRecord} from 'lib-ssh';
import type {FailureDetail} from './failure.ts';

/** The target of a connect as the authority decoded it: a plain host string, or a host with a user and a port. */
export type ConnectTarget =
  | {kind: 'plain'; text: string}
  | {kind: 'host'; hostName: string; user?: string; port?: number};

/** What the window asks for. */
export interface ConnectInput {
  target: ConnectTarget;
  /** The host string exactly as the authority wrote it. */
  rawHostString: string;
  /** The resolver call of the window: 1 for the first, more for each reconnection. */
  attempt: number;
  isReconnection: boolean;
  windowId: string;
  /** The window's folder or workspace, or none. */
  windowWorkspace: string | undefined;
}

/** A step that did not work: the failure and whatever the step knows to tell around it. */
export interface StepFailure extends FailureDetail {
  hints?: readonly FailureHint[];
  /** Set only by the pre-connection script, whose own dialog has told the user. */
  userAlreadyNotified?: boolean;
  diagnostics?: readonly string[];
}

/** The result of a step: its value, or why it did not work. */
export type StepResult<T> =
  {kind: 'done'; value: T} | {kind: 'failed'; failure: StepFailure};

/** What is decided about a connection before any `ssh` runs: the host's platform and the host's remote command. */
export interface ConnectionTerms {
  /** The platform the scripts are written for; `unknown` while the probe has still to find out. */
  platform: PlatformHint;
  /** Whether the host's own remote command runs for this connection (decided once, when `ssh` is started). */
  remoteCommandInEffect: boolean;
}

/** The connection to the host once the login is done: a channel for the server steps, and the end of it. */
export interface ConnectionLease {
  channel: HostChannel;
  /** The loopback port of the connection's SOCKS relay, which the window's tunnel rides. */
  socksPort: number;
  /** Leaves what a later window needs to reuse the server; true when the connection took it. */
  storeSharedRecord(record: SharedRecord): Promise<boolean>;
  /** Gives the lease back, or ends the direct session; called once, after a failure or when the window ends. */
  release(): void;
}

/** What opening the window's tunnel gives: where the window connects, and what it can do over the tunnel. */
type OpenedTunnel = Omit<Connected, 'connectionToken' | 'trusted'>;

/** An open window tunnel and the way to close it. */
export interface TunnelOpening {
  opened: OpenedTunnel;
  /** Closes the tunnel; called once, when the window ends or when the connect is abandoned after the tunnel opened. */
  close(): void;
}

/** The steps of one connect, each over the real thing in the extension and over a fake in a test. */
export interface ConnectSteps {
  /** The target and the settings that apply to it, checked before anything runs. */
  validate(input: ConnectInput): StepResult<undefined>;
  /** The pre-connection script, when one is set; the pipeline calls it on the first attempt only. */
  preconnect(
    input: ConnectInput,
    cancellation: AbortSignal,
  ): Promise<StepResult<undefined>>;
  /** Finds the `ssh` client. */
  locateClient(input: ConnectInput): Promise<StepResult<undefined>>;
  /**
   * Decides the platform and the remote command from the settings and the host string alone, and asks the user for
   * the platform when the settings do not say. It runs before any `ssh` does, so a question comes first; the wait
   * for the user's answer has no limit of its own.
   */
  decideTerms(
    input: ConnectInput,
    cancellation: AbortSignal,
  ): Promise<StepResult<ConnectionTerms>>;
  /**
   * Takes a lease from the connection server, or opens a direct session when it is off, and waits for the login.
   * The waits that are the machine's are bounded inside the client; the wait for the user's answers has no limit.
   */
  openConnection(
    input: ConnectInput,
    terms: ConnectionTerms,
    cancellation: AbortSignal,
  ): Promise<StepResult<ConnectionLease>>;
  probe(
    input: ConnectInput,
    lease: ConnectionLease,
    cancellation: AbortSignal,
  ): Promise<ProbeOutcome>;
  plan(
    input: ConnectInput,
    host: ProbedHost,
  ): {plan: Plan} | {failure: PlanFailure};
  /** Asks for the licence when the server needs it; the wait for the user's answer has no limit. */
  gate(input: ConnectInput, cancellation: AbortSignal): Promise<GateOutcome>;
  transfer(
    input: ConnectInput,
    lease: ConnectionLease,
    host: ProbedHost,
    plan: Extract<Plan, {kind: 'download'}>,
    onPhase: (phase: TransferPhase) => void,
    cancellation: AbortSignal,
  ): Promise<TransferOutcome>;
  start(
    input: ConnectInput,
    lease: ConnectionLease,
    host: ProbedHost,
    licenceAccepted: boolean,
    cancellation: AbortSignal,
  ): Promise<StartOutcome>;
  /** Installs the default extensions on a server that was already running; a failure never fails the connect. */
  installExtensions(
    input: ConnectInput,
    lease: ConnectionLease,
    cancellation: AbortSignal,
  ): Promise<void>;
  /** Opens the window's port to the server through the connection; `onWaiting` fires if the port is slow to answer. */
  openTunnel(
    input: ConnectInput,
    lease: ConnectionLease,
    server: StartedServer,
    onWaiting: () => void,
    cancellation: AbortSignal,
  ): Promise<StepResult<TunnelOpening>>;
  /** Writes the platform the host reported to the settings after a connect has worked, where the settings ask for it. */
  rememberPlatform(
    input: ConnectInput,
    reported: ProbedHost['operatingSystem'],
  ): Promise<void>;
}
