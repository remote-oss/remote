import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  claim,
  recordPath,
  serializeRecord,
  type HelperRecord,
} from '../../src/index.ts';
import {MemoryFilePort} from '../../src/testing/memory-file-port.ts';
import type {RegistryFilePort} from '../../src/registry/file-port.ts';

// A port whose read finds nothing even though createExclusive saw the file: a concurrent
// process removed it between the two calls, so there is no record to join with.
function readVanishes(inner: MemoryFilePort): RegistryFilePort {
  return {
    createExclusive: (path, text) => inner.createExclusive(path, text),
    read: path => {
      // The competing file is taken away before the read, so it is already gone.
      inner.files.delete(path);
      return Promise.resolve(undefined);
    },
    remove: path => inner.remove(path),
  };
}

// The two records the rows share.
const FIRST: HelperRecord = {
  version: 1,
  namespace: 'ssh.connection',
  // eslint-disable-next-line id-length -- contract field name
  key: 'user@host:22',
  endpoint: '/tmp/first.sock',
  nonce: 'n1',
  // eslint-disable-next-line id-length -- contract field name
  pid: 100,
  startedAt: 1,
  payload: {},
};

const SECOND: HelperRecord = {
  version: 1,
  namespace: 'ssh.connection',
  // eslint-disable-next-line id-length -- contract field name
  key: 'user@host:22',
  endpoint: '/tmp/second.sock',
  nonce: 'n2',
  // eslint-disable-next-line id-length -- contract field name
  pid: 200,
  startedAt: 2,
  payload: {},
};

// The file path the rows share.
const PATH = recordPath('/r', 'ssh.connection', 'user@host:22');

// Both claimers for the same key, in one turn.
function concurrentClaims(port: MemoryFilePort) {
  return Promise.all([
    claim(port, '/r', 'ssh.connection', 'user@host:22', FIRST),
    claim(port, '/r', 'ssh.connection', 'user@host:22', SECOND),
  ]);
}

describe('claim (card helper-01 table)', () => {
  it('claim on an empty port -> claimed', async () => {
    const port = new MemoryFilePort();
    const result = await claim(
      port,
      '/r',
      'ssh.connection',
      'user@host:22',
      FIRST,
    );
    deepStrictEqual(result, {outcome: 'claimed'});
  });

  it('claim on an empty port -> the file exists with serializeRecord(record)', async () => {
    const port = new MemoryFilePort();
    await claim(port, '/r', 'ssh.connection', 'user@host:22', FIRST);
    strictEqual(port.files.get(PATH), serializeRecord(FIRST));
  });

  it('claim when the file exists with a valid record -> existing with that record (parsed)', async () => {
    const port = new MemoryFilePort();
    port.files.set(PATH, serializeRecord(SECOND));
    const result = await claim(
      port,
      '/r',
      'ssh.connection',
      'user@host:22',
      FIRST,
    );
    deepStrictEqual(result, {outcome: 'existing', record: SECOND});
  });

  it('claim when the file exists with a valid record -> the file unchanged', async () => {
    const port = new MemoryFilePort();
    const original = serializeRecord(SECOND);
    port.files.set(PATH, original);
    await claim(port, '/r', 'ssh.connection', 'user@host:22', FIRST);
    strictEqual(port.files.get(PATH), original);
  });

  it('claim when the file exists with corrupt text -> corrupt', async () => {
    const port = new MemoryFilePort();
    port.files.set(PATH, 'not json');
    const result = await claim(
      port,
      '/r',
      'ssh.connection',
      'user@host:22',
      FIRST,
    );
    deepStrictEqual(result, {outcome: 'corrupt'});
  });

  it('claim when the file exists with corrupt text -> the file unchanged', async () => {
    const port = new MemoryFilePort();
    port.files.set(PATH, 'not json');
    await claim(port, '/r', 'ssh.connection', 'user@host:22', FIRST);
    strictEqual(port.files.get(PATH), 'not json');
  });

  it('two concurrent claim calls on the same key -> exactly one claimed', async () => {
    const results = await concurrentClaims(new MemoryFilePort());
    strictEqual(
      results.filter(result => result.outcome === 'claimed').length,
      1,
    );
  });

  it('two concurrent claim calls on the same key -> the other existing with the winner record', async () => {
    const results = await concurrentClaims(new MemoryFilePort());
    deepStrictEqual(
      results.filter(result => result.outcome === 'existing'),
      [{outcome: 'existing', record: FIRST}],
    );
  });

  it('claim when the file vanishes between the create and the read -> corrupt', async () => {
    const inner = new MemoryFilePort();
    inner.files.set(PATH, serializeRecord(SECOND));
    const result = await claim(
      readVanishes(inner),
      '/r',
      'ssh.connection',
      'user@host:22',
      FIRST,
    );
    deepStrictEqual(result, {outcome: 'corrupt'});
  });
});
