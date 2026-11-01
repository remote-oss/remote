/**
 * @fileoverview The connect of Remote - SSH assembled from the editor's surfaces and the machine it runs on: the ports
 * of each connect's steps, the connector over them, and the resolver's options. Nothing here imports the editor or
 * Node; the extension passes the real surfaces and the machine, and a test passes fakes.
 */

import type {TunnelOpener} from './forwarding/default-forwards.ts';
import {
  type DefaultReadEvents,
  waitForDefaultRead,
} from './forwarding/default-forwards-timing.ts';
import type {
  DecodedTarget,
  FailurePresenter,
  ResolverOptions,
} from 'lib-authority';
import {
  findFreePort,
  selectTunnelPath,
  type LocalPort,
  parseRange,
  type PortProber,
  socksDialer,
  SOCKS_HANDSHAKE_MILLISECONDS,
  TUNNEL_WAIT_LIMITS,
} from 'lib-forwarding';
import type {Scheduler} from 'lib-helper';
import type {SettingHost} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import {
  OVERRIDE_POLICIES,
  type OverridePolicy,
  type ProductProfile,
} from 'lib-product';
import {
  type ClientFilePort,
  type Clock,
  CLIENT_DOWNLOAD_BOUNDS,
  DISCARD_DEADLINE_MILLISECONDS,
  type CredentialsPort,
  type DownloadPort,
  hostLockLoopOf,
  type LicenceModal,
  type AcceptanceStore,
} from 'lib-server';
import {
  acquireConnection,
  buildInvocation,
  type ClientEnvironment,
  type ClientPlatform,
  type ConnectionClientEnvironment,
  type HostListResult,
  killConnection,
  type LocalFiles,
  type LoginTerminals,
  type ProcessSpawner,
  SharedSessionChannel,
  SshHostChannel,
  type SshTarget,
  terminalCopierOf,
  type TerminalLogin,
} from 'lib-ssh';
import {
  type DownloadProgressPort,
  serverDownloadProgress,
} from './cli/server-download-progress.ts';
import {announcePlatform} from './connect/platform-notice.ts';
import type {RemotePlatform} from './pipeline/platform.ts';
import type {AcceptanceState} from './surfaces/acceptance-store.ts';
import type {NoticePort} from './surfaces/notice.ts';
import {
  CLIENT_CHECK_MILLISECONDS,
  HOST_LOCK_ATTEMPTS,
  HOST_LOCK_INTERVAL_MILLISECONDS,
  PRECONNECT_MILLISECONDS,
  SERVER_BOUNDS,
  SESSION_RUN_LIMITS,
} from './pipeline/bounds.ts';
import {
  agentForwardingOf,
  defaultForwardsOf,
  connectionSettingsOf,
  localDownloadModeOf,
  overrideOf,
  serverSettingsOf,
  switchOf,
  terminalModeOf,
  termsSettingsOf,
  textOf,
  tunnelSettingsOf,
  valueOf,
  x11ForwardingOf,
} from './pipeline/connect-settings.ts';
import type {ConnectionRequestEnvironment} from './pipeline/connection-request.ts';
import type {LinkTerminals} from './pipeline/forwarding-step.ts';
import {connectorOf, type SshConnector} from './pipeline/connector.ts';
import {loggedChannel} from './pipeline/remote-log.ts';
import type {PortChoice} from './pipeline/port-choice.ts';
import {hostAlias} from './pipeline/host-settings.ts';
import {
  type MaintenanceRun,
  maintenanceConnectionKey,
  maintenanceInputOf,
  runMaintenance,
} from './maintenance/maintenance-run.ts';
import type {ConnectInput, StepFailure} from './pipeline/steps.ts';
import {stepsOf, type WiringPorts} from './pipeline/wiring.ts';
import type {PreconnectApprovals} from './preconnect/approvals.ts';
import type {PreconnectPorts} from './preconnect/ports.ts';
import type {PreconnectDialog} from './surfaces/preconnect-dialog.ts';
import {phaseTitleOf, startTitleOf} from './surfaces/progress-titles.ts';
import {type FailureStringId, textOfId} from './surfaces/failure-strings.ts';
import {
  attachPromptSurface,
  type PromptEditor,
} from './surfaces/prompt-surface.ts';
import type {Translate} from './surfaces/strings.ts';
import {attachTerminalQuestions} from './surfaces/terminal-questions.ts';

