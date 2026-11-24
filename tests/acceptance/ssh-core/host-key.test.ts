/**
 * @fileoverview The fingerprint pick of a window in the classic wording (F-2305): what it names, what Continue, Cancel and a
 * close with no choice leave in the known-hosts file, and the keywords that change its title.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync} from 'node:fs';
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

/** Answers the fingerprint pick of the window `alias` with `answer` and checks the failure dialog, the known-hosts file and that the window is unconnected. */
async function cancelledPick(
  alias: string,
  answer: 'no' | 'dismiss',
): Promise<void> {
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

  it('F-2305 AC-12, AC-13 (c3019-cancel-no): Cancel ends in the failure dialog with no reason, leaves the known-hosts file empty, and leaves the window unconnected', async () => {
    await cancelledPick('c3019-cancel-no', 'no');
  });

  it('F-2305 AC-12, AC-13 (c3019-cancel-closed): the pick closed with no choice, which is how Escape and a loss of focus reach the extension, ends in the failure dialog with no reason, leaves the known-hosts file empty, and leaves the window unconnected', async () => {
    await cancelledPick('c3019-cancel-closed', 'dismiss');
  });

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
});
