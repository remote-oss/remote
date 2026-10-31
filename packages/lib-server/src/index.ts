/**
 * @fileoverview lib-server: the editor's server on a host, installed and started through a host
 * channel. A package hands the library one flat policy record per extension; the library never
 * branches on which extension calls it.
 */

export {
  type Cleanup,
  type DownloadPlacement,
  type ExtraStartOption,
  type InstallMode,
  type Prefetch,
  type PolicyProblem,
  type RequirementsCheck,
  type ServerPolicyRecord,
  type Verification,
} from './policy/record.ts';
export {
  CONTAINERS_POLICY,
  type LocalDownloadMode,
  SSH_POLICY,
  sshPolicyFor,
  wslPolicy,
} from './policy/rows.ts';
export {validatePolicyRecord} from './policy/validate.ts';
export {
  type ResultBlock,
  type ScriptStatus,
  parseResult,
  factOfLine,
  LAUNCHING_LINE,
  RESULT_BEGIN,
  RESULT_END,
} from './scripts/result-block.ts';
export {
  type ProgressLine,
  type ProgressStep,
  parseProgressLine,
  progressLines,
  PROGRESS_PREFIX,
} from './scripts/progress-line.ts';
export {
  type BootstrapRequest,
  type ProxyVariables,
  type ScriptParameters,
  type ScriptStep,
  scriptFor,
  type StartParameters,
  type StepwiseAction,
} from './scripts/bootstrap.ts';
export {
  type HostArchitecture,
  type ProbedHost,
  type ProbeFailure,
  type ProbeOutcome,
  probe,
  templatePlatformOf,
} from './lifecycle/probe.ts';
export {type StepOptions, type StepRun, runStep} from './lifecycle/run-step.ts';
export {
  cleanup,
  kill,
  type MaintenanceOutcome,
  uninstall,
} from './lifecycle/maintenance.ts';
export {
  plan,
  type ExistingLayout,
  type HostFacts,
  type Plan,
  type PlanFailure,
  type PlanInput,
  type PlanNote,
} from './install/plan.ts';
export {
  type ExtensionResult,
  type ExtensionsNotRun,
  type ExtensionsOutcome,
  installExtensions,
  isExtensionIdentifier,
  keptExtensions,
} from './lifecycle/extensions.ts';
export {
  type HostLockLoop,
  isAcceptedBindHost,
  rangeProblem,
  type RuntimeDependencies,
  type RuntimeOptions,
  serverPort,
  startOrReuse,
  type StartedServer,
  type StartFailure,
  type StartNotice,
  type StartOutcome,
} from './lifecycle/runtime.ts';
export {
  type AcceptanceStore,
  acceptanceKey,
  classifyServerLicence,
  ensureAccepted,
  type GateOutcome,
  type LicenceClassification,
  type LicenceModal,
  type LicenceTerms,
  type ModalAnswer,
} from './gate/licence-gate.ts';
export {
  type Clock,
  type ClientLockOptions,
  type LockFilePort,
  lockIdFor,
  withClientLock,
} from './locks/client-lock.ts';
export {type HostLockStep, hostLockLoop} from './locks/host-lock-loop.ts';
export type {
  ClientFilePort,
  CredentialsPort,
  DownloadBounds,
  DownloadFacts,
  DownloadFailureCause,
  DownloadPort,
  DownloadRequest,
  DownloadResult,
} from './transfer/ports.ts';
export {
  addressForLog,
  type ArchiveCache,
  DISCARD_DEADLINE_MILLISECONDS,
  type DownloadPlan,
  transfer,
  type TransferDependencies,
  type TransferFailure,
  type TransferInput,
  type TransferOutcome,
  type TransferPhase,
} from './transfer/transfer.ts';
export {
  type CliInstallOutcome,
  type CliPlacement,
  type CliStartDependencies,
  type CliStopOutcome,
  installCli,
  startCli,
  stopCli,
} from './lifecycle/cli.ts';
export {proxyVariableText} from './proxy-variable-text.ts';
export {
  type ProductKeys,
  cacheFolders,
  archiveKeyOf,
  clientArchiveFolder,
  isFromSameGallery,
} from './cache/folders.ts';
export {
  type CliMode,
  type CliModeInput,
  cliArchiveTemplateVariables,
  decideCliMode,
  type DirectReason,
} from './cli-path/decision.ts';
export {CLI_PLATFORMS} from './cli-path/platforms.ts';
export {type CliServeError, parseCliServeError} from './cli-path/cli-output.ts';
export {downloadPortOf, type HttpGet} from './transfer/http-download.ts';
export {CLIENT_DOWNLOAD_BOUNDS} from './policy/bounds.ts';
export {nodeClientFiles, sha256Of} from './transfer/node-files.ts';
export {nodeCredentialsPort} from './transfer/node-netrc.ts';
export {hostLockLoopOf, type LockWait} from './transfer/lock-loop.ts';
export {
  type ByteStream,
  type CliControl,
  type CliControlFailure,
  type CliServeParams,
  type CliSocket,
  openCliControl,
  type ServerLogLine,
} from './cli-control/client.ts';
export {type S045Event, s045EventOf} from './cli-control/progress.ts';
