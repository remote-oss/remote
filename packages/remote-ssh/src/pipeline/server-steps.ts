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
  expand,
  type OverridePolicy,
  type LicenceFacts,
  type OverrideValue,
  type ProductProfile,
  resolveServerArchive,
} from 'lib-product';
import {
  type AcceptanceStore,
  type ArchiveCache,
  type ClientFilePort,
  classifyServerLicence,
  type DownloadBounds,
  type DirectReason,
  type DownloadPort,
  ensureAccepted,
  installExtensions,
  type HostLockLoop,
  type LicenceModal,
  plan,
  type ProbedHost,
  type PlanInput,
  probe,
  type ServerPolicyRecord,
  startOrReuse,
  transfer,
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
import type {ConnectSteps} from './steps.ts';

/** What the server steps of one connect are made from. */
export interface ServerStepDependencies {
  profile: ProductProfile;
  policy: ServerPolicyRecord;
  settings: HostServerSettings;
  /** `remote.SSH.useExecServer`: the plan notes it and never applies it. */
  useExecServer: boolean;
  /** The user's download override and where it came from, when one is set. */
  override: OverrideValue | undefined;
  overridePolicy: OverridePolicy;
  /** The user name on the host, from the effective ssh config; read when a step needs it, once the lookup has run. */
  remoteUser: () => string;
  clock: () => number;
  bounds: ServerBounds;
  store: AcceptanceStore;
  modal: LicenceModal;
  download: DownloadPort;
  files: ClientFilePort;
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

type ServerStepNames =
  | 'validate'
  | 'probe'
  | 'plan'
  | 'gate'
  | 'transfer'
  | 'start'
  | 'installExtensions';

/** The archive source the planner reads, from what the resolution found. */
function sourceOf(resolution: ArchiveResolution): PlanInput['source'] {
  switch (resolution.kind) {
    case 'resolved':
      return {kind: 'resolved', address: resolution.address};
    case 'noSource':
      return {kind: 'noSource'};
    default:
      return {kind: 'invalidOverride', problem: resolution.problem};
  }
}

/** Why the CLI path was not used, as the log says it once per connect. */
const CLI_NOT_USED_REASONS: Readonly<
  Record<Exclude<DirectReason, 'settingOff' | 'manualBootstrap'>, string>
> = {
  noCliSource: 'the editor names no CLI source',
  noBuildForPlatform: 'there is no CLI build for this host',
  termsToAccept: "the server's terms must be accepted first",
};

/** The host's platform as the templates name it: a musl Linux is `alpine`. */
function templatePlatformOf(host: ProbedHost): {
  operatingSystem: ProbedHost['operatingSystem'] | 'alpine';
  architecture: ProbedHost['architecture'];
} {
  return {
    operatingSystem: host.libc === 'musl' ? 'alpine' : host.operatingSystem,
    architecture: host.architecture,
  };
}

/**
 * The address of the CLI archive for a host, from the product's `cliDownloadUrlTemplate`, or why it gives none: no
 * template, or one that is unusable for this host.
 */
export function cliAddressOf(
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
): Pick<ConnectSteps, ServerStepNames> {
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
      ...changes,
    });
  }

  return {
    validate: input => {
      const problem = validateTarget(sshTargetOf(input.target));
      if (problem !== undefined) {
        return {
          kind: 'failed',
          failure: {
            kind: 'invalidSetting',
            reason: {id: problem.reason, values: [problem.character]},
          },
        };
      }
      return settings.installFolder.kind === 'invalid'
        ? {
            kind: 'failed',
            failure: {
              kind: 'invalidSetting',
              reason: {
                id: 'installPathProvided',
                values: [settings.installFolder.value],
              },
            },
          }
        : {kind: 'done', value: undefined};
    },
    probe: (input, lease, cancellation) =>
      probe(lease.channel, parametersFor({}), cancellation),
    plan: (input, host) => {
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
      cliAddress = cliSource.kind === 'address' ? cliSource.address : undefined;
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
        // An unusable template plans the direct install, as no template does.
        ...(cliAddress === undefined
          ? {}
          : {
              cliMode: {
                useExecServerSetting: dependencies.useExecServer,
                // `localServerDownload` has no manual bootstrap value in this extension.
                manualBootstrap: false,
                cliTemplate: profile.cliDownloadUrlTemplate,
                sourcesFree: serverFree && cliFree,
              },
              cliName: `${profile.applicationName}-${names.commit}`,
              // installCli's own step finds a CLI already placed and reports it without a download.
              cliPresentOnHost: false,
            }),
      });
      for (const note of 'plan' in result ? result.plan.notes : []) {
        dependencies.logger.info(
          `the CLI path was not used: ${CLI_NOT_USED_REASONS[note.reason]}`,
        );
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
      return result;
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
    transfer: (input, lease, host, downloadPlan, onPhase, cancellation) =>
      transfer(
        {
          plan: downloadPlan,
          parameters: parametersFor({
            archiveUrl: downloadPlan.address,
            hostOperatingSystem: host.operatingSystem,
          }),
          clientFolder: dependencies.clientFolder,
          cache: dependencies.archiveCache,
          downloadBounds: dependencies.downloadBounds,
          temporaryToken: dependencies.newTemporaryToken(),
          verification: dependencies.policy.verification,
          hostFolder: host.temporaryFolder,
          cancellation,
          discardDeadlineMilliseconds: dependencies.discardDeadlineMilliseconds,
        },
        {
          channel: lease.channel,
          download: dependencies.download,
          files: dependencies.files,
          lockLoop: dependencies.lockLoop,
          logger: dependencies.logger,
          onPhase,
        },
      ),
    start: (input, lease, host, licenceAccepted, cancellation) =>
      startOrReuse(
        lease.channel,
        parametersFor({hostOperatingSystem: host.operatingSystem}),
        runtimeOptionsFor(settings, dependencies.bounds, licenceAccepted),
        dependencies.policy.allowedExtraStartOptions,
        {lockLoop: dependencies.lockLoop, logger: dependencies.logger},
        cancellation,
      ),
    installExtensions: async (input, lease, cancellation) => {
      await installExtensions(
        lease.channel,
        parametersFor({}),
        settings.defaultExtensions,
        dependencies.logger,
        cancellation,
      );
    },
  };
}
