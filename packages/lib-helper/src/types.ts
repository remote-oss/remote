/**
 * One record per helper: what a helper is (its endpoint and nonce), who runs it (its process id),
 * and a small payload the extension may read. A per-user registry holds no secret beyond the nonce.
 */
export interface HelperRecord {
  version: 1;
  namespace: string;
  key: string;
  endpoint: string;
  nonce: string;
  pid: number;
  startedAt: number;
  payload: Record<string, string | number | boolean>;
}

/** How a helper ends once its last lease is gone, as data rather than a per-consumer branch. */
export type EndPolicy =
  | {kind: 'graceAfterLastLease'; milliseconds: number}
  | {kind: 'delayedCheckAfterLastLease'; milliseconds: number; action: string}
  | {kind: 'idleAfterLastLease'; milliseconds: number};

/** The record's fields in the order they are written to the file. */
const FIELD_ORDER = [
  'version',
  'namespace',
  'key',
  'endpoint',
  'nonce',
  'pid',
  'startedAt',
  'payload',
] as const;

/** Payload keys that never belong in a record: prompt answers and credentials, case-insensitive. */
const REFUSED_PAYLOAD_KEYS = new Set([
  'password',
  'passphrase',
  'token',
  'secret',
  'answer',
]);

/** Raised when a record's shape is wrong for the registry. */
export class RecordShapeError extends Error {
  /** What is wrong with the record's shape. */
  readonly problem: string;

  /** Keep the problem as the message. */
  constructor(problem: string) {
    super(problem);
    this.name = 'RecordShapeError';
    this.problem = problem;
  }
}

/**
 * Write the record to a line of JSON, keys in the registry's order. It rejects a field the
 * registry does not know, a field the record is missing, a payload value that is not a plain
 * string, number or boolean, and a payload key that would carry a prompt answer or credential.
 */
export function serializeRecord(record: HelperRecord): string {
  if (!isHelperRecordShape(record)) {
    throw new RecordShapeError('a missing or unknown field');
  }
  return JSON.stringify({
    version: record.version,
    namespace: record.namespace,
    // eslint-disable-next-line id-length -- the record's field name, fixed by the contract
    key: record.key,
    endpoint: record.endpoint,
    nonce: record.nonce,
    // eslint-disable-next-line id-length -- the record's field name, fixed by the contract
    pid: record.pid,
    startedAt: record.startedAt,
    payload: record.payload,
  });
}

/**
 * The one shape check the writer and the reader share, so the reader is as strict as the
 * writer: a plain object with exactly the eight fields, the string fields as strings, the number
 * fields as numbers, and a payload of primitives that carries no refused key.
 */
function isHelperRecordShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const fields = value as Record<string, unknown>;
  for (const name of Object.keys(fields)) {
    if (!(FIELD_ORDER as readonly string[]).includes(name)) {
      return false;
    }
  }
  for (const name of FIELD_ORDER) {
    if (!(name in fields)) {
      return false;
    }
  }
  if (
    fields.version !== 1 ||
    typeof fields.namespace !== 'string' ||
    typeof fields.key !== 'string' ||
    typeof fields.endpoint !== 'string' ||
    typeof fields.nonce !== 'string' ||
    typeof fields.pid !== 'number' ||
    typeof fields.startedAt !== 'number'
  ) {
    return false;
  }
  const payload = fields.payload;
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  for (const [name, value] of Object.entries(
    payload as Record<string, unknown>,
  )) {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      return false;
    }
    if (REFUSED_PAYLOAD_KEYS.has(name.toLowerCase())) {
      return false;
    }
  }
  return true;
}

/**
 * Read a record back from its JSON. It returns `undefined` on any shape error, so a corrupt or
 * foreign file is never mistaken for a live helper.
 */
export function parseRecord(text: string): HelperRecord | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isHelperRecordShape(data)) {
    return undefined;
  }
  return data as HelperRecord;
}
