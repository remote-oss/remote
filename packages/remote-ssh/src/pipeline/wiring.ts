/**
 * @fileoverview The steps of each connect, composed from the editor's ports: a fresh state per connect, the client
 * step and the connection step over it, and the server steps made once the connect's host is known. Nothing here
 * imports the editor; the extension passes the real ports and a test passes fakes.
 */

import type {
  AcquireConnectionOutcome,
  ConnectionAcquireRequest,
  ConnectionLimits,
  SharedConnection,
} from 'lib-ssh';
import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import {connectionLimitsFor} from './bounds.ts';
import {
  type ConnectionRequestEnvironment,
  type ConnectionRequestSettings,
  connectionRequestOf,
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
import {openTunnelStep, type TunnelStepDependencies} from './tunnel-step.ts';

/** The settings a connect reads, each when the step that needs it runs. */
interface WiringSettings {
  /** `remote.SSH.preconnect`, as written. */
  preconnect: () => unknown;
  /** The per-host server settings, as written. */
  server: () => RawServerSettings;
  /** The settings the connection's request reads. */
  connection: () => ConnectionRequestSettings;
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
  channelFor: (
    connection: SharedConnection,
    terms: ConnectionTerms,
  ) => HostChannel;
  /** Shows the login's questions for this connect; the alias names the host in them. */
  attachLogin: (login: LoginLease, alias: string) => {dispose(): void};
  /** The server steps' dependencies, apart from what depends on the connect's host. */
  server: Omit<ServerStepDependencies, 'settings' | 'remoteUser'>;
  tunnel: TunnelStepDependencies;
  logger: Logger;
}

/** Whatever the connect has found so far, required: a missing value means a step ran out of order, a defect. */
function lookedUp(state: ConnectState): NonNullable<ConnectState['effective']> {
  if (state.effective === undefined) {
    throw new Error('the host was used before its configuration was read');
  }
  return state.effective;
}

/** The steps of one connect, sharing a state that lives for that connect alone. */
export function stepsOf(ports: WiringPorts): ConnectSteps {
  const state: ConnectState = {};
  const held: {server?: ReturnType<typeof createServerSteps>} = {};

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
      remoteUser: () => lookedUp(state).user,
    });
    return held.server;
  }

  const terms = createTermsSteps(ports.terms);
  return {
    validate: input => serverSteps(input).validate(input),
    preconnect: preconnectStep({
      setting: ports.settings.preconnect,
      logger: ports.logger,
    }),
    decideTerms: terms.decideTerms,
    locateClient: locateClientStep({
      ...ports.locate,
      configFile: () => ports.settings.connection().configFile,
      connectTimeout: () => ports.settings.connection().connectTimeout,
      state,
    }),
    openConnection: openConnectionStep({
      acquire: request =>
        ports.acquire(
          request,
          connectionLimitsFor(
            lookedUp(state).connectTimeout,
            ports.settings.connection().connectTimeout,
          ),
        ),
      requestFor: (input, connectTerms) =>
        connectionRequestOf(
          input,
          connectTerms,
          state,
          ports.settings.connection(),
          ports.requestEnvironment,
        ),
      channelFor: ports.channelFor,
      attachLogin: (login, input) =>
        ports.attachLogin(login, hostAlias(input.target)),
      logger: ports.logger,
    }),
    probe: (input, ...rest) => serverSteps(input).probe(input, ...rest),
    plan: (input, ...rest) => serverSteps(input).plan(input, ...rest),
    gate: (input, ...rest) => serverSteps(input).gate(input, ...rest),
    transfer: (input, ...rest) => serverSteps(input).transfer(input, ...rest),
    start: (input, ...rest) => serverSteps(input).start(input, ...rest),
    installExtensions: (input, ...rest) =>
      serverSteps(input).installExtensions(input, ...rest),
    openTunnel: openTunnelStep(ports.tunnel),
    rememberPlatform: terms.rememberPlatform,
  };
}
