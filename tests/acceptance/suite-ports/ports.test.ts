import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {recordLines} from '../suite/harness.ts';
import casesFile from './cases.json' with {type: 'json'};
import {containerAddress, listenAddress, reaches, serverPort} from './ports.ts';

/** One ports case of the run, as tests/acceptance/suite-ports/cases.json lists it. */
interface PortsCase {
  label: string;
  cite: string;
  authority?: string;
  settings: Record<string, unknown>;
  holders?: number[];
  keepServer?: boolean;
  outcome: 'connected' | 'connectedOrDialog';
  port?: number | 'random';
  address?: string;
  reaches?: boolean;
  noListenerOn?: number;
  noNotice?: boolean;
}

/** The ports case of this window, named by the variable the harness gave it. */
const portsCase = (casesFile as {cases: PortsCase[]}).cases.find(
  candidate => candidate.label === (process.env.HARNESS_PORTS_CASE ?? ''),
);

/** The run's folder, where the launch's copy of its settings lives. */
const runFolder = process.env.HARNESS_RUN_FOLDER ?? '';

/** The marks of a record question that is an internal script error text. */
const ERROR_TEXTS = ['Error:', 'TypeError:', 'ReferenceError:', '    at '];

describe(`the ports case "${portsCase?.label ?? 'unknown'}" of the VSCodium run`, () => {
  it('contracts harness: the window is one of the ports cases', () => {
    strictEqual(portsCase === undefined, false);
  });

  it(`${portsCase?.cite ?? 'F-2409'}: the connect ended as the case says`, () => {
    const dialog = recordLines('failureDialog').find(line =>
      line.question.startsWith('Could not establish connection to "harness"'),
    );
    strictEqual(
      vscode.env.remoteName === 'ssh-remote' ||
        (portsCase?.outcome === 'connectedOrDialog' && dialog !== undefined),
      true,
    );
  });

  if (portsCase?.port !== undefined) {
    it(`${portsCase.cite}: the server listens on the case's port`, async () => {
      strictEqual(
        portsCase.port === 'random'
          ? portOutsideRanges(await serverPort())
          : (await serverPort()) === portsCase.port,
        true,
      );
    });
  }

  if (portsCase?.address !== undefined) {
    it(`${portsCase.cite}: the server listens on the case's address`, async () => {
      // The case checks the address only when connected; a dialog took the connect and then nothing listens.
      const connected = vscode.env.remoteName === 'ssh-remote';
      const address = connected
        ? await listenAddress(await serverPort())
        : undefined;
      strictEqual(address, connected ? portsCase.address : undefined);
    });
  }

  if (portsCase?.noListenerOn !== undefined) {
    const heldPort = portsCase.noListenerOn;
    it(`${portsCase.cite}: nothing new listens in the new range`, async () => {
      strictEqual(await listenAddress(heldPort), undefined);
    });
  }

  if (portsCase?.reaches === true) {
    it(`${portsCase.cite}: another machine reaches the server's port`, async () => {
      strictEqual(
        await reaches(await containerAddress(), await serverPort()),
        true,
      );
    });
  }

  if (portsCase?.noNotice === true) {
    it(`${portsCase.cite}: no notice appeared`, () => {
      deepStrictEqual(recordLines('notice'), []);
    });
  }

  if (portsCase?.outcome === 'connectedOrDialog') {
    it(`${portsCase.cite}: the window stays usable, with no script error text`, async () => {
      const document = await vscode.workspace.openTextDocument({
        content: 'usable',
      });
      deepStrictEqual(
        [
          recordLines().filter(line =>
            ERROR_TEXTS.some(mark => line.question.includes(mark)),
          ),
          document.isUntitled,
        ],
        [[], true],
      );
    });
  }

  it('F-2409 AC-17: settings.json is unchanged', () => {
    const userSettings = readFileSync(
      path.join(runFolder, 'user-data', 'User', 'settings.json'),
    );
    const launchSettings = readFileSync(
      path.join(runFolder, `ports-${portsCase?.label ?? ''}-settings.json`),
    );
    strictEqual(Buffer.compare(userSettings, launchSettings), 0);
  });
});

/** Whether the port is outside the ranges the named keys address, so the case's range did not apply. */
function portOutsideRanges(port: number): boolean {
  return (port < 45000 || port > 45010) && (port < 46000 || port > 46010);
}
