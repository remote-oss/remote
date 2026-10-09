/**
 * @fileoverview The library's contract: one codec per authority family, the registry that decodes an authority at
 * its first `+`, the opener commands, and the mapping a failure gives core.
 */
export type {
  Codec,
  ContainerTarget,
  DecodedOrMalformed,
  DecodedTarget,
  Family,
  MalformedAuthority,
  SshTarget,
  TunnelTarget,
  WslTarget,
} from './codecs/types.ts';
export type {ContainerFamily} from './codecs/container.ts';
export {containerCodec} from './codecs/container.ts';
export type {OuterCodec} from './codecs/outer-hop.ts';
export {sshRemoteCodec} from './codecs/ssh-remote.ts';
export {tunnelCodec} from './codecs/tunnel.ts';
export {decodeAuthority, encodeAuthority, wslCodec} from './codecs/registry.ts';
export type {
  Connected,
  Failed,
  FailureHint,
  FailureReason,
  FilledString,
} from './connector/results.ts';
export {
  type ProbeApi,
  type ProbeRequest,
  type ProposalName,
  type ProposalProbe,
  type ProposalState,
  probeProposals,
} from './gate/probe.ts';
export {probeApiOf} from './gate/vscode-api.ts';
export {
  type LabelFormatterHost,
  registerAuthorityLabel,
  type ResourceLabelFormatter,
} from './labels/formatter.ts';
export {
  argvEntryList,
  decide,
  type GateDecision,
  type GateInput,
  type ProbeReport,
  type ProbeResult,
} from './gate/decisions.ts';
export {
  type Applied,
  type ConnectionEvent,
  type ConnectionState,
  ConnectionTracker,
  type CurrentConnection,
} from './resolver/connection-state.ts';
export {
  type InteractionOutcome,
  type RestartAnswer,
  runSetup,
  type SetupAnswer,
  type SetupFlags,
  type SetupNotice,
  type SetupPorts,
  type SetupRun,
  type WindowClaim,
} from './gate/setup.ts';
export {CLAIM_COMMAND, type ClaimHost, windowClaimOf} from './gate/claim.ts';

export type {OpenCommand, OpenTarget, PathKind} from './opener/arguments.ts';
export {openLocalCommand, openRemoteCommand} from './opener/arguments.ts';
export type {FailedLike, ResolverOutcome} from './resolver/failure-mapping.ts';
export {mapFailure} from './resolver/failure-mapping.ts';
export {
  closeRemote,
  openLocal,
  type OpenOutcome,
  type OpenerHost,
  type OpenRequest,
  openRemote,
  reload,
} from './opener/opener.ts';
