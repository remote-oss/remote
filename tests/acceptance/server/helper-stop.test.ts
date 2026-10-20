import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type EndpointConnection,
  type HelperRecord,
  recordPath,
  serializeRecord,
} from 'lib-helper';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {
  helloAnswered,
  type HelperStopWorld,
  stopRecordedHelpers,
} from './helper-stop.ts';

/** A record of the key and nonce `nonce` whose helper would listen at `endpoint`. */
function helperRecord(nonce: string, endpoint = '/run/rh.sock'): HelperRecord {
  return {
    version: 1,
    namespace: 'watch',
    recordKey: nonce,
    endpoint,
    nonce,
    startedByProcessId: 1,
    startedAt: 0,
    payload: {},
  };
}

/** Writes `record` with lib-helper's own form under the registry folder `folder`, and returns the file. */
function writeRecord(folder: string, record: HelperRecord): string {
  const file = recordPath(folder, record.namespace, record.recordKey);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, serializeRecord(record));
  return file;
}

/** A world that notes each stop and kill, whose helpers answer after the stop when their nonce is in `answering`. */
function notingWorld(answering: readonly string[]): {
  world: HelperStopWorld;
  stops: string[][];
  kills: Array<[number, string]>;
} {
  const stops: string[][] = [];
  const kills: Array<[number, string]> = [];
  return {
    world: {
      stop: (folder, namespace, recordKey) => {
        stops.push([folder, namespace, recordKey]);
        return Promise.resolve();
      },
      answers: record => Promise.resolve(answering.includes(record.nonce)),
      processesHolding: text => (text === 'hung' ? [41, 42] : []),
      kill: (processId, signal) => {
        kills.push([processId, signal]);
      },
    },
    stops,
    kills,
  };
}

describe('the helper stop program', () => {
  let root = '';
  let userData = '';
  let registry = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'helper-stop-'));
    userData = path.join(root, 'user-data');
    registry = path.join(
      userData,
      'User',
      'globalStorage',
      'ext.a',
      'instance-registry',
    );
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it("stops each of lib-helper's records with its folder, namespace and key, and kills the one that still answers, by its nonce, removing its record", async () => {
    const ended = writeRecord(registry, helperRecord('gone'));
    const hung = writeRecord(registry, helperRecord('hung'));
    const {world, stops, kills} = notingWorld(['hung']);
    await stopRecordedHelpers(userData, world);
    deepStrictEqual(
      [stops.sort(), kills, existsSync(ended), existsSync(hung)],
      [
        [
          [registry, 'watch', 'gone'],
          [registry, 'watch', 'hung'],
        ],
        [
          [41, 'SIGKILL'],
          [42, 'SIGKILL'],
        ],
        true,
        false,
      ],
    );
  });

  it("stops a helper that no longer runs with lib-helper's own stop, which removes its record", async () => {
    const record = writeRecord(
      registry,
      helperRecord('n1', path.join(root, 'none.sock')),
    );
    await stopRecordedHelpers(userData);
    strictEqual(existsSync(record), false);
  });

  it('as a program, stops what is recorded under each folder it names and exits 0', () => {
    const second = path.join(root, 'second');
    const records = [
      writeRecord(registry, helperRecord('n1', path.join(root, 'none.sock'))),
      writeRecord(
        path.join(second, 'User', 'globalStorage', 'ext.a', 'registry'),
        helperRecord('n2', path.join(root, 'none.sock')),
      ),
    ];
    const result = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, 'helper-stop.ts'), userData, second],
      {encoding: 'utf8'},
    );
    deepStrictEqual(
      [result.status, records.map(record => existsSync(record))],
      [0, [false, false]],
    );
  });

  describe('a hello to a recorded helper', () => {
    const record = {endpoint: '/run/one.sock', nonce: 'n1'};

    /** A port whose helper at the record's endpoint does what `onHello` says with each connection. */
    async function portAnswering(
      onHello: (connection: EndpointConnection) => void,
    ): Promise<FakeEndpointPort> {
      const endpoints = new FakeEndpointPort();
      await endpoints.listen('/run/one.sock', connection => {
        connection.onMessage(() => {
          onHello(connection);
        });
      });
      return endpoints;
    }

    it('is answered by a helper that welcomes it', async () => {
      const endpoints = await portAnswering(connection => {
        connection.send({type: 'welcome'});
      });
      strictEqual(await helloAnswered(endpoints, record, 1000), true);
    });

    it('is not answered when nothing listens, when the helper closes, or when it stays silent past the limit', async () => {
      const closing = await portAnswering(connection => {
        connection.close();
      });
      const silent = await portAnswering(() => undefined);
      deepStrictEqual(
        [
          await helloAnswered(new FakeEndpointPort(), record, 1000),
          await helloAnswered(closing, record, 1000),
          await helloAnswered(silent, record, 20),
        ],
        [false, false, false],
      );
    });
  });
});
