/**
 * @fileoverview The session record every resolve keeps (card connect-135, F-2605 BR-9): its environment hints, its
 * error hints with their numbers, its log hint, and the two records kept. Read through the README's documented key,
 * `remote.ssh.hints` in the extension's global state.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  inWindow,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {changedKeys, extensionState} from '../windows/global-state.ts';
import {type HintRecords, hintRecords} from '../windows/hint-store.ts';
import {
  notificationCentre,
  notifications,
  statusItem,
} from '../windows/renderer.ts';
import {
  closeAllButLocal,
  dismissals,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';

/** The 22 settings of the record, in order, as the README lists them. */
const SETTINGS = [
  'useLocalServer',
  'useExecServer',
  'bindHost',
  'path',
  'configFile',
  'useFlock',
  'lockfilesInTmp',
  'localServerDownload',
  'remoteServerListenOnSocket',
  'defaultExtensions',
  'defaultExtensionsIfInstalledLocally',
  'loglevel',
  'enableDynamicForwarding',
  'enableRemoteCommand',
  'serverPickPortsFromRange',
  'serverInstallPath',
  'permitPtyAllocation',
  'preferredLocalPortRange',
  'useCurlAndWgetConfigurationFiles',
  'experimental.enhancedSessionLogs',
  'httpProxy',
  'httpsProxy',
];

/** The settings without details in the record. */
const WITHOUT_DETAILS = ['defaultExtensionsIfInstalledLocally', 'loglevel'];

const CLEAR = 'opensshremotes.clearAllSessionHints';

/** The package's manifest descriptions of the settings, by name without the prefix. */
function descriptions(): Record<string, string> {
  const folder = path.join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'packages',
    'remote-ssh',
  );
  const manifest = JSON.parse(
    readFileSync(path.join(folder, 'package.json'), 'utf8'),
  ) as {
    contributes: {
      configuration: {
        properties: Record<
          string,
          {description?: string; markdownDescription?: string}
        >;
      };
    };
  };
  const strings = JSON.parse(
    readFileSync(path.join(folder, 'package.nls.json'), 'utf8'),
  ) as Record<string, string>;
  return Object.fromEntries(
    SETTINGS.filter(name => !WITHOUT_DETAILS.includes(name)).map(name => {
      const declared =
        manifest.contributes.configuration.properties[`remote.SSH.${name}`];
      const reference =
        declared?.description ?? declared?.markdownDescription ?? '';
      return [name, strings[reference.replaceAll('%', '')] ?? reference];
    }),
  );
}

/** The hosts the log hint of `record` shows a resolve of: each resolve's own text starts at its own resolver line. */
function logOf(record: HintRecords[number]): {resolves: string[]} {
  const text = record.hints.find(hint => hint.kind === 'log')?.text ?? '';
  return {
    resolves: [...text.matchAll(/Resolving ssh-remote\+(\S+),/gu)].map(
      found => found[1] ?? '',
    ),
  };
}

/** Waits until the store holds `count` records, and gives them. */
async function recordsWhen(count: number): Promise<HintRecords> {
  await waitFor(
    `${String(count)} session records`,
    () => hintRecords().length === count,
    60_000,
  );
  return hintRecords();
}

/** Waits until the newest record holds a log hint, and gives the records. */
async function recordsWithLog(count: number): Promise<HintRecords> {
  await recordsWhen(count);
  await waitFor(
    'the log hint of the newest record',
    () =>
      hintRecords()
        .at(-1)
        ?.hints.some(hint => hint.kind === 'log') ?? false,
    60_000,
  );
  return hintRecords();
}

/** One failing attempt on `nowhere`, whose name never resolves; the window is closed when it has ended. */
async function failingAttempt(name: string): Promise<void> {
  appendScript(dismissals(name));
  await openWindow('nowhere', name);
  try {
    await waitFor(
      'the failure dialog',
      () => hintRecords().length > 0,
      INSTALL_MILLISECONDS,
    );
  } finally {
    await new Promise(resolve => setTimeout(resolve, 5000));
    await closeWindow(name).catch(() => undefined);
  }
}