/** The editor's surfaces a connect shows, each over the editor. */
export interface ConnectSurfaces {
  settings: SettingHost;
  /** The hosts of the configuration files in effect, read at each call: the connect's first check. */
  configuredHosts(): HostListResult;
  translate: Translate;
  prompts: PromptEditor;
  /** The editor's login terminals, where terminal mode runs `ssh`. */
  terminals: LoginTerminals;
  /** Asks the user for the host's platform; nothing when the pick closed without one. */
  pickPlatform: (
    alias: string,
    cancellation: AbortSignal,
  ) => Promise<RemotePlatform | undefined>;
  /** Sets the exact key for the alias in `remote.SSH.remotePlatform`, in the user's settings. */
  writePlatform: (alias: string, platform: RemotePlatform) => Promise<void>;
  /** The non-modal notices, and the profile's record of the answers to them. */
  notice: NoticePort;
  noticeState: AcceptanceState;
  licenceModal: LicenceModal;
  acceptances: AcceptanceStore;
  /** The question before a pre-connection script runs, and the record of the scripts the user trusts. */
  preconnectDialog: PreconnectDialog;
  preconnectApprovals: PreconnectApprovals;
  presenter: FailurePresenter;
  /** The editor's notifications with a percentage, which the server download shows after the window resolved. */
  downloadProgress: DownloadProgressPort;
  /** Reveals the connection's log. */
  revealLog: () => void;
  /** Tells the user that the host's bind host entry is not valid; does not wait for the user. */
  rejectBindHost: (alias: string, configured: string) => void;
  /** The editor's terminals that make the agent link after the editor's own checks. */
  linkTerminals: LinkTerminals;
  /** Makes these the only variables the window's terminals get from the extension. */
  applyTerminalEnvironment: (
    variables: Readonly<Record<string, string>>,
  ) => void;
  /** The editor's tunnel service, which the default forwarded ports are opened through. */
  tunnels: TunnelOpener;
  /** The editor's events that tell the default forwards' read that the window has its remote settings. */
  defaultReadEvents: DefaultReadEvents;
}

/** Where the extension runs and what it may use there. */
export interface ConnectMachine {
  profile: ProductProfile;
  platform: ClientPlatform;
  homeFolder: string;
  /** The editor process's working directory, which a relative script path resolves against. */
  workingDirectory: string;
  /** The reads of a pre-connection script's file. */
  preconnectFiles: Pick<PreconnectPorts, 'readFile' | 'exists'>;
  /** The editor's environment, given to each process as it is. */
  processEnvironment: Readonly<Record<string, string | undefined>>;
  /** The program search path and Program Files folder the client search reads. */
  clientSearch: ClientEnvironment;
  spawner: ProcessSpawner;
  /** The window's client of the helpers, with the extension's waits. */
  helpers: ConnectionClientEnvironment['helper'];
  /** A free loopback port for a helper's SOCKS forward; bound and released. */
  freeSocksPort: () => Promise<number>;
  /** The extension's bundled helper script and askpass program, and the runtime that runs them. */
  bundles: {helperScript: string; askpassProgram: string; runtime: string};
  /** The profile's folder in the extension's global storage, and the user's runtime folder. */
  folders: {registry: string; runtime: string; clientTemporary: string};
  files: LocalFiles;
  clientFiles: ClientFilePort;
  download: DownloadPort;
  credentials: CredentialsPort;
  scheduler: Scheduler;
  clock: Clock;
  local: LocalPort;
  prober: PortProber;
  /** A new token, different in every window and in every call. */
  newTemporaryToken: () => string;
  /** A cryptographic random integer in 1..999999999, which names an agent link. */
  drawLinkNumber: () => number;
}

