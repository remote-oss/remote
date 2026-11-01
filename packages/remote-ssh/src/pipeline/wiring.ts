/**
 * @fileoverview The steps of each connect, composed from the editor's ports: a fresh state per connect, the client
 * step and the connection step over it, and the server steps made once the connect's host is known. Nothing here
 * imports the editor; the extension passes the real ports and a test passes fakes.
 */

import type {DefaultForwards} from 'lib-forwarding';
import {
  applyDefaults as applyDefaultForwards,
  type TunnelOpener,
} from '../forwarding/default-forwards.ts';
import type {ReadSignal} from '../forwarding/default-forwards-timing.ts';
import type {FailurePresenter} from 'lib-authority';
import {environmentTunnels, type LocalPort} from 'lib-forwarding';
import type {Scheduler} from 'lib-helper';
import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {OverrideValue} from 'lib-product';
import {type LocalDownloadMode, sshPolicyFor} from 'lib-server';
import {
  buildInvocation,
  tunnelStart,
  connectWaitMilliseconds,
  type HostListResult,
} from 'lib-ssh';
import type {
  AcquireConnectionOutcome,
  ConnectionAcquireRequest,
  ConnectionLimits,
  ConnectWaitSettings,
  RunBase,
  SessionRunner,
} from 'lib-ssh';
import {openCliBridge} from '../cli/cli-bridge.ts';
import {
  type ForwardingPlans,
  forwardingEnvironment,
} from '../environment/forwarding.ts';
import type {ServerDownloadProgress} from '../cli/server-download-progress.ts';
import {
  connectionLimitsFor,
  connectWaitsFor,
  effectiveConnectTimeoutSeconds,
  FIRST_SERVE_MILLISECONDS,
  HELPER_REQUEST_MILLISECONDS,
  HOST_ZERO_TIMEOUT_SECONDS,
} from './bounds.ts';
import type {PhaseEvent} from './connect.ts';
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
import {
  type ForwardingDependencies,
  linkAgent,
  planForwarding,
} from './forwarding-step.ts';
import type {PreconnectPorts} from '../preconnect/ports.ts';
import {preconnectStep} from './preconnect-step.ts';
import {
  createServerSteps,
  type ServerStepDependencies,
} from './server-steps.ts';
import type {
  ConnectInput,
  ConnectionTerms,
  ConnectSteps,
  StepFailure,
} from './steps.ts';
import {createTermsSteps, type TermsStepDependencies} from './terms-steps.ts';
import {
  openTerminalConnectionStep,
  type TerminalConnectionDependencies,
} from './terminal-connection-step.ts';
import type {PortChoice} from './port-choice.ts';
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
  /** Where the connect may download the server archive, from `remote.SSH.localServerDownload`. */
  localDownloadMode: () => LocalDownloadMode;
  /** `remote.SSH.enableAgentForwarding`, on unless it is false. */
  agentForwarding: () => boolean;
  /** `remote.SSH.enableX11Forwarding`, on unless it is false. */
  x11Forwarding: () => boolean;
  /** `remote.SSH.defaultForwardedPorts`, as it is when the call is made. */
  defaultForwards: () => DefaultForwards;
}

/** What the channel of one connect is made from: the host as written, the runs' shared part, and the terms. */
export interface ChannelRun {
  hostString: string;
  base: RunBase;
  terms: ConnectionTerms;
  /** The connect wait of this connect, for a login of the channel's own, such as the window's copy. */
  connectWait: ConnectWaitSettings;
  /** The host as the user named it, which that login's questions name. */
  displayHost: string;
}

/** What the CLI path needs besides the server steps. */
interface CliWiring {
  local: LocalPort;
  scheduler: Scheduler;
  /** The bridge's loopback port, chosen as the tunnel's is; nothing when none is free. */
  chooseLocalPort(): Promise<PortChoice>;
  newSecret(): string;
  presenter: FailurePresenter;
  /** The driver of the server download's notification of one bridge's first `serve`. */
  downloadProgress(): ServerDownloadProgress;
}