describe('the session record of every resolve (card connect-135)', function () {
  this.timeout(900_000);
  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await closeAllButLocal();
    await inWindow('local', CLEAR);
    await waitFor('an empty store', () => hintRecords().length === 0, 60_000);
  });

  after(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2605 AC-17 (c135-record): a failed attempt keeps 25 environment hints in order, its error hint with a number, and the log hint', async () => {
    await userSettings({
      'remote.SSH.lockfilesInTmp': true,
      'remote.SSH.httpProxy': 'http://proxy.invalid:3128',
    });
    await failingAttempt('c135-a');
    const [record] = await recordsWithLog(1);
    const hints = record?.hints ?? [];
    const environment = hints.filter(hint => hint.kind === 'environment');
    const wanted = descriptions();
    const lines = connectionLog();
    const editorVersion =
      /Editor version: (.+)$/u.exec(
        lines.find(line => line.startsWith('Editor version:')) ?? '',
      )?.[1] ?? '';
    deepStrictEqual(
      {
        kinds: hints.map(hint => hint.kind),
        names: environment
          .slice(0, 22)
          .map(hint => /'([^']+)'/u.exec(hint.message ?? '')?.[1]),
        details: environment.slice(0, 22).map(hint => hint.details),
        lockfiles: environment[6]?.message,
        proxy: environment[20]?.message,
        undefinedOnes: [environment[10]?.message, environment[11]?.message],
        tail: environment.slice(22).map(hint => hint.message),
        error: hints
          .filter(hint => hint.kind === 'error')
          .map(hint => [hint.status, hint.statusNumber]),
        logHasResolver: hints
          .find(hint => hint.kind === 'log')
          ?.text?.includes('Resolving ssh-remote+nowhere, attempt 1'),
      },
      {
        kinds: [
          ...Array.from({length: 25}, () => 'environment'),
          'error',
          'log',
        ],
        names: SETTINGS,
        details: SETTINGS.map(name => wanted[name]),
        lockfiles: "Extension setting 'lockfilesInTmp' is set to value 'true'",
        proxy:
          "Extension setting 'httpProxy' is set to value 'http://proxy.invalid:3128'",
        undefinedOnes: [
          "Extension setting 'defaultExtensionsIfInstalledLocally' is set to value 'undefined'",
          "Extension setting 'loglevel' is set to value 'undefined'",
        ],
        tail: [
          `VS Code version: ${editorVersion}`,
          'Remote-SSH version: remote-ssh@0.1.0',
          `${process.platform} ${process.arch}`,
        ],
        error: [['OfflineError', 3]],
        logHasResolver: true,
      },
    );
  });

  it('F-2605 AC-16 (c135-count): every attempt, success or failure, keeps a record, and only the newest two stay, oldest first', async () => {
    await inWindow('local', CLEAR);
    await waitFor('an empty store', () => hintRecords().length === 0, 60_000);
    const seen: Array<{count: number; starts: string[]}> = [];
    await failingAttempt('c135-b1');
    seen.push({count: (await recordsWhen(1)).length, starts: []});
    await openWindow('harness', 'c135-b2');
    try {
      const both = await recordsWithLog(2);
      seen.push({
        count: both.length,
        starts: both.map(record => record.started),
      });
    } finally {
      await closeWindow('c135-b2').catch(() => undefined);
    }
    await failingAttempt('c135-b3');
    await waitFor(
      'the third attempt to replace the first',
      () =>
        hintRecords()
          .at(-1)
          ?.hints.some(hint => hint.kind === 'log') ?? false,
      60_000,
    );
    const last = hintRecords();
    deepStrictEqual(
      [
        seen.map(entry => entry.count),
        last.length,
        last[0]?.started === seen[1]?.starts[1],
        last.every(record => record.started !== '' && record.hints.length > 0),
        (last[0]?.started ?? '') < (last[1]?.started ?? ''),
        last.map(record => logOf(record)),
      ],
      [
        [1, 2],
        2,
        true,
        true,
        true,
        [{resolves: ['harness']}, {resolves: ['nowhere']}],
      ],
    );
  });

  it('F-2605 AC-22 (c135-clear): after the clear in a connected window the cleared records do not come back, and the next attempt leaves exactly one', async () => {
    await openWindow('harness', 'c135-c1');
    try {
      await connectedWithin('c135-c1', INSTALL_MILLISECONDS);
      await recordsWithLog(2);
      await inWindow('c135-c1', CLEAR);
      await waitFor('an empty store', () => hintRecords().length === 0, 60_000);
      await new Promise(resolve => setTimeout(resolve, 25_000));
      const later = hintRecords();
      await openWindow('harness', 'c135-c2');
      try {
        const [only] = await recordsWithLog(1);
        deepStrictEqual(
          [
            later.length,
            hintRecords().length,
            only?.hints.some(hint => hint.kind === 'log'),
          ],
          [0, 1, true],
          JSON.stringify(later),
        );
      } finally {
        await closeWindow('c135-c2').catch(() => undefined);
      }
    } finally {
      await closeWindow('c135-c1').catch(() => undefined);
    }
  });

  it('F-2605 AC-20 (c135-clear-shows-nothing): the command shows nothing, logs that the hints were cleared, removes the records and nothing else of the extension’s state, and leaves the connection as it was', async () => {
    await openWindow('harness', 'c135-d1');
    try {
      await connectedWithin('c135-d1', INSTALL_MILLISECONDS);
      await waitFor(
        'a record with its log hint',
        () =>
          hintRecords().some(record =>
            record.hints.some(hint => hint.kind === 'log'),
          ),
        60_000,
      );
      await waitFor(
        'the record in the state database',
        async () => 'remote.ssh.hints' in (await extensionState()),
        60_000,
      );
      const before = await extensionState();
      const indicator = (await statusItem('c135-d1', 'status.host')).text;
      const mark = recordLines().length;
      const logMark = connectionLog().length;
      await inWindow('c135-d1', CLEAR);
      await waitFor(
        'the records to be gone',
        async () => !('remote.ssh.hints' in (await extensionState())),
        60_000,
      );
      deepStrictEqual(
        [
          recordLines().length - mark,
          await notifications('c135-d1'),
          await notificationCentre('c135-d1'),
          connectionLog()
            .slice(logMark)
            .some(line => line.includes('Cleared all session hints')),
          changedKeys(before, await extensionState()),
          (await statusItem('c135-d1', 'status.host')).text === indicator,
        ],
        [0, [], [], true, ['remote.ssh.hints'], true],
      );
    } finally {
      await closeWindow('c135-d1').catch(() => undefined);
    }
  });

  it('F-2605 AC-21 (c135-clear-empty): with the store already empty the command shows nothing, writes no record line and leaves the store empty', async () => {
    await inWindow('local', CLEAR);
    await waitFor('an empty store', () => hintRecords().length === 0, 60_000);
    const mark = recordLines().length;
    await inWindow('local', CLEAR);
    deepStrictEqual(
      [
        recordLines().length - mark,
        await notifications('local'),
        await notificationCentre('local'),
        hintRecords().length,
      ],
      [0, [], [], 0],
    );
  });
});
