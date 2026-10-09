/**
 * @fileoverview The outer-hop helpers a codec that carries an outer hop shares: splitting a
 * `<name>@<outer authority>` payload and re-joining it, the outer always going through the injected codec so the
 * leaf imports only the target types.
 */
import type {DecodedTarget, Family, MalformedAuthority} from './types.ts';

/**
 * A codec that decodes a full authority into a target and re-encodes it, so an outer hop round-trips through
 * whatever codec the family's codec was built on.
 */
export interface OuterCodec {
  decode(authority: string): DecodedTarget | {malformed: MalformedAuthority};
  encode(decoded: DecodedTarget): string;
}

/** The outcome of splitting a payload at its `@`: the name, or the refusal the outer hop earned. */
export type OuterHop =
  | {name: string; outer: DecodedTarget | undefined}
  | {name: string; refusal: MalformedAuthority};

/**
 * Splits a `<name>@<outer authority>` payload: the name, and the outer hop decoded through the injected codec. A
 * payload without `@` gives the whole payload as the name and no outer; an outer the codec refuses is a `badOuter`.
 */
export function outerHop(
  family: Family,
  payload: string,
  outer: OuterCodec,
): OuterHop {
  const atIndex = payload.indexOf('@');
  if (atIndex === -1) {
    return {name: payload, outer: undefined};
  }
  const decoded = outer.decode(payload.slice(atIndex + 1));
  if ('malformed' in decoded) {
    return {
      name: payload.slice(0, atIndex),
      refusal: {family, payload, reason: 'badOuter'},
    };
  }
  return {name: payload.slice(0, atIndex), outer: decoded};
}

/** The payload of a name with an optional outer hop: the name, or the name and the outer re-encoded through the codec. */
export function outerPayload(
  name: string,
  outer: DecodedTarget | undefined,
  codec: OuterCodec,
): string {
  return outer === undefined ? name : `${name}@${codec.encode(outer)}`;
}