/** What the steps of every connect are made from. */
export interface WiringPorts {
  /** The hosts of the configuration files in effect, the reading the host pick uses: the connect's first check. */
  configuredHosts(): HostListResult;
  /** The pre-connection step's machine and editor ports. */
  preconnect: PreconnectPorts;
  settings: WiringSettings;
  /** The editor's tunnel service, which the default forwarded ports are opened through. */
  tunnels: TunnelOpener;
  /** Resolves with what ended the wait before the default forwards are read: the window has its remote settings by then. */
  defaultRead(): Promise<ReadSignal>;
  terms: TermsStepDependencies;
  /** The client step's dependencies, apart from this connect's state and what the settings give. */
  locate: Omit<
    LocateStepDependencies,
    'state' | 'configFile' | 'connectTimeout'
  >;
  /** Takes a lease on the host's helper, with the limits of the login wait when it starts. */
  acquire: (
    request: ConnectionAcquireRequest<StepFailure>,
    limits: () => ConnectionLimits,
  ) => Promise<AcquireConnectionOutcome<StepFailure>>;
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
    | 'settings'
    | 'remoteUser'
    | 'override'
    | 'useExecServer'
    | 'policy'
    | 'socketMode'
  >;
  /** The tunnel step's dependencies, apart from the window's environment, which the host's options give. */
  tunnel: Omit<
    TunnelStepDependencies,
    'environment' | 'connectWait' | 'tunnelInvocation' | 'tunnelInput'
  >;
  cliPath: CliWiring;
  /** The window's forwarding, apart from the settings and the log: its draw, its earlier link and its terminals. */
  forwarding: Omit<
    ForwardingDependencies,
    'agentForwarding' | 'x11Forwarding' | 'logger'
  >;
  logger: Logger;
}

/** What a rejection of the loopback says: Node's sockets and servers reject with an `Error`. */
function detailOf(caught: unknown): string {
  return (caught as Error).message;
}

/** Whatever the connect has found so far, required: a missing value means a step ran out of order, a defect. */
function lookedUp(state: ConnectState): NonNullable<ConnectState['effective']> {
  if (state.effective === undefined) {
    throw new Error('the host was used before its configuration was read');
  }
  return state.effective;
}

/**
 * The window's environment: the variables of its forwarding plans, and the host's `LocalForward` entries as tunnels;
 * an entry left out is logged with its position and why.
 */
