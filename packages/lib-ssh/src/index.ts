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
export {
  buildInvocation,
  buildOptionsQuery,
  TUNNEL_SUCCESS_LINE,
} from './arguments/invocation.ts';
export type {ClientPlatform} from './config/platform.ts';
export type {
  ClientLocations,
  ConfigFileReader,
  ConfigFileSetting,
  FileInEffect,
} from './config/files.ts';
export {configFilePath, expandHome, filesInEffect} from './config/files.ts';
export type {HostEntry, HostListResult} from './config/hosts.ts';
export {listHosts} from './config/hosts.ts';
export type {
  EffectiveOptions,
  EffectiveOptionsResult,
} from './config/effective.ts';
export {parseEffectiveOptions} from './config/effective.ts';
export type {
  ForwardingBlock,
  ForwardingPath,
} from './config/forwarding-block.ts';
export {forwardingBlock} from './config/forwarding-block.ts';
export type {
  AddHostProblem,
  AddHostResult,
  BlockLine,
  HostBlock,
} from './config/add-host.ts';
export {parseAddHostCommand} from './config/add-host.ts';
export {lexConfiguration} from './config/lexer.ts';
export type {LexResult} from './config/lexer.ts';
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
export {
  classify,
  endWithFullStop,
  isDebugLine,
  logLinesOf,
} from './diagnostics/classify.ts';
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
export {
  ConnectWait,
  connectWaitMilliseconds,
  type ConnectWaitSettings,
} from './process/connect-wait.ts';
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
  preludeProgram,
  type ScriptPlan,
} from './process/remote-program.ts';
export {
  type BootstrapEvent,
  bootstrapEventOf,
  bootstrapLogLine,
  sessionStart,
  sessionStartFor,
} from './connection-server/session-bootstrap.ts';
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
  type ScriptFailureReason,
  readConnectionRequest,
  type SharedRecord,
  type StoredAgentLink,
  type StoredDisplay,
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
  type PreparedConnection,
  type RunFacts,
  CONNECTION_NAMESPACE,
  type ConnectOutcome,
  killConnection,
  type SessionRun,
  type SessionRunEnd,
  SharedConnection,
} from './connection-server/client.ts';
export {
  EXEC_ARGUMENT_LIMIT_BYTES,
  type SessionRunner,
  SharedSessionChannel,
  type SharedSessionChannelOptions,
} from './connection-server/shared-channel.ts';
export {
  readConnectionEvent,
  readConnectionReply,
} from './connection-server/messages.ts';
export {
  type LoginTerminalName,
  type LoginTerminals,
  type LoginTerminalSession,
  type TerminalLogin,
  type TerminalEnd,
} from './terminal/login-terminal.ts';
export {PlainTextFilter} from './terminal/plain-text.ts';
export {
  PARTIAL_LINE_PAUSE_MILLISECONDS,
  type PromptReaderEvents,
  PromptReader,
  isTerminalPrompt,
} from './terminal/prompt-reader.ts';
export {TerminalStream} from './terminal/terminal-stream.ts';
export {
  TerminalSessionRunner,
  type TerminalRunnerOptions,
} from './terminal/terminal-runs.ts';
export {
  openTunnelSession,
  type TunnelGate,
  type TunnelSession,
} from './terminal/tunnel-session.ts';
export {
  type Copier,
  terminalCopierOf,
  type TerminalCopierOptions,
} from './terminal/terminal-copy.ts';
export {
  followLoginOutput,
  type LoginOutputSinks,
} from './terminal/login-output.ts';
