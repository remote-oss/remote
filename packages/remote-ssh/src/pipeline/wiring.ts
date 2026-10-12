/**
 * @fileoverview The steps of each connect, composed from the editor's ports: a fresh state per connect, the client
 * step and the connection step over it, and the server steps made once the connect's host is known. Nothing here
 * imports the editor; the extension passes the real ports and a test passes fakes.
 */

import {environmentTunnels} from 'lib-forwarding';
import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {OverrideValue} from 'lib-product';
import type {
  AcquireConnectionOutcome,
  ConnectionAcquireRequest,
  ConnectionLimits,
  ConnectWaitSettings,
  RunBase,
  SessionRunner,
} from 'lib-ssh';
import {
  connectionLimitsFor,
  effectiveConnectTimeoutSeconds,
  HOST_ZERO_TIMEOUT_SECONDS,
} from './bounds.ts';
import {
  type ConnectionRequestEnvironment,
  type ConnectionRequestSettings,
  connectionRequestOf,
  runBaseOf,
  installRequestOf,
} from './connection-request.ts';
import {type LoginLease, openConnectionStep} from './connection-step.ts';
import {
  hostAlias,
  hostServerSettings,
  type RawServerSettings,
} from './host-settings.ts';
import {
  type ConnectState,
  type LocateStepDependencies,
  locateClientStep,
} from './locate-step.ts';
import {preconnectStep} from './preconnect-step.ts';
import {
  createServerSteps,
  type ServerStepDependencies,
} from './server-steps.ts';
import type {ConnectInput, ConnectionTerms, ConnectSteps} from './steps.ts';
import {createTermsSteps, type TermsStepDependencies} from './terms-steps.ts';
import {
  openTerminalConnectionStep,
  type TerminalConnectionDependencies,
} from './terminal-connection-step.ts';
import {openTunnelStep, type TunnelStepDependencies} from './tunnel-step.ts';

/** The settings a connect reads, each when the step that needs it runs. */
interface WiringSettings {
  /** `remote.SSH.preconnect`, as written. */
  preconnect: () => unknown;
  /** The per-host server settings, as written. */
  server: () => RawServerSettings;
  /** The settings the connection's request reads. */
  connection: () => ConnectionRequestSettings;
  /** The user's server download override and the layer it came from, when one is set. */
  override: () => OverrideValue | undefined;
  /** `remote.SSH.useExecServer`. */
  useExecServer: () => boolean;
}

/** What the channel of one connect is made from: the host as written, the runs' shared part, and the terms. */
export interface ChannelRun {
  hostString: string;
  base: RunBase;
  terms: ConnectionTerms;
}

/** What the steps of every connect are made from. */
export interface WiringPorts {
  settings: WiringSettings;
  terms: TermsStepDependencies;
  /** The client step's dependencies, apart from this connect's state and what the settings give. */
  locate: Omit<
    LocateStepDependencies,
    'state' | 'configFile' | 'connectTimeout'
  >;
  /** Takes a lease on the host's helper with the client's waits for this connect. */
  acquire: (
    request: ConnectionAcquireRequest,
    limits: ConnectionLimits,
  ) => Promise<AcquireConnectionOutcome>;
  requestEnvironment: ConnectionRequestEnvironment;
  /** The channel of the server steps over a connection's session, in either mode. */
  channelFor: (session: SessionRunner, channelRun: ChannelRun) => HostChannel;
  /** Shows the login's questions for this connect; the alias names the host in them. */
  attachLogin: (login: LoginLease, alias: string) => {dispose(): void};
  /** The terminal connection step's ports, apart from what the connect's own state and settings give. */
  terminal: Omit<
    TerminalConnectionDependencies,
    'installRequest' | 'connectWait' | 'channelFor' | 'logger'
  >;
  /** The server steps' dependencies, apart from what depends on the connect's host. */
  server: Omit<
    ServerStepDependencies,
    'settings' | 'remoteUser' | 'override' | 'useExecServer'
  >;
  /** The tunnel step's dependencies, apart from the window's environment, which the host's options give. */
  tunnel: Omit<TunnelStepDependencies, 'environment'>;
  logger: Logger;
}

/** Whatever the connect has found so far, required: a missing value means a step ran out of order, a defect. */
function lookedUp(state: ConnectState): NonNullable<ConnectState['effective']> {
  if (state.effective === undefined) {
    throw new Error('the host was used before its configuration was read');
  }
  return state.effective;
}

/**
 * The window's environment: no variables of its own, and the host's `LocalForward` entries as tunnels; an entry
 * left out is logged with its position and why.
 */
