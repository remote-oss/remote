/**
 * @fileoverview The SSH group in a window connected through Remote - SSH (card coverage-102, #1809, part 2): the
 * hosts it lists and the files its two buttons offer, open and write are the local machine's, and nothing is written
 * on the SSH host.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import {
  closeWindow,
  inWindow,
  onHostAs,
  openWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {hostLabels, VIEW} from '../windows/explorer-rows.ts';
import {closePick, pickShown} from '../windows/explorer-home.ts';
import {closeIfOpen, connectedTo} from '../windows/explorer-folders.ts';
import {
  answerInputBox,
  chooseQuickPickRow,
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

  it('F-5102 AC-20 (ssh-window): in an SSH window the hosts listed are the local machine’s, the picker offers the local file, a completed New Remote writes the local file, and nothing is written on the SSH host', async () => {
    const window = 'c102-g1';
    await openWindow(HOST, window);
    try {
      await connectedTo(window, HOST);
      await inWindow(window, 'workbench.view.remote');
      const config = variable('HARNESS_SSH_CONFIG');
      const listed = await waitFor(
        `window ${window} to list hosts`,
        async () => (await hostLabels(window)).length > 0,
        30_000,
      ).then(() => hostLabels(window));
      await rowAction(window, VIEW, GROUP, GEAR);
      const picker = await pickShown(window);
      await closePick(window);
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
          listed.includes(HOST),
          picker.rows[0],
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
        [true, config, true, '', []],
      );
    } finally {
      await closeIfOpen(window);
      await closeWindow(window).catch(() => undefined);
    }
  });
});
