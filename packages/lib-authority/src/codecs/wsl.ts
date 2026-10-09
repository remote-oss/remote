/**
 * @fileoverview The wsl codec: the distro, and the outer hop a wsl authority carries after `@`.
 */
import {outerHop, outerPayload} from './registry.ts';
import type {Codec, DecodedOrMalformed, WslTarget} from './types.ts';

const FAMILY = 'wsl';

/** Decodes a wsl payload `<distro>[@<outer authority>]`; the outer decodes through the registry. */
function decode(payload: string): DecodedOrMalformed<WslTarget> {
  const split = outerHop(FAMILY, payload);
  if ('refusal' in split) {
    return {malformed: split.refusal};
  }
  const target: WslTarget = {distro: split.name};
  if (split.outer !== undefined) {
    target.outer = split.outer;
  }
  return {target, rawHostString: payload};
}

/** Encodes a wsl target back to `<distro>` or `<distro>@<outer authority>`. */
function encode(target: WslTarget): string {
  return outerPayload(target.distro, target.outer);
}

/** The wsl label: the distro, or `default distro` when the payload named none. */
function label(target: WslTarget): string {
  return target.distro === '' ? 'default distro' : target.distro;
}

/** The wsl codec of the contract. */
export const wslCodec: Codec<WslTarget> = {decode, encode, label};
