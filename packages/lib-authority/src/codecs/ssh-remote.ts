/**
 * @fileoverview The ssh-remote codec: a JSON host, as the lower-case hex of a compact
 * {hostName, user?, port?}, and every other payload as a plain host string taken as written
 * (the plain form keeps an upper-case letter or a /, + or \ separator plain out).
 */
import {TextDecoder, TextEncoder} from 'node:util';
import type {
  Codec,
  DecodedOrMalformed,
  MalformedAuthority,
  SshTarget,
} from './types.ts';

const FAMILY = 'ssh-remote';

/** Lower-case hexadecimal with even length. */
const LOWER_HEX = /^[0-9a-f]+$/;

// A blank or separator space that makes a host name malformed with reason whitespace: the ASCII blanks, the two
// separator characters, and every space separator, U+0020 included.
const WHITESPACE = /[\t\n\r \u2028\u2029\p{Zs}]/u;

/**
 * A character that keeps an encoded text plain out: an upper-case letter in any script, or one of
 * the three separators we never leave plain.
 */
const PLAIN_REFUSERS = /\p{Uppercase_Letter}|[/+\\]/u;

/** A refusal, carrying the payload and the reason the contract names. */
function refuse(payload: string, reason: string): MalformedAuthority {
  return {family: FAMILY, payload, reason};
}

/** Whether the text holds a control character: the ASCII controls and DEL, or a C1 control (U+0080 to U+009F). */
function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/** The host-name refusal for a piece of text, or none: whitespace before control, the reasons in that order. */
function hostRefusal(
  name: string,
  payload: string,
): MalformedAuthority | undefined {
  if (WHITESPACE.test(name)) {
    return refuse(payload, 'whitespace');
  }
  if (hasControl(name)) {
    return refuse(payload, 'control');
  }
  return undefined;
}

/** The compact JSON form as it decodes from the hex. */
interface HostJson {
  hostName: unknown;
  user?: unknown;
  port?: unknown;
}

/** The even-length lower-case hexadecimal string as its bytes. */
function hexBytes(payload: string): Uint8Array {
  const bytes = new Uint8Array(payload.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(payload.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** The port of a JSON payload: an integer 1-65535, or a string of digits in that range. */
function decodePort(
  portValue: unknown,
  payload: string,
): {port?: number} | {malformed: MalformedAuthority} {
  if (portValue === undefined) {
    return {};
  }
  let value: number;
  if (typeof portValue === 'number') {
    if (!Number.isInteger(portValue)) {
      return {malformed: refuse(payload, 'badPort')};
    }
    value = portValue;
  } else if (typeof portValue === 'string' && /^\d+$/.test(portValue)) {
    value = Number(portValue);
  } else {
    return {malformed: refuse(payload, 'badPort')};
  }
  if (value < 1 || value > 65535) {
    return {malformed: refuse(payload, 'badPort')};
  }
  return {port: value};
}

/**
 * The JSON form, when the payload is even-length lower-case hex whose bytes are valid UTF-8 that
 * JSON.parse yields as an object. A decoded text that starts with a byte-order mark is a refusal of its own.
 * Anything else that is not a JSON object is not the JSON form (there is no badHex) and the caller reads
 * it as plain.
 */
function decodeJson(
  payload: string,
): DecodedOrMalformed<SshTarget> | undefined {
  if (payload.length % 2 !== 0 || !LOWER_HEX.test(payload)) {
    return undefined;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(
      hexBytes(payload),
    );
  } catch {
    return undefined;
  }
  if (text.codePointAt(0) === 0xfeff) {
    // A byte-order mark before the opening brace of the object is a refusal of its own; before
    // anything else the payload is the plain host as written.
    if (text.slice(1).startsWith('{')) {
      return {malformed: refuse(payload, 'badJson')};
    }
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const host = parsed as HostJson;
  if (typeof host.hostName !== 'string' || host.hostName === '') {
    return {malformed: refuse(payload, 'badJson')};
  }
  const nameRefusal = hostRefusal(host.hostName, payload);
  if (nameRefusal !== undefined) {
    return {malformed: nameRefusal};
  }
  const userValue = host.user;
  if (userValue !== undefined && typeof userValue !== 'string') {
    return {malformed: refuse(payload, 'badJson')};
  }
  const portOutcome = decodePort(host.port, payload);
  if ('malformed' in portOutcome) {
    return {malformed: portOutcome.malformed};
  }
  const target: SshTarget = {kind: 'host', hostName: host.hostName};
  if (userValue !== undefined && userValue !== '') {
    target.user = userValue;
  }
  if (portOutcome.port !== undefined) {
    target.port = portOutcome.port;
  }
  return {target, rawHostString: payload};
}

/** Decodes an ssh-remote payload: empty, or a host-name refusal, or one of the two forms. */
function decode(payload: string): DecodedOrMalformed<SshTarget> {
  if (payload === '') {
    return {malformed: refuse(payload, 'empty')};
  }
  const plainRefusal = hostRefusal(payload, payload);
  if (plainRefusal !== undefined) {
    return {malformed: plainRefusal};
  }
  const json = decodeJson(payload);
  if (json !== undefined) {
    return json;
  }
  return {target: {kind: 'plain', text: payload}, rawHostString: payload};
}

/**
 * Encodes an ssh-remote target: plain, exactly as written, when there is no user and
 * no port and the text carries no upper-case letter and none of the three separators; the hex of the
 * compact JSON otherwise. Brackets are never added or stripped.
 */
function encode(target: SshTarget): string {
  if (target.kind === 'host') {
    const json: HostJson = {hostName: target.hostName};
    if (target.user !== undefined && target.user !== '') {
      json.user = target.user;
    }
    if (target.port !== undefined) {
      json.port = target.port;
    }
    const plain =
      (target.user === undefined || target.user === '') &&
      target.port === undefined &&
      !PLAIN_REFUSERS.test(target.hostName);
    return plain ? target.hostName : toHex(JSON.stringify(json));
  }
  return PLAIN_REFUSERS.test(target.text)
    ? toHex(JSON.stringify({hostName: target.text}))
    : target.text;
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

/** The label the formatter shows: the plain text, or the present parts of `user@hostName:port`. */
function label(target: SshTarget): string {
  if (target.kind === 'plain') {
    return target.text;
  }
  const user = target.user;
  const head =
    user !== undefined && user !== ''
      ? `${user}@${target.hostName}`
      : target.hostName;
  return target.port === undefined ? head : `${head}:${String(target.port)}`;
}

/** The ssh-remote codec of the contract. */
export const sshRemoteCodec: Codec<SshTarget> = {decode, encode, label};
