/**
 * @fileoverview The tunnel codec: the whole payload is the tunnel's name, as the user wrote it, and no further `+` is
 * allowed in it.
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

/**
 * Decodes a tunnel payload, which is the tunnel's name whole: `/`, `:`, `@`, `%` and every other character stay in it.
 * An empty payload is refused as `empty`, and a payload with a `+` anywhere as `plus`.
 */
function decode(payload: string): DecodedOrMalformed<TunnelTarget> {
  if (payload === '') {
    return {malformed: refuse(payload, 'empty')};
  }
  if (payload.includes('+')) {
    return {malformed: refuse(payload, 'plus')};
  }
  return {target: {tunnelName: payload}, rawHostString: payload};
}

/** Encodes a tunnel target back to its name. */
function encode(target: TunnelTarget): string {
  return target.tunnelName;
}

/** The tunnel label: the tunnel name. */
function label(target: TunnelTarget): string {
  return target.tunnelName;
}

/** The tunnel codec of the contract. */
export const tunnelCodec: Codec<TunnelTarget> = {decode, encode, label};
