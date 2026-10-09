/**
 * @fileoverview The wsl codec: the distro, and the outer hop a wsl authority carries after `@`, the outer always
 * through the codec the caller injects.
 */
import type {Codec, DecodedOrMalformed, WslTarget} from './types.ts';
import {type OuterCodec, outerHop, outerPayload} from './outer-hop.ts';

const FAMILY = 'wsl';

/** Decodes a wsl payload `<distro>[@<outer authority>]`; the outer decodes through the injected codec. */
function decode(
  outer: OuterCodec,
  payload: string,
): DecodedOrMalformed<WslTarget> {
  const split = outerHop(FAMILY, payload, outer);
  if ('refusal' in split) {
    return {malformed: split.refusal};
  }
  const target: WslTarget = {distro: split.name};
  if (split.outer !== undefined) {
    target.outer = split.outer;
  }
  return {target, rawHostString: payload};
}

/** The codec of the wsl family for the outer codec a caller injects. */
export function wslCodecOf(outer: OuterCodec): Codec<WslTarget> {
  return {
    decode: payload => decode(outer, payload),
    encode: target => outerPayload(target.distro, target.outer, outer),
    label: target =>
      target.distro === '' ? 'wsl.defaultDistro' : target.distro,
  };
}
