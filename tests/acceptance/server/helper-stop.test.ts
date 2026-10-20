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
  helperRecords,
  type HelperStopWorld,
  processesHolding,
  stopHelpersUnder,
} from './helper-stop.ts';

/** A record of `namespace` and `recordKey` whose helper would listen at `endpoint`, with the nonce `nonce`. */
function helperRecord(
  namespace: string,
  recordKey: string,
  nonce: string,
  endpoint = '/run/rh.sock',
): HelperRecord {
  return {
    version: 1,
    namespace,
    recordKey,
    endpoint,
    nonce,
    startedByProcessId: 1,
    startedAt: 0,
    payload: {},
  };
}

/** Writes `record` under the registry folder `folder`, at its key's path, and returns the file. */
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

describe("the helpers a run's windows leave running", () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'acceptance-helpers-'));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  describe('the records under a user-data folder', () => {
    it("finds the records of every profile's registry and of the instance's, and nothing else", () => {
      const userData = path.join(root, 'user-data');
      const storage = path.join(userData, 'User', 'globalStorage');
      const instance = path.join(storage, 'ext.a', 'instance-registry');
      const profile = path.join(storage, 'ext.b', 'registry');
      const named = path.join(
        userData,
        'User',
        'profiles',
        'abc',
        'globalStorage',
        'ext.b',
        'registry',
      );
      writeRecord(instance, helperRecord('watch', 'one', 'n1'));
      writeRecord(profile, helperRecord('ssh.connection', 'host', 'n2'));
      writeRecord(named, helperRecord('ssh.connection', 'host', 'n3'));
      // A record moved away from its key's path, a file that holds no record, and a file of another name.
      const moved = recordPath(profile, 'ssh.connection', 'other');
      writeFileSync(
        moved,
        serializeRecord(helperRecord('ssh.connection', 'host', 'n4')),
      );
      writeFileSync(
        path.join(path.dirname(moved), `${'a'.repeat(32)}.json`),
        '{}',
      );
      writeFileSync(path.join(path.dirname(moved), 'notes.json'), '{}');
      deepStrictEqual(
        helperRecords(userData)
          .map(found => [found.folder, found.record.nonce])
          .sort(),
        [
          [instance, 'n1'],
          [profile, 'n2'],
          [named, 'n3'],
        ],
      );
    });

    it('finds none in a user-data folder the editor never made', () => {
      deepStrictEqual(helperRecords(path.join(root, 'none')), []);
    });
  });

  describe('stopping them', () => {
    it('stops each recorded helper with its folder, namespace and key, and kills the one that still answers, by its nonce, removing its record', async () => {
      const userData = path.join(root, 'user-data');
      const folder = path.join(
        userData,
        'User',
        'globalStorage',
        'ext.a',
        'instance-registry',
      );
      const ended = writeRecord(folder, helperRecord('watch', 'ended', 'gone'));
      const hung = writeRecord(folder, helperRecord('watch', 'hung', 'hung'));
      const {world, stops, kills} = notingWorld(['hung']);
      await stopHelpersUnder(userData, world);
      deepStrictEqual(
        [stops.sort(), kills, existsSync(ended), existsSync(hung)],
        [
          [
            [folder, 'watch', 'ended'],
            [folder, 'watch', 'hung'],
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

    it("stops a helper that no longer runs with this machine's own stop, which removes its record", async () => {
      const userData = path.join(root, 'user-data');
      const record = writeRecord(
        path.join(userData, 'User', 'globalStorage', 'ext.a', 'registry'),
        helperRecord('watch', 'one', 'n1', path.join(root, 'none.sock')),
      );
      await stopHelpersUnder(userData);
      strictEqual(existsSync(record), false);
    });

    it('the program stops what is recorded under each folder it names', () => {
      const first = path.join(root, 'first');
      const second = path.join(root, 'second');
      const records = [first, second].map(userData =>
        writeRecord(
          path.join(userData, 'User', 'globalStorage', 'ext.a', 'registry'),
          helperRecord('watch', 'one', 'n1', path.join(root, 'none.sock')),
        ),
      );
      const result = spawnSync(
        process.execPath,
        [path.join(import.meta.dirname, 'stop-helpers.ts'), first, second],
        {encoding: 'utf8'},
      );
      deepStrictEqual(
        [result.status, records.map(record => existsSync(record))],
        [0, [false, false]],
      );
    });
  });

  describe('a hello to a recorded helper', () => {
    const record = helperRecord('watch', 'one', 'n1', '/run/one.sock');

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

  describe('the processes that hold a nonce', () => {
    it('are the ones whose environment holds it; another process, a name that is no process and an unreadable one are not', () => {
      const proc = path.join(root, 'proc');
      for (const [entry, environment] of [
        ['12', 'PATH=/bin\0REMOTE_OSS_HELPER_PARAMETERS={"nonce":"n1"}\0'],
        ['13', 'PATH=/bin\0'],
        ['self', 'n1'],
      ] as const) {
        mkdirSync(path.join(proc, entry), {recursive: true});
        writeFileSync(path.join(proc, entry, 'environ'), environment);
      }
      mkdirSync(path.join(proc, '14'));
      deepStrictEqual(processesHolding('n1', proc), [12]);
    });

    it('are none without a process folder', () => {
      deepStrictEqual(processesHolding('n1', path.join(root, 'none')), []);
    });
  });
});
