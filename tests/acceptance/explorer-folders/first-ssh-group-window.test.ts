/**
 * @fileoverview The SSH group in a window connected through Remote - SSH (card coverage-102, #1809, part 2): the
 * hosts it lists and the files its two buttons offer, open and write are the local machine's, and nothing is written
 * on the SSH host. The file runs before folders.test.ts (the names run alphabetically): after it, the view lists the
 * folders of 122 visits and reading its rows scrolls for minutes. Its window is named outside the `c102-` prefix of the
 * rows that count their own history.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {
  activeEditorTextOf,
  closeWindow,
  inWindow,
  onHostAs,
  openWindow,
  startInWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {hostLabels, VIEW} from '../windows/explorer-rows.ts';
import {pickShown} from '../windows/explorer-home.ts';
import {closeIfOpen, connectedTo} from '../windows/explorer-folders.ts';
import {
  answerInputBox,
  chooseQuickPickRow,
  editorTabs,
  notifications,
  rowAction,
} from '../windows/renderer.ts';

const HOST = 'harness';
const GEAR = 'Open SSH Config File';
const PLUS = 'New Remote';
const GROUP = 'SSH';
const ADDED = 'c102-written-locally';

/** How long one step of the row may take, in milliseconds. */
const STEP_MILLISECONDS = 90_000;

/** How long the view of the SSH window is given to list the host that New Remote wrote, in milliseconds. */
const LISTING_MILLISECONDS = 300_000;

/** The result of `work`, or the error that names `step` once it takes longer than `milliseconds`, a step's time by default. */
async function within<Result>(
  step: string,
  work: Promise<Result>,
  milliseconds = STEP_MILLISECONDS,
): Promise<Result> {
  const expiry = new AbortController();
  const late = delay(milliseconds, undefined, {
    signal: expiry.signal,
  }).then(() => {
    throw new Error(`${step} took more than ${String(milliseconds)} ms`);
  });
  process.stderr.write(`ssh-window, ${step}: started\n`);
  const started = Date.now();
  try {
    return await Promise.race([work, late]);
  } finally {
    process.stderr.write(
      `ssh-window, ${step}: ${String(Date.now() - started)} ms\n`,
    );
    expiry.abort();
    late.catch(() => undefined);
  }
}

/** The output of the shell script `script` run on the SSH host as `user`. */
function onSshHost(
  step: string,
  user: string,
  script: string,
): Promise<string> {
  return within(step, onHostAs(user, 'sh', '-c', script));
}

describe('the SSH group in a window connected through Remote - SSH (card coverage-102, part 2)', function () {
  this.timeout(1_200_000);
  let configText = '';

  beforeEach(() => {
    configText = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
  });

  afterEach(() => {
    writeFileSync(variable('HARNESS_SSH_CONFIG'), configText);
  });

  it('F-5102 AC-20 (ssh-window): in an SSH window the hosts listed are exactly the local machine’s and none of the SSH account’s own, the picker offers the local file and opening it shows the local file, a completed New Remote writes the local file, and nothing is written on the SSH host', async () => {
    const window = 'g102-first';
    const config = variable('HARNESS_SSH_CONFIG');
    const remoteFile = '/home/harness/.ssh/config';
    const before = await onSshHost(
      'reading the SSH account’s config',
      'harness',
      `cat ${remoteFile} 2>/dev/null; true`,
    );
    try {
      await onSshHost(
        'adding the remote-only host',
        'harness',
        `mkdir -p /home/harness/.ssh && printf 'Host c102-remote-only\\n' >> ${remoteFile}`,
      );
      await within(
        'showing the Remote view in the local window',
        inWindow('local', 'workbench.view.remote'),
      );
      await within(`opening window ${window}`, openWindow(HOST, window));
      await within(`window ${window} connecting`, connectedTo(window, HOST));
      await within(
        `showing the Remote view in window ${window}`,
        inWindow(window, 'workbench.view.remote'),
      );
      const local = await within(
        'the local window listing hosts',
        waitFor(
          'the local window to list hosts',
          async () => (await hostLabels('local')).length > 0,
          30_000,
        ).then(() => hostLabels('local')),
      );
      const listed = await within(
        `window ${window} listing hosts`,
        waitFor(
          `window ${window} to list hosts`,
          async () => (await hostLabels(window)).length > 0,
          30_000,
        ).then(() => hostLabels(window)),
      );
      await within(
        'the gear of the SSH group',
        rowAction(window, VIEW, GROUP, GEAR),
      );
      const picker = await within('the picker of the gear', pickShown(window));
      await within(
        'choosing the local file',
        chooseQuickPickRow(window, config),
      );
      await within(
        `window ${window} opening the local file`,
        waitFor(
          `window ${window} to open the local file`,
          async () =>
            (await editorTabs(window)).some(
              entry => entry.label === path.basename(config),
            ),
          30_000,
        ),
      );
      const opened = await within(
        'reading the open file',
        activeEditorTextOf(window),
      );
      await within(
        'closing the editors',
        startInWindow(window, 'workbench.action.closeAllEditors'),
      );
      await within(
        'the plus of the SSH group',
        rowAction(window, VIEW, GROUP, PLUS),
      );
      await within('the first picker of New Remote', pickShown(window));
      await within(
        'typing the host line',
        answerInputBox(window, `ssh ${ADDED}`),
      );
      await within('the second picker of New Remote', pickShown(window));
      await within(
        'choosing the file to write',
        chooseQuickPickRow(window, config),
      );
      // The write is waited for in the file itself; the view of the SSH window follows it by its own refresh, which on a
      // slow runner took more than a minute, so the listing is given five.
      await within(
        `the local file holding ${ADDED}`,
        waitFor(
          `the local file to hold ${ADDED}`,
          () => Promise.resolve(readFileSync(config, 'utf8').includes(ADDED)),
          60_000,
        ),
      );
      await within(
        `window ${window} listing ${ADDED}`,
        waitFor(
          `window ${window} to list ${ADDED}`,
          async () => (await hostLabels(window)).includes(ADDED),
          LISTING_MILLISECONDS,
        ),
        LISTING_MILLISECONDS + STEP_MILLISECONDS,
      );
      deepStrictEqual(
        [
          listed,
          listed.includes('c102-remote-only'),
          picker.rows[0],
          opened?.includes(`Host ${HOST}`),
          readFileSync(config, 'utf8').includes(`Host ${ADDED}`),
          (
            await onSshHost(
              'searching the SSH host for the added host',
              'root',
              `timeout 90 grep -rlD skip ${ADDED} /home /root /etc/ssh 2>/dev/null; true`,
            )
          ).trim(),
          await within('reading the notifications', notifications(window)),
        ],
        [local, false, config, true, true, '', []],
      );
    } finally {
      await onSshHost(
        'restoring the SSH account’s config',
        'harness',
        before === ''
          ? `rm -f ${remoteFile}`
          : `printf '%s' '${before.replaceAll("'", "'\\''")}' > ${remoteFile}`,
      );
      await within(`closing window ${window}`, closeIfOpen(window));
      await within(
        `closing window ${window} again`,
        closeWindow(window).catch(() => undefined),
      );
    }
  });
});
