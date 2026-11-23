/**
 * @fileoverview The fingerprint pick of a window in the classic wording (F-2305): what it names, what Continue, Cancel and a
 * close with no choice leave in the known-hosts file, and the keywords that change its title.
 */

import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  ASK_WITHOUT,
  askLines,
  freshKnown,
  harnessHostFingerprint,
  hostBlock,
  writeConfig,
} from '../windows/config-keywords-support.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  appendScript,
  closeWindow,
  connected,
  connectedWithin,
  hostAnswer,
  inWindow,
  nextEmptyName,
  nextEmptyWindow,
  onHostAs,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';

const HOST_KEY_FILE = '/etc/ssh/ssh_host_ed25519_key.pub';

/** The config file and the empty known-hosts file of a host `alias` that asks about its key, with the lines `extra` in its block. */
function askingHost(
  alias: string,
  extra: readonly string[] = [],
): {file: string; known: string} {
  const known = freshKnown(alias);
  const file = writeConfig(alias, [
    hostBlock(alias, [...askLines(known), ...extra], ASK_WITHOUT),
  ]);
  return {file, known};
}

/** Points the editor at a config file of a host `alias` that asks about its key, and gives its known-hosts file. */
async function asking(
  alias: string,
  extra?: readonly string[],
): Promise<string> {
  const {file, known} = askingHost(alias, extra);
  await userSettings({
    'remote.SSH.configFile': file,
    'remote.SSH.remotePlatform': {[alias]: 'linux'},
  });
  return known;
}

/** The lines of the file `file` that are not empty. */
function knownLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '');
}

/** The questions of the picks window `window` was asked, not the held ones. */
function picksOf(window: string): string[] {
  return recordLines('pick', window)
    .filter(line => line.answer !== 'held')
    .map(line => line.question);
}

/** The scripted dismissals of the failure dialog and the action pick that follow a refused connection of `window`. */
function refusals(window: string) {
  return [
    {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window,
    },
  ] as const;
}

/** The line `known` holds for `alias` with a key that is not the host's: the type and key of a fresh ed25519 key. */
function changedKnown(alias: string): string {
  const folder = variable('HARNESS_RUN_FOLDER');
  const other = path.join(folder, `${alias}.other`);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', other]);
  const [type, key] = readFileSync(`${other}.pub`, 'utf8').split(/\s+/);
  const known = path.join(folder, `${alias}.known`);
  writeFileSync(known, `${alias} ${type ?? ''} ${key ?? ''}\n`);
  return known;
}

/** Points the editor at a config file of a host `alias` whose known-hosts file is `known`, with `checking` as its StrictHostKeyChecking. */
async function checking(
  alias: string,
  known: string,
  mode: string,
  settings: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const file = writeConfig(alias, [
    hostBlock(
      alias,
      [
        `UserKnownHostsFile ${known}`,
        `StrictHostKeyChecking ${mode}`,
        `HostKeyAlias ${alias}`,
        'HashKnownHosts no',
      ],
      ASK_WITHOUT,
    ),
  ]);
  await userSettings({
    'remote.SSH.configFile': file,
    'remote.SSH.remotePlatform': {[alias]: 'linux'},
    ...settings,
  });
}

/** The dialog the refusal of a connection shows when the key of the host changed. */
function changedDialog(alias: string): string {
  return `Could not establish connection to "${alias}": Remote host key has changed, port forwarding is disabled.`;
}

/** The questions of the failure dialogs window `window` showed. */
function failuresOf(window: string): string[] {
  return recordLines('failureDialog', window).map(line => line.question);
}

/** Waits for window `window` to show a failure dialog. */
function failureShown(window: string, milliseconds: number): Promise<void> {
  return waitFor(
    `${window} to show its failure dialog`,
    () => recordLines('failureDialog', window).length > 0,
    milliseconds,
  );
}

/** Waits for window `window` to be asked its fingerprint pick. */
function pickAsked(window: string): Promise<void> {
  return waitFor(
    `${window} to ask the fingerprint pick`,
    () => picksOf(window).length > 0,
    90_000,
  );
}

