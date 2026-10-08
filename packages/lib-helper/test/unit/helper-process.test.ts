import {deepStrictEqual, rejects, strictEqual, throws} from 'node:assert';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {
  acquire,
  type AcquireOutcome,
  type HelperLease,
  nodeClientEnvironment,
  parseRecord,
  recordPath,
} from '../../src/index.ts';
import {nodeEndpointPort} from '../../src/endpoint/node-endpoint.ts';
import {nodeFilePort} from '../../src/registry/node-file-port.ts';
import {helperParameters} from '../../src/runtime/helper-main.ts';

const SCRIPT = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'echo-helper.ts',
);

function leaseOf(outcome: AcquireOutcome): HelperLease {
  if (outcome.kind !== 'acquired') {
    throw new Error(`no lease: ${outcome.failure}`);
  }
  return outcome.lease;
}

describe('a helper process', function () {
  this.timeout(20000);
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'helper-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('starts once, serves two leases, and ends by its grace after the last release', async () => {
    const environment = {
      ...nodeClientEnvironment(process.execPath),
      endpointFolder: folder,
    };
    const request = {
      folder: path.join(folder, 'registry'),
      namespace: 'test.echo',
      helperKey: 'one',
      script: SCRIPT,
      options: {},
      policy: {kind: 'graceAfterLastLease', milliseconds: 300} as const,
      payload: {kind: 'echo'},
      cancellation: new AbortController().signal,
    };
    const first = leaseOf(await acquire(environment, request));
    const second = leaseOf(await acquire(environment, request));
    const reply = await second.request('ping', 5000);
    const secondPosition = second.position();
    const recordText = await nodeFilePort.read(
      recordPath(path.join(folder, 'registry'), 'test.echo', 'one'),
    );
    const endpoint = parseRecord(recordText ?? '')?.endpoint ?? '';
    first.release();
    second.release();
    await delay(1500);
    deepStrictEqual(
      [first.startedByMe, second.startedByMe, secondPosition, reply],
      [true, false, 1, {kind: 'reply', body: {echo: 'ping'}}],
    );
    await rejects(nodeEndpointPort().connect(endpoint));
  });
});

describe('helper parameters', () => {
  it('reads the parameters its client passed', () => {
    strictEqual(
      helperParameters({REMOTE_OSS_HELPER_PARAMETERS: '{"nonce":"n"}'}).nonce,
      'n',
    );
  });

  it('fails without them', () => {
    throws(() => helperParameters({}), {
      message: 'REMOTE_OSS_HELPER_PARAMETERS is not set',
    });
  });
});

describe('the Node.js registry file port', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'helper-files-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('creates a record once, in a folder it makes', async () => {
    const file = path.join(folder, 'ns', 'a.json');
    deepStrictEqual(
      [
        await nodeFilePort.createExclusive(file, 'one'),
        await nodeFilePort.createExclusive(file, 'two'),
        await nodeFilePort.read(file),
      ],
      ['created', 'exists', 'one'],
    );
  });

  it('reads no record that is not there, and removes one that is not there', async () => {
    const file = path.join(folder, 'none.json');
    await nodeFilePort.remove(file);
    strictEqual(await nodeFilePort.read(file), undefined);
  });

  it('passes on a create the folder refuses', async () => {
    const locked = path.join(folder, 'locked');
    mkdirSync(locked, {mode: 0o500});
    await rejects(
      nodeFilePort.createExclusive(path.join(locked, 'a.json'), 'x'),
    );
  });

  it('passes on other failures of create and read', async () => {
    await rejects(
      nodeFilePort
        .createExclusive(path.join(folder, 'ns'), 'x')
        .then(() =>
          nodeFilePort.createExclusive(path.join(folder, 'ns', 'a.json'), 'x'),
        ),
    );
    await rejects(nodeFilePort.read(folder));
  });
});
