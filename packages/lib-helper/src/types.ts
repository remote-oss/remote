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
 * registry does not know, a payload value that is not a plain string, number or boolean, and a
 * payload key that would carry a prompt answer or credential.
 */
export function serializeRecord(record: HelperRecord): string {
  const fields = record as unknown as Record<string, unknown>;
  for (const name of Object.keys(fields)) {
    if (!(FIELD_ORDER as readonly string[]).includes(name)) {
      throw new RecordShapeError(`unknown field ${name}`);
    }
  }
  for (const [name, value] of Object.entries(record.payload)) {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new RecordShapeError(`non-primitive payload value ${name}`);
    }
    if (REFUSED_PAYLOAD_KEYS.has(name.toLowerCase())) {
      throw new RecordShapeError(`refused payload key ${name}`);
    }
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
 * Read a record back from its JSON. It returns `undefined` on any shape error or when the version
 * is not 1, so a corrupt or foreign file is never mistaken for a live helper.
 */
export function parseRecord(text: string): HelperRecord | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  const fields = data as Record<string, unknown>;
  if (fields.version !== 1) {
    return undefined;
  }
  for (const name of FIELD_ORDER) {
    if (!(name in fields)) {
      return undefined;
    }
  }
  return data as HelperRecord;
}
