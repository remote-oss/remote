/**
 * @fileoverview The authority registry: the core split at the first `+`, and the family's codec for each payload,
 * the outer hop of the container and wsl families always going through the registry's own codec.
 */
import {containerCodec} from './container.ts';
import {sshRemoteCodec} from './ssh-remote.ts';
import {tunnelCodec} from './tunnel.ts';
import {wslCodecOf} from './wsl.ts';
import type {
  ContainerTarget,
  DecodedOrMalformed,
  DecodedTarget,
  Family,
  MalformedAuthority,
  SshTarget,
  TunnelTarget,
  WslTarget,
} from './types.ts';
import type {OuterCodec} from './outer-hop.ts';

/** The target shape a codec decodes, across the families. */
type UnionTarget = SshTarget | WslTarget | ContainerTarget | TunnelTarget;

/** The families the registry decodes, in the order the contract lists them. */
const FAMILIES = [
  'ssh-remote',
  'wsl',
  'dev-container',
  'attached-container',
  'k8s-container',
  'apple-container',
  'exec',
  'tunnel',
] as const;

/**
 * The outer codec the registry hands the container and wsl codecs: the registry's own decode and encode, so an
 * outer hop stays on the registry's round-trip.
 */
const REGISTRY_OUTER: OuterCodec = {
  decode: decodeAuthority,
  encode: encodeAuthority,
};

/** The container codec of each container family, built once on the registry's outer. */
const CONTAINER_CODECS = {
  'dev-container': containerCodec('dev-container', REGISTRY_OUTER),
  'attached-container': containerCodec('attached-container', REGISTRY_OUTER),
  'k8s-container': containerCodec('k8s-container', REGISTRY_OUTER),
  'apple-container': containerCodec('apple-container', REGISTRY_OUTER),
  exec: containerCodec('exec', REGISTRY_OUTER),
};

/** The wsl codec of the contract, built on the registry's outer. */
export const wslCodec = wslCodecOf(REGISTRY_OUTER);

/** Encodes the target with the family's codec. */
function encodePayload(decoded: DecodedTarget): string {
  const {family, target} = decoded;
  if (family === 'ssh-remote') {
    return sshRemoteCodec.encode(target as SshTarget);
  }
  if (family === 'wsl') {
    return wslCodec.encode(target as WslTarget);
  }
  if (family === 'tunnel') {
    return tunnelCodec.encode(target as TunnelTarget);
  }
  return CONTAINER_CODECS[family].encode(target as ContainerTarget);
}

/**
 * Splits an authority at its first `+` and decodes the payload with the family's codec. An authority without
 * a `+` has no family to hand the payload to, so it is refused as `unknownFamily` before any lookup.
 */
export function decodeAuthority(
  authority: string,
): DecodedTarget | {malformed: MalformedAuthority} {
  const plus = authority.indexOf('+');
  if (plus === -1) {
    const refusal: MalformedAuthority = {
      family: authority as Family,
      payload: authority,
      reason: 'unknownFamily',
    };
    return {malformed: refusal};
  }
  const family = authority.slice(0, plus) as Family;
  const payload = authority.slice(plus + 1);
  if (!FAMILIES.includes(family)) {
    return {
      malformed: {family, payload: authority, reason: 'unknownFamily'},
    };
  }
  const outcome: DecodedOrMalformed<UnionTarget> =
    family === 'ssh-remote'
      ? sshRemoteCodec.decode(payload)
      : family === 'wsl'
        ? wslCodec.decode(payload)
        : family === 'tunnel'
          ? tunnelCodec.decode(payload)
          : CONTAINER_CODECS[family].decode(payload);
  if ('malformed' in outcome) {
    return {malformed: outcome.malformed};
  }
  return {family, target: outcome.target, rawHostString: outcome.rawHostString};
}

/** Encodes a decoded target back to `<family>+<payload>`. */
export function encodeAuthority(decoded: DecodedTarget): string {
  return `${decoded.family}+${encodePayload(decoded)}`;
}
