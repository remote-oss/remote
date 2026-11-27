/**
 * @fileoverview The server steps of a connect over the real libraries: the probe, the install plan with the archive
 * resolution, the licence gate, the transfer and the start. One set is made for each connect, because the plan
 * decides what the gate and the transfer need.
 */

import type {Logger} from 'lib-log';
import {
  type ArchiveResolution,
  BASE_PLACEHOLDERS,
  classifyLicence,
  cliRedirectRule,
  expand,
  type OverridePolicy,
  type LicenceFacts,
  type OverrideValue,
  type ProductProfile,
  resolveServerArchive,
} from 'lib-product';
import {
  type AcceptanceStore,
  addressForLog,
  type ArchiveCache,
  classifyServerLicence,
  cleanup,
  type ClientFilePort,
  type CredentialsPort,
  type DirectReason,
  type DownloadBounds,
  type DownloadPort,
  ensureAccepted,
  heldServer,
  hostAlias,
  type HostLockLoop,
  installCli,
  installExtensions,
  kill,
  type LicenceModal,
  type Plan,
  plan,
  type PlanInput,
  probe,
  type ProbedHost,
  type ScriptParameters,
  type ServerPolicyRecord,
  startCli,
  type StartFailure,
  startOrReuse,
  stopCli,
  templatePlatformOf,
  transfer,
  type TransferFailure,
  uninstall,
} from 'lib-server';
import {validateTarget} from 'lib-ssh';
import {sshTargetOf, type HostServerSettings} from './host-settings.ts';
import {
  type ParameterInput,
  runtimeOptionsFor,
  scriptParametersFor,
  type ServerBounds,
  serverNamesOf,
} from './parameters.ts';
import {english, textOfId} from '../surfaces/failure-strings.ts';
import type {ConnectSteps} from './steps.ts';
import {proxyProblem, type ProxyProblem} from './proxy-check.ts';
import {localDownloadValue} from './failure.ts';

/** What the server steps of one connect are made from. */
export interface ServerStepDependencies {
  profile: ProductProfile;
  policy: ServerPolicyRecord;
  settings: HostServerSettings;
  /** `remote.SSH.useExecServer`: off, the plan takes the direct install; on, it takes the CLI path where the editor names a CLI source. */
  useExecServer: boolean;
  /** The user's download override and where it came from, when one is set. */
  override: OverrideValue | undefined;
  overridePolicy: OverridePolicy;
  /**
   * Tells the user that the host's bind host entry is not valid and the loopback address is used; `configured` is the
   * entry as written. It does not wait for the user.
   */
  rejectBindHost: (alias: string, configured: string) => void;
  /** The editor's strict URI parser, which throws for a text that is no URI. */
  parseUri: (text: string) => void;
  /** Keeps the hint of a proxy value the parser rejected, for the troubleshooting view. */
  onProxyRejected: (problem: ProxyProblem) => void;
  /** The user name on the host, from the effective ssh config; read when a step needs it, once the lookup has run. */
  remoteUser: () => string;
  /** Whether this connect's server listens on a socket; the tunnel step's path decides it, once per connect. */
  socketMode: () => boolean;
  clock: () => number;
  bounds: ServerBounds;
  store: AcceptanceStore;
  modal: LicenceModal;
  download: DownloadPort;
  credentials: CredentialsPort;
  files: ClientFilePort;
  /** Tells that the host could not download the archive while the client may not: `downloadFailed`, or `noDownloader`. */
  onHostDownloadRefused: (cause: 'downloadFailed' | 'noDownloader') => void;
  /** Keeps the hint of an install folder setting the check rejected, `value` being the setting as written. */
  onInstallFolderInvalid: (value: string) => void;
  /** Keeps the hint of an install folder the host could not create, for the troubleshooting view. */
  onInstallFolderRefused: () => void;
  /** Keeps the hint of a host the server's requirements check refused, for the troubleshooting view. */
  onPrerequisitesMissing: () => void;
  /** Keeps the hint of an install that stopped for a program the host does not have, `program` being `tar` or `gzip`. */
  onCommandMissing: (program: string) => void;
  /** Keeps the hint of a download the client could not make, `value` being the reason the dialog gives. */
  onLocalDownloadFailed: (value: string) => void;
  /** Where a manual bootstrap reads the user's server archive on the client. */
  bootstrapArchive: string;
  /** Keeps the hint of a manual bootstrap that could not start on the client: no archive at its path, or one it cannot read. */
  onLocalBootstrapFailed: (
    failure:
      {cause: 'missing'; path: string} | {cause: 'unreadable'; detail: string},
  ) => void;
  /** Whether the program the client's archive is copied to the host with can be started. */
  copyAvailable: () => Promise<boolean>;
  lockLoop: HostLockLoop;
  /** The client's temporary folder, where a downloaded archive that is not kept waits. */
  clientFolder: string;
  /** Where a downloaded archive lives: a temporary file, or the cache later connects reuse. */
  archiveCache: ArchiveCache;
  /** The limits of a download on the client, from the policy. */
  downloadBounds: DownloadBounds;
  /** A new token for each transfer, so that two transfers never share a file name. */
  newTemporaryToken: () => string;
  discardDeadlineMilliseconds: number;
  logger: Logger;
}

