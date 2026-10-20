/**
 * @fileoverview What a dev container configuration file says, as far as choosing one needs it: its text, the tolerant
 * read of its JSON-with-comments, the label of its row and whether it names a container source.
 */

import path from 'node:path';
import {parse} from 'jsonc-parser';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import type {CandidatePlace} from './discovery.ts';

/** The English templates of the labels a place falls back to. */
const LABEL_TEMPLATES = {
  S224: 'Main',
  S280: 'Project Root',
} as const;

/** The byte-order marks of UTF-8, UTF-16 little endian and UTF-16 big endian. */
const UTF8_MARK = [0xef, 0xbb, 0xbf] as const;
const UTF16_LITTLE_MARK = [0xff, 0xfe] as const;
const UTF16_BIG_MARK = [0xfe, 0xff] as const;

/** Whether `bytes` start with `mark`. */
function startsWith(bytes: Uint8Array, mark: readonly number[]): boolean {
  return mark.every((byte, index) => bytes[index] === byte);
}

/** The bytes of a big endian UTF-16 text as little endian: each pair of bytes swapped. */
function swapped(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length - (bytes.length % 2));
  for (let index = 0; index < result.length; index += 2) {
    result[index] = bytes[index + 1] ?? 0;
    result[index + 1] = bytes[index] ?? 0;
  }
  return result;
}

/** The text of a configuration file: UTF-8, with a leading byte-order mark of UTF-8, UTF-16 LE or UTF-16 BE decoded. */
export function decodeConfiguration(bytes: Uint8Array): string {
  if (startsWith(bytes, UTF16_LITTLE_MARK)) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (startsWith(bytes, UTF16_BIG_MARK)) {
    return new TextDecoder('utf-16le').decode(swapped(bytes.subarray(2)));
  }
  return new TextDecoder('utf-8').decode(
    startsWith(bytes, UTF8_MARK) ? bytes.subarray(UTF8_MARK.length) : bytes,
  );
}

/** The tolerant read: the JSONC object, or undefined when no object can be read at all. */
export function parseConfiguration(
  text: string,
): Record<string, unknown> | undefined {
  const parsed: unknown = parse(text, [], {allowTrailingComma: true});
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/** The picker label of a candidate: its `name`, or the fallback of its place. */
export function labelOf(
  place: CandidatePlace,
  parsed: Record<string, unknown> | undefined,
  translate: Translate,
): string {
  const name = parsed?.name;
  if (typeof name === 'string' && name !== '') {
    return name;
  }
  if (place.kind === 'dotfile') {
    return filled(translate, LABEL_TEMPLATES.S280);
  }
  return place.kind === 'main'
    ? filled(translate, LABEL_TEMPLATES.S224)
    : place.name;
}

/** Whether the configuration names a container source: `image`, `dockerFile`, `build.dockerfile` or `dockerComposeFile`. */
export function hasContainerSource(parsed: Record<string, unknown>): boolean {
  const {build} = parsed;
  return (
    parsed.image !== undefined ||
    parsed.dockerFile !== undefined ||
    parsed.dockerComposeFile !== undefined ||
    (typeof build === 'object' &&
      build !== null &&
      !Array.isArray(build) &&
      'dockerfile' in build)
  );
}

/**
 * The absolute path of the Dockerfile the configuration names: `build.dockerfile`, else the legacy `dockerFile`, read
 * against the folder of the configuration file. None when it names no Dockerfile, or when its text holds a variable
 * (`${`) that only the CLI can substitute.
 */
export function dockerfileOf(
  parsed: Record<string, unknown>,
  configFile: string,
): string | undefined {
  const {build} = parsed;
  const named =
    typeof build === 'object' && build !== null && !Array.isArray(build)
      ? (build as Record<string, unknown>).dockerfile
      : undefined;
  const value = typeof named === 'string' ? named : parsed.dockerFile;
  return typeof value === 'string' && !value.includes('${')
    ? path.resolve(path.dirname(configFile), value)
    : undefined;
}
