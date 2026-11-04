/**
 * @fileoverview The SSH group in a window connected through Remote - SSH (card coverage-102, #1809, part 2): the
 * hosts it lists and the files its two buttons offer, open and write are the local machine's, and nothing is written
 * on the SSH host.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
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

/** How long one command on the SSH host may take, in milliseconds. */
const HOST_COMMAND_MILLISECONDS = 120_000;

/** The output of the shell script `script` run on the SSH host as `user`, or the error that names `step` once it takes too long. */
async function onSshHost(
  step: string,
  user: string,
  script: string,
): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${step} took more than ${String(HOST_COMMAND_MILLISECONDS)} ms on the SSH host`,
        ),
      );
    }, HOST_COMMAND_MILLISECONDS);
  });
  try {
    return await Promise.race([onHostAs(user, 'sh', '-c', script), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

describe('the SSH group in a window connected through Remote - SSH (card coverage-102, part 2)', function () {
  this.timeout(600_000);
  let configText = '';

  beforeEach(() => {
    configText = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
  });

  afterEach(() => {
    writeFileSync(variable('HARNESS_SSH_CONFIG'), configText);
  });

  it('F-5102 AC-20 (ssh-window): in an SSH window the hosts listed are exactly the local machine’s and none of the SSH account’s own, the picker offers the local file and opening it shows the local file, a completed New Remote writes the local file, and nothing is written on the SSH host', async () => {
    const window = 'c102-g1';
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
      await inWindow('local', 'workbench.view.remote');
      await openWindow(HOST, window);
      await connectedTo(window, HOST);
      await inWindow(window, 'workbench.view.remote');
      const local = await waitFor(
        'the local window to list hosts',
        async () => (await hostLabels('local')).length > 0,
        30_000,
      ).then(() => hostLabels('local'));
      const listed = await waitFor(
        `window ${window} to list hosts`,
        async () => (await hostLabels(window)).length > 0,
        30_000,
      ).then(() => hostLabels(window));
      await rowAction(window, VIEW, GROUP, GEAR);
      const picker = await pickShown(window);
      await chooseQuickPickRow(window, config);
      await waitFor(
        `window ${window} to open the local file`,
        async () =>
          (await editorTabs(window)).some(
            entry => entry.label === path.basename(config),
          ),
        30_000,
      );
      const opened = await activeEditorTextOf(window);
      await startInWindow(window, 'workbench.action.closeAllEditors');
      await rowAction(window, VIEW, GROUP, PLUS);
      await pickShown(window);
      await answerInputBox(window, `ssh ${ADDED}`);
      await pickShown(window);
      await chooseQuickPickRow(window, config);
      await waitFor(
        `window ${window} to list ${ADDED}`,
        async () => (await hostLabels(window)).includes(ADDED),
        20_000,
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
          await notifications(window),
        ],
        [local, false, config, true, true, '', []],
      );
    } finally {
      await closeIfOpen(window);
      await closeWindow(window).catch(() => undefined);
      await onSshHost(
        'restoring the SSH account’s config',
        'harness',
        before === ''
          ? `rm -f ${remoteFile}`
          : `printf '%s' '${before.replaceAll("'", "'\\''")}' > ${remoteFile}`,
      );
    }
  });
});