/** The parts of a connect that show the connecting window. */
export interface ConnectAssembly {
  connector: SshConnector;
  options: ResolverOptions;
  /** Ends the local connection server of a host string; silent, also when none runs. */
  killLocalServer(hostString: string): Promise<void>;
  /** Runs the kill or the uninstall on a host in a connection of its own, outside any window. */
  maintain(
    action: 'kill' | 'uninstall',
    target: SshTarget,
  ): Promise<MaintenanceRun>;
}

/** The editor environment of the processes of a connect, without the entries the editor leaves unset. */
function definedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** The window's local port: the first free one in the preferred range, else any free one; or why there is none. */
async function chooseLocalPort(
  prober: PortProber,
  settingValue: unknown,
  logger: Logger,
): Promise<PortChoice> {
  const parsed = parseRange(settingValue);
  if ('none' in parsed && parsed.reason !== 'empty') {
    logger.info(
      `remote.SSH.preferredLocalPortRange is ignored: ${parsed.reason}`,
    );
  }
  const range = 'range' in parsed ? parsed.range : undefined;
  const found = await findFreePort(prober, range);
  if ('port' in found) {
    return {port: found.port};
  }
  return range === undefined ? {noPort: true} : {busyRange: range};
}

/** The download override's policy of Remote - SSH in `policies`; a table without one is a defect. */
export function sshOverridePolicy(
  policies: typeof OVERRIDE_POLICIES = OVERRIDE_POLICIES,
): OverridePolicy {
  const policy = policies['remote-ssh'];
  if (policy === undefined) {
    throw new Error('lib-product names no override policy for remote-ssh');
  }
  return policy;
}

