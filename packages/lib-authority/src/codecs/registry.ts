/**
 * @fileoverview The authority registry: the core split at the first `+`, and the family's codec for each payload.
 */
import {containerCodec} from './container.ts';
import {sshRemoteCodec} from './ssh-remote.ts';
import {tunnelCodec} from './tunnel.ts';
import {wslCodec} from './wsl.ts';
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

/** The outcome of splitting a payload at its `@`: the name, or the refusal the outer hop earned. */
type OuterHop =
  | {name: string; outer: DecodedTarget | undefined}
  | {name: string; refusal: MalformedAuthority};

/**
 * Splits a `<name>@<outer authority>` payload: the name, and the outer hop decoded through the registry. A
 * payload without `@` gives the whole payload as the name and no outer; an outer that refuses is a `badOuter`.
 */
export function outerHop(family: Family, payload: string): OuterHop {
  const atIndex = payload.indexOf('@');
  if (atIndex === -1) {
    return {name: payload, outer: undefined};
  }
  const outer = decodeAuthority(payload.slice(atIndex + 1));
  if ('malformed' in outer) {
    return {
      name: payload.slice(0, atIndex),
      refusal: {family, payload, reason: 'badOuter'},
    };
  }
  return {name: payload.slice(0, atIndex), outer};
}

/** The payload of a name with an optional outer hop: the name, or the name and the outer's authority. */
export function outerPayload(
  name: string,
  outer: DecodedTarget | undefined,
): string {
  return outer === undefined ? name : `${name}@${encodeAuthority(outer)}`;
}

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
  return containerCodec(family).encode(target as ContainerTarget);
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
          : containerCodec(family).decode(payload);
  if ('malformed' in outcome) {
    return {malformed: outcome.malformed};
  }
  return {family, target: outcome.target, rawHostString: outcome.rawHostString};
}

/** Encodes a decoded target back to `<family>+<payload>`. */
export function encodeAuthority(decoded: DecodedTarget): string {
  return `${decoded.family}+${encodePayload(decoded)}`;
}
