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
