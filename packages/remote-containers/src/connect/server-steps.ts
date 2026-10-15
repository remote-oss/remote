/**
 * @fileoverview The server of a connection over the container's channel: the probe, the plan with the archive
 * resolution, the licence gate, the transfer with one more try, and the start. One run makes one connection's steps,
 * so the tree the scripts share is decided once.
 */

import type {Failed} from 'lib-authority';
import type {HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import {
  type ArchiveResolution,
  type LicenceFacts,
  OVERRIDE_POLICIES,
  type OverridePolicy,
  type OverrideValue,
  type ProductProfile,
  resolveServerArchive,
  serverDataFolderNameOrDefault,
} from 'lib-product';
import {
  type AcceptanceStore,
  archiveKeyOf,
  cacheFolders,
  CLIENT_DOWNLOAD_BOUNDS,
  classifyServerLicence,
  clientArchiveFolder,
  type Clock,
  type ClientFilePort,
  CONTAINERS_POLICY,
  DISCARD_DEADLINE_MILLISECONDS,
  type DownloadPort,
  ensureAccepted,
  hostLockLoopOf,
  type LicenceModal,
  type Plan,
  plan,
  probe,
  type ScriptParameters,
  startOrReuse,
  templatePlatformOf,
  transfer,
  type TransferFailure,
} from 'lib-server';
import {installRelayScript, relayScriptPath} from '../exec/relay-script.ts';
import {
  cancelled,
  noServerSource,
  requirementsNotMet,
  serverFailed,
  unsupportedPlatform,
} from './failures.ts';
import {prepareVolumeFolders} from './volume-folders.ts';

/** How long the server may take to report its port, in seconds. */
const READY_SECONDS = 15;

/** How long the client's download may take before it ends, in seconds. */
const DOWNLOAD_SECONDS = 30 * 60;

/** How often the host's lock is asked for while another window holds it, and how far apart, in milliseconds. */
const LOCK_ATTEMPTS = 30;
const LOCK_INTERVAL_MILLISECONDS = 1000;

/** The folder under the system's temporary folder that holds the archives the client downloads. */
const DEFAULT_CACHE_FOLDER = 'vscode-remote-containers';

/** What the steps of one connect are made from. */
export interface ServerStepDependencies {
  profile: ProductProfile;
  /** The `remote.serverDownloadBaseUrl` value and the layer it came from, when one is set. */
  override: OverrideValue | undefined;
  /** The value of `remote.serverDownloadFolder`, whatever it is. */
  downloadFolder: unknown;
  /** The system's temporary folder on the client. */
  temporaryFolder: string;
  store: AcceptanceStore;
  modal: LicenceModal;
  download: DownloadPort;
  files: ClientFilePort;
  clock: Clock;
  newTemporaryToken: () => string;
  logger: Logger;
}

/** What one connect asks of the steps. */
export interface ServerRequest {
  channel: HostChannel;
  /** The container's channel as root, for the volume's shared folders (contracts §5.2). */
  rootChannel: HostChannel;
  remoteUser: string;
  /** Whether the container mounts the `vscode` volume, so that the server installs into its shared tree. */
  volumeMounted: boolean;
  /** The extensions the server installs when it starts: the new container's list, empty for a container that is reused. */
  defaultExtensions: readonly string[];
  onPhase(phase: 'installing' | 'startingServer'): void;
  cancellation: AbortSignal;
}

/** The server a connect started or found, and the paths the relay needs. */
export interface StartedContainerServer {
  kind: 'started';
  port: number;
  connectionToken: string;
  processId: number;
  reused: boolean;
  /** The installed server's own `node`. */
  nodePath: string;
  relayPath: string;
}

/** How the steps ended. */
export type ServerResult =
  StartedContainerServer | {kind: 'failed'; failure: Failed};

function failedWith(failure: Failed): ServerResult {
  return {kind: 'failed', failure};
}

/** The log text of a transfer that failed: its kind, then what it carries. */
export function transferredDetail(failure: TransferFailure): string {
  switch (failure.kind) {
    case 'scriptFailed':
      return failure.writeFailure === undefined
        ? `scriptFailed (${failure.status})`
        : `scriptFailed (${failure.status}): cannot write ${failure.writeFailure.path}: ${failure.writeFailure.error}`;
    case 'serverDownload':
      return failure.status === undefined
        ? `serverDownload (${failure.cause})`
        : `serverDownload (${failure.cause}, HTTP ${String(failure.status)})`;
    case 'localDownload':
      return `localDownload (${failure.cause}): ${failure.detail}`;
    case 'downloadTimeout':
      return `downloadTimeout (${failure.reason})`;
    case 'verification':
      return `verification (${failure.mismatch})`;
    case 'copy':
    case 'channelFailed':
      return `${failure.kind} (${failure.failure.kind}): ${failure.failure.detail}`;
    case 'retriesExhausted':
      return failure.lockPath === undefined
        ? `retriesExhausted (${String(failure.attempts)} attempts)`
        : `retriesExhausted (${String(failure.attempts)} attempts): lock ${failure.lockPath}`;
    default:
      return failure.kind;
  }
}

/** The download override's policy of Dev Containers in `policies`; a table without one is a defect. */
export function containersOverridePolicy(
  policies: typeof OVERRIDE_POLICIES = OVERRIDE_POLICIES,
): OverridePolicy {
  const policy = policies['remote-containers'];
  if (policy === undefined) {
    throw new Error(
      'lib-product names no override policy for remote-containers',
    );
  }
  return policy;
}

/** The name an archive is kept under on the client: `<server>-<platform>[-<quality>].tar.gz`, no suffix for stable. */
function archiveNameOf(
  profile: ProductProfile,
  platform: ReturnType<typeof templatePlatformOf>,
): string {
  const suffix = profile.quality === 'stable' ? '' : `-${profile.quality}`;
  return `${profile.serverApplicationName}-${platform.operatingSystem}-${platform.architecture}${suffix}.tar.gz`;
}

/** The parameters of every script of one connect; the tree is the same in all of them but the discovery probe. */
function parametersOf(
  dependencies: ServerStepDependencies,
  request: ServerRequest,
  installTree: string,
  archiveUrl: string,
): ScriptParameters {
  const {profile} = dependencies;
  return {
    installRoot: '',
    dataFolderName: serverDataFolderNameOrDefault(profile),
    launcher: `bin/${profile.serverApplicationName}`,
    commit: profile.commit,
    archiveUrl,
    archivePath: '',
    removeArchive: false,
    archiveFormat: 'tar.gz',
    epochMilliseconds: dependencies.clock.now(),
    installTree,
    proxy: {http: '', https: ''},
    downloader: {
      useConfigurationFiles: false,
      timeoutSeconds: DOWNLOAD_SECONDS,
    },
    lock: {
      method: 'link',
      inTemporaryFolder: false,
      filePrefix: `remote-lock.${request.remoteUser}`,
    },
    environmentSetup: '',
    installUmask: CONTAINERS_POLICY.installUmask,
    cleanup: CONTAINERS_POLICY.cleanup,
    start: {
      bindHost: '127.0.0.1',
      port: '0',
      licenceAccepted: false,
      graceSeconds: 0,
      extensions: [],
      fileWatcherPollingMilliseconds: 0,
      useHostProxy: false,
      requirementsHelper: false,
      readySeconds: READY_SECONDS,
      socketMode: false,
    },
  };
}

/** The client's cache root: the setting's folder when it is a non-empty text, else the temporary folder's own one. */
function cacheRootOf(dependencies: ServerStepDependencies): string {
  const {downloadFolder} = dependencies;
  return typeof downloadFolder === 'string' && downloadFolder !== ''
    ? downloadFolder
    : `${dependencies.temporaryFolder}/${DEFAULT_CACHE_FOLDER}`;
}

/** The failure of a probe that gave no host. */
function probeFailure(
  outcome: Extract<Awaited<ReturnType<typeof probe>>, {kind: 'failed'}>,
  logger: Logger,
): Failed {
  const {failure} = outcome;
  logger.info(`the probe failed: ${failure.kind}`);
  switch (failure.kind) {
    case 'unsupportedPlatform':
      return unsupportedPlatform('S031', failure.reported);
    case 'unsupportedArch':
      return unsupportedPlatform(
        failure.libc === 'musl' ? 'S031' : 'S359',
        failure.reported,
      );
    case 'prerequisiteMissing':
      logger.info(`the container lacks: ${failure.missing.join(', ')}`);
      return serverFailed();
    case 'channelFailed':
      return failure.failure.kind === 'cancelled'
        ? cancelled()
        : serverFailed();
    default:
      return serverFailed();
  }
}

/** The licence facts of a plan that downloads from `resolution`, else those of a reuse. */
function licenceFactsOf(
  profile: ProductProfile,
  resolution: ArchiveResolution,
  chosen: Plan,
): LicenceFacts {
  const base = {
    serverLicenseEmpty: profile.serverLicense.length === 0,
    updateUrl: profile.updateUrl,
  };
  return chosen.kind === 'download' && resolution.kind === 'resolved'
    ? {...base, step: resolution.step, downloadUrl: chosen.address}
    : {...base, step: 'reuse'};
}

/** What the log says once for a failed first try: the address, the cache path and the reason. */
function retryLine(
  failure: Extract<TransferFailure, {kind: 'localDownload'}>,
  address: string,
  cachePath: string,
): string {
  return `the server download failed (${address}, ${cachePath}): ${failure.detail}; retrying once`;
}

/** Runs the steps of one connect. */
export async function runServerSteps(
  dependencies: ServerStepDependencies,
  request: ServerRequest,
): Promise<ServerResult> {
  const {profile, logger} = dependencies;
  const {channel, cancellation} = request;
  const discovered = await probe(
    channel,
    parametersOf(dependencies, request, '', ''),
    cancellation,
  );
  if (discovered.kind === 'failed') {
    return failedWith(probeFailure(discovered, logger));
  }
  const platform = templatePlatformOf(discovered.host);
  const platformName = `${platform.operatingSystem}-${platform.architecture}`;
  const installTree =
    cacheFolders(profile, profile.commit, platformName, request.volumeMounted)
      .serverTree ?? '';
  let host = discovered.host;
  if (installTree !== '') {
    await prepareVolumeFolders(
      request.rootChannel,
      profile,
      platformName,
      logger,
      cancellation,
    );
    const withTree = await probe(
      channel,
      parametersOf(dependencies, request, installTree, ''),
      cancellation,
    );
    if (withTree.kind === 'failed') {
      return failedWith(probeFailure(withTree, logger));
    }
    host = withTree.host;
  }
  const dataFolder = `${host.home}/${serverDataFolderNameOrDefault(profile)}`;
  const installed = await installRelayScript(channel, dataFolder, cancellation);
  if (installed.kind === 'failed') {
    logger.info(`the relay script was not installed: ${installed.detail}`);
    return failedWith(serverFailed());
  }
  const policy = containersOverridePolicy();
  const resolution = resolveServerArchive(
    profile,
    platform,
    policy,
    dependencies.override,
  );
  const planned = plan({
    facts: {
      ...platform,
      homeFolder: host.home,
      existingLayouts: [
        ...(host.treeComplete
          ? [{kind: 'tree' as const, commit: profile.commit, path: installTree}]
          : []),
        ...(host.installed
          ? [
              {
                kind: 'bin' as const,
                commit: profile.commit,
                path: host.installFolder,
              },
            ]
          : []),
      ],
    },
    commit: profile.commit,
    serverDataFolderName: serverDataFolderNameOrDefault(profile),
    launcher: `bin/${profile.serverApplicationName}`,
    installPathSetting: undefined,
    placement: CONTAINERS_POLICY.downloadPlacement,
    useExecServerSetting: false,
    installTree,
    source:
      resolution.kind === 'resolved'
        ? {kind: 'resolved', address: resolution.address}
        : resolution.kind === 'noSource'
          ? {kind: 'noSource'}
          : {kind: 'invalidOverride', problem: resolution.problem},
  });
  if ('failure' in planned) {
    logger.info(`the server source was not usable: ${planned.failure.kind}`);
    return failedWith(noServerSource(profile.applicationName));
  }
  const chosen = planned.plan;
  const licence = await ensureAccepted(
    classifyServerLicence(licenceFactsOf(profile, resolution, chosen), {
      serverLicenseEmpty: profile.serverLicense.length === 0,
      serverLicenseUrl: profile.serverLicenseUrl,
    }),
    dependencies.store,
    dependencies.modal,
    logger,
    cancellation,
  );
  if (licence.kind !== 'cleared') {
    return failedWith(cancelled());
  }
  const nodeFolder =
    installTree === '' ? `${dataFolder}/bin/${profile.commit}` : installTree;
  if (chosen.kind === 'download') {
    request.onPhase('installing');
    const downloading = chosen;
    const address = downloading.address;
    const archivePath = `${clientArchiveFolder(
      cacheRootOf(dependencies),
      profile,
      archiveKeyOf(
        // A plan that downloads has a source, so its resolution resolved.
        (resolution as Extract<ArchiveResolution, {kind: 'resolved'}>).step,
        profile,
      ),
    )}/${archiveNameOf(profile, platform)}`;
    function attempt(): ReturnType<typeof transfer> {
      return transfer(
        {
          plan: downloading,
          parameters: parametersOf(dependencies, request, installTree, address),
          clientFolder: dependencies.temporaryFolder,
          cache: {kind: 'kept', archivePath},
          downloadBounds: CLIENT_DOWNLOAD_BOUNDS,
          temporaryToken: dependencies.newTemporaryToken(),
          verification: CONTAINERS_POLICY.verification,
          hostFolder: host.temporaryFolder,
          cancellation,
          discardDeadlineMilliseconds: DISCARD_DEADLINE_MILLISECONDS,
        },
        {
          channel,
          download: dependencies.download,
          files: dependencies.files,
          lockLoop: hostLockLoopOf(
            dependencies.clock,
            LOCK_ATTEMPTS,
            LOCK_INTERVAL_MILLISECONDS,
          ),
          logger,
          onPhase: () => undefined,
        },
      );
    }
    let transferred = await attempt();
    if (
      transferred.kind === 'failed' &&
      transferred.failure.kind === 'localDownload'
    ) {
      logger.info(retryLine(transferred.failure, address, archivePath));
      transferred = await attempt();
    }
    if (transferred.kind === 'failed') {
      logger.info(
        `the server was not installed: ${transferredDetail(transferred.failure)}`,
      );
      return failedWith(
        transferred.failure.kind === 'cancelled' ? cancelled() : serverFailed(),
      );
    }
  }
  request.onPhase('startingServer');
  logger.info('Starting VS Code Server');
  const started = await startOrReuse(
    channel,
    parametersOf(dependencies, request, installTree, ''),
    {
      bindHost: '127.0.0.1',
      portRange: '',
      licenceAccepted: licence.acceptanceFlag,
      graceSeconds: 0,
      defaultExtensions: request.defaultExtensions,
      fileWatcherPollingMilliseconds: 0,
      readySeconds: READY_SECONDS,
      socketMode: false,
    },
    CONTAINERS_POLICY,
    {
      lockLoop: hostLockLoopOf(
        dependencies.clock,
        LOCK_ATTEMPTS,
        LOCK_INTERVAL_MILLISECONDS,
      ),
      logger,
    },
    cancellation,
  );
  if (started.kind === 'failed') {
    logger.info(`the server was not started: ${started.failure.kind}`);
    return failedWith(
      started.failure.kind === 'prerequisitesMissing'
        ? requirementsNotMet(started.failure.detail)
        : serverFailed(),
    );
  }
  if (
    started.notices.some(notice => notice.kind === 'requirementsHelperMissing')
  ) {
    logger.warn(
      "the server has no requirements helper; the container's requirements weren't checked",
    );
  }
  const {server} = started;
  if (server.endpoint.kind !== 'port') {
    return failedWith(serverFailed());
  }
  logger.info(`server listening on 127.0.0.1:${String(server.endpoint.port)}`);
  if (server.reused) {
    logger.info('reusing the running server');
  }
  return {
    kind: 'started',
    port: server.endpoint.port,
    connectionToken: server.connectionToken,
    processId: server.processId,
    reused: server.reused,
    nodePath: `${nodeFolder}/node`,
    relayPath: relayScriptPath(dataFolder),
  };
}
