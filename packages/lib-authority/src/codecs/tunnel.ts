/**
 * @fileoverview The tunnel codec: the tunnel name, and the distro it carries after `/`.
 */
import type {
  Codec,
  DecodedOrMalformed,
  MalformedAuthority,
  TunnelTarget,
} from './types.ts';

const FAMILY = 'tunnel';

/** A refusal, carrying the payload and the reason the contract names. */
function refuse(payload: string, reason: string): MalformedAuthority {
  return {family: FAMILY, payload, reason};
}

/** Decodes a tunnel payload `<tunnelName>[/<distro>]`; an empty name, with or without a distro, is a refusal. */
function decode(payload: string): DecodedOrMalformed<TunnelTarget> {
  if (payload === '') {
    return {malformed: refuse(payload, 'empty')};
  }
  const slash = payload.indexOf('/');
  const tunnelName = slash === -1 ? payload : payload.slice(0, slash);
  if (tunnelName === '') {
    return {malformed: refuse(payload, 'empty')};
  }
  const target: TunnelTarget = {tunnelName};
  if (slash !== -1) {
    target.distro = payload.slice(slash + 1);
  }
  return {
    target,
    rawHostString: payload,
  };
}

/** Encodes a tunnel target back to `<tunnelName>` or `<tunnelName>/<distro>`. */
function encode(target: TunnelTarget): string {
  return target.distro === undefined
    ? target.tunnelName
    : `${target.tunnelName}/${target.distro}`;
}

/** The tunnel label: the tunnel name. */
function label(target: TunnelTarget): string {
  return target.tunnelName;
}

/** The tunnel codec of the contract. */
export const tunnelCodec: Codec<TunnelTarget> = {decode, encode, label};
