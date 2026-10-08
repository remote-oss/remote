/**
 * @fileoverview The registry's record files: where a record lives, its text, and the claim of a key by the first
 * helper that writes its record.
 */

import {createHash} from 'node:crypto';
import type {HelperRecord} from '../types.ts';
import type {RegistryFilePort} from './file-port.ts';

/** A record that does not have the shape the registry writes. */
export class RecordShapeError extends Error {
  /** An error naming what is wrong with the record. */
  constructor(problem: string) {
    super(`helper record: ${problem}`);
    this.name = 'RecordShapeError';
  }
}

/** The fields of a record, in the order the registry writes them. */
const RECORD_FIELDS = [
  'version',
  'namespace',
  'subject',
  'endpoint',
  'nonce',
  'processId',
  'startedAt',
  'payload',
] as const;

const STRING_FIELDS = ['namespace', 'subject', 'endpoint', 'nonce'] as const;

const NUMBER_FIELDS = ['processId', 'startedAt'] as const;

/** Payload keys that would hold a secret; a record is readable by any process of the user. */
const REFUSED_PAYLOAD_KEYS = new Set([
  'password',
  'passphrase',
  'token',
  'secret',
  'answer',
]);

const KEY_DIGEST_LENGTH = 32;

/** The record file of a key: its namespace folder and the first 32 hex digits of the key's SHA-256. */
export function recordPath(
  folder: string,
  namespace: string,
  subject: string,
): string {
  const digest = createHash('sha256').update(subject).digest('hex');
  return `${folder}/${namespace}/${digest.slice(0, KEY_DIGEST_LENGTH)}.json`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function payloadProblem(payload: unknown): string | undefined {
  if (!isPlainObject(payload)) {
    return 'payload is not an object';
  }
  for (const [name, value] of Object.entries(payload)) {
    if (REFUSED_PAYLOAD_KEYS.has(name.toLowerCase())) {
      return `payload key '${name}' would hold a secret`;
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      return `payload value '${name}' is not a string, number or boolean`;
    }
  }
  return undefined;
}

/** What is wrong with `value` as a record, or undefined when it is one. */
function shapeProblem(value: unknown): string | undefined {
  if (!isPlainObject(value)) {
    return 'not an object';
  }
  const names = Object.keys(value);
  const unknown = names.find(
    name => !(RECORD_FIELDS as readonly string[]).includes(name),
  );
  if (unknown !== undefined) {
    return `unknown field '${unknown}'`;
  }
  const missing = RECORD_FIELDS.find(name => !names.includes(name));
  if (missing !== undefined) {
    return `missing field '${missing}'`;
  }
  if (value.version !== 1) {
    return 'version is not 1';
  }
  const notString = STRING_FIELDS.find(name => typeof value[name] !== 'string');
  if (notString !== undefined) {
    return `${notString} is not a string`;
  }
  const notNumber = NUMBER_FIELDS.find(name => typeof value[name] !== 'number');
  if (notNumber !== undefined) {
    return `${notNumber} is not a number`;
  }
  return payloadProblem(value.payload);
}

/** The record's text, its fields in the registry's order; throws RecordShapeError for a record of another shape. */
export function serializeRecord(record: HelperRecord): string {
  const problem = shapeProblem(record);
  if (problem !== undefined) {
    throw new RecordShapeError(problem);
  }
  return JSON.stringify(
    Object.fromEntries(RECORD_FIELDS.map(name => [name, record[name]])),
  );
}

/** The record a text holds, or undefined when it is not JSON or not a record of this version. */
export function parseRecord(text: string): HelperRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Text that is not JSON is no record.
    return undefined;
  }
  // shapeProblem has checked every field of the record type.
  return shapeProblem(value) === undefined
    ? (value as HelperRecord)
    : undefined;
}

/** How a claim ended: this helper holds the key, another helper does, or the key's file is unreadable. */
export type ClaimOutcome =
  | {outcome: 'claimed'}
  | {outcome: 'existing'; record: HelperRecord}
  | {outcome: 'corrupt'};

/** Writes the record unless the key's file exists; otherwise reads the record that holds the key. */
export async function claim(
  port: RegistryFilePort,
  folder: string,
  namespace: string,
  subject: string,
  record: HelperRecord,
): Promise<ClaimOutcome> {
  const path = recordPath(folder, namespace, subject);
  if (
    (await port.createExclusive(path, serializeRecord(record))) === 'created'
  ) {
    return {outcome: 'claimed'};
  }
  const existing = parseRecord((await port.read(path)) ?? '');
  return existing === undefined
    ? {outcome: 'corrupt'}
    : {outcome: 'existing', record: existing};
}
