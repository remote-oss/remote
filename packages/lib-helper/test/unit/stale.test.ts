import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import {
  isStale,
  recordPath,
  type RegistryFilePort,
  replaceStale,
  serializeRecord,
} from '../../src/index.ts';
import {MemoryFilePort} from '../../src/testing/memory-file-port.ts';
import {sampleRecord} from './record-fixture.ts';

const PATH = recordPath('/r', 'ssh.connection', 'user@host:22');

/** A port that logs its calls and, on remove, lets `beforeCreate` stand for another claimer. */
class LoggingPort implements RegistryFilePort {
  readonly calls: string[] = [];
  readonly inner = new MemoryFilePort();
  beforeCreate: () => void = () => undefined;

  createExclusive(path: string, text: string): Promise<'created' | 'exists'> {
    this.calls.push('createExclusive');
    this.beforeCreate();
    return this.inner.createExclusive(path, text);
  }

  read(path: string): Promise<string | undefined> {
    return this.inner.read(path);
  }

  remove(path: string): Promise<void> {
    this.calls.push('remove');
    return this.inner.remove(path);
  }
}

function replace(port: RegistryFilePort) {
  return replaceStale(
    port,
    '/r',
    'ssh.connection',
    'user@host:22',
    sampleRecord('new'),
  );
}

describe('isStale', () => {
  const record = sampleRecord();

  it('keeps a helper that answered in time with its nonce', () => {
    strictEqual(
      isStale(
        record,
        {answered: true, nonceMatched: true, elapsedMilliseconds: 10},
        500,
      ),
      false,
    );
  });

  it('replaces a helper that did not answer', () => {
    strictEqual(
      isStale(
        record,
        {answered: false, nonceMatched: false, elapsedMilliseconds: 500},
        500,
      ),
      true,
    );
  });

  it('replaces a helper that answered with another nonce', () => {
    strictEqual(
      isStale(
        record,
        {answered: true, nonceMatched: false, elapsedMilliseconds: 10},
        500,
      ),
      true,
    );
  });

  it('counts an answer at the limit as late', () => {
    strictEqual(
      isStale(
        record,
        {answered: true, nonceMatched: true, elapsedMilliseconds: 500},
        500,
      ),
      true,
    );
  });
});

describe('replaceStale', () => {
  let port: LoggingPort;

  beforeEach(() => {
    port = new LoggingPort();
  });

  it('removes the stale record, then claims the key', async () => {
    port.inner.files.set(PATH, serializeRecord(sampleRecord('old')));
    deepStrictEqual(
      [await replace(port), port.calls],
      [{outcome: 'claimed'}, ['remove', 'createExclusive']],
    );
  });

  it('yields to a helper that claims the key in between, removing once', async () => {
    port.beforeCreate = () => {
      port.inner.files.set(PATH, serializeRecord(sampleRecord('other')));
    };
    deepStrictEqual(
      [
        await replace(port),
        port.calls.filter(call => call === 'remove').length,
      ],
      [{outcome: 'existing', record: sampleRecord('other')}, 1],
    );
  });

  it('claims an absent record, still removing once', async () => {
    deepStrictEqual(
      [await replace(port), port.calls],
      [{outcome: 'claimed'}, ['remove', 'createExclusive']],
    );
  });

  it('fails when the record written in between is unreadable', async () => {
    port.beforeCreate = () => {
      port.inner.files.set(PATH, '{broken');
    };
    await rejects(replace(port), {
      message:
        "helper record of 'ssh.connection' is unreadable after its replacement",
    });
  });
});