/** The CLI's stop as the server steps run it: with the cancellation the wiring bounds it by. */
type BoundedStop = (
  ...parameters: [
    ...Parameters<ConnectSteps['stopCli']>,
    cancellation: AbortSignal,
  ]
) => Promise<void>;

/** The maintenance of a host's server that each action of the `maintain` step runs. */
const MAINTENANCE = {kill, uninstall, cleanup} as const;

/**
 * The parameters with `dataFolder`, a data folder a shared record names, in place of the settings' own: its parent as
 * the install root and its last name as the data folder's name. None given keeps the parameters as they are.
 */
function inDataFolder(
  parameters: ScriptParameters,
  dataFolder: string | undefined,
): ScriptParameters {
  if (dataFolder === undefined) {
    return parameters;
  }
  const split = dataFolder.lastIndexOf('/');
  return {
    ...parameters,
    installRoot: dataFolder.slice(0, split),
    dataFolderName: dataFolder.slice(split + 1),
  };
}

type ServerStepNames =
  | 'checkStartSettings'
  | 'validate'
  | 'checkInstallFolder'
  | 'checkProxy'
  | 'probe'
  | 'plan'
  | 'gate'
  | 'transfer'
  | 'start'
  | 'installCli'
  | 'startCli'
  | 'maintain'
  | 'heldServer'
  | 'certainlyDirect'
  | 'installExtensions';

/** The archive source the planner reads, from what the resolution found. */
function sourceOf(resolution: ArchiveResolution): PlanInput['source'] {
  switch (resolution.kind) {
    case 'resolved':
      return {
        kind: 'resolved',
        address: resolution.address,
        redirect: resolution.redirect,
      };
    case 'noSource':
      return {kind: 'noSource'};
    default:
      return {kind: 'invalidOverride', problem: resolution.problem};
  }
}

/** The script parameters' key for the CLI's name and data folder. */
const CLI_PARAMETERS = 'cli';

/** Why the CLI path was not used, as the log says it once per connect. */
const CLI_NOT_USED_REASONS: Readonly<
  Record<Exclude<DirectReason, 'settingOff' | 'manualBootstrap'>, string>
> = {
  noCliSource: 'the editor names no CLI source',
  noBuildForPlatform: 'there is no CLI build for this host',
  termsToAccept: "the server's terms must be accepted first",
  socketMode: 'the server listens on a socket, which the CLI does not',
};