/** The ports of every connect's steps. */
export function wiringPortsOf(
  surfaces: ConnectSurfaces,
  machine: ConnectMachine,
  logger: Logger,
): WiringPorts {
  const {settings} = surfaces;
  /** What every login terminal shares: its questions, and whether it is shown. */
  const loginSurfaces = {
    attachQuestions: (login: TerminalLogin, input: ConnectInput) =>
      attachTerminalQuestions(login, surfaces.prompts, hostAlias(input.target)),
    revealLoginTerminals: () => switchOf(settings, 'showLoginTerminal'),
  };
  /** A loopback port for the window, the tunnel's or the CLI bridge's, in the preferred range when one is free. */
  function chooseWindowPort(): Promise<PortChoice> {
    return chooseLocalPort(
      machine.prober,
      valueOf(settings, 'preferredLocalPortRange'),
      logger,
    );
  }
  const processEnvironment = definedEnvironment(machine.processEnvironment);
  const requestEnvironment: ConnectionRequestEnvironment = {
    registryFolder: machine.folders.registry,
    helperScript: machine.bundles.helperScript,
    askpassProgram: machine.bundles.askpassProgram,
    runtime: machine.bundles.runtime,
    runtimeFolder: machine.folders.runtime,
    homeFolder: machine.homeFolder,
    platform: machine.platform,
    processEnvironment: machine.processEnvironment,
  };
  return {
    configuredHosts: () => surfaces.configuredHosts(),
    preconnect: {
      ...machine.preconnectFiles,
      spawner: machine.spawner,
      environment: processEnvironment,
      workingDirectory: machine.workingDirectory,
      home: machine.homeFolder,
      approvals: surfaces.preconnectApprovals,
      dialog: surfaces.preconnectDialog,
      logger,
    },
    settings: {
      preconnect: () => valueOf(settings, 'preconnect'),
      server: () => serverSettingsOf(settings),
      connection: () => connectionSettingsOf(settings),
      override: () => overrideOf(settings),
      useExecServer: () => switchOf(settings, 'useExecServer'),
      localDownloadMode: () => localDownloadModeOf(settings),
      agentForwarding: () => agentForwardingOf(settings),
      x11Forwarding: () => x11ForwardingOf(settings),
      defaultForwards: () => defaultForwardsOf(settings),
    },
    tunnels: surfaces.tunnels,
    defaultRead: () =>
      waitForDefaultRead(surfaces.defaultReadEvents, machine.scheduler),
    terms: {
      settings: () => termsSettingsOf(settings),
      pickPlatform: surfaces.pickPlatform,
      writePlatform: surfaces.writePlatform,
      announcePlatform: platform => {
        announcePlatform(
          {
            notice: surfaces.notice,
            state: surfaces.noticeState,
            translate: surfaces.translate,
            logger,
          },
          platform,
        );
      },
    },
    locate: {
      settingValue: () => textOf(settings, 'path'),
      mode: () => (terminalModeOf(settings) ? 'terminal' : 'shared'),
      environment: machine.clientSearch,
      platform: machine.platform,
      homeFolder: machine.homeFolder,
      spawner: machine.spawner,
      processEnvironment,
      checkMilliseconds: CLIENT_CHECK_MILLISECONDS,
      logger,
    },
    acquire: (request, limits) =>
      acquireConnection<StepFailure>(
        {helper: machine.helpers, freePort: machine.freeSocksPort},
        request,
        limits,
      ),
    requestEnvironment,
    channelFor: (session, channelRun) =>
      loggedChannel(
        new SharedSessionChannel({
          session,
          direct: new SshHostChannel({
            hostString: channelRun.hostString,
            platform: channelRun.terms.platform,
            base: channelRun.base,
            spawner: machine.spawner,
            editorEnvironment: machine.processEnvironment,
            // The copy runs in a login terminal of its own, so no run of this channel asks through askpass.
            askpassEnvironment: {},
            files: machine.files,
            scheduler: machine.scheduler,
            copier: terminalCopierOf({
              terminals: surfaces.terminals,
              scheduler: machine.scheduler,
              invocationFor: copy =>
                buildInvocation({...channelRun.base, purpose: 'copy', copy}),
              connectWait: () => channelRun.connectWait,
              attachQuestions: login =>
                attachTerminalQuestions(
                  login,
                  surfaces.prompts,
                  channelRun.displayHost,
                ),
              revealLoginTerminals: () =>
                switchOf(settings, 'showLoginTerminal'),
            }),
          }),
          files: machine.files,
          ...SESSION_RUN_LIMITS,
        }),
        logger,
      ),
    attachLogin: (login, alias) =>
      attachPromptSurface(login, surfaces.prompts, {displayHost: alias}),
    terminal: {
      terminals: surfaces.terminals,
      dynamicForwarding: () =>
        selectTunnelPath(tunnelSettingsOf(settings)) === 'socks',
      freePort: machine.freeSocksPort,
      scheduler: machine.scheduler,
      newMarker: machine.helpers.newNonce,
      ...loginSurfaces,
    },
    server: {
      profile: machine.profile,
      overridePolicy: sshOverridePolicy(),
      clock: () => machine.clock.now(),
      bounds: SERVER_BOUNDS,
      store: surfaces.acceptances,
      modal: surfaces.licenceModal,
      download: machine.download,
      credentials: machine.credentials,
      files: machine.clientFiles,
      lockLoop: hostLockLoopOf(
        machine.clock,
        HOST_LOCK_ATTEMPTS,
        HOST_LOCK_INTERVAL_MILLISECONDS,
      ),
      clientFolder: machine.folders.clientTemporary,
      archiveCache: {kind: 'none'},
      downloadBounds: CLIENT_DOWNLOAD_BOUNDS,
      newTemporaryToken: machine.newTemporaryToken,
      discardDeadlineMilliseconds: DISCARD_DEADLINE_MILLISECONDS,
      rejectBindHost: surfaces.rejectBindHost,
      logger,
    },
    cliPath: {
      local: machine.local,
      scheduler: machine.scheduler,
      chooseLocalPort: chooseWindowPort,
      newSecret: machine.helpers.newNonce,
      presenter: surfaces.presenter,
      downloadProgress: () =>
        serverDownloadProgress(
          surfaces.downloadProgress,
          textOfId('S045', surfaces.translate),
        ),
    },
    forwarding: {
      draw: machine.drawLinkNumber,
      windowLink: {path: undefined},
      linkTerminals: surfaces.linkTerminals,
    },
    tunnel: {
      terminals: surfaces.terminals,
      ...loginSurfaces,
      settings: () => tunnelSettingsOf(settings),
      local: machine.local,
      scheduler: machine.scheduler,
      limits: TUNNEL_WAIT_LIMITS,
      dialerFor: socksPort =>
        socksDialer({
          local: machine.local,
          socksPort,
          scheduler: machine.scheduler,
          handshakeMilliseconds: SOCKS_HANDSHAKE_MILLISECONDS,
        }),
      chooseLocalPort: chooseWindowPort,
      logger,
    },
    logger,
  };
}

