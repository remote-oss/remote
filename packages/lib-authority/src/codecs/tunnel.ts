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

/** Decodes a tunnel payload `<tunnelName>[/<distro>]`; an empty name is a refusal. */
function decode(payload: string): DecodedOrMalformed<TunnelTarget> {
  if (payload === '') {
    const refusal: MalformedAuthority = {
      family: FAMILY,
      payload,
      reason: 'empty',
    };
    return {malformed: refusal};
  }
  const slash = payload.indexOf('/');
  if (slash === -1) {
    return {target: {tunnelName: payload}, rawHostString: payload};
  }
  return {
    target: {
      tunnelName: payload.slice(0, slash),
      distro: payload.slice(slash + 1),
    },
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
