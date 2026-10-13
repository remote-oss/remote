import {deepStrictEqual, strictEqual} from 'node:assert';
import * as vscode from 'vscode';
import {recordLines} from '../suite/harness.ts';
import casesFile from './cases.json' with {type: 'json'};
import {
  archiveCopiesLeft,
  archiveSize,
  binEntries,
  downloadRequests,
  existsOnHost,
  installedCommits,
  isHostDownloader,
} from './install.ts';

/** The download host's requests a case expects: a count, all of one path, or only the client's. */
interface ExpectedRequests {
  count?: number;
  path?: string;
  clientOnly?: boolean;
}

/** One install case of the run, as tests/acceptance/suite-install/cases.json lists it. */
interface InstallCase {
  label: string;
  cite: string;
  outcome: 'connected' | 'dialog' | 'any';
  dialog?: string;
  dialogIncludes?: string[];
  stages?: string[];
  noStages?: string[];
  noRecordText?: string[];
  noDownloadProgress?: boolean;
  installedIn?: string;
  hostLacks?: string[];
  leftovers?: string;
  requests?: ExpectedRequests;
  licenceDetail?: string;
  noArchiveLeft?: boolean;
}

/** The install case of this window, named by the variable the harness gave it. */
const installCase = (casesFile as {cases: InstallCase[]}).cases.find(
  candidate => candidate.label === (process.env.HARNESS_INSTALL_CASE ?? ''),
);

/**
 * The texts F-2403 AC-21 keeps off every surface of a failed install: STR:S040, S054, S055, S061, S080, S124 and S154,
 * as remote-oss/remote-ssh#48 §2 writes them.
 */
const UNSHOWN_TEXTS = [
  'Download the correct VS Code that corresponds both to your local installation and the remote architecture',
  'Ensure that the remote server has internet access and has access to the VS Code CDN',
  'Ensure that the remote server has internet access and that the network is not blocking the download',
  'Ensure there is sufficient free disk space on the remote machine',
  'If your remote server is behind a firewall, ask your IT department to allow access to the VS Code CDN',
  'See output log for server installation URL',
  'Update VS Code and try again later',
];

/** The question of the window's failure dialog, or `undefined` when none was shown. */
function dialogQuestion(): string | undefined {
  return recordLines('failureDialog').at(0)?.question;
}

/** The texts of the window's `progress` lines, in order. */
function progressTexts(): string[] {
  return recordLines('progress').map(line => line.question);
}

/** Whether `wanted` appears in `texts` in this order, other texts between them allowed. */
function inOrder(texts: readonly string[], wanted: readonly string[]): boolean {
  let next = 0;
  for (const text of texts) {
    if (text === wanted[next]) {
      next += 1;
    }
  }
  return next === wanted.length;
}

describe(`the install case "${installCase?.label ?? 'unknown'}" of the VSCodium run`, () => {
  it('contracts harness: the window is one of the install cases', () => {
    strictEqual(installCase === undefined, false);
  });

  const label = installCase?.label ?? '';
  const cite = installCase?.cite ?? 'F-2403';

  if (installCase?.outcome === 'connected') {
    it(`${cite}: the connect ended as the case says`, () => {
      deepStrictEqual(
        [vscode.env.remoteName, dialogQuestion()],
        ['ssh-remote', undefined],
      );
    });
  }

  if (installCase?.outcome === 'dialog') {
    const {dialog, dialogIncludes} = installCase;
    it(`${cite}: the connect ended as the case says`, () => {
      const question = dialogQuestion() ?? '';
      deepStrictEqual(
        [
          dialog ?? question,
          (dialogIncludes ?? []).filter(text => !question.includes(text)),
        ],
        [question, []],
      );
    });

    it(`F-2403 AC-21: no text of the list appears (${label})`, () => {
      const shown = [
        dialogQuestion() ?? '',
        ...recordLines('mitigationPick').flatMap(line => line.items ?? []),
        ...recordLines('notice').map(line => line.question),
      ];
      deepStrictEqual(
        UNSHOWN_TEXTS.filter(text => shown.some(each => each.includes(text))),
        [],
      );
    });
  }

  if (
    installCase?.stages !== undefined ||
    installCase?.noStages !== undefined ||
    installCase?.noDownloadProgress === true
  ) {
    const {stages, noStages, noDownloadProgress} = installCase;
    it(`${cite}: the stages are the case's`, () => {
      const texts = progressTexts();
      deepStrictEqual(
        [
          inOrder(texts, stages ?? []),
          (noStages ?? []).filter(stage => texts.includes(stage)),
          noDownloadProgress === true
            ? recordLines('downloadProgress').length
            : 0,
        ],
        [true, [], 0],
        `progress: ${JSON.stringify(texts)}`,
      );
    });
  }

  if (installCase?.noRecordText !== undefined) {
    const {noRecordText} = installCase;
    it(`${cite}: no record line holds the case's texts`, () => {
      const questions = recordLines().map(line => line.question);
      deepStrictEqual(
        noRecordText.filter(text =>
          questions.some(question => question.includes(text)),
        ),
        [],
      );
    });
  }

  if (
    installCase?.installedIn !== undefined ||
    installCase?.hostLacks !== undefined ||
    installCase?.leftovers !== undefined
  ) {
    const {installedIn, hostLacks, leftovers} = installCase;
    it(`${cite}: the host holds what the case says`, async () => {
      deepStrictEqual(
        [
          installedIn === undefined
            ? 1
            : (await installedCommits(installedIn)).length,
          await Promise.all(
            (hostLacks ?? []).map(async hostPath => existsOnHost(hostPath)),
          ),
          leftovers === undefined
            ? true
            : (await binEntries(leftovers)).length > 0,
        ],
        [1, (hostLacks ?? []).map(() => false), true],
      );
    });
  }

  if (installCase?.requests !== undefined) {
    const {requests} = installCase;
    it(`${cite}: the download host saw the case's requests`, () => {
      const seen = downloadRequests(label);
      deepStrictEqual(
        [
          requests.count ?? seen.length,
          requests.path === undefined
            ? []
            : seen.filter(each => !each.path.startsWith(requests.path ?? '')),
          requests.clientOnly === true
            ? seen.length > 0 &&
              seen.every(each => !isHostDownloader(each.userAgent))
            : true,
        ],
        [seen.length, [], true],
        `requests: ${JSON.stringify(seen)}`,
      );
    });
  }

  if (installCase?.licenceDetail !== undefined) {
    const {licenceDetail} = installCase;
    it(`${cite}: the licence modal's detail names the terms`, () => {
      strictEqual(
        recordLines('licenceModal').some(
          line => line.detail?.includes(licenceDetail) === true,
        ),
        true,
      );
    });
  }

  if (installCase?.noArchiveLeft === true) {
    it(`${cite}: the client kept no copy of the archive`, async () => {
      deepStrictEqual(archiveCopiesLeft(label, await archiveSize()), []);
    });
  }
});
