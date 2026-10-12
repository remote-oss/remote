/**
 * @fileoverview The server steps of a connect over the real libraries: the probe, the install plan with the archive
 * resolution, the licence gate, the transfer and the start. One set is made for each connect, because the plan
 * decides what the gate and the transfer need.
 */

import {effectiveUseLocalServer, type TunnelSettings} from 'lib-forwarding';
import type {Logger} from 'lib-log';
import {
  type ArchiveResolution,
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
  type DownloadPort,
  ensureAccepted,
  installExtensions,
  type HostLockLoop,
  type LicenceModal,
  plan,
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
  /** The settings that choose how the connection is made; read for each connect. */
  connectionSettings: () => Pick<
    TunnelSettings,
    'listenOnSocket' | 'useLocalServer'
  >;
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
      if (!effectiveUseLocalServer(dependencies.connectionSettings())) {
        dependencies.logger.warn(
          'a connection without the shared connection is not built yet',
        );
        return {kind: 'failed', failure: {kind: 'unknown'}};
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
      const resolution = resolveServerArchive(
        profile,
        {
          operatingSystem:
            host.libc === 'musl' ? 'alpine' : host.operatingSystem,
          architecture: host.architecture,
        },
        dependencies.overridePolicy,
        dependencies.override,
      );
      const result = plan({
        facts: {
          operatingSystem:
            host.libc === 'musl' ? 'alpine' : host.operatingSystem,
          architecture: host.architecture,
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
      });
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
