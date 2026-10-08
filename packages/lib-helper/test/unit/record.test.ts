import {deepStrictEqual, ok, strictEqual, throws} from 'node:assert';
import {
  parseRecord,
  recordPath,
  serializeRecord,
  type HelperRecord,
} from '../../src/index.ts';

// The record the rows of this file share.
const RECORD: HelperRecord = {
  version: 1,
  namespace: 'ssh.connection',
  recordKey: 'user@host:22',
  endpoint: '/tmp/remote-oss-helper.sock',
  nonce: 'a1b2c3',
  startedByProcessId: 4242,
  startedAt: 1760000000000,
  payload: {user: 'dev', port: 22, shared: true},
};

/** A value the registry must refuse, typed as a record so that the serializer can be called with it. */
function asRecord(value: Record<string, unknown>): HelperRecord {
  // The serializer checks at run time what this cast hides from the compiler.
  return value as unknown as HelperRecord;
}

/** The sample record with `fields` laid over it, however wrong they are. */
function untyped(fields: Record<string, unknown>): HelperRecord {
  return asRecord({...RECORD, ...fields});
}

describe('record (card helper-01 table)', () => {
  it("recordPath('/r', 'ssh.connection', 'user@host:22') -> /r/ssh.connection/<32 hex>.json", () => {
    const path = recordPath('/r', 'ssh.connection', 'user@host:22');
    ok(/^\/r\/ssh\.connection\/[0-9a-f]{32}\.json$/.test(path));
  });

  it("recordPath('/r', 'ssh.connection', 'user@host:22') -> the same input twice gives the same path", () => {
    const path = recordPath('/r', 'ssh.connection', 'user@host:22');
    strictEqual(path, recordPath('/r', 'ssh.connection', 'user@host:22'));
  });

  it("recordPath('/r', 'ssh.connection', 'user@host:22') -> a different recordKey gives a different path", () => {
    const path = recordPath('/r', 'ssh.connection', 'user@host:22');
    const other = recordPath('/r', 'ssh.connection', 'user@host:2222');
    ok(path !== other);
  });

  it("recordPath('/r', 'ssh.connection', 'user@host:22') -> the recordKey text does not appear in the path", () => {
    strictEqual(
      recordPath('/r', 'ssh.connection', 'user@host:22').includes(
        'user@host:22',
      ),
      false,
    );
  });

  it('serializeRecord(valid) then parseRecord -> round-trips to a deep-equal record', () => {
    deepStrictEqual(parseRecord(serializeRecord(RECORD)), RECORD);
  });

  it('serializeRecord with an extra field -> throws RecordShapeError', () => {
    throws(() => serializeRecord(untyped({extra: 1})), {
      name: 'RecordShapeError',
    });
  });

  it('serializeRecord with payload {answer: {nested: 1}} -> throws RecordShapeError', () => {
    throws(() => serializeRecord(untyped({payload: {answer: {nested: 1}}})), {
      name: 'RecordShapeError',
    });
  });

  it('serializeRecord with an array payload -> throws RecordShapeError', () => {
    throws(() => serializeRecord(untyped({payload: [1, 'a']})), {
      name: 'RecordShapeError',
    });
  });

  it('parseRecord of a record with an array payload -> undefined', () => {
    strictEqual(
      parseRecord(JSON.stringify({...RECORD, payload: [1, 'a']})),
      undefined,
    );
  });

  it("serializeRecord with payload {password: 'x'} -> throws RecordShapeError", () => {
    throws(() => serializeRecord({...RECORD, payload: {password: 'x'}}), {
      name: 'RecordShapeError',
    });
  });

  it('serializeRecord with a refused payload key in another case (Answer) -> throws RecordShapeError', () => {
    throws(() => serializeRecord({...RECORD, payload: {Answer: 'x'}}), {
      name: 'RecordShapeError',
    });
  });

  it('serializeRecord with the nonce field missing -> throws RecordShapeError', () => {
    const withoutNonce: Record<string, unknown> = {...RECORD};
    delete withoutNonce.nonce;
    throws(() => serializeRecord(asRecord(withoutNonce)), {
      name: 'RecordShapeError',
    });
  });

  it("parseRecord('not json') -> undefined", () => {
    strictEqual(parseRecord('not json'), undefined);
  });

  it("parseRecord('null') -> undefined", () => {
    strictEqual(parseRecord('null'), undefined);
  });

  it("parseRecord('[1]') -> undefined (a JSON array, not a record)", () => {
    strictEqual(parseRecord('[1]'), undefined);
  });

  it("parseRecord('42') -> undefined (a JSON number, not a record)", () => {
    strictEqual(parseRecord('42'), undefined);
  });

  it('parseRecord of a record whose payload is a string -> undefined', () => {
    const payload = JSON.stringify({
      ...JSON.parse(serializeRecord(RECORD)),
      payload: 'x',
    });
    strictEqual(parseRecord(payload), undefined);
  });

  it('parseRecord of a record with a wrong-typed field (namespace a number) -> undefined', () => {
    const wrongTyped = serializeRecord(RECORD).replace(
      '"namespace":"ssh.connection"',
      '"namespace":5',
    );
    strictEqual(parseRecord(wrongTyped), undefined);
  });

  it('parseRecord of a record with an unknown field -> undefined', () => {
    const unknown = JSON.stringify({
      ...JSON.parse(serializeRecord(RECORD)),
      extra: 1,
    });
    strictEqual(parseRecord(unknown), undefined);
  });

  it("parseRecord of a record whose payload holds {password: 'p'} -> undefined", () => {
    const payload = serializeRecord(RECORD).replace('}', ',"password":"p"}');
    strictEqual(parseRecord(payload), undefined);
  });

  it('parseRecord of a record with version: 2 -> undefined', () => {
    const versioned = serializeRecord(RECORD).replace(
      '"version":1',
      '"version":2',
    );
    strictEqual(parseRecord(versioned), undefined);
  });

  it('parseRecord of a record missing nonce -> undefined', () => {
    const without = serializeRecord(RECORD).replace('"nonce":"a1b2c3",', '');
    strictEqual(parseRecord(without), undefined);
  });
});
