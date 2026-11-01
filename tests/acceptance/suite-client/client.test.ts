import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import {redact} from 'lib-log';
import {
  bannerLine,
  checkingLine,
  notValidLine,
  pathSettingLine,
  rejectedLine,
  searchedLines,
  usingLine,
} from '../../../packages/remote-ssh/src/diagnostics/log-content.ts';
import {connectionLog, recordLines} from '../suite/harness.ts';
import {
  recordAfterDialog,
  type RecordLine,
  type ScriptEntry,
} from '../suite-local/script.ts';
import casesFile from './cases.json' with {type: 'json'};

/** One launch of the client search, as tests/acceptance/suite-client/cases.json lists it. */
interface ClientCase {
  label: string;
  cite: string;
  checked: string[];
  /** The program the lookup and the connection ran; null when no program was used for either. */
  used: string | null;
  /** How many times the program ran the connection: the install, and with the server on a socket the tunnel too; one when absent. */
  connects?: number;
  /** The failure dialog's text, for a case that fails. */
  dialog?: string;
  /** The case's answers. */
  script?: ScriptEntry[];
}

const cases = (casesFile as {cases: ClientCase[]}).cases;

/** The case of this launch, named by the harness. */
const launched = cases.find(
  candidate => candidate.label === process.env.HARNESS_CLIENT_CASE,
);

/** The fake clients' folder in the run, which the harness names. */
const CLIENTS = path.join(process.env.HARNESS_RUN_FOLDER ?? '', 'clients');

/** The calls the fake clients logged during this launch, each as `<name>\t<kind>`. */
function calls(): string[] {
  return readFileSync(path.join(CLIENTS, 'calls.log'), 'utf8')
    .split('\n')
    .filter(line => line !== '');
}

/** The program a fake client has under `clients/`, as the harness wrote it. */
function program(name: string): string {
  return path.join(CLIENTS, name);
}

/** The folders of the launch's search path, as the extension logs them. */
function searchPath(): string[] {
  return (process.env.PATH ?? '').split(path.delimiter);
}

/** The lines of `wanted` that `logged` holds, each after the one before it: the log's own lines between them are free. */
function inOrder(
  logged: readonly string[],
  wanted: readonly string[],
): string[] {
  const found: string[] = [];
  let from = 0;
  for (const line of wanted) {
    const position = logged.indexOf(line, from);
    if (position >= 0) {
      found.push(line);
      from = position + 1;
    }
  }
  return found;
}

/** A line as the log shows it: the log redacts a run of 32 or more word characters, which a run folder's name can hold. */
function logged(line: string): string {
  return redact(line, []);
}

/** The banner the fake client `fails` prints, as the log shows it. */
const FAILS_BANNER = 'OpenSSH_9.6p1';

if (launched === undefined) {
  throw new Error(
    `no client case for "${String(process.env.HARNESS_CLIENT_CASE)}"`,
  );
}
const {cite, label, checked, used, dialog, connects = 1} = launched;

/** The case's record once its dialog's pick of actions was answered, without the display-only lines. */
let dialogRecord: RecordLine[] = [];

describe(`the client search of ${label}`, () => {
  if (dialog !== undefined) {
    before(async () => {
      dialogRecord = (await recordAfterDialog()).filter(
        line =>
          !['progress', 'downloadProgress', 'progressEnd'].includes(
            line.surface,
          ),
      );
    });
  }

  if (dialog === undefined) {
    it(`${cite} (${label}): the window connected`, () => {
      strictEqual(vscode.env.remoteName, 'ssh-remote');
    });

    it(`${cite} (${label}): no notification or dialog of the client search`, () => {
      const shown = recordLines().filter(
        line => line.surface === 'failureDialog' || line.surface === 'notice',
      );
      deepStrictEqual(
        shown,
        [],
        `${JSON.stringify(shown)}\nthe connection log:\n${connectionLog().join('\n')}`,
      );
    });
  } else {
    it(`${cite} (${label}): the connect failed with the case's dialog`, () => {
      strictEqual(
        dialogRecord.find(line => line.surface === 'failureDialog')?.question,
        dialog,
      );
    });

    it(`${cite} (${label}): the dialog has Close Remote, Retry and More Actions...`, () => {
      deepStrictEqual(
        dialogRecord.find(line => line.surface === 'failureDialog')?.buttons,
        ['Close Remote', 'Retry', 'More Actions...'],
      );
    });

    it(`${cite} (${label}): no notice`, () => {
      deepStrictEqual(
        dialogRecord.filter(line => line.surface === 'notice'),
        [],
      );
    });
  }

  it(`${cite} (${label}): the programs checked and run are the table's`, () => {
    deepStrictEqual(
      calls(),
      used === null
        ? checked.map(name => `${name}\tcheck`)
        : [
            ...checked.map(name => `${name}\tcheck`),
            `${used}\toptions`,
            ...Array.from({length: connects}, () => `${used}\tconnect`),
          ],
    );
  });

  if (label === 'client-silent') {
    it("F-2101 AC-20 (client-silent): the window connected within 30 s of the connect's first progress line", () => {
      const first = recordLines('progress')[0];
      strictEqual(
        first === undefined
          ? 'the record has no progress line'
          : Date.now() - first.time <= 30_000,
        true,
      );
    });
  }

  if (label === 'client-fails') {
    it('F-2101 AC-26 (client-fails): the log gives the setting, the rejection, the search path, the program checked, its banner and the program used, in order', () => {
      const failing = program('fails/ssh');
      const found = 'ssh';
      const expected = [
        pathSettingLine(failing),
        checkingLine(failing),
        bannerLine(FAILS_BANNER),
        rejectedLine(failing, 'exit status 1'),
        notValidLine(failing),
        ...searchedLines(searchPath()),
        checkingLine(found),
        bannerLine('OpenSSH_9.6p1, OpenSSL 3.0.13'),
        usingLine(found),
      ].map(logged);
      deepStrictEqual(inOrder(connectionLog(), expected), expected);
    });
  }

  if (label === 'client-missing') {
    it('F-2101 AC-6 (client-missing): the log says the configured path is not a valid SSH binary', () => {
      strictEqual(
        connectionLog().includes(logged(notValidLine(program('none/ssh')))),
        true,
      );
    });
  }
});
