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
    const before = await onHostAs(
      'harness',
      'sh',
      '-c',
      `cat ${remoteFile} 2>/dev/null; true`,
    );
    try {
      await onHostAs(
        'harness',
        'sh',
        '-c',
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
            await onHostAs(
              'root',
              'sh',
              '-c',
              `grep -rl ${ADDED} /home /root /etc/ssh 2>/dev/null; true`,
            )
          ).trim(),
          await notifications(window),
        ],
        [local, false, config, true, true, '', []],
      );
    } finally {
      await closeIfOpen(window);
      await closeWindow(window).catch(() => undefined);
      await onHostAs(
        'harness',
        'sh',
        '-c',
        before === ''
          ? `rm -f ${remoteFile}`
          : `printf '%s' '${before.replaceAll("'", "'\\''")}' > ${remoteFile}`,
      );
    }
  });
});