/** The line the log says once for a reason the CLI path was not used; the rows that expect it build from it. */
export function cliNotUsedLine(
  reason: keyof typeof CLI_NOT_USED_REASONS,
): string {
  return `the CLI path was not used: ${CLI_NOT_USED_REASONS[reason]}`;
}

/**
 * The address of the CLI archive for a host, from the product's `cliDownloadUrlTemplate`, or why it gives none: no
 * template, or one that is unusable for this host.
 */
function cliAddressOf(
  profile: ProductProfile,
  platform: {operatingSystem: string; architecture: string},
): {kind: 'address'; address: string} | {kind: 'none'} | {kind: 'unusable'} {
  if (profile.cliDownloadUrlTemplate === '') {
    return {kind: 'none'};
  }
  const expansion = expand(
    profile.cliDownloadUrlTemplate,
    {
      ...platform,
      commit: profile.commit,
      quality: profile.quality,
      version: profile.version,
      release: profile.version,
      applicationName: profile.applicationName,
    },
    BASE_PLACEHOLDERS,
  );
  return expansion.kind === 'url'
    ? {kind: 'address', address: expansion.address}
    : {kind: 'unusable'};
}

/** The steps that talk to the host and the libraries, for one connect. */
export function createServerSteps(
  dependencies: ServerStepDependencies,
): Pick<ConnectSteps, ServerStepNames> & {stopCli: BoundedStop} {
  const {profile, settings} = dependencies;
  const names = serverNamesOf(profile);
  const noLicenceFacts = {
    serverLicenseEmpty: profile.serverLicense.length === 0,
    updateUrl: profile.updateUrl,
  };
  let licenceFacts: LicenceFacts = {...noLicenceFacts, step: 'reuse'};
  /** The CLI archive's address for this connect's host, once the plan has read it. */
  let cliAddress: string | undefined;

  function parametersFor(
    changes: Partial<ParameterInput>,
  ): ReturnType<typeof scriptParametersFor> {
    return scriptParametersFor({
      names,
      policy: dependencies.policy,
      settings,
      remoteUser: dependencies.remoteUser(),
      hostOperatingSystem: undefined,
      archiveUrl: '',
      epochMilliseconds: dependencies.clock(),
      bounds: dependencies.bounds,
      socketMode: dependencies.socketMode(),
      ...changes,
    });
  }

  /**
   * Keeps the hint of a failure that has one: an install folder the host could not create, a program the host lacks
   * for the unpack, a host the server's requirements check refused, or a download the client could not make.
   */
  function recordFailureHint(failure: TransferFailure | StartFailure): void {
    if (
      failure.kind === 'scriptFailed' &&
      failure.status === 'CreateInstallDirFailed'
    ) {
      dependencies.onInstallFolderRefused();
    } else if (failure.kind === 'unpack' && failure.missing !== undefined) {
      dependencies.onCommandMissing(failure.missing);
    } else if (failure.kind === 'prerequisitesMissing') {
      dependencies.onPrerequisitesMissing();
    } else if (failure.kind === 'localDownload') {
      dependencies.onLocalDownloadFailed(localDownloadValue(failure));
    } else if (
      failure.kind === 'localBootstrap' &&
      failure.cause !== 'windowsHost'
    ) {
      dependencies.onLocalBootstrapFailed(failure);
    }
  }

  /** Whether this connect runs a manual bootstrap: `remote.SSH.localServerDownload` is `manual-bootstrap`. */
  function manualBootstrap(): boolean {
    const placement = dependencies.policy.downloadPlacement;
    return (
      placement.kind === 'hostFirst' && placement.mode === 'manualBootstrap'
    );
  }

  /** The CLI archive's address, which a CLI plan always comes with: asking for it before such a plan is a defect. */
  function plannedCliAddress(): string {
    if (cliAddress === undefined) {
      throw new Error('a CLI step ran before a CLI plan');
    }
    return cliAddress;
  }

  /** The script parameters of the CLI's install and start: its name in the archive, and its place on the host. */
  function cliParametersFor(
    cliPlan: Extract<Plan, {kind: 'cli'}>,
    host: ProbedHost,
  ): ScriptParameters & {cli: NonNullable<ScriptParameters['cli']>} {
    return {
      ...parametersFor({
        archiveUrl: plannedCliAddress(),
        hostOperatingSystem: host.operatingSystem,
      }),
      launcher: profile.applicationName,
      [CLI_PARAMETERS]: {
        name: `${profile.applicationName}-${names.commit}`,
        dataFolder: cliPlan.cliDataFolder,
      },
    };
  }

  return {
    checkStartSettings: input => {
      if (settings.rangeProblem !== undefined) {
        return {
          kind: 'failed',
          failure: {
            kind: 'invalidSetting',
            ...(settings.rangeProblem === 'reversed'
              ? {reason: {id: 'reversedPortRange', values: []}}
              : {}),
          },
        };
      }
      if (settings.bindHost.rejected !== undefined) {
        dependencies.rejectBindHost(
          hostAlias(input.target),
          settings.bindHost.rejected,
        );
      }
      return {kind: 'done', value: undefined};
    },
    validate: input => {
      const problem = validateTarget(sshTargetOf(input.target));
      if (problem !== undefined) {
        return {
          kind: 'failed',
          failure: {
            kind: 'invalidSetting',
            reason: {id: problem.reason, values: [problem.character]},
            logDetail: textOfId(problem.reason, english, [problem.character]),
          },
        };
      }
      return {kind: 'done', value: undefined};
    },
    checkInstallFolder: () => {
      if (settings.installFolder.kind !== 'invalid') {
        return {kind: 'done', value: undefined};
      }
      dependencies.onInstallFolderInvalid(settings.installFolder.value);
      return {
        kind: 'failed',
        failure: {
          kind: 'invalidSetting',
          reason: {
            id: 'installPathProvided',
            values: [settings.installFolder.value],
          },
        },
      };
    },
    checkProxy: () => {
      const problem = proxyProblem(settings, dependencies.parseUri);
      if (problem === undefined) {
        return {kind: 'done', value: undefined};
      }
      dependencies.onProxyRejected(problem);
      return {
        kind: 'failed',
        failure: {
          kind: 'invalidSetting',
          reason: {text: problem.error},
          logDetail: `the proxy value '${problem.value}' is no URI: ${problem.error}`,
        },
      };
    },
    probe: (input, lease, cancellation) =>
      probe(lease.channel, parametersFor({}), cancellation),
    maintain: (input, lease, action, cancellation, host, dataFolder) =>
      MAINTENANCE[action](
        lease.channel,
        inDataFolder(
          parametersFor({hostOperatingSystem: host?.operatingSystem}),
          dataFolder,
        ),
        cancellation,
      ),
    heldServer: (input, lease, host, dataFolder, cancellation) =>
      heldServer(
        lease.channel,
        inDataFolder(
          parametersFor({hostOperatingSystem: host.operatingSystem}),
          dataFolder,
        ),
        cancellation,
      ),
    certainlyDirect: (input, host) =>
      !dependencies.useExecServer ||
      dependencies.socketMode() ||
      manualBootstrap() ||
      cliAddressOf(profile, templatePlatformOf(host)).kind !== 'address',
    plan: (input, host, options) => {
      const platform = templatePlatformOf(host);
      const resolution = resolveServerArchive(
        profile,
        platform,
        dependencies.overridePolicy,
        dependencies.override,
      );
      const cliSource = cliAddressOf(profile, platform);
      if (cliSource.kind === 'unusable') {
        dependencies.logger.info(
          'the CLI path was not used: the CLI template is unusable',
        );
      }
      cliAddress =
        cliSource.kind === 'address' && options?.direct !== true
          ? cliSource.address
          : undefined;
      const serverFree =
        resolution.kind !== 'resolved' ||
        !classifyLicence({
          ...noLicenceFacts,
          step: resolution.step,
          downloadUrl: resolution.address,
        });
      const cliFree =
        cliAddress === undefined ||
        !classifyLicence({
          ...noLicenceFacts,
          step: 'productTemplate',
          downloadUrl: cliAddress,
        });
      const result = plan({
        facts: {
          ...platform,
          homeFolder: host.home,
          existingLayouts: host.installed
            ? [{kind: 'bin', commit: names.commit, path: host.installFolder}]
            : [],
        },
        commit: names.commit,
        serverDataFolderName: names.dataFolderName,
        launcher: names.launcher,
        installPathSetting:
          settings.installFolder.kind === 'folder'
            ? settings.installFolder.folder
            : undefined,
        placement: dependencies.policy.downloadPlacement,
        useExecServerSetting: dependencies.useExecServer,
        source: sourceOf(resolution),
        // An unusable template and the direct re-plan plan the direct install with no mode; without a template the
        // planner still decides the direct install and notes why, so the log says so once per connect.
        ...(cliSource.kind === 'unusable' || options?.direct === true
          ? {}
          : {
              cliMode: {
                useExecServerSetting: dependencies.useExecServer,
                manualBootstrap: manualBootstrap(),
                socketMode: dependencies.socketMode(),
                cliTemplate: profile.cliDownloadUrlTemplate,
                sourcesFree: serverFree && cliFree,
              },
              cliName: `${profile.applicationName}-${names.commit}`,
              // installCli's own step finds a CLI already placed and reports it without a download.
              cliPresentOnHost: false,
            }),
      });
      for (const note of 'plan' in result ? result.plan.notes : []) {
        dependencies.logger.info(cliNotUsedLine(note.reason));
      }
      if (
        'plan' in result &&
        result.plan.kind === 'download' &&
        resolution.kind === 'resolved'
      ) {
        licenceFacts = {
          ...noLicenceFacts,
          step: resolution.step,
          downloadUrl: result.plan.address,
        };
      } else {
        licenceFacts = {...noLicenceFacts, step: 'reuse'};
      }
      return 'plan' in result && resolution.kind === 'resolved'
        ? {...result, step: resolution.step}
        : result;
    },
    gate: (input, cancellation) => {
      const classification = classifyServerLicence(licenceFacts, {
        serverLicenseEmpty: profile.serverLicense.length === 0,
        serverLicenseUrl: profile.serverLicenseUrl,
      });
      return ensureAccepted(
        classification,
        dependencies.store,
        dependencies.modal,
        dependencies.logger,
        cancellation,
      );
    },
    transfer: async (
      input,
      lease,
      host,
      downloadPlan,
      onPhase,
      cancellation,
    ) => {
      const bootstrap = manualBootstrap();
      if (bootstrap && host.operatingSystem === 'win32') {
        return {
          kind: 'failed',
          failure: {kind: 'localBootstrap', cause: 'windowsHost'},
        };
      }
      const outcome = await transfer(
        {
          plan: downloadPlan,
          parameters: parametersFor({
            archiveUrl: downloadPlan.address,
            hostOperatingSystem: host.operatingSystem,
          }),
          clientFolder: dependencies.clientFolder,
          cache: dependencies.archiveCache,
          downloadBounds: {
            ...dependencies.downloadBounds,
            stallMilliseconds: dependencies.policy.downloadStallMilliseconds,
          },
          ...(dependencies.policy.transferStallMilliseconds === undefined
            ? {}
            : {
                copyStallMilliseconds:
                  dependencies.policy.transferStallMilliseconds,
              }),
          temporaryToken: dependencies.newTemporaryToken(),
          verification: dependencies.policy.verification,
          hostFolder: host.temporaryFolder,
          ...(bootstrap
            ? {bootstrapArchive: dependencies.bootstrapArchive}
            : {}),
          cancellation,
          discardDeadlineMilliseconds: dependencies.discardDeadlineMilliseconds,
        },
        {
          channel: lease.channel,
          download: dependencies.download,
          credentials: dependencies.credentials,
          files: dependencies.files,
          copyAvailable: dependencies.copyAvailable,
          lockLoop: dependencies.lockLoop,
          logger: dependencies.logger,
          onPhase,
          sessionLock: true,
        },
      );
      const placement = dependencies.policy.downloadPlacement;
      if (
        outcome.kind === 'failed' &&
        outcome.failure.kind === 'serverDownload' &&
        (outcome.failure.cause === 'downloadFailed' ||
          outcome.failure.cause === 'noDownloader') &&
        placement.kind === 'hostFirst' &&
        placement.mode === 'off'
      ) {
        dependencies.onHostDownloadRefused(outcome.failure.cause);
      }
      if (
        outcome.kind === 'failed' &&
        outcome.failure.kind === 'localBootstrap' &&
        outcome.failure.cause === 'missing'
      ) {
        dependencies.logger.warn(
          `To stage the server, download ${addressForLog(downloadPlan.address)}`,
        );
        dependencies.logger.warn(`and save it as ${outcome.failure.path}`);
      }
      if (outcome.kind === 'failed') {
        recordFailureHint(outcome.failure);
      }
      return outcome;
    },
    start: async (input, lease, host, licenceAccepted, cancellation) => {
      const outcome = await startOrReuse(
        lease.channel,
        parametersFor({hostOperatingSystem: host.operatingSystem}),
        runtimeOptionsFor(
          settings,
          dependencies.bounds,
          licenceAccepted,
          dependencies.socketMode(),
        ),
        dependencies.policy,
        {
          lockLoop: dependencies.lockLoop,
          logger: dependencies.logger,
          sessionLock: true,
        },
        cancellation,
      );
      if (outcome.kind === 'failed') {
        recordFailureHint(outcome.failure);
      }
      return outcome;
    },
    installCli: async (input, lease, host, cliPlan, onPhase, cancellation) =>
      installCli(
        cliParametersFor(cliPlan, host),
        {
          plan: cliPlan,
          address: plannedCliAddress(),
          redirect: cliRedirectRule(profile, plannedCliAddress()),
          transfer: {
            clientFolder: dependencies.clientFolder,
            cache: dependencies.archiveCache,
            downloadBounds: {
              ...dependencies.downloadBounds,
              stallMilliseconds: dependencies.policy.downloadStallMilliseconds,
            },
            temporaryToken: dependencies.newTemporaryToken(),
            verification: dependencies.policy.verification,
            hostFolder: host.temporaryFolder,
            discardDeadlineMilliseconds:
              dependencies.discardDeadlineMilliseconds,
          },
        },
        {
          channel: lease.channel,
          download: dependencies.download,
          credentials: dependencies.credentials,
          files: dependencies.files,
          logger: dependencies.logger,
          onPhase,
        },
        cancellation,
      ),
    startCli: async (input, lease, host, cliPlan, controlToken, cancellation) =>
      startCli(
        lease.channel,
        cliParametersFor(cliPlan, host),
        controlToken,
        cancellation,
      ),
    stopCli: async (input, lease, host, cliPlan, processId, cancellation) => {
      const stopped = await stopCli(
        lease.channel,
        cliParametersFor(cliPlan, host),
        processId,
        cancellation,
      );
      if (stopped.kind === 'failed') {
        dependencies.logger.warn(
          `the CLI was not stopped: ${stopped.failure.kind}`,
        );
      }
    },
    installExtensions: async (input, lease, cancellation, dataFolder) => {
      await installExtensions(
        lease.channel,
        inDataFolder(parametersFor({}), dataFolder),
        settings.defaultExtensions,
        dependencies.logger,
        cancellation,
      );
    },
  };
}
