import {
  deepStrictEqual,
  notStrictEqual,
  strictEqual,
  throws,
} from 'node:assert';
import {
  type HelperRecord,
  parseRecord,
  RecordShapeError,
  recordPath,
  serializeRecord,
} from '../../src/index.ts';
import {sampleRecord} from './record-fixture.ts';

/** A record the type would not allow, which the registry must refuse. */
function untyped(fields: Record<string, unknown>): HelperRecord {
  const value: unknown = {...sampleRecord(), ...fields};
  // The registry checks at run time what this cast hides from the compiler.
  return value as HelperRecord;
}

function withPayload(payload: unknown): HelperRecord {
  return untyped({payload});
}

describe('recordPath', () => {
  it('names the record after the namespace and 32 hex digits of the key', () => {
    strictEqual(
      /^\/r\/ssh\.connection\/[0-9a-f]{32}\.json$/.test(
        recordPath('/r', 'ssh.connection', 'user@host:22'),
      ),
      true,
    );
  });

  it('gives the same key the same path', () => {
    strictEqual(
      recordPath('/r', 'ssh.connection', 'user@host:22'),
      recordPath('/r', 'ssh.connection', 'user@host:22'),
    );
  });

  it('gives another key another path', () => {
    notStrictEqual(
      recordPath('/r', 'ssh.connection', 'user@host:22'),
      recordPath('/r', 'ssh.connection', 'user@host:23'),
    );
  });

  it('never shows the key in the path', () => {
    strictEqual(
      recordPath('/r', 'ssh.connection', 'user@host:22').includes('host'),
      false,
    );
  });
});

describe('serializeRecord and parseRecord', () => {
  it('round-trips a record', () => {
    deepStrictEqual(
      parseRecord(serializeRecord(sampleRecord())),
      sampleRecord(),
    );
  });

  it('writes the fields in the registry order', () => {
    strictEqual(
      serializeRecord(sampleRecord()),
      '{"version":1,"namespace":"ssh.connection","subject":"user@host:22","endpoint":"/run/helper.sock",' +
        '"nonce":"nonce-1","processId":4242,"startedAt":1700000000000,' +
        '"payload":{"port":49152,"host":"host","shared":true}}',
    );
  });

  it('refuses a nested payload value under an ordinary key', () => {
    throws(
      () => serializeRecord(withPayload({options: {nested: 1}})),
      RecordShapeError,
    );
  });

  it('refuses an extra field', () => {
    throws(() => serializeRecord(untyped({extra: 1})), RecordShapeError);
  });

  it('refuses a nested payload value', () => {
    throws(
      () => serializeRecord(withPayload({answer: {nested: 1}})),
      RecordShapeError,
    );
  });

  for (const secretKey of [
    'password',
    'passphrase',
    'token',
    'secret',
    'Answer',
  ]) {
    it(`refuses the payload key ${secretKey}`, () => {
      throws(
        () => serializeRecord(withPayload({[secretKey]: 'x'})),
        RecordShapeError,
      );
    });
  }

  it('refuses a payload that is not an object', () => {
    throws(() => serializeRecord(withPayload([])), RecordShapeError);
  });

  it('reads no record from text that is not JSON', () => {
    strictEqual(parseRecord('not json'), undefined);
  });

  it('reads no record of another version', () => {
    strictEqual(
      parseRecord(JSON.stringify({...sampleRecord(), version: 2})),
      undefined,
    );
  });

  it('reads no record without a nonce', () => {
    const withoutNonce: Partial<HelperRecord> = sampleRecord();
    delete withoutNonce.nonce;
    strictEqual(parseRecord(JSON.stringify(withoutNonce)), undefined);
  });

  it('reads no record whose text is not an object', () => {
    strictEqual(parseRecord('[]'), undefined);
  });

  it('reads no record whose string field is not a string', () => {
    strictEqual(
      parseRecord(JSON.stringify({...sampleRecord(), endpoint: 7})),
      undefined,
    );
  });

  it('reads no record whose number field is not a number', () => {
    strictEqual(
      parseRecord(JSON.stringify({...sampleRecord(), processId: '4242'})),
      undefined,
    );
  });
});
