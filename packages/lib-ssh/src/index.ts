/**
 * @fileoverview The library's contract: target checks and argument lists for `ssh` and `scp`, the SSH
 * configuration model, the classifiers for ssh's error output and askpass questions, and the client lookup.
 */

export type {SshTarget, TargetProblem} from './arguments/target.ts';
export {validateTarget} from './arguments/target.ts';
export type {
  CopyRequest,
  CopyRunRequest,
  Forward,
  Invocation,
  InvocationRequest,
  InvocationSettings,
  OptionsQueryRequest,
  SshPurpose,
  SshRequest,
} from './arguments/invocation.ts';
export {buildInvocation, buildOptionsQuery} from './arguments/invocation.ts';
export type {
  ClientLocations,
  ClientPlatform,
  ConfigFileReader,
  FileInEffect,
} from './config/files.ts';
export {filesInEffect} from './config/files.ts';
export type {HostEntry, HostListResult} from './config/hosts.ts';
export {listHosts} from './config/hosts.ts';
export type {
  EffectiveOptions,
  EffectiveOptionsResult,
} from './config/effective.ts';
export {parseEffectiveOptions} from './config/effective.ts';
export type {
  AddHostProblem,
  AddHostResult,
  BlockLine,
  HostBlock,
} from './config/add-host.ts';
export {parseAddHostCommand} from './config/add-host.ts';
export {writeHostBlock} from './config/writer.ts';
export type {DiagnosticStringId, FailureKind} from './diagnostics/rules.ts';
export type {
  Classification,
  ClassifyPurpose,
  ConnectionMode,
  FailureHint,
  FailureReason,
  FilledString,
} from './diagnostics/classify.ts';
export {classify, endWithFullStop, logLinesOf} from './diagnostics/classify.ts';
export type {
  PickItem,
  PromptStringId,
  PromptSurface,
  PromptText,
} from './prompts/classify.ts';
export {classifyPrompt} from './prompts/classify.ts';
export type {ClientCandidate, ClientEnvironment} from './client/locate.ts';
export {
  candidates,
  judge,
  scpProgram,
  VERSION_ARGUMENTS,
} from './client/locate.ts';
export {ConnectWait, type ConnectWaitSettings} from './process/connect-wait.ts';
export {nodeProcessSpawner} from './process/node-spawner.ts';
export type {
  ProcessHandle,
  ProcessSpawner,
  ProcessSpecification,
  StartError,
} from './process/ports.ts';
export {
  sessionEnvironment,
  type SpawnFailure,
  type SpawnOutcome,
  spawnSession,
  SshSession,
} from './process/session.ts';
export {
  type RunBase,
  SshHostChannel,
  type SshHostChannelOptions,
} from './process/host-channel.ts';
export {LineSplitter} from './process/line-splitter.ts';
export {type LocalFiles, nodeLocalFiles} from './process/node-files.ts';
export {
  planScript,
  posixQuote,
  type ScriptPlan,
} from './process/remote-program.ts';
export {
  firstSetupMarker,
  type SetupMarker,
  setupMarkerOf,
} from './diagnostics/setup-report.ts';
export {
  type ConnectionEvent,
  type ConnectionReply,
  type ConnectionRequest,
  type PromptSurface as ConnectionPromptSurface,
  type Refusal,
  readConnectionRequest,
  type SharedRecord,
} from './connection-server/messages.ts';
export {
  LoginOwnership,
  type OpenPrompt,
  PromptBook,
} from './connection-server/ownership.ts';
export {
  ConnectionHandler,
  type ConnectionHandlerOptions,
} from './connection-server/handler.ts';
export {
  type ConnectionHelperEnvironment,
  type ConnectionHelperOptions,
  runConnectionHelper,
} from './connection-server/helper.ts';
export {
  type AskRequest,
  type AskReply,
  readAskReply,
  readAskRequest,
} from './askpass/messages.ts';
export {
  AskpassEndpoint,
  type AskpassHooks,
  DEFAULT_FIRST_MESSAGE_MILLISECONDS,
} from './askpass/endpoint.ts';
export {
  askpassEndpointPath,
  LAUNCHER_FOLDER,
  launcherPath,
} from './askpass/paths.ts';
export {
  type AskpassProgramEnvironment,
  ENDPOINT_VARIABLE,
  NONCE_VARIABLE,
  runAskpassProgram,
} from './askpass/program.ts';
export {
  askpassEnvironment,
  type AskpassEnvironmentRequest,
} from './askpass/environment.ts';
export {
  installLauncher,
  launcherText,
  type LauncherFiles,
  nodeLauncherFiles,
} from './askpass/launcher.ts';
export {
  acquireConnection,
  type AcquireConnectionOutcome,
  type ConnectedState,
  type ConnectionClientEnvironment,
  type ConnectionFailure,
  type ConnectionLimits,
  type ConnectionNotice,
  type ConnectionAcquireRequest,
  CONNECTION_NAMESPACE,
  type ConnectOutcome,
  killConnection,
  SharedConnection,
} from './connection-server/client.ts';
export {
  readConnectionEvent,
  readConnectionReply,
} from './connection-server/messages.ts';
