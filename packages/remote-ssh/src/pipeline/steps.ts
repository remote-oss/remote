/**
 * @fileoverview The ports of the connect pipeline: one function for each step it runs, with the results the
 * libraries already give. The pipeline knows the order and what a failure means; the steps know how to do the work
 * over the real client, helper, host and editor.
 */

import type {
  ByteStream,
  CliControl,
  CliInstallOutcome,
  CliServeParams,
  GateOutcome,
  MaintenanceOutcome,
  Plan,
  PlanFailure,
  ProbeOutcome,
  ProbedHost,
  ServerLogLine,
  StartedServer,
  StartOutcome,
  TransferOutcome,
  TransferPhase,
} from 'lib-server';
import type {Connected, Failed} from 'lib-authority';
import type {CliBridge} from '../cli/cli-bridge.ts';
import type {AgentLinkPlan} from '../environment/agent-link.ts';
import type {ForwardingPlans} from '../environment/forwarding.ts';
import type {PortRange, TunnelPath} from 'lib-forwarding';
import type {HostChannel, PlatformHint} from 'lib-host';
import type {ConnectionNotice, FailureHint, SharedRecord} from 'lib-ssh';
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

/** How long the probe and the tunnel may wait, in milliseconds, from the host's connect timeout. */
export interface ConnectWaits {
  probeMilliseconds: number;
  tunnelMilliseconds: number;
}

/** The connection to the host once the login is done: a channel for the server steps, and the end of it. */
export interface ConnectionLease {
  channel: HostChannel;
  /** The loopback port of the connection's SOCKS relay, which the window's tunnel rides. */
  socksPort: number;
  /** What an earlier window of the connection left for reuse; none when nothing was stored. */
  storedRecord: SharedRecord | undefined;
  /** Leaves what a later window needs to reuse the server; true when the connection took it. */
  storeSharedRecord(record: SharedRecord): Promise<boolean>;
  /** Gives the lease back, or ends the direct session; called once, after a failure or when the window ends. */
  release(): void;
  /** Hears the notices of the login; the returned function stops it. */
  onNotice(listener: (notice: ConnectionNotice) => void): () => void;
  /** Gives the answer to one of the login's questions; true when it reached `ssh`. */
  answer(promptId: number, text: string): Promise<boolean>;
  /** Cancels one of the login's questions; true when it was open. */
  refuse(promptId: number): Promise<boolean>;
}

/** What opening the window's tunnel gives: where the window connects, and what it can do over the tunnel. */
type OpenedTunnel = Omit<Connected, 'connectionToken' | 'trusted'>;

/** An open window tunnel and the way to close it. */
export interface TunnelOpening {
  opened: OpenedTunnel;
  /** Closes the tunnel; called once, when the window ends or when the connect is abandoned after the tunnel opened. */
  close(): void;
  /**
   * Calls `listener` once when the tunnel ends without being asked to (its listener failed, or its own session
   * ended), at once if it already has. A `close()` the caller asked for never calls it.
   */
  onClosed(listener: (detail: string) => void): void;
}

