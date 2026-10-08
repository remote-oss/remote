import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  isStale,
  recordPath,
  replaceStale,
  serializeRecord,
  type HelperRecord,
} from '../../src/index.ts';
import {MemoryFilePort} from '../../src/testing/memory-file-port.ts';
import type {RegistryFilePort} from '../../src/registry/file-port.ts';

const RECORD: HelperRecord = {
  version: 1,
  namespace: 'ssh.connection',
  // eslint-disable-next-line id-length -- contract field name
  key: 'user@host:22',
  endpoint: '/tmp/record.sock',
  nonce: 'n1',
  // eslint-disable-next-line id-length -- contract field name
  pid: 100,
  startedAt: 1,
  payload: {},
};

// A helper that wins the race while the replacement is in flight.
const FRESH: HelperRecord = {
  version: 1,
  namespace: 'ssh.connection',
  // eslint-disable-next-line id-length -- contract field name
  key: 'user@host:22',
  endpoint: '/tmp/fresh.sock',
  nonce: 'fresh',
  // eslint-disable-next-line id-length -- contract field name
  pid: 777,
  startedAt: 3,
  payload: {},
};

// The file path the rows share.
const PATH = recordPath('/r', 'ssh.connection', 'user@host:22');

// A port whose remove step is followed by the given file, so the create either finds a rival's
// record (the caller joins with it) or a corrupt file (the caller proceeds as if it claimed).
function racingPort(
  inner: MemoryFilePort,
  rivalText: string,
): RegistryFilePort {
  return {
    createExclusive: (path, text) => inner.createExclusive(path, text),
    read: path => inner.read(path),
    remove: async path => {
      await inner.remove(path);
      inner.files.set(path, rivalText);
    },
  };
}

describe('isStale (card helper-01 table)', () => {
  it('isStale(r, {answered: true, nonceMatched: true, elapsed: 10}, 500) -> false', () => {
    strictEqual(
      isStale(
        RECORD,
        {answered: true, nonceMatched: true, elapsedMilliseconds: 10},
        500,
      ),
      false,
    );
  });

  it('isStale(r, {answered: false, nonceMatched: false, elapsed: 500}, 500) -> true', () => {
    strictEqual(
      isStale(
        RECORD,
        {answered: false, nonceMatched: false, elapsedMilliseconds: 500},
        500,
      ),
      true,
    );
  });

  it('isStale(r, {answered: true, nonceMatched: false, elapsed: 10}, 500) -> true', () => {
    strictEqual(
      isStale(
        RECORD,
        {answered: true, nonceMatched: false, elapsedMilliseconds: 10},
        500,
      ),
      true,
    );
  });

  it('isStale(r, {answered: true, nonceMatched: true, elapsed: 500}, 500) -> true (limit reached counts as late)', () => {
    strictEqual(
      isStale(
        RECORD,
        {answered: true, nonceMatched: true, elapsedMilliseconds: 500},
        500,
      ),
      true,
    );
  });
});

describe('replaceStale (card helper-01 table)', () => {
  it('replaceStale when the file exists -> the port saw remove then createExclusive', async () => {
    const port = new MemoryFilePort();
    port.files.set(PATH, serializeRecord(RECORD));
    await replaceStale(port, '/r', 'ssh.connection', 'user@host:22', FRESH);
    deepStrictEqual(
      port.calls.map(call => call.operation),
      ['remove', 'createExclusive'],
    );
  });

  it('replaceStale when the file exists -> outcome claimed', async () => {
    const port = new MemoryFilePort();
    port.files.set(PATH, serializeRecord(RECORD));
    const result = await replaceStale(
      port,
      '/r',
      'ssh.connection',
      'user@host:22',
      FRESH,
    );
    deepStrictEqual(result, {outcome: 'claimed'});
  });

  it('replaceStale when another claimer wins between remove and create -> existing with the other record', async () => {
    const inner = new MemoryFilePort();
    inner.files.set(PATH, serializeRecord(RECORD));
    const result = await replaceStale(
      racingPort(inner, serializeRecord(FRESH)),
      '/r',
      'ssh.connection',
      'user@host:22',
      FRESH,
    );
    deepStrictEqual(result, {outcome: 'existing', record: FRESH});
  });

  it('replaceStale when another claimer wins between remove and create -> no second remove', async () => {
    const inner = new MemoryFilePort();
    inner.files.set(PATH, serializeRecord(RECORD));
    await replaceStale(
      racingPort(inner, serializeRecord(FRESH)),
      '/r',
      'ssh.connection',
      'user@host:22',
      FRESH,
    );
    const removes = inner.calls.filter(
      call => call.operation === 'remove',
    ).length;
    strictEqual(removes, 1);
  });

  it('replaceStale when the file is absent -> claimed', async () => {
    const port = new MemoryFilePort();
    const result = await replaceStale(
      port,
      '/r',
      'ssh.connection',
      'user@host:22',
      RECORD,
    );
    deepStrictEqual(result, {outcome: 'claimed'});
  });

  it('replaceStale when a corrupt file appears after the remove -> claimed', async () => {
    const inner = new MemoryFilePort();
    inner.files.set(PATH, serializeRecord(RECORD));
    const result = await replaceStale(
      racingPort(inner, 'not json'),
      '/r',
      'ssh.connection',
      'user@host:22',
      FRESH,
    );
    deepStrictEqual(result, {outcome: 'claimed'});
  });

  it('replaceStale when the file is absent -> remove still called once (idempotent)', async () => {
    const port = new MemoryFilePort();
    await replaceStale(port, '/r', 'ssh.connection', 'user@host:22', RECORD);
    const removes = port.calls.filter(
      call => call.operation === 'remove',
    ).length;
    strictEqual(removes, 1);
  });
});

describe('MemoryFilePort (card helper-01 table)', () => {
  it('MemoryFilePort.createExclusive twice on one path -> created then exists', async () => {
    const port = new MemoryFilePort();
    const first = await port.createExclusive('/r/x.json', 'one');
    const second = await port.createExclusive('/r/x.json', 'two');
    deepStrictEqual([first, second], ['created', 'exists']);
  });
});