function windowEnvironment(
  plans: ForwardingPlans | undefined,
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
  if (plans === undefined) {
    throw new Error('the tunnel was asked for before the forwarding plans');
  }
  return {
    extensionHostEnv: forwardingEnvironment(plans),
    environmentTunnels: tunnels,
  };
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
export function stepsOf(
  ports: WiringPorts,
  onPhase: (event: PhaseEvent) => void,
): ConnectSteps {
  const state: ConnectState = {};
  const held: {
    server?: ReturnType<typeof createServerSteps>;
    connection?: ConnectionRequestSettings;
    opening?: {input: ConnectInput; terms: ConnectionTerms};
    forwarding?: ForwardingPlans;
  } = {};
  const forwarding: ForwardingDependencies = {
    ...ports.forwarding,
    agentForwarding: ports.settings.agentForwarding,
    x11Forwarding: ports.settings.x11Forwarding,
    logger: ports.logger,
  };

  /** `question`, preceded by a stage that opens the progress, so that no prompt shows before the progress does. */
  function prompting<Arguments extends unknown[], Result>(
    question: (...argumentList: Arguments) => Result,
  ): (...argumentList: Arguments) => Result {
    return (...argumentList) => {
      onPhase({kind: 'promptShown'});
      return question(...argumentList);
    };
  }

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
      modal: {
        ...ports.server.modal,
        askUser: prompting(ports.server.modal.askUser.bind(ports.server.modal)),
      },
      settings: hostServerSettings(
        ports.settings.server(),
        hostAlias(input.target),
      ),
      override: ports.settings.override(),
      useExecServer: ports.settings.useExecServer(),
      policy: sshPolicyFor(ports.settings.localDownloadMode()),
      remoteUser: () => lookedUp(state).user,
      socketMode: () => tunnelStep.tunnelPath() === 'socket',
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
      connectWait: terminalWaitOf(
        lookedUp(state).connectTimeout,
        connectionSettings().connectTimeout,
      ),
      displayHost: hostAlias(input.target),
    });
  }

  const terms = createTermsSteps({
    ...ports.terms,
    pickPlatform: prompting(ports.terms.pickPlatform),
  });
  const locateClient = locateClientStep({
    ...ports.locate,
    configFile: () => connectionSettings().configFile,
    connectTimeout: () => connectionSettings().connectTimeout,
    state,
  });
  const sharedConnection = openConnectionStep({
    acquire: request =>
      ports.acquire(request, () =>
        connectionLimitsFor(
          state.effective?.connectTimeout,
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
        () => locateClient(input),
      ),
    adoptRunFacts: runFacts => {
      state.programs ??= {
        sshProgram: runFacts.sshProgram,
        scpProgram: runFacts.scpProgram,
      };
      state.effective ??= runFacts.effective;
    },
    waits: () =>
      connectWaitsFor(
        effectiveConnectTimeoutSeconds(
          lookedUp(state).connectTimeout,
          connectionSettings().connectTimeout,
        ),
      ),
    channelFor: channelOf,
    attachLogin: (login, input) =>
      ports.attachLogin(login, hostAlias(input.target)),
    onPhase,
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
        terminalWaitOf(
          lookedUp(state).connectTimeout,
          connectionSettings().connectTimeout,
        ),
      ),
    channelFor: channelOf,
    connectWait: () =>
      terminalWaitOf(
        lookedUp(state).connectTimeout,
        connectionSettings().connectTimeout,
      ),
    logger: ports.logger,
  });
  const tunnelStep = openTunnelStep({
    ...ports.tunnel,
    connectWait: () =>
      terminalWaitOf(
        lookedUp(state).connectTimeout,
        connectionSettings().connectTimeout,
      ),
    tunnelInvocation: forward => {
      if (held.opening === undefined) {
        throw new Error('the tunnel was asked for before the connection');
      }
      return buildInvocation({
        ...runBaseOf(
          held.opening.input,
          held.opening.terms,
          state,
          connectionSettings(),
          ports.requestEnvironment,
        ),
        purpose: 'tunnel',
        forwards: [forward],
      });
    },
    tunnelInput: () =>
      tunnelStart(held.opening?.terms.remoteCommandInEffect ?? false).input,
    environment: () =>
      windowEnvironment(
        held.forwarding,
        lookedUp(state).localForwards,
        ports.logger,
      ),
  });
  return {
    checkConfigFile: () => {
      const listing = ports.configuredHosts();
      if ('parseError' in listing) {
        return {
          kind: 'failed',
          failure: {
            kind: 'configFileUnparsable',
            reason: {
              text: `${listing.parseError.file}: ${listing.parseError.reason}`,
            },
            logDetail: `the SSH configuration file cannot be parsed: ${listing.parseError.file}: ${listing.parseError.reason}`,
          },
        };
      }
      return {kind: 'done', value: undefined};
    },
    checkStartSettings: input => serverSteps(input).checkStartSettings(input),
    validate: input => serverSteps(input).validate(input),
    checkInstallFolder: input => serverSteps(input).checkInstallFolder(input),
    preconnect: preconnectStep({
      setting: ports.settings.preconnect,
      ports: ports.preconnect,
      onRunning: () => {
        onPhase({kind: 'runningPreconnectScript'});
      },
      prompting,
    }),
    decideTerms: terms.decideTerms,
    lookupBeforeConnection: () => ports.locate.mode() === 'terminal',
    locateClient,
    openConnection: (input, connectTerms, cancellation) => {
      held.opening = {input, terms: connectTerms};
      if (ports.locate.mode() === 'shared') {
        return sharedConnection(input, connectTerms, cancellation);
      }
      // A terminal connect always logs in, so its progress opens now.
      onPhase({kind: 'initializing'});
      return terminalConnection(input, connectTerms, cancellation);
    },
    probe: (input, ...rest) => serverSteps(input).probe(input, ...rest),
    planForwarding: async (input, lease, host, cancellation) => {
      held.forwarding = await planForwarding(
        forwarding,
        lease,
        host,
        cancellation,
      );
      return held.forwarding;
    },
    linkAgent: (lease, plan) => {
      linkAgent(forwarding, lease.channel, plan);
    },
    plan: (input, ...rest) => serverSteps(input).plan(input, ...rest),
    gate: (input, ...rest) => serverSteps(input).gate(input, ...rest),
    transfer: (input, ...rest) => serverSteps(input).transfer(input, ...rest),
    start: (input, ...rest) => serverSteps(input).start(input, ...rest),
    installCli: (input, ...rest) =>
      serverSteps(input).installCli(input, ...rest),
    startCli: (input, ...rest) => serverSteps(input).startCli(input, ...rest),
    stopCli: (input, lease, host, plan, processId) =>
      new Promise<void>(resolve => {
        const bound = new AbortController();
        const stopTimer = ports.cliPath.scheduler.setTimer(
          HELPER_REQUEST_MILLISECONDS,
          () => {
            bound.abort();
            ports.logger.warn(
              `the CLI was not stopped within ${String(HELPER_REQUEST_MILLISECONDS)} ms`,
            );
            resolve();
          },
        );
        function settle(): void {
          stopTimer();
          resolve();
        }
        void serverSteps(input)
          .stopCli(input, lease, host, plan, processId, bound.signal)
          .then(settle, settle);
      }),
    connectControl: async port => {
      try {
        return await ports.cliPath.local.connect(port);
      } catch (caught) {
        ports.logger.warn(
          `the CLI's control port refused a connection: ${detailOf(caught)}`,
        );
        return undefined;
      }
    },
    openBridge: async (control, serveParams, events) => {
      const chosen = await ports.cliPath.chooseLocalPort();
      if ('busyRange' in chosen) {
        return {busyRange: chosen.busyRange};
      }
      if ('noPort' in chosen) {
        return undefined;
      }
      const {port} = chosen;
      const progress = ports.cliPath.downloadProgress();
      return openCliBridge(
        control,
        serveParams,
        {
          ...events,
          onFirstServeLog: line => {
            progress.onLine(line);
          },
          onFirstServeEnded: () => {
            progress.end();
          },
        },
        {
          local: ports.cliPath.local,
          port,
          scheduler: ports.cliPath.scheduler,
          firstServeMilliseconds: FIRST_SERVE_MILLISECONDS,
          laterServeMilliseconds: connectWaitMilliseconds(
            terminalWaitOf(
              lookedUp(state).connectTimeout,
              connectionSettings().connectTimeout,
            ),
          ),
        },
      ).catch((caught: unknown) => {
        ports.logger.warn(
          `the bridge could not listen on ${String(port)}: ${detailOf(caught)}`,
        );
        return undefined;
      });
    },
    newSecret: () => ports.cliPath.newSecret(),
    presentLateFailure: failed => {
      void ports.cliPath.presenter.present(failed);
    },
    maintain: (input, ...rest) => serverSteps(input).maintain(input, ...rest),
    installExtensions: (input, ...rest) =>
      serverSteps(input).installExtensions(input, ...rest),
    ...tunnelStep,
    rememberPlatform: terms.rememberPlatform,
    applyDefaults: async () => {
      const signal = await ports.defaultRead();
      ports.logger.info(`the default forwards are read after ${signal}`);
      await applyDefaultForwards(
        ports.settings.defaultForwards(),
        ports.tunnels,
        ports.logger,
      );
    },
  };
}