/** The steps of one connect, each over the real thing in the extension and over a fake in a test. */
export interface ConnectSteps {
  /** The settings that decide how the server starts, checked before anything runs; a window's connect alone runs it. */
  checkStartSettings(input: ConnectInput): StepResult<undefined>;
  /** The target, checked before anything runs. */
  validate(input: ConnectInput): StepResult<undefined>;
  /** The install folder setting, checked before anything runs. */
  checkInstallFolder(input: ConnectInput): StepResult<undefined>;
  /** The pre-connection script, when one is set; the pipeline calls it on the first attempt only. */
  preconnect(
    input: ConnectInput,
    cancellation: AbortSignal,
  ): Promise<StepResult<undefined>>;
  /** Finds the `ssh` client and reads the host's configuration, which decides how long the later waits may take. */
  locateClient(input: ConnectInput): Promise<StepResult<ConnectWaits>>;
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
  /**
   * The window's agent link and display, from the settings and the probe's facts, or the plans the connection's stored
   * record keeps; they make the window's environment for the rest of the connect.
   */
  planForwarding(
    input: ConnectInput,
    lease: ConnectionLease,
    host: ProbedHost,
    cancellation: AbortSignal,
  ): Promise<ForwardingPlans>;
  /**
   * Makes a `link` plan's link on the host from a hidden terminal, and reads it back over the lease's channel once the
   * terminal ended; returns at once, and only logs a failure.
   */
  linkAgent(lease: ConnectionLease, plan: AgentLinkPlan): void;
  /** The install plan; `direct` plans without the CLI path, as its fallback does. */
  plan(
    input: ConnectInput,
    host: ProbedHost,
    options?: {direct: boolean},
  ):
    | {
        plan: Plan;
        /** The step that resolved the archive's address; none when the plan has no archive to download. */
        step?: 'override' | 'productTemplate' | 'builtInTable' | undefined;
      }
    | {failure: PlanFailure};
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
  /** Places the CLI on the host, from the archive the plan's host gets, unless it is there already. */
  installCli(
    input: ConnectInput,
    lease: ConnectionLease,
    host: ProbedHost,
    plan: Extract<Plan, {kind: 'cli'}>,
    onPhase: (phase: TransferPhase) => void,
    cancellation: AbortSignal,
  ): Promise<CliInstallOutcome>;
  /** Starts the placed CLI, which requires `controlToken` of every caller. */
  startCli(
    input: ConnectInput,
    lease: ConnectionLease,
    host: ProbedHost,
    plan: Extract<Plan, {kind: 'cli'}>,
    controlToken: string,
    cancellation: AbortSignal,
  ): Promise<StartOutcome>;
  /**
   * Ends the CLI `startCli` started, while that process is still the CLI, and only that process: the server it started
   * stays for the host's other connections. It settles within the helper's request bound, whatever the host does.
   */
  stopCli(
    input: ConnectInput,
    lease: ConnectionLease,
    host: ProbedHost,
    plan: Extract<Plan, {kind: 'cli'}>,
    processId: number,
  ): Promise<void>;
  /** Connects to the CLI's control port through a local port the tunnel opened; nothing when it refused. */
  connectControl(localPort: number): Promise<ByteStream | undefined>;
  /**
   * Opens the window's bridge over the authenticated control connection; the configured range when every port of it
   * was busy, and nothing when no other local port could be had.
   */
  openBridge(
    control: CliControl,
    serveParams: CliServeParams,
    events: {
      onServeLog(line: ServerLogLine): void;
      onControlEnded(listener: () => void): void;
    },
  ): Promise<CliBridge | {busyRange: PortRange} | undefined>;
  /** A secret no earlier connect used: a control token, a server's connection token, or a token the CLI must refuse. */
  newSecret(): string;
  /** Shows the failure of a connect that had already given the window its connection. */
  presentLateFailure(failed: Failed): void;
  /** Kills the host's servers or uninstalls them, over the lease's session; the server stays untouched on any failure. */
  maintain(
    input: ConnectInput,
    lease: ConnectionLease,
    action: 'kill' | 'uninstall',
    cancellation: AbortSignal,
  ): Promise<MaintenanceOutcome>;
  /** Installs the default extensions on a server that was already running; a failure never fails the connect. */
  installExtensions(
    input: ConnectInput,
    lease: ConnectionLease,
    cancellation: AbortSignal,
  ): Promise<void>;
  /**
   * The path the window's tunnel takes, read once for the connect. The pipeline bounds the tunnel step itself only
   * on the SOCKS path: a second `ssh` has its own bounds, and a login to wait for.
   */
  tunnelPath(): TunnelPath;
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
  /** Forwards the ports of `remote.SSH.defaultForwardedPorts`, as the setting is when the call is made. */
  applyDefaults(input: ConnectInput): Promise<void>;
}
