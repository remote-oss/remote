/**
 * @fileoverview The library's contract: one codec per authority family, the registry that decodes an authority at
 * its first `+`, and the shapes every codec shares.
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
export {sshRemoteCodec} from './codecs/ssh-remote.ts';
export {tunnelCodec} from './codecs/tunnel.ts';
export {wslCodec} from './codecs/wsl.ts';
export {decodeAuthority, encodeAuthority} from './codecs/registry.ts';
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
