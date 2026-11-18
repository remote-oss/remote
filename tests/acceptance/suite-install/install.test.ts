import {deepStrictEqual, strictEqual} from 'node:assert';
import * as vscode from 'vscode';
import {connectionLog, onHost, recordLines} from '../suite/harness.ts';
import casesFile from './cases.json' with {type: 'json'};
import {
  archiveCopiesLeft,
  archiveSize,
  binEntries,
  downloadRequests,
  existsOnHost,
  hostPlatform,
  installedCommits,
  isHostDownloader,
  runVariable,
  standInCliRanAs,
} from './install.ts';

/** The download host's requests a case expects: a count, all of one path, or only the client's. */
interface ExpectedRequests {
  count?: number;
  path?: string;
  clientOnly?: boolean;
  /** How many requests the client itself made, whatever the host's downloader asked: one for a client that does not retry. */
  clientCount?: number;
  /** The host's downloader asked first and failed, and the client's followed. */
  hostThenClient?: boolean;
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
  /** The server folder the CLI archive of an exec-mode install reaches under its commit-keyed name. */
  cliIn?: string;
  /** File names, as `find -name` patterns, that nothing under the host's home and temporary folders may carry. */
  noHostFiles?: string[];
  /** Whether the case only makes the state of the case that needs it, so its only row is its own connect. */
  primer?: true;
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

    if (installCase.primer !== true) {
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
          requests.clientCount === undefined ||
            seen.filter(each => !isHostDownloader(each.userAgent)).length ===
              requests.clientCount,
          requests.hostThenClient === true
            ? seen.findIndex(each => isHostDownloader(each.userAgent)) === 0 &&
              seen.some(each => !isHostDownloader(each.userAgent))
            : true,
        ],
        [seen.length, [], true, true, true],
        `requests: ${JSON.stringify(seen)}`,
      );
    });
  }

  if (installCase?.cliIn !== undefined) {
    const {cliIn} = installCase;
    // The copy's template names the client's loopback and the case forces the local download, so the request is the
    // client's own: the host's downloader, which cannot reach a loopback, makes none.
    it(`${cite}: the client asked once for the CLI of the host's platform and of its own commit`, async () => {
      const platform = await hostPlatform();
      const seen = downloadRequests(label);
      deepStrictEqual(
        seen
          .filter(
            each =>
              each.path.startsWith('/cli/') &&
              !isHostDownloader(each.userAgent),
          )
          .map(each => each.path),
        [
          `/cli/${platform}/${runVariable('HARNESS_CLIENT_COMMIT')}/cli-${platform}.tar.gz`,
        ],
        `all the requests of the case: ${JSON.stringify(seen)}; the log lines that name the CLI: ${JSON.stringify(
          connectionLog().filter(line => /\bCLI\b/i.test(line)),
        )}`,
      );
    });

    // The install removes the CLI's file when the CLI fails, so the stand-in writes the path it was run as: that path is
    // the archive's file in the server folder, under the commit-keyed name, and it was run from there.
    it(`${cite}: the CLI archive's file was run from the server folder of the host under its commit-keyed name`, async () => {
      const commit = runVariable('HARNESS_CLIENT_COMMIT');
      const ranAs = await standInCliRanAs();
      deepStrictEqual(
        [
          ranAs.startsWith(`${cliIn}/`),
          ranAs.slice(cliIn.length + 1).endsWith(`-${commit}`),
          ranAs.slice(cliIn.length + 1).includes('/'),
        ],
        [true, true, false],
        `the stand-in CLI was run as ${JSON.stringify(ranAs)}; the log lines that name the CLI: ${JSON.stringify(
          connectionLog().filter(line => /\bCLI\b/i.test(line)),
        )}`,
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

  if (installCase?.noHostFiles !== undefined) {
    const {noHostFiles} = installCase;
    it(`${cite}: the host holds no file named ${noHostFiles.join(', ')}`, async () => {
      deepStrictEqual(
        await Promise.all(
          noHostFiles.map(async pattern =>
            (
              await onHost(
                'sh',
                '-c',
                `find /home/harness /tmp -name '${pattern}' 2>/dev/null; true`,
              )
            ).trim(),
          ),
        ),
        noHostFiles.map(() => ''),
      );
    });
  }
});
