import {deepStrictEqual, strictEqual} from 'node:assert';
import * as vscode from 'vscode';
import {
  launchScript,
  type RecordLine,
  type ScriptEntry,
} from '../suite-local/script.ts';
import casesFile from './cases.json' with {type: 'json'};

/** One failing connect of the run, as tests/acceptance/suite-failure/cases.json lists it. */
interface FailureCase {
  alias: string;
  /** The criteria the case's dialog text proves. */
  cite: string;
  script: ScriptEntry[];
  dialog: string;
}

/** The failing connects, bundled from the file the harness reads to launch them. */
const cases = (casesFile as {cases: FailureCase[]}).cases;

/** The failing connect of this window, named by the authority of the folder it was opened on. */
const failure = cases.find(
  candidate =>
    vscode.workspace.workspaceFolders?.[0]?.uri.authority ===
    `ssh-remote+${candidate.alias}`,
);

/** The record of this window's script once the pick of actions was answered, waiting up to 90 s. */
async function recordAfterDialog(): Promise<RecordLine[]> {
  const launched = launchScript();
  for (let attempt = 0; attempt < 180; attempt++) {
    const record = launched.record();
    if (record.some(line => line.surface === 'mitigationPick')) {
      return record;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return launched.record();
}

describe(`a failed connect to "${failure?.alias ?? 'unknown'}" (ruling 1)`, () => {
  let record: RecordLine[] = [];

  before(async () => {
    record = (await recordAfterDialog()).filter(
      line => !['progress', 'downloadProgress'].includes(line.surface),
    );
  });

  it('contracts harness: the window is one of the failing connects', () => {
    strictEqual(failure === undefined, false);
  });

  it(`${failure?.cite ?? 'F-2601'}: the dialog names the alias, with the reason of the failure`, () => {
    strictEqual(
      record.find(line => line.surface === 'failureDialog')?.question,
      failure?.dialog,
    );
  });

  it('F-2601 AC-12, AC-13: dismissing the dialog opened the pick of actions, and every question was the next one of the script (ruling 5)', () => {
    deepStrictEqual(
      record.map(line => [line.surface, line.matched]),
      failure?.script.map(entry => [entry.surface, true]),
    );
  });
});
