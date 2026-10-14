import {strictEqual} from 'node:assert';
import {removeOwnRecord, serializeRecord} from '../../src/index.ts';
import {MemoryFilePort} from '../../src/testing/memory-file-port.ts';

const FILE = '/registry/ssh.connection/record.json';

function recordWith(nonce: string): string {
  return serializeRecord({
    version: 1,
    namespace: 'ssh.connection',
    recordKey: 'user@host:22',
    endpoint: '/run/rh.sock',
    nonce,
    startedByProcessId: 1,
    startedAt: 0,
    payload: {},
  });
}

describe('removeOwnRecord', () => {
  let files: MemoryFilePort;

  beforeEach(() => {
    files = new MemoryFilePort();
  });

  it('contracts X1: removeOwnRecord removes a record with its nonce', async () => {
    files.files.set(FILE, recordWith('mine'));
    await removeOwnRecord(files, FILE, 'mine');
    strictEqual(files.files.has(FILE), false);
  });

  it('contracts X1: removeOwnRecord keeps a record with another nonce', async () => {
    files.files.set(FILE, recordWith('theirs'));
    await removeOwnRecord(files, FILE, 'mine');
    strictEqual(files.files.has(FILE), true);
  });

  it('contracts X1: removeOwnRecord keeps a file that does not parse', async () => {
    files.files.set(FILE, '{broken');
    await removeOwnRecord(files, FILE, 'mine');
    strictEqual(files.files.has(FILE), true);
  });

  it('contracts X1: removeOwnRecord with no file is done', async () => {
    await removeOwnRecord(files, FILE, 'mine');
    strictEqual(
      files.calls.some(call => call.operation === 'remove'),
      false,
    );
  });
});