function windowEnvironment(
  localForwards: readonly string[],
  logger: Logger,
): {
  extensionHostEnv: Readonly<Record<string, string | null>>;
  environmentTunnels: readonly unknown[];
} {
  const {tunnels, skipped} = environmentTunnels(localForwards);
  for (const entry of skipped) {
    logger.info(
      `LocalForward entry ${String(entry.index)} is not shown as a tunnel: ${entry.reason}`,
    );
  }
  return {extensionHostEnv: {}, environmentTunnels: tunnels};
}

/**
 * The wait of a terminal-mode login, as the shared helper's: a host's own 0 waits the ceiling with no margin;
 * otherwise the host's timeout, else the setting's, else the default.
 */
export function terminalWaitOf(
  hostValue: string | undefined,
  settingValue: unknown,
): ConnectWaitSettings {
  return {
    connectTimeoutSeconds:
      hostValue === '0'
        ? 0
        : effectiveConnectTimeoutSeconds(hostValue, settingValue),
    fromHost: hostValue !== undefined,
    unboundedWaitSeconds: HOST_ZERO_TIMEOUT_SECONDS,
  };
}

/** The steps of one connect, sharing a state that lives for that connect alone. */
export function stepsOf(ports: WiringPorts): ConnectSteps {
  const state: ConnectState = {};
  const held: {
    server?: ReturnType<typeof createServerSteps>;
    connection?: ConnectionRequestSettings;
  } = {};

  /** The connection's settings, read once for this connect, so all of its runs use the same. */
  function connectionSettings(): ConnectionRequestSettings {
    held.connection ??= ports.settings.connection();
    return held.connection;
  }

  /** The server steps for this connect's host, made the first time a step needs them. */
  function serverSteps(
    input: ConnectInput,
  ): ReturnType<typeof createServerSteps> {
    held.server ??= createServerSteps({
      ...ports.server,
      settings: hostServerSettings(
        ports.settings.server(),
        hostAlias(input.target),
      ),
      override: ports.settings.override(),
      useExecServer: ports.settings.useExecServer(),
      remoteUser: () => lookedUp(state).user,
    });
    return held.server;
  }

  /** The channel over `session` for this connect's input and terms, with the runs' shared part. */
  function channelOf(
    session: SessionRunner,
    connectTerms: ConnectionTerms,
    input: ConnectInput,
  ): HostChannel {
    return ports.channelFor(session, {
      hostString: input.rawHostString,
      base: runBaseOf(
        input,
        connectTerms,
        state,
        connectionSettings(),
        ports.requestEnvironment,
      ),
      terms: connectTerms,
    });
  }

  const terms = createTermsSteps(ports.terms);
  const sharedConnection = openConnectionStep({
    acquire: request =>
      ports.acquire(
        request,
        connectionLimitsFor(
          lookedUp(state).connectTimeout,
          connectionSettings().connectTimeout,
        ),
      ),
    requestFor: (input, connectTerms) =>
      connectionRequestOf(
        input,
        connectTerms,
        state,
        connectionSettings(),
        ports.requestEnvironment,
      ),
    channelFor: channelOf,
    attachLogin: (login, input) =>
      ports.attachLogin(login, hostAlias(input.target)),
    logger: ports.logger,
  });
  const terminalConnection = openTerminalConnectionStep({
    ...ports.terminal,
    installRequest: (input, connectTerms, socksPort) =>
      installRequestOf(
        input,
        connectTerms,
        state,
        connectionSettings(),
        ports.requestEnvironment,
        socksPort,
      ),
    channelFor: channelOf,
    connectWait: () =>
      terminalWaitOf(
        lookedUp(state).connectTimeout,
        connectionSettings().connectTimeout,
      ),
    logger: ports.logger,
  });
  return {
    validate: input => serverSteps(input).validate(input),
    preconnect: preconnectStep({
      setting: ports.settings.preconnect,
      logger: ports.logger,
    }),
    decideTerms: terms.decideTerms,
    locateClient: locateClientStep({
      ...ports.locate,
      configFile: () => connectionSettings().configFile,
      connectTimeout: () => connectionSettings().connectTimeout,
      state,
    }),
    openConnection: (input, connectTerms, cancellation) =>
      (ports.locate.mode() === 'shared'
        ? sharedConnection
        : terminalConnection)(input, connectTerms, cancellation),
    probe: (input, ...rest) => serverSteps(input).probe(input, ...rest),
    plan: (input, ...rest) => serverSteps(input).plan(input, ...rest),
    gate: (input, ...rest) => serverSteps(input).gate(input, ...rest),
    transfer: (input, ...rest) => serverSteps(input).transfer(input, ...rest),
    start: (input, ...rest) => serverSteps(input).start(input, ...rest),
    installExtensions: (input, ...rest) =>
      serverSteps(input).installExtensions(input, ...rest),
    openTunnel: openTunnelStep({
      ...ports.tunnel,
      environment: () =>
        windowEnvironment(lookedUp(state).localForwards, ports.logger),
    }),
    rememberPlatform: terms.rememberPlatform,
  };
}