/** The host alias of a decoded target; a target that is not an ssh one names none. */
function aliasOf(target: DecodedTarget): string {
  return 'kind' in target.target ? hostAlias(target.target) : '';
}

/** The connector of every window connect, and the resolver's options over it. */
export function connectAssemblyOf(
  surfaces: ConnectSurfaces,
  machine: ConnectMachine,
  logger: Logger,
  connectorFrom: typeof connectorOf = connectorOf,
): ConnectAssembly {
  const ports = wiringPortsOf(surfaces, machine, logger);
  const connector = connectorFrom({
    stepsFor: onPhase => stepsOf(ports, onPhase),
    options: {
      // A getter, so each connect reads the setting as it is then.
      get maximumReconnectionAttempts() {
        return valueOf(surfaces.settings, 'maxReconnectionAttempts');
      },
      preconnectMilliseconds: PRECONNECT_MILLISECONDS,
      logger,
      serve: {commit: machine.profile.commit, quality: machine.profile.quality},
      get useExecServer() {
        return switchOf(surfaces.settings, 'useExecServer');
      },
    },
    revealLog: surfaces.revealLog,
    terminalMode: () => terminalModeOf(surfaces.settings),
    applyTerminalEnvironment: surfaces.applyTerminalEnvironment,
  });
  const {translate} = surfaces;
  let shownTitle = '';
  return {
    connector,
    maintain: async (action, target) => {
      const runKey = machine.helpers.newNonce();
      try {
        return await runMaintenance(
          stepsOf(ports, () => undefined),
          maintenanceInputOf(target, runKey),
          action,
          new AbortController().signal,
        );
      } finally {
        await killConnection(
          {helper: machine.helpers, freePort: machine.freeSocksPort},
          machine.folders.registry,
          maintenanceConnectionKey(target, runKey),
        );
      }
    },
    killLocalServer: hostString =>
      killConnection(
        {helper: machine.helpers, freePort: machine.freeSocksPort},
        machine.folders.registry,
        hostString,
      ),
    options: {
      family: 'ssh-remote',
      connector,
      presenter: surfaces.presenter,
      cancellable: false,
      allowsTrust: false,
      startTitle: target => {
        // A new connect starts here: a stage without a message of its own has nothing before it to keep.
        shownTitle = '';
        const title = startTitleOf(aliasOf(target));
        return textOfId(title.id as FailureStringId, translate, title.values);
      },
      titleOf: phase => {
        const title = phaseTitleOf(phase);
        // A stage without a message of its own keeps the one shown before it.
        if (title !== undefined) {
          shownTitle = textOfId(
            title.id as FailureStringId,
            translate,
            title.values,
          );
        }
        return shownTitle;
      },
    },
  };
}
