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
import casesFile from './cases.json' with {type: 'json'};

/** One launch of the client search, as tests/acceptance/suite-client/cases.json lists it. */
interface ClientCase {
  label: string;
  cite: string;
  checked: string[];
  used: string;
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
const {cite, label, checked, used} = launched;

describe(`the client search of ${label}`, () => {
  it(`${cite} (${label}): the window connected`, () => {
    strictEqual(vscode.env.remoteName, 'ssh-remote');
  });

  it(`${cite} (${label}): the programs checked and run are the table's`, () => {
    deepStrictEqual(calls(), [
      ...checked.map(name => `${name}\tcheck`),
      `${used}\toptions`,
      `${used}\tconnect`,
    ]);
  });

  it(`${cite} (${label}): no notification or dialog of the client search`, () => {
    deepStrictEqual(
      recordLines().filter(
        line => line.surface === 'failureDialog' || line.surface === 'notice',
      ),
      [],
    );
  });

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