describe('host-key questions in a window (card #3019, F-2305)', function () {
  this.timeout(600_000);

  let saved: string | undefined;
  let fingerprint = '';

  before(async () => {
    saved = readUserSettings();
    fingerprint = (await harnessHostFingerprint()) ?? '';
  });

  after(() => {
    restoreUserSettings(saved);
  });

  it('F-2305 AC-11 (c3019-continue): Continue in the fingerprint pick connects the window, and ssh has written the host’s key', async () => {
    const alias = 'c3019-continue';
    const known = await asking(alias);
    appendScript([
      {surface: 'pick', match: 'fingerprint', answer: 'yes', window: alias},
    ]);
    try {
      await openWindow(alias, alias);
      await connectedWithin(alias, INSTALL_MILLISECONDS);
      const key = (await onHostAs('harness', 'cat', HOST_KEY_FILE))
        .trim()
        .split(/\s+/)
        .slice(0, 2);
      deepStrictEqual(
        [
          picksOf(alias),
          knownLines(known).length,
          knownLines(known)[0]?.split(/\s+/).slice(-2),
        ],
        [[`"${alias}" has fingerprint "${fingerprint}".`], 1, key],
      );
    } finally {
      await closeWindow(alias).catch(() => undefined);
    }
  });

  for (const [suffix, answer] of [
    ['no', 'no'],
    ['closed', 'dismiss'],
  ] as const) {
    it(`F-2305 AC-12, AC-13 (c3019-cancel-${suffix}): ${suffix === 'no' ? 'Cancel' : 'the pick closed with no choice'} ends in the failure dialog with no reason, leaves the known-hosts file empty, and leaves the window unconnected`, async () => {
      const alias = `c3019-cancel-${suffix}`;
      const known = await asking(alias);
      appendScript([
        {surface: 'pick', match: 'fingerprint', answer, window: alias},
        ...refusals(alias),
      ]);
      try {
        await openWindow(alias, alias);
        await waitFor(
          `${alias} to show the failure dialog`,
          () => recordLines('failureDialog', alias).length > 0,
          90_000,
        );
        await new Promise(resolve => setTimeout(resolve, 5000));
        deepStrictEqual(
          [
            recordLines('failureDialog', alias).map(line => line.question),
            knownLines(known),
            await connected(alias),
          ],
          [[`Could not establish connection to "${alias}".`], [], false],
        );
      } finally {
        await closeWindow(alias).catch(() => undefined);
      }
    });
  }

  it('F-2305 AC-9 (c3019-typed): a typed user@host gets the pick with the host part only', async () => {
    const alias = 'c3019-typed';
    const known = freshKnown(alias);
    const file = writeConfig(alias, [
      hostBlock(
        'localhost',
        [...askLines(known), 'HashKnownHosts no'],
        ASK_WITHOUT,
      ),
    ]);
    await userSettings({
      'remote.SSH.configFile': file,
      'remote.SSH.remotePlatform': {localhost: 'linux'},
    });
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), alias);
    mkdirSync(folder, {recursive: true});
    const first = await openFolderWindow(folder);
    let next: string | undefined;
    try {
      // The local folder window reloads as an empty remote window, whose name the next empty window has.
      const opened = nextEmptyName();
      appendScript([
        hostAnswer(first, {typed: 'harness@localhost'}),
        {surface: 'pick', match: 'fingerprint', answer: 'no', window: opened},
        ...refusals(opened),
      ]);
      next = await nextEmptyWindow(() =>
        inWindow(first, 'opensshremotes.openEmptyWindowInCurrentWindow'),
      );
      await pickAsked(next);
      deepStrictEqual(picksOf(next), [
        `"localhost" has fingerprint "${fingerprint}".`,
      ]);
    } finally {
      await closeWindow(next ?? first).catch(() => undefined);
    }
  });

  it('F-2305 AC-10 (c3019-md5): with FingerprintHash md5 the pick’s fingerprint is the MD5: one', async () => {
    const alias = 'c3019-md5';
    await asking(alias, ['FingerprintHash md5']);
    appendScript([
      {surface: 'pick', match: 'fingerprint', answer: 'no', window: alias},
      ...refusals(alias),
    ]);
    try {
      const hashed =
        (
          await onHostAs(
            'harness',
            'ssh-keygen',
            '-l',
            '-E',
            'md5',
            '-f',
            HOST_KEY_FILE,
          )
        )
          .trim()
          .split(' ')[1] ?? '';
      await openWindow(alias, alias);
      await pickAsked(alias);
      deepStrictEqual(picksOf(alias), [
        `"${alias}" has fingerprint "${hashed}".`,
      ]);
    } finally {
      await closeWindow(alias).catch(() => undefined);
    }
  });

  it('F-2305 AC-24 (c3019-keyalias): with HostKeyAlias the pick names the picked alias and ssh’s line names the key alias', async () => {
    const alias = 'c3019-keyalias';
    const known = await asking(alias, [
      'HostKeyAlias c3019-keyname',
      'HashKnownHosts no',
    ]);
    appendScript([
      {surface: 'pick', match: 'fingerprint', answer: 'yes', window: alias},
    ]);
    try {
      await openWindow(alias, alias);
      await connectedWithin(alias, INSTALL_MILLISECONDS);
      deepStrictEqual(
        [picksOf(alias), knownLines(known).map(line => line.split(/\s+/)[0])],
        [[`"${alias}" has fingerprint "${fingerprint}".`], ['c3019-keyname']],
      );
    } finally {
      await closeWindow(alias).catch(() => undefined);
    }
  });

  it('F-2305 AC-25 (c3019-visual): with VisualHostKey yes the pick’s title is the fingerprint alone, with no picture', async () => {
    const alias = 'c3019-visual';
    await asking(alias, ['VisualHostKey yes']);
    appendScript([
      {surface: 'pick', match: 'fingerprint', answer: 'no', window: alias},
      ...refusals(alias),
    ]);
    try {
      await openWindow(alias, alias);
      await pickAsked(alias);
      deepStrictEqual(picksOf(alias), [
        `"${alias}" has fingerprint "${fingerprint}".`,
      ]);
    } finally {
      await closeWindow(alias).catch(() => undefined);
    }
  });
  for (const mode of ['ask', 'yes', 'accept-new']) {
    it(`F-2305 AC-16, AC-28 (c3021-changed-${mode.replace('-', '')}): a changed key with StrictHostKeyChecking ${mode} fails at once with the reason that the key changed, asks nothing, and changes no file and no setting`, async () => {
      const alias = `c3021-changed-${mode.replace('-', '')}`;
      const known = changedKnown(alias);
      await checking(alias, known, mode);
      const settings = readUserSettings();
      appendScript(refusals(alias));
      try {
        const before = readFileSync(known, 'utf8');
        await openWindow(alias, alias);
        await failureShown(alias, 60_000);
        deepStrictEqual(
          {
            failures: failuresOf(alias),
            asked: [
              ...recordLines('pick', alias),
              ...recordLines('maskedInput', alias),
            ].length,
            known: readFileSync(known, 'utf8') === before,
            settingsKept: readUserSettings() === settings,
          },
          {
            failures: [changedDialog(alias)],
            asked: 0,
            known: true,
            settingsKept: true,
          },
        );
      } finally {
        await closeWindow(alias).catch(() => undefined);
      }
    });
  }

  it('F-2305 AC-17 (c3021-retry-changed): Retry on the changed key’s dialog gives the same dialog again and changes no file', async () => {
    const alias = 'c3021-retry-changed';
    const known = changedKnown(alias);
    await checking(alias, known, 'ask');
    const settings = readUserSettings();
    const again = nextEmptyName();
    appendScript([
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Retry'},
        window: alias,
      },
      ...refusals(again),
    ]);
    try {
      const before = readFileSync(known, 'utf8');
      await openWindow(alias, alias);
      await failureShown(again, 90_000);
      deepStrictEqual(
        {
          first: failuresOf(alias),
          second: failuresOf(again),
          known: readFileSync(known, 'utf8') === before,
          settingsKept: readUserSettings() === settings,
        },
        {
          first: [changedDialog(alias)],
          second: [changedDialog(alias)],
          known: true,
          settingsKept: true,
        },
      );
    } finally {
      await closeWindow(again).catch(() => undefined);
      await closeWindow(alias).catch(() => undefined);
    }
  });

  it('F-2305 AC-18 (c3021-changed-terminal): in terminal mode the dialog of a changed key has no reason', async () => {
    const alias = 'c3021-changed-terminal';
    const known = changedKnown(alias);
    const saved = readUserSettings();
    await checking(alias, known, 'ask', {'remote.SSH.useLocalServer': false});
    const settings = readUserSettings();
    appendScript(refusals(alias));
    try {
      const before = readFileSync(known, 'utf8');
      await openWindow(alias, alias);
      await failureShown(alias, 60_000);
      deepStrictEqual(
        {
          failures: failuresOf(alias),
          asked: picksOf(alias).length,
          known: readFileSync(known, 'utf8') === before,
          settingsKept: readUserSettings() === settings,
        },
        {
          failures: [`Could not establish connection to "${alias}".`],
          asked: 0,
          known: true,
          settingsKept: true,
        },
      );
    } finally {
      await closeWindow(alias).catch(() => undefined);
      restoreUserSettings(saved);
    }
  });

  it('F-2305 AC-34 (c3021-retry-pick): after a refused pick, Retry never accepts the key without Continue', async () => {
    const alias = 'c3021-retry-pick';
    const known = await asking(alias);
    const settings = readUserSettings();
    const again = nextEmptyName();
    appendScript([
      {surface: 'pick', match: 'fingerprint', answer: 'no', window: alias},
      {
        surface: 'failureDialog',
        match: 'Could not establish connection',
        answer: {button: 'Retry'},
        window: alias,
      },
      {surface: 'pick', match: 'fingerprint', answer: 'no', window: again},
      ...refusals(again),
    ]);
    try {
      await openWindow(alias, alias);
      await failureShown(again, 90_000);
      deepStrictEqual(
        {
          known: knownLines(known),
          failures: failuresOf(again),
          settingsKept: readUserSettings() === settings,
        },
        {
          known: [],
          failures: [`Could not establish connection to "${alias}".`],
          settingsKept: true,
        },
      );
    } finally {
      await closeWindow(again).catch(() => undefined);
      await closeWindow(alias).catch(() => undefined);
    }
  });
});
