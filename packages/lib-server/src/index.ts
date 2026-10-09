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
export {CONTAINERS_POLICY, SSH_POLICY, wslPolicy} from './policy/rows.ts';
export {validatePolicyRecord} from './policy/validate.ts';
export {
  type ResultBlock,
  type ScriptStatus,
  parseResult,
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
  type ProbedHost,
  type ProbeFailure,
  type ProbeOutcome,
  probe,
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
  type HostLockLoop,
  isAcceptedBindHost,
  isExtensionIdentifier,
  isReversedRange,
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
  DownloadBounds,
  DownloadFacts,
  DownloadFailureCause,
  DownloadPort,
  DownloadRequest,
  DownloadResult,
} from './transfer/ports.ts';
export {
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
