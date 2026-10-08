import {deepStrictEqual, strictEqual} from 'node:assert';
import {claim, recordPath, serializeRecord} from '../../src/index.ts';
import {MemoryFilePort} from '../../src/testing/memory-file-port.ts';
import {sampleRecord} from './record-fixture.ts';

const PATH = recordPath('/r', 'ssh.connection', 'user@host:22');

function claimWith(port: MemoryFilePort, nonce = 'nonce-1') {
  return claim(
    port,
    '/r',
    'ssh.connection',
    'user@host:22',
    sampleRecord(nonce),
  );
}

describe('claim', () => {
  let port: MemoryFilePort;

  beforeEach(() => {
    port = new MemoryFilePort();
  });

  it('claims a free key', async () => {
    deepStrictEqual(await claimWith(port), {outcome: 'claimed'});
  });

  it('writes the record of a claimed key', async () => {
    await claimWith(port);
    strictEqual(port.files.get(PATH), serializeRecord(sampleRecord()));
  });

  it('reports the record that holds the key', async () => {
    port.files.set(PATH, serializeRecord(sampleRecord('nonce-other')));
    deepStrictEqual(await claimWith(port), {
      outcome: 'existing',
      record: sampleRecord('nonce-other'),
    });
  });

  it('leaves the holding record unchanged', async () => {
    port.files.set(PATH, serializeRecord(sampleRecord('nonce-other')));
    await claimWith(port);
    strictEqual(
      port.files.get(PATH),
      serializeRecord(sampleRecord('nonce-other')),
    );
  });

  it('reports a corrupt record and leaves it unchanged', async () => {
    port.files.set(PATH, '{broken');
    deepStrictEqual(
      [await claimWith(port), port.files.get(PATH)],
      [{outcome: 'corrupt'}, '{broken'],
    );
  });

  it('reports a record that vanished after the failed create as corrupt', async () => {
    port.read = () => Promise.resolve(undefined);
    port.files.set(PATH, serializeRecord(sampleRecord('nonce-other')));
    deepStrictEqual(await claimWith(port), {outcome: 'corrupt'});
  });

  it('lets exactly one of two concurrent claims win', async () => {
    deepStrictEqual(
      await Promise.all([claimWith(port, 'first'), claimWith(port, 'second')]),
      [
        {outcome: 'claimed'},
        {outcome: 'existing', record: sampleRecord('first')},
      ],
    );
  });
});

describe('MemoryFilePort', () => {
  it('creates a path once', async () => {
    const port = new MemoryFilePort();
    deepStrictEqual(
      [
        await port.createExclusive('/a', 'one'),
        await port.createExclusive('/a', 'two'),
      ],
      ['created', 'exists'],
    );
  });
});
