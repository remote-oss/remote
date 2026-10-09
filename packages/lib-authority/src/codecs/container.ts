/**
 * @fileoverview The container codecs: the payload of one container family, and the outer hop it carries after `@`.
 */
import {outerHop, outerPayload} from './registry.ts';
import type {Codec, ContainerTarget, DecodedOrMalformed} from './types.ts';

/** The families whose payload is the container family's own text. */
export type ContainerFamily =
  | 'dev-container'
  | 'attached-container'
  | 'k8s-container'
  | 'apple-container'
  | 'exec';

/** Decodes a container payload `<payload>[@<outer authority>]`; the outer decodes through the registry. */
function decode(
  family: ContainerFamily,
  payload: string,
): DecodedOrMalformed<ContainerTarget> {
  const split = outerHop(family, payload);
  if ('refusal' in split) {
    return {malformed: split.refusal};
  }
  const target: ContainerTarget = {payload: split.name};
  if (split.outer !== undefined) {
    target.outer = split.outer;
  }
  return {target, rawHostString: payload};
}

/** Encodes a container target back to `<payload>` or `<payload>@<outer authority>`. */
function encode(target: ContainerTarget): string {
  return outerPayload(target.payload, target.outer);
}

/** The container label: the family's payload text exactly as written. */
function label(target: ContainerTarget): string {
  return target.payload;
}

/** The codec of one container family; its malformed rows name that family. */
export function containerCodec(
  family: ContainerFamily,
): Codec<ContainerTarget> {
  return {
    decode: payload => decode(family, payload),
    encode,
    label,
  };
}
