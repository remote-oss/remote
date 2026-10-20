import {deepStrictEqual, throws} from 'node:assert';
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
  holdsRecordFiles,
  runUserDataFolders,
  STOP_PROGRAM,
  stopHelpersUnder,
  stopRunHelpers,
} from './acceptance-helper-stop.ts';
import type {CommandRunner} from './command-runner.ts';

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

/** Writes a file named as a helper's record under the user-data folder's registry, and returns the folder. */
function withRecordFile(root: string, name: string): string {
  const userData = path.join(root, name, 'user-data');
  const registry = path.join(
    userData,
    'User',
    'globalStorage',
    'ext.a',
    'registry',
    'watch',
  );
  mkdirSync(registry, {recursive: true});
  writeFileSync(path.join(registry, `${'0'.repeat(32)}.json`), '{}');
  return userData;
}

describe('the run stops the helpers its windows leave running', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'acceptance-helper-stop-'));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it("knows a user-data folder holds records by their files' names", () => {
    const withRecord = withRecordFile(root, 'with');
    const without = path.join(root, 'without', 'user-data');
    mkdirSync(path.join(without, 'User', 'globalStorage'), {recursive: true});
    writeFileSync(
      path.join(without, 'User', 'globalStorage', 'settings.json'),
      '{}',
    );
    deepStrictEqual(
      [
        holdsRecordFiles(withRecord),
        holdsRecordFiles(without),
        holdsRecordFiles(path.join(root, 'none')),
      ],
      [true, false, false],
    );
  });

  it("runs the acceptance package's stop program on a folder with records, and nothing on one without", () => {
    const {command, commands} = notingRunner(0);
    const withRecord = withRecordFile(root, 'with');
    stopHelpersUnder(withRecord, command);
    stopHelpersUnder(path.join(root, 'none'), command);
    deepStrictEqual(
      [commands, existsSync(STOP_PROGRAM)],
      [[[process.execPath, STOP_PROGRAM, withRecord]], true],
    );
  });

  it('fails when the stop program fails', () => {
    const {command} = notingRunner(1);
    throws(() => {
      stopHelpersUnder(withRecordFile(root, 'with'), command);
    }, /no such file/);
  });

  it("the clean-up stops the helpers of each of the run's own folders, and of no other run's", () => {
    for (const name of [
      'acceptance-77-2-checks-AbC123',
      'acceptance-77-2-checks-xyz789',
      'acceptance-77-2-checks-more-AbC123',
      'acceptance-77-2-checks-',
      'other',
    ]) {
      mkdirSync(path.join(root, name));
    }
    const stopped: string[] = [];
    stopRunHelpers(root, '77-2-checks', userDataFolder => {
      stopped.push(userDataFolder);
    });
    deepStrictEqual(stopped, [
      path.join(root, 'acceptance-77-2-checks-AbC123', 'user-data'),
      path.join(root, 'acceptance-77-2-checks-xyz789', 'user-data'),
    ]);
  });

  it("names the run's user-data folders as the run names its folder", () => {
    for (const name of [
      'acceptance-local-9-Ab12',
      'acceptance-local-90-Ab12',
    ]) {
      mkdirSync(path.join(root, name));
    }
    deepStrictEqual(runUserDataFolders(root, 'local-9'), [
      path.join(root, 'acceptance-local-9-Ab12', 'user-data'),
    ]);
  });
});
