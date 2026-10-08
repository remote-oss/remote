/**
 * @fileoverview The ssh-remote codec: the three forms of F-2008 BR-5 — a config alias, a bare host name, and the
 * lower-case hex of a compact JSON {hostName, user?, port?}.
 */
import {TextDecoder, TextEncoder} from 'node:util';
import type {
  Codec,
  DecodedOrMalformed,
  MalformedAuthority,
  SshTarget,
} from './types.ts';

const FAMILY = 'ssh-remote';

/** A bare host name: letters, digits, dot, colon and hyphen only, no user, no port. */
const BARE_HOST = /^[a-z0-9.:-]+$/i;

/** Lower-case hexadecimal with even length. */
const LOWER_HEX = /^[0-9a-f]+$/;

/** A blank that makes a payload malformed with reason whitespace. */
const WHITESPACE = /[\t\n\r ]/;

/** Whether the text holds a control character, including DEL. */
function hasControl(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** The compact JSON form as it decodes from the hex. */
interface HostJson {
  hostName: unknown;
  user?: unknown;
  port?: unknown;
}

/** A refusal, carrying the payload and the reason the contract names. */
function refuse(payload: string, reason: string): MalformedAuthority {
  return {family: FAMILY, payload, reason};
}

/** Decodes a lower-case hex payload to a host target, or the reason that refused it. */
function decodeHex(
  payload: string,
): {target: SshTarget} | {malformed: MalformedAuthority} {
  let text: string;
  try {
    text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(
      hexBytes(payload),
    );
  } catch {
    return {malformed: refuse(payload, 'badHex')};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {malformed: refuse(payload, 'badHex')};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {malformed: refuse(payload, 'badJson')};
  }
  const host = parsed as HostJson;
  if (typeof host.hostName !== 'string') {
    return {malformed: refuse(payload, 'badJson')};
  }
  const userValue = host.user;
  let user: string | undefined;
  if (userValue !== undefined) {
    if (typeof userValue !== 'string') {
      return {malformed: refuse(payload, 'badJson')};
    }
    user = userValue;
  }
  const portValue = host.port;
  let port: number | undefined;
  if (portValue !== undefined) {
    if (
      typeof portValue !== 'number' ||
      !Number.isInteger(portValue) ||
      portValue < 1 ||
      portValue > 65535
    ) {
      return {malformed: refuse(payload, 'badPort')};
    }
    port = portValue;
  }
  const target: SshTarget = {kind: 'host', hostName: host.hostName};
  if (user !== undefined) {
    target.user = user;
  }
  if (port !== undefined) {
    target.port = port;
  }
  return {target};
}

/** The even-length lower-case hexadecimal string as its bytes. */
function hexBytes(payload: string): Uint8Array {
  const bytes = new Uint8Array(payload.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(payload.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Decodes an ssh-remote payload: empty, or whitespace or control, or one of the three forms. */
function decode(payload: string): DecodedOrMalformed<SshTarget> {
  if (payload === '') {
    return {malformed: refuse(payload, 'empty')};
  }
  if (WHITESPACE.test(payload)) {
    return {malformed: refuse(payload, 'whitespace')};
  }
  if (hasControl(payload)) {
    return {malformed: refuse(payload, 'control')};
  }
  if (payload.length % 2 === 0 && LOWER_HEX.test(payload)) {
    const decoded = decodeHex(payload);
    if ('malformed' in decoded) {
      return {malformed: decoded.malformed};
    }
    return {target: decoded.target, rawHostString: payload};
  }
  if (payload.startsWith('[') && payload.endsWith(']')) {
    return {
      target: {kind: 'host', hostName: payload.slice(1, -1)},
      rawHostString: payload,
    };
  }
  if (BARE_HOST.test(payload)) {
    return {target: {kind: 'host', hostName: payload}, rawHostString: payload};
  }
  return {target: {kind: 'alias', alias: payload}, rawHostString: payload};
}

/** Encodes an ssh-remote target: the alias, a bare host name, or the hex of the compact JSON. */
function encode(target: SshTarget): string {
  if (target.kind === 'alias') {
    return target.alias;
  }
  if (target.user === undefined && target.port === undefined) {
    return bareForm(target.hostName);
  }
  const json: HostJson = {hostName: target.hostName};
  if (target.user !== undefined) {
    json.user = target.user;
  }
  if (target.port !== undefined) {
    json.port = target.port;
  }
  return toHex(JSON.stringify(json));
}

/** A bare host name, bracketed again when it is an address with an IPv6 colon of its own. */
function bareForm(hostName: string): string {
  return hostName.includes(':') &&
    hostName.indexOf(':') !== hostName.lastIndexOf(':')
    ? `[${hostName}]`
    : hostName;
}

/** The compact JSON text as its lower-case hexadecimal form. */
function toHex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let outText = '';
  for (const byte of bytes) {
    outText += byte.toString(16).padStart(2, '0');
  }
  return outText;
}

/** The label the formatter shows: the present parts of `user@hostName:port`. */
function label(target: SshTarget): string {
  if (target.kind === 'alias') {
    return target.alias;
  }
  const head =
    target.user === undefined
      ? target.hostName
      : `${target.user}@${target.hostName}`;
  return target.port === undefined ? head : `${head}:${String(target.port)}`;
}

/** The ssh-remote codec of the contract. */
export const sshRemoteCodec: Codec<SshTarget> = {decode, encode, label};
