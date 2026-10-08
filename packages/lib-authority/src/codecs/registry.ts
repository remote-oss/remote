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

/** The outcome a codec's decode gives, re-stamped with the family and the payload as written. */
function finish<T extends UnionTarget>(
  family: Family,
  payload: string,
  outcome: DecodedOrMalformed<T>,
): DecodedOrMalformed<UnionTarget> {
  if ('malformed' in outcome) {
    const refusal: MalformedAuthority = {
      family,
      payload,
      reason: outcome.malformed.reason,
    };
    return {malformed: refusal};
  }
  return {target: outcome.target, rawHostString: outcome.rawHostString};
}

/** Decodes the payload with the family's codec, keeping the family and payload. */
function decodePayload(
  family: Family,
  payload: string,
): DecodedOrMalformed<UnionTarget> {
  if (family === 'ssh-remote') {
    return finish(family, payload, sshRemoteCodec.decode(payload));
  }
  if (family === 'wsl') {
    return finish(family, payload, wslCodec.decode(payload));
  }
  if (family === 'tunnel') {
    return finish(family, payload, tunnelCodec.decode(payload));
  }
  return finish(family, payload, containerCodec(family).decode(payload));
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

/** Splits an authority at its first `+` and decodes the payload with the family's codec. */
export function decodeAuthority(
  authority: string,
): DecodedTarget | {malformed: MalformedAuthority} {
  const plus = authority.indexOf('+');
  const family = (plus === -1 ? authority : authority.slice(0, plus)) as Family;
  const payload = plus === -1 ? '' : authority.slice(plus + 1);
  if (!FAMILIES.includes(family)) {
    const refusal: MalformedAuthority = {
      family,
      payload: authority,
      reason: 'unknownFamily',
    };
    return {malformed: refusal};
  }
  const outcome = decodePayload(family, payload);
  if ('malformed' in outcome) {
    return {malformed: outcome.malformed};
  }
  return {family, target: outcome.target, rawHostString: outcome.rawHostString};
}

/** Encodes a decoded target back to `<family>+<payload>`. */
export function encodeAuthority(decoded: DecodedTarget): string {
  return `${decoded.family}+${encodePayload(decoded)}`;
}
