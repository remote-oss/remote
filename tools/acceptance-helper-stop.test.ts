import {deepStrictEqual, throws} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  helperRecords,
  processesHolding,
  runUserDataFolders,
  STOP_PROGRAM,
  stopHelpersUnder,
  stopRunHelpers,
} from './acceptance-helper-stop.ts';
import type {CommandRunner} from './command-runner.ts';

/** The file name a record of `recordKey` has: the first 32 hex characters of the key's digest. */
function recordName(recordKey: string): string {
  return `${createHash('sha256').update(recordKey).digest('hex').slice(0, 32)}.json`;
}

/** The text of a record file. */
function recordText(
  namespace: string,
  recordKey: string,
  nonce: string,
): string {
  return JSON.stringify({
    namespace,
    recordKey,
    nonce,
    endpoint: '/run/rh.sock',
  });
}

/** Writes a record of `namespace` and `recordKey` under the registry folder `folder`, at its key's path. */
function writeRecord(
  folder: string,
  namespace: string,
  recordKey: string,
  nonce: string,
): void {
  mkdirSync(path.join(folder, namespace), {recursive: true});
  writeFileSync(
    path.join(folder, namespace, recordName(recordKey)),
    recordText(namespace, recordKey, nonce),
  );
}

/** A user-data folder under `root/name` with one record in a profile's registry. */
function userDataWithRecord(root: string, name: string): string {
  const userData = path.join(root, name, 'user-data');
  writeRecord(
    path.join(userData, 'User', 'globalStorage', 'ext.a', 'registry'),
    'watch',
    'one',
    'n1',
  );
  return userData;
}

/** A runner that notes each command and answers with `status`. */
function notingRunner(status: number): {
  command: CommandRunner;
  commands: string[][];
} {
  const commands: string[][] = [];
  return {
    command: (program, programArguments) => {
      commands.push([program, ...programArguments]);
      return {status, stdout: '', stderr: status === 0 ? '' : 'no such file'};
    },
    commands,
  };
}

describe('the run stops the helpers its windows leave running', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'acceptance-helper-stop-'));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  describe('the records under a user-data folder', () => {
    it("are found in every profile's registry and in the instance's, and nothing else is", () => {
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
      writeRecord(instance, 'watch', 'one', 'n1');
      writeRecord(profile, 'ssh.connection', 'host', 'n2');
      writeRecord(named, 'ssh.connection', 'host', 'n3');
      // Not records: one away from its key's path, one in another namespace's folder, JSON that holds no record,
      // JSON null, text that isn't JSON, and a file of another name.
      for (const [name, text] of [
        [recordName('other'), recordText('ssh.connection', 'host', 'n4')],
        [recordName('away'), recordText('watch', 'away', 'n5')],
        [recordName('empty'), '{}'],
        [recordName('null'), 'null'],
        [recordName('text'), 'not a record'],
        ['notes.json', '{}'],
      ] as const) {
        writeFileSync(path.join(profile, 'ssh.connection', name), text);
      }
      deepStrictEqual(
        helperRecords(userData).map(found => [
          found.folder,
          found.namespace,
          found.recordKey,
          found.nonce,
          found.endpoint,
        ]),
        [
          [instance, 'watch', 'one', 'n1', '/run/rh.sock'],
          [profile, 'ssh.connection', 'host', 'n2', '/run/rh.sock'],
          [named, 'ssh.connection', 'host', 'n3', '/run/rh.sock'],
        ],
      );
    });

    it('are none in a user-data folder the editor never made', () => {
      deepStrictEqual(helperRecords(path.join(root, 'none')), []);
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

  describe('the stop', () => {
    it("runs the acceptance package's program on a folder with records, and nothing on one without", () => {
      const {command, commands} = notingRunner(0);
      const withRecord = userDataWithRecord(root, 'with');
      stopHelpersUnder(withRecord, command);
      stopHelpersUnder(path.join(root, 'none'), command);
      deepStrictEqual(commands, [[process.execPath, STOP_PROGRAM, withRecord]]);
    });

    it('fails when the program fails', () => {
      const {command} = notingRunner(1);
      throws(() => {
        stopHelpersUnder(userDataWithRecord(root, 'with'), command);
      }, /no such file/);
    });

    it("the clean-up runs the program once for each of the run's own folders, and for no other run's", () => {
      const first = userDataWithRecord(root, 'acceptance-77-2-checks-AbC123');
      const second = userDataWithRecord(root, 'acceptance-77-2-checks-xyz789');
      userDataWithRecord(root, 'acceptance-77-2-checks-more-AbC123');
      userDataWithRecord(root, 'other');
      const {command, commands} = notingRunner(0);
      stopRunHelpers(root, '77-2-checks', command);
      deepStrictEqual(commands, [
        [process.execPath, STOP_PROGRAM, first],
        [process.execPath, STOP_PROGRAM, second],
      ]);
    });

    it("names the run's user-data folders as the run names its folder", () => {
      for (const name of [
        'acceptance-local-9-Ab12',
        'acceptance-local-9-',
        'acceptance-local-90-Ab12',
      ] as const) {
        mkdirSync(path.join(root, name));
      }
      deepStrictEqual(runUserDataFolders(root, 'local-9'), [
        path.join(root, 'acceptance-local-9-Ab12', 'user-data'),
      ]);
    });
  });
});
