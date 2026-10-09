/**
 * @fileoverview The container codecs: the payload of one container family, and the outer hop it carries after `@`,
 * the outer always through the codec the caller injects.
 */
import type {Codec, ContainerTarget, DecodedOrMalformed} from './types.ts';
import {type OuterCodec, outerHop, outerPayload} from './outer-hop.ts';

/** The families whose payload is the container family's own text. */
export type ContainerFamily =
  | 'dev-container'
  | 'attached-container'
  | 'k8s-container'
  | 'apple-container'
  | 'exec';

/**
 * The codec of one container family for the outer codec a caller injects: its payload, and the outer hop it
 * carries after `@`, decoded and re-encoded through that codec.
 */
export function containerCodec(
  family: ContainerFamily,
  outer: OuterCodec,
): Codec<ContainerTarget> {
  return {
    decode: (payload: string): DecodedOrMalformed<ContainerTarget> => {
      const split = outerHop(family, payload, outer);
      if ('refusal' in split) {
        return {malformed: split.refusal};
      }
      const target: ContainerTarget = {payload: split.name};
      if (split.outer !== undefined) {
        target.outer = split.outer;
      }
      return {target, rawHostString: payload};
    },
    encode: target => outerPayload(target.payload, target.outer, outer),
    label: target => target.payload,
  };
}
